// lib/geo.ts
// Geofencing + local notifications for Snapigo.
// - Defines a background task for geofence ENTER events
// - Registers regions from your Supabase coupons table
// - Sends local notifications when you enter a saved place
// - Includes helpers for testing and "notify now if already inside"

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';

/* ----------------------------------------------------------------------------
 * Types
 * --------------------------------------------------------------------------*/
type Store = {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  default_radius_m?: number; // optional per-store radius override
  radius_m?: number;         // optional per-coupon radius override
};

type Row = {
  id: string;
  title?: string | null;
  expires_at?: string | null;
  store?: string | null;   // store name (optional)
  attrs?: any;             // expects attrs.address and optional attrs.geo.{lat,lng}
};

/* ----------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------*/
const TASK = 'SNAPIGO_GEOFENCE_TASK';           // Geofencing task name
const META_KEY = 'snapigo_region_meta';         // Stored notif metadata per region
const STATE_KEY = 'snapigo_notif_state';        // Anti-spam throttle state
const MAX_REGIONS = 18;                         // Keep under iOS ~20 region cap
const DAILY_CAP = 3;                            // Max notifications per day
const COOLDOWN_H = 24;                          // Per-coupon cooldown (hours)
const MIN_RADIUS = 150;                         // iOS geofencing is coarse; keep >=150m
const MAX_RADIUS = 800;                         // Don't spam huge circles
const DEFAULT_RADIUS = 250;                     // Fallback radius when not provided

/* ----------------------------------------------------------------------------
 * Notification handler (set once). This decides how notifs show on iOS.
 * --------------------------------------------------------------------------*/
// Guard across hot reloads/dev client
if (!(globalThis as any).__SNAPIGO_NOTIF_HANDLER_SET__) {
  Notifications.setNotificationHandler({
    // Use Banner/List on iOS (replaces deprecated shouldShowAlert)
    handleNotification: async (): Promise<Notifications.NotificationBehavior> => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  (globalThis as any).__SNAPIGO_NOTIF_HANDLER_SET__ = true;
}

/* ----------------------------------------------------------------------------
 * Background geofence task (define once)
 * - iOS wakes your app and calls this when you ENTER a region
 * --------------------------------------------------------------------------*/
if (!(globalThis as any).__SNAPIGO_TASK_DEFINED__) {
  TaskManager.defineTask(TASK, async ({ data, error }) => {
    if (error) return;

    const { eventType, region } = (data as any) || {};
    if (eventType !== Location.GeofencingEventType.Enter) return;

    // Retrieve the message we saved for this region ID when we registered it
    const metaStr = await AsyncStorage.getItem(META_KEY);
    const meta = metaStr ? JSON.parse(metaStr) : {};
    const entry = meta[region?.identifier] || {};
    const key = entry.merchantId || entry.couponId || region?.identifier; // throttle key

    // Respect anti-spam limits (daily cap & per-key cooldown)
    if (!(await allowNotify(key))) return;

    // Fire the local notification
    await Notifications.scheduleNotificationAsync({
      content: {
        title: entry.title || 'Nearby deal',
        body: entry.body || 'You saved a coupon here.',
        data: { couponId: entry.couponId || null },
      },
      trigger: null, // fire immediately
    });

    await markNotified(key);
  });

  (globalThis as any).__SNAPIGO_TASK_DEFINED__ = true;
}

/* ----------------------------------------------------------------------------
 * Public API
 * --------------------------------------------------------------------------*/

/**
 * Request notifications + location (foreground + background) permissions.
 * Call this from UI before registering geofences.
 */
export async function initGeo() {
  const n = await Notifications.requestPermissionsAsync();
  if (n.status !== 'granted') return false;

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return false;

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return false;

  return true;
}

/**
 * Fetch coupons from Supabase and register geofences for them.
 * - Expects your "coupons" table to have: id, title, expires_at, store, attrs
 * - attrs.address is used to geocode if lat/lng is missing
 */
export async function registerFromSupabase(ownerId: string) {
  const { data, error } = await supabase
    .from('coupons')
    .select('id,title,expires_at,store,attrs')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const coupons = (data || []).map((row: Row) => {
    const attrs = row.attrs || {};
    const storeObj: Store = {
      name: row.store || attrs.store?.name,
      address: attrs.address || attrs.store?.address,
      lat: attrs.geo?.lat ?? attrs.lat,
      lng: attrs.geo?.lng ?? attrs.lng,
      default_radius_m: attrs.default_radius_m,
      radius_m: attrs.radius_m,
    };
    return {
      id: row.id,
      title: row.title || undefined,
      valid_to: row.expires_at || undefined,
      store: storeObj,
    };
  });

  return registerFromCoupons(coupons);
}

/**
 * Register geofences from an in-memory list:
 * [{ id, title, valid_to, store: { address | lat | lng | radius } }, ...]
 * - Ensures coordinates (geocodes address if needed)
 * - Ranks by distance and "expiring soon"
 * - Registers up to MAX_REGIONS
 * - Immediately notifies once if you're already inside any region
 */
export async function registerFromCoupons(
  coupons: Array<{ id: string; title?: string; valid_to?: string; store: Store }>
) {
  // Current device position (reference point for scoring + inside-now check)
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const anchor = { lat: pos.coords.latitude, lng: pos.coords.longitude };

  // Ensure coords for each coupon (use saved lat/lng, else geocode address)
  const withCoords: Array<{
    id: string; title?: string; valid_to?: string;
    store: Required<Pick<Store, 'lat' | 'lng'>> & Store
  }> = [];

  for (const c of coupons) {
    let lat = c.store.lat, lng = c.store.lng;

    if ((lat == null || lng == null) && c.store.address) {
      try {
        const res = await Location.geocodeAsync(c.store.address);
        if (res?.length) { lat = res[0].latitude; lng = res[0].longitude; }
      } catch {
        // ignore geocoding errors; coupon will be skipped if coords remain missing
      }
    }

    if (lat != null && lng != null) {
      withCoords.push({ ...c, store: { ...c.store, lat, lng } as any });
    }
  }

  // Score by distance and boost if expiring within ~14 days (lower score = better)
  const scored = withCoords
    .map((c) => {
      const dist = haversine(anchor.lat, anchor.lng, c.store.lat!, c.store.lng!); // meters
      const expBoost = Math.max(0, 1 - daysUntil(c.valid_to) / 14); // 0..1
      return { c, score: dist - expBoost * 500 };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_REGIONS);

  // Build region list
  const regions = scored.map(({ c }) => ({
    identifier: c.id,
    latitude: c.store.lat!,
    longitude: c.store.lng!,
    radius: clampRadius(c.store.default_radius_m ?? c.store.radius_m ?? DEFAULT_RADIUS),
    notifyOnEnter: true,
    notifyOnExit: false,
  }));

  // Persist metadata used by the background task to compose notifications
  const meta: Record<string, any> = {};
  scored.forEach(({ c }) => {
    meta[c.id] = {
      couponId: c.id,
      title: c.title || (c.store.name ? `Nearby: ${c.store.name}` : 'Nearby deal'),
      body: c.valid_to
        ? `Valid until ${new Date(c.valid_to).toLocaleDateString()}`
        : 'You saved a coupon here.',
    };
  });

  // Replace any previous set, then start geofencing with the new regions
  try { await Location.stopGeofencingAsync(TASK); } catch {}
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  await Location.startGeofencingAsync(TASK, regions);

  // OPTIONAL: log for debugging
  // console.log('REGIONS:', regions);

  // If you're already inside any region right now, send ONE immediate notification
  for (const r of regions) {
    const dist = haversine(anchor.lat, anchor.lng, r.latitude, r.longitude);
    if (dist <= r.radius) {
      const entry = meta[r.identifier];
      const key = entry.merchantId || entry.couponId || r.identifier;
      if (await allowNotify(key)) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: entry.title,
            body: entry.body,
            data: { couponId: entry.couponId || null },
          },
          trigger: null,
        });
        await markNotified(key);
        break; // avoid spamming if multiple include your current position
      }
    }
  }

  return { count: regions.length };
}

/**
 * One-tap test: create a single geofence circle at your current location.
 * - Good for proving that permissions + background task are wired
 * - Includes an "inside-now" notification so you see a banner without moving
 */
export async function registerSingleTestHere(radiusM = DEFAULT_RADIUS, identifier = 'TEST_AREA') {
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = pos.coords;
  const radius = clampRadius(radiusM);

  // Clear previous regions and set simple message meta for this test region
  try { await Location.stopGeofencingAsync(TASK); } catch {}
  await AsyncStorage.setItem(
    META_KEY,
    JSON.stringify({ [identifier]: { title: 'Test area', body: 'Geofence entered' } })
  );

  // Start a single region centered on the current location
  await Location.startGeofencingAsync(TASK, [{
    identifier,
    latitude,
    longitude,
    radius,
    notifyOnEnter: true,
    notifyOnExit: false,
  }]);

  // Fire once immediately so you see a banner without leaving the area
  if (await allowNotify(identifier)) {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Test area', body: 'Geofence entered', data: { couponId: null } },
      trigger: null,
    });
    await markNotified(identifier);
  }
}

/**
 * Check saved coupons and send ONE notification now if you're already inside
 * any of them (useful for home testing without moving).
 */
export async function notifyOnceIfInsideNowFromSupabase(ownerId: string, fallbackRadiusM = 400) {
  // Load rows
  const { data, error } = await supabase
    .from('coupons')
    .select('id,title,expires_at,store,attrs')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  // Current position
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };

  // Ensure coords
  type C = {
    id: string; title?: string; valid_to?: string | null;
    store: { name?: string; address?: string; lat: number; lng: number; radius_m?: number; default_radius_m?: number }
  };
  const withCoords: C[] = [];

  for (const row of data || []) {
    const attrs = (row as any).attrs || {};
    let lat = attrs.geo?.lat ?? attrs.lat;
    let lng = attrs.geo?.lng ?? attrs.lng;
    const address = attrs.address || attrs.store?.address;
    const name = (row as any).store || attrs.store?.name;

    if ((lat == null || lng == null) && address) {
      try {
        const r = await Location.geocodeAsync(address);
        if (r?.length) { lat = r[0].latitude; lng = r[0].longitude; }
      } catch {}
    }

    if (lat != null && lng != null) {
      withCoords.push({
        id: (row as any).id,
        title: (row as any).title || undefined,
        valid_to: (row as any).expires_at || undefined,
        store: {
          name, address, lat, lng,
          radius_m: attrs.radius_m, default_radius_m: attrs.default_radius_m
        }
      });
    }
  }

  // No valid coords — nothing to evaluate
  if (!withCoords.length) return { fired: false, reason: 'no_coords', nearestDistanceM: undefined };

  // Find the nearest saved place and its radius
  let best: { c: C; dist: number; radius: number } | null = null;
  for (const c of withCoords) {
    const dist = haversine(me.lat, me.lng, c.store.lat, c.store.lng);
    const r = clampRadius(c.store.default_radius_m ?? c.store.radius_m ?? fallbackRadiusM);
    if (!best || dist < best.dist) best = { c, dist, radius: r };
  }

  if (!best) return { fired: false, reason: 'no_best', nearestDistanceM: undefined };

  // If already inside, send one local notification (respect throttle)
  if (best.dist <= best.radius) {
    const entry = {
      couponId: best.c.id,
      title: best.c.title || (best.c.store.name ? `Nearby: ${best.c.store.name}` : 'Nearby deal'),
      body: best.c.valid_to
        ? `Valid until ${new Date(best.c.valid_to).toLocaleDateString()}`
        : 'You saved a coupon here.',
    };

    if (await allowNotify(entry.couponId)) {
      await Notifications.scheduleNotificationAsync({
        content: { title: entry.title, body: entry.body, data: { couponId: entry.couponId } },
        trigger: null,
      });
      await markNotified(entry.couponId);
      return { fired: true, id: best.c.id, distanceM: Math.round(best.dist), radiusM: best.radius };
    } else {
      return { fired: false, reason: 'throttled', nearestDistanceM: Math.round(best.dist) };
    }
  }

  // Not inside any region — report nearest distance for debugging
  return { fired: false, reason: 'outside', nearestDistanceM: Math.round(best.dist) };
}

/**
 * Stop all geofences (useful when resetting state).
 */
export async function stopAllGeofences() {
  try { await Location.stopGeofencingAsync(TASK); } catch {}
}

/* ----------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------*/

/** Enforce sane radius bounds */
function clampRadius(r: number) {
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, r));
}

/** Anti-spam guard: daily cap + per-key cooldown */
async function allowNotify(key: string) {
  const now = Date.now();
  const s = await AsyncStorage.getItem(STATE_KEY);
  let state = s ? JSON.parse(s) : {};
  const today = new Date().toISOString().slice(0, 10);

  if (state.day !== today) state = { day: today, daily: 0, lastByKey: {} };
  if ((state.daily || 0) >= DAILY_CAP) {
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
    return false;
  }
  const last = state.lastByKey?.[key];
  if (last && now - last < COOLDOWN_H * 3600 * 1000) {
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
    return false;
  }
  return true;
}

/** Update throttle state after a notification is sent */
async function markNotified(key: string) {
  const now = Date.now();
  const s = await AsyncStorage.getItem(STATE_KEY);
  let state = s ? JSON.parse(s) : {};
  const today = new Date().toISOString().slice(0, 10);

  if (state.day !== today) state = { day: today, daily: 0, lastByKey: {} };
  state.daily = (state.daily || 0) + 1;
  state.lastByKey = state.lastByKey || {};
  state.lastByKey[key] = now;

  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
}

/** Haversine distance in meters between two lat/lng points */
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

/** Days until a given ISO date (negative if already expired) */
function daysUntil(iso?: string | null) {
  if (!iso) return 9999;
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}
