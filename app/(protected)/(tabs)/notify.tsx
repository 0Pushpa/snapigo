// app/(protected)/(tabs)/notify.tsx
import '@/lib/geo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  initGeo,
  notifyOnceIfInsideNowFromSupabase,
  registerFromCoupons,
  registerFromSupabase,
  registerSingleTestHere,
  stopAllGeofences,
} from '../../../lib/geo';
import { supabase } from '../../../lib/supabase';

/* ------------------------ Local storage keys ------------------------ */

const INBOX_KEY = 'snapigo_inbox';           // list of notifications we show in Notify tab
const UNREAD_KEY = 'snapigo_unread_count';   // numeric unread count for badge

type InboxItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string; // ISO string
  read: boolean;
};

/* ------------------------ Local helpers (iOS-first) ------------------------ */

async function ensureNotifPermissions(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();

  const authorized =
    !!cur.granted ||
    cur.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    cur.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (authorized) return true;

  const req = await Notifications.requestPermissionsAsync();
  return (
    !!req.granted ||
    req.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

async function notifStatusLabel(): Promise<string> {
  const s = await Notifications.getPermissionsAsync();
  if (s.ios?.status === Notifications.IosAuthorizationStatus.DENIED) return 'denied';
  if (s.ios?.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED)
    return 'not_determined';
  if (s.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL)
    return 'provisional';
  if (s.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL)
    return 'ephemeral';
  if (s.granted || s.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED)
    return 'authorized';
  return 'unknown';
}

// 🔹 Persist inbox + keep unread count in sync
async function saveInbox(inbox: InboxItem[]) {
  try {
    await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(inbox));
  } catch {
    // ignore
  }
}

async function loadInbox(): Promise<InboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(INBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function updateUnreadCount(inbox: InboxItem[]) {
  try {
    const unread = inbox.filter((n) => !n.read).length;
    await AsyncStorage.setItem(UNREAD_KEY, String(unread));
  } catch {
    // ignore
  }
}

async function sendNow(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: null, // immediate
  });
}

function openAppSettings() {
  try {
    Linking.openSettings();
  } catch {
    Alert.alert('Open Settings', 'Open iOS Settings → Snapigo to enable permissions.');
  }
}

/* -------------- small util to parse "lat,lng" text quickly --------------- */
function parseLatLng(input: string): { lat: number; lng: number } | null {
  const t = input.trim();
  const m = t.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

/* --------------------------------- Screen --------------------------------- */

export default function NotifyTab() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  // diagnostics
  const [notifStatus, setNotifStatus] = useState<string>('checking…');
  const [locFg, setLocFg] = useState<string>('checking…');
  const [locBg, setLocBg] = useState<string>('checking…');

  // inbox for showing "actual notifications"
  const [inbox, setInbox] = useState<InboxItem[]>([]);

  // Ad-hoc test fields
  const [placeInput, setPlaceInput] = useState<string>(''); // address or "lat,lng"
  const [radiusInput, setRadiusInput] = useState<string>('250'); // meters

  // 🔁 Load inbox + attach listener for new notifications
  useEffect(() => {
    let isMounted = true;

    const initInboxAndListener = async () => {
      const stored = await loadInbox();
      if (isMounted) setInbox(stored);

      // When any notification is received while app is foreground,
      // mirror it into our inbox so it shows in this tab.
      const sub = Notifications.addNotificationReceivedListener(async (notification) => {
        const content = notification.request.content;
        const newItem: InboxItem = {
          id: notification.request.identifier || String(Date.now()),
          title: content.title || 'Snapigo alert',
          body: content.body || '',
          createdAt: new Date().toISOString(),
          read: false,
        };

        // Prepend newest
        setInbox((prev) => {
          const updated = [newItem, ...prev];
          // Fire and forget persistence + unread count
          saveInbox(updated);
          updateUnreadCount(updated);
          return updated;
        });
      });

      return () => {
        sub.remove();
      };
    };

    let cleanup: (() => void) | undefined;

    initInboxAndListener().then((c) => {
      cleanup = c;
    });

    return () => {
      isMounted = false;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    (async () => {
      await ensureNotifPermissions();
      setNotifStatus(await notifStatusLabel());

      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();
      setLocFg(fg.status);
      setLocBg(bg.status);

      const ok = await initGeo(); // asks for anything missing & wires background task
      setReady(ok);
    })();
  }, []);

  const refreshDiag = async () => {
    setNotifStatus(await notifStatusLabel());
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    setLocFg(fg.status);
    setLocBg(bg.status);
  };

  const guardNotif = async () => {
    const ok = await ensureNotifPermissions();
    if (!ok) {
      Alert.alert('Notifications disabled', 'Allow “Banners” for Snapigo to see alerts.', [
        { text: 'Open Settings', onPress: openAppSettings },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
    return ok;
  };

  // 🔹 Mark a single notification as read when user taps it
  const handleNotificationPress = async (id: string) => {
    const updated = inbox.map((item) =>
      item.id === id ? { ...item, read: true } : item
    );
    setInbox(updated);
    await saveInbox(updated);
    await updateUnreadCount(updated);
  };

  // Optional: clear all notifications (and badge)
  const clearAll = async () => {
    setInbox([]);
    await saveInbox([]);
    await updateUnreadCount([]);
  };

  /* -------------------------- Existing action flows ------------------------- */

  const registerSaved = async () => {
    try {
      setLoading(true);
      if (!(await guardNotif())) return;

      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const uid = data.session?.user?.id;
      if (!uid) {
        Alert.alert('Not signed in', 'Please sign in first.');
        return;
      }

      const res = await registerFromSupabase(uid);
      await refreshDiag();
      Alert.alert('Geofences active', `Registered ${res.count} places.`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const testHere = async () => {
    try {
      setLoading(true);
      if (!(await guardNotif())) return;

      await registerSingleTestHere();
      await refreshDiag();
      Alert.alert('Test region set', 'Dropped a geofence here and fired one banner.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const checkInsideOnce = async () => {
    try {
      setLoading(true);
      if (!(await guardNotif())) return;

      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const uid = data.session?.user?.id;
      if (!uid) {
        Alert.alert('Not signed in', 'Please sign in first.');
        return;
      }

      const res: any = await notifyOnceIfInsideNowFromSupabase(uid, 350);
      await refreshDiag();

      if (res.fired) {
        Alert.alert('Already inside', 'Sent a banner for one nearby saved place.');
      } else {
        const nearest = res.nearestDistanceM;
        Alert.alert(
          'No banner (once)',
          nearest != null
            ? `Reason: ${res.reason}. Nearest saved place is ~${nearest} m away.`
            : `Reason: ${res.reason ?? 'outside'}.`
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const sendLocalTest = async () => {
    try {
      setLoading(true);
      if (!(await guardNotif())) return;

      await sendNow('Snapigo Test', 'Local notification works 🎉');
      await refreshDiag();
      // The actual notification content will be added to inbox
      // by the Notifications.addNotificationReceivedListener above
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const resetAll = async () => {
    try {
      setLoading(true);
      await stopAllGeofences();
      await AsyncStorage.removeItem('snapigo_notif_state');
      await AsyncStorage.removeItem('snapigo_region_meta');
      // Do NOT clear inbox here automatically; that's user-facing history.
      await refreshDiag();
      Alert.alert('Reset complete', 'Stopped geofences and cleared throttle/meta.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  /* -------------------------- Ad-hoc address/coords ------------------------- */

  const adHocTest = async () => {
    try {
      setLoading(true);
      if (!(await guardNotif())) return;

      const txt = placeInput.trim();
      if (!txt.length) {
        Alert.alert('Missing location', 'Enter an address or "lat,lng".');
        return;
      }

      // get coordinates (parse "lat,lng" or geocode address)
      let coords = parseLatLng(txt);
      let geocodedFrom = 'coords';
      if (!coords) {
        const res = await Location.geocodeAsync(txt);
        if (!res || !res.length) {
          Alert.alert('Not found', 'Could not geocode that address.');
          return;
        }
        coords = { lat: res[0].latitude, lng: res[0].longitude };
        geocodedFrom = 'address';
      }

      // radius
      const r = Math.max(150, Math.min(800, Number(radiusInput) || 250)); // keep within our geo.ts bounds

      // Build a synthetic coupon and reuse geo.ts registerFromCoupons (this sets metadata,
      // starts geofencing, and fires ONE banner if you’re already inside)
      const fakeId = `ADHOC_${Date.now()}`;
      const res = await registerFromCoupons([
        {
          id: fakeId,
          title: 'Ad-hoc test area',
          valid_to: undefined, // keep type happy
          store: {
            lat: coords.lat,
            lng: coords.lng,
            radius_m: r,
            default_radius_m: r,
            name: 'Custom spot',
          },
        },
      ]);

      await refreshDiag();

      // Also compute distance now and tell you explicitly
      const me = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const dist = haversine(me.coords.latitude, me.coords.longitude, coords.lat, coords.lng);
      const inside = dist <= r;

      Alert.alert(
        inside ? 'Inside this area' : 'Outside this area',
        `${
          geocodedFrom === 'address' ? 'Geocoded' : 'Parsed'
        } at (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}).
Radius: ${Math.round(r)} m. Distance now: ${Math.round(dist)} m.
${
  inside
    ? 'Sent a banner (once) and registered this region.'
    : 'Region registered; you will get a banner on entry.'
}
Registered regions: ${res.count}.`
      );
    } catch (e: any) {
      Alert.alert('Ad-hoc error', e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  /* ---------- SCROLL/KEYBOARD AWARE LAYOUT ---------- */
  const TAB_BAR_HEIGHT = 86; // typical bottom tab height
  const keyboardOffset = Platform.select({
    ios: TAB_BAR_HEIGHT + insets.bottom,
    android: 0,
  }) as number;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#ffebd5' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardOffset}
      >
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 24 + insets.bottom + TAB_BAR_HEIGHT, // keep content above keyboard & tab bar
            gap: 12,
            backgroundColor: '#ffebd5',
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Nearby Alerts</Text>
            <Text style={styles.subtitle}>
              Get a ping when you’re near your saved deals.
            </Text>
          </View>

          {/* Status banner */}
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor: ready ? '#DCFCE7' : '#FFEFD1',
                borderColor: ready ? '#86EFAC' : '#FCD34D',
              },
            ]}
          >
            <Text style={styles.statusEmoji}>{ready ? '🟢' : '🟡'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>
                {ready ? 'Ready to alert' : 'Almost there'}
              </Text>
              <Text style={styles.statusText}>
                {ready
                  ? 'Permissions OK.'
                  : 'Allow Notifications (Banners) and Location (Always + Precise).'}
              </Text>
            </View>
            <Pressable onPress={openAppSettings}>
              <Text style={{ color: '#2563eb', fontWeight: '700' }}>Settings</Text>
            </Pressable>
          </View>

          {/* 🔵 Recent notifications list (what you see as popup at the top) */}
          <View style={styles.card}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={styles.cardTitle}>Recent notifications</Text>
              {inbox.length > 0 && (
                <Pressable onPress={clearAll}>
                  <Text style={{ fontSize: 12, color: '#6b7280' }}>Clear all</Text>
                </Pressable>
              )}
            </View>

            {inbox.length === 0 ? (
              <Text style={{ color: '#6b7280' }}>
                No notifications stored yet. When alerts pop up, you’ll see them here.
              </Text>
            ) : (
              inbox.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => handleNotificationPress(item.id)}
                  style={[
                    styles.inboxRow,
                    !item.read && { backgroundColor: '#eff6ff' },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontWeight: item.read ? '600' : '800',
                        color: '#111827',
                      }}
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                    {!!item.body && (
                      <Text
                        style={{ color: '#4b5563', fontSize: 12, marginTop: 2 }}
                        numberOfLines={2}
                      >
                        {item.body}
                      </Text>
                    )}
                    <Text
                      style={{ color: '#9ca3af', fontSize: 10, marginTop: 4 }}
                    >
                      {new Date(item.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  {!item.read && <View style={styles.unreadDot} />}
                </Pressable>
              ))
            )}
          </View>

          {/* Actions */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Actions</Text>

            <ActionButton
              label="Register from Saved Coupons"
              caption="Turn your saved stores into geofences."
              emoji="📍"
              onPress={registerSaved}
              disabled={!ready || loading}
              kind="primary"
            />

            <ActionButton
              label="Register Single Test (Here)"
              caption="Drop a test geofence at your current spot."
              emoji="🧪"
              onPress={testHere}
              disabled={!ready || loading}
            />

            <ActionButton
              label="Check Inside Any Saved (Once)"
              caption="If already inside a saved place, send one banner now."
              emoji="🔎"
              onPress={checkInsideOnce}
              disabled={!ready || loading}
            />

            <ActionButton
              label="Send Test Notification"
              caption="Fire a quick local notification."
              emoji="🔔"
              onPress={sendLocalTest}
              disabled={loading}
            />

            <ActionButton
              label="Reset Geofences & Throttle"
              caption="Stop geofences and clear daily/cooldown limits."
              emoji="♻️"
              onPress={resetAll}
              disabled={loading}
            />

            {loading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator />
                <Text style={styles.loadingText}>Working on it…</Text>
              </View>
            )}
          </View>

          {/* Ad-hoc test (address or lat,lng) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ad-hoc Test (Address or Coords)</Text>

            <View style={styles.inputRow}>
              <Text style={styles.inputLabel}>Location</Text>
              <TextInput
                style={styles.input}
                placeholder='e.g., "1600 Amphitheatre Pkwy, Mountain View" or "42.96,-85.67"'
                placeholderTextColor="#9CA3AF"
                value={placeInput}
                onChangeText={setPlaceInput}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
            </View>

            <View style={styles.inputRow}>
              <Text style={styles.inputLabel}>Radius (m)</Text>
              <TextInput
                style={styles.input}
                placeholder="250"
                placeholderTextColor="#9CA3AF"
                value={radiusInput}
                onChangeText={setRadiusInput}
                keyboardType="number-pad"
                returnKeyType="done"
              />
            </View>

            <ActionButton
              label="Ad-hoc Test This Place"
              caption="Registers one region at that spot and tells you if you're inside now."
              emoji="🧭"
              onPress={adHocTest}
              disabled={!ready || loading}
              kind="primary"
            />
          </View>

          {/* Tips */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tips</Text>
            <TipRow
              emoji="🌐"
              text="iPhone Settings → Snapigo → Location → Always + Precise."
            />
            <TipRow
              emoji="🔔"
              text="iPhone Settings → Snapigo → Notifications → Allow + Banners."
            />
            <TipRow emoji="🧭" text="Open the app occasionally to refresh geofences." />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ------------------------------- UI bits ------------------------------- */

function ActionButton({
  emoji,
  label,
  caption,
  onPress,
  disabled,
  kind = 'secondary',
}: {
  emoji: string;
  label: string;
  caption?: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary';
}) {
  const base = [
    styles.actionBtn,
    kind === 'primary' ? styles.actionPrimary : styles.actionSecondary,
    disabled && { opacity: 0.5 },
  ];
  const labelStyle = [
    styles.actionLabel,
    kind === 'primary' ? { color: '#fff' } : { color: '#1f2937' },
  ];
  const captionStyle = [
    styles.actionCaption,
    kind === 'primary' ? { color: '#eef2ff' } : { color: '#6b7280' },
  ];

  return (
    <Pressable
      style={({ pressed }) => [base, pressed && { transform: [{ scale: 0.99 }] }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.actionEmoji}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={labelStyle}>{label}</Text>
        {caption ? <Text style={captionStyle}>{caption}</Text> : null}
      </View>
      <Text style={kind === 'primary' ? styles.chevLight : styles.chevDark}>›</Text>
    </Pressable>
  );
}

function TipRow({ emoji, text }: { emoji: string; text: string }) {
  return (
    <View style={styles.tipRow}>
      <Text style={{ fontSize: 16 }}>{emoji}</Text>
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <Text style={{ color: '#6b7280', width: 120 }}>{label}</Text>
      <Text style={{ color: '#111827', fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

/* ------------------------------- Math util ------------------------------- */

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371e3; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ------------------------------- Styles ------------------------------- */

const styles = StyleSheet.create({
  header: { paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 24, fontWeight: '900', color: '#5a4636' },
  subtitle: { color: '#6b5b4d', marginTop: 4 },

  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    backgroundColor: '#FFEFD1',
  },
  statusEmoji: { fontSize: 18 },
  statusTitle: { fontWeight: '800', color: '#1f2937' },
  statusText: { color: '#374151', marginTop: 2, fontSize: 12 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f2caa1',
    padding: 12,
    gap: 10,
  },
  cardTitle: { fontWeight: '800', color: '#5a4636' },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 2,
    gap: 12,
  },
  actionPrimary: {
    backgroundColor: '#2563eb',
    borderColor: '#1d4ed8',
  },
  actionSecondary: {
    backgroundColor: '#ffffff',
    borderColor: '#f2caa1',
  },
  actionEmoji: { fontSize: 20 },
  actionLabel: { fontSize: 16, fontWeight: '900' },
  actionCaption: { fontSize: 12, marginTop: 2 },

  chevLight: { fontSize: 28, color: '#fff', paddingHorizontal: 4, lineHeight: 20 },
  chevDark: { fontSize: 28, color: '#6b7280', paddingHorizontal: 4, lineHeight: 20 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 },
  loadingText: { color: '#6b7280' },

  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  tipText: { color: '#374151', flex: 1, lineHeight: 18 },

  inputRow: { gap: 6 },
  inputLabel: { color: '#6b7280', fontSize: 12, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
  },

  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginTop: 4,
    gap: 8,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#2563eb',
    marginLeft: 6,
  },
});
