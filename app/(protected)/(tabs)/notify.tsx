import '@/lib/geo';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import { initGeo, registerFromSupabase, registerSingleTestHere } from '../../../lib/geo';
import { supabase } from '../../../lib/supabase';

export default function NotifyTab() {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => { (async () => setReady(await initGeo()))(); }, []);

  const registerSaved = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const uid = data.session?.user?.id;
      if (!uid) { Alert.alert('Not signed in', 'Please sign in first.'); return; }

      const res = await registerFromSupabase(uid);
      Alert.alert('Geofences active', `Registered ${res.count} places.`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const sendLocalTest = () =>
    Notifications.scheduleNotificationAsync({
      content: { title: 'Test', body: 'Local notif works' },
      trigger: null,
    });

  return (
    <View style={styles.wrap}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Nearby Alerts</Text>
        <Text style={styles.subtitle}>Get a ping when you’re near your saved deals.</Text>
      </View>

      {/* Status banner */}
      <View style={[styles.statusBanner, { backgroundColor: ready ? '#DCFCE7' : '#FFEFD1', borderColor: ready ? '#86EFAC' : '#FCD34D' }]}>
        <Text style={styles.statusEmoji}>{ready ? '🟢' : '🟡'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusTitle}>{ready ? 'Ready to alert' : 'Almost there'}</Text>
          <Text style={styles.statusText}>
            {ready
              ? 'Location & notifications are enabled.'
              : 'Grant location + notification permissions to activate alerts.'}
          </Text>
        </View>
      </View>

      {/* Actions card */}
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
          onPress={registerSingleTestHere}
          disabled={!ready || loading}
        />
        <ActionButton
          label="Send Test Notification"
          caption="Fire a quick local test notification."
          emoji="🔔"
          onPress={sendLocalTest}
          disabled={loading}
        />

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>Working on it…</Text>
          </View>
        )}
      </View>

      {/* Tips card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tips</Text>
        <TipRow emoji="🌐" text="Keep Location set to “Always” so alerts work even when the app is closed." />
        <TipRow emoji="🧭" text="If alerts feel quiet, open the app once to refresh geofences." />
        <TipRow emoji="🏷️" text="Save more coupons to add more places to watch." />
      </View>
    </View>
  );
}

/* ---------- Small UI bits ---------- */

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
  const labelStyle = [styles.actionLabel, kind === 'primary' ? { color: '#fff' } : { color: '#1f2937' }];
  const captionStyle = [styles.actionCaption, kind === 'primary' ? { color: '#eef2ff' } : { color: '#6b7280' }];

  return (
    <Pressable style={({ pressed }) => [base, pressed && { transform: [{ scale: 0.99 }] }]} onPress={onPress} disabled={disabled}>
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

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#ffebd5',
    padding: 16,
    gap: 12,
  },

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
});
