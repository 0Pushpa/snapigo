// lib/geo.ts
// Geofencing + local notifications for Snapigo.
// - Defines a background task for geofence ENTER events
// - Registers regions from your Supabase coupons table
// - Sends local notifications when you enter a saved place
// - Includes helpers for testing and "notify now if already inside"
// - NOW ALSO logs notifications into an in-app inbox + unread count
// - NEW: Includes both owned coupons and saved public coupons for geofencing

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

type InboxItem = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  data?: any;
};

/* ----------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------*/
const TASK = 'SNAPIGO_GEOFENCE_TASK';           // Geofencing task name
const META_KEY = 'snapigo_region_meta';         // Stored notif metadata per region
const STATE_KEY = 'snapigo_notif_state';        // Anti-spam throttle state
const MAX_REGIONS = 18;                         // Keep under iOS ~20 region cap
const DAILY_CAP = 50;                           // Max notifications per day
const COOLDOWN_H = 0.01;                        // Per-coupon cooldown (hours)
const MIN_RADIUS = 150;                         // iOS geofencing is coarse; keep >=150m
const MAX_RADIUS = 800;                         // Don't spam huge circles
const DEFAULT_RADIUS = 250;                     // Fallback radius when not provided

// 🔴 Shared keys for in-app "inbox" + unread badge
export const INBOX_KEY = 'snapigo_inbox';
export const UNREAD_KEY = 'snapigo_unread_count';

/* ----------------------------------------------------------------------------
 * Emoji + catchy notification copy helpers
 * --------------------------------------------------------------------------*/

function emojiForStoreName(name?: string | null) {
  const s = (name || '').toLowerCase();

  if (/mcdonald/.test(s) || /\bburger\b/.test(s) || /\bgrill\b/.test(s)) return '🍔';
  if (/\bpizza\b/.test(s)) return '🍕';
  if (/\b(coffee|cafe|starbucks|espresso)\b/.test(s)) return '☕️';
  if (/\b(taco|burrito|mex)\b/.test(s)) return '🌮';
  if (/\b(grocery|market|mart|superstore)\b/.test(s)) return '🛒';
  if (/\b(shop|store|retail|mall)\b/.test(s)) return '🛍️';
  return '🏷️';
}

/**
 * Clean up deal titles so we don't show ugly "undefined off" / "% off" / "$ off".
 * Rules:
 *  - remove the strings "undefined" / "null"
 *  - collapse extra spaces
 *  - if it contains "off" but has NO digits (0–9) → treat as empty
 *  - hide incomplete things like "$ off", "$", "off"
 */
function sanitizeDealTitle(raw?: string | null): string {
  if (!raw) return '';

  let t = raw
    .replace(/undefined/gi, '')
    .replace(/null/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!t) return '';

  const lower = t.toLowerCase();

  // "off" with no numbers at all → useless
  if (lower.includes('off') && !/\d/.test(lower)) {
    return '';
  }

  // Incomplete junk patterns
  if (/^\$+\s*off$/i.test(lower)) return ''; // "$ off"
  if (/^\$+$/.test(lower)) return '';        // "$"
  if (/^off$/i.test(lower)) return '';       // "off"

  return t;
}

function buildNearbyNotifContent(
  storeName?: string | null,
  dealTitle?: string | null,
  validTo?: string | null
) {
  const emoji = emojiForStoreName(storeName);
  const title = storeName
    ? `${emoji} You’re near ${storeName}`
    : `${emoji} Saved deal nearby`;

  // 🧹 Clean up the title before using it in the body
  const cleaned = sanitizeDealTitle(dealTitle);
  const bodyCore =
    cleaned || 'One of your saved coupons is close by';

  let expiryChunk = '';

  if (validTo) {
    const d = new Date(validTo);
    if (!Number.isNaN(d.getTime())) {
      expiryChunk = ` • Valid until ${d.toLocaleDateString()}`;
    }
  }

  const body = `${bodyCore}${expiryChunk}. Use it before it expires!.`;

  // color = Android accent color for the notification (background of small icon / accent bar)
  const color = '#f97316'; // nice warm orange that matches the app

  return { title, body, color };
}

/* ----------------------------------------------------------------------------
 * Inbox helpers (log notifications for Notify tab)
 * --------------------------------------------------------------------------*/

async function appendNotificationToInbox(args: {
  title: string;
  body: string;
  data?: any;
}) {
  try {
    const raw = await AsyncStorage.getItem(INBOX_KEY);
    let inbox: InboxItem[] = raw ? JSON.parse(raw) : [];

    const item: InboxItem = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: args.title,
      body: args.body,
      createdAt: Date.now(),
      read: false,
      data: args.data ?? null,
    };

    // newest first
    inbox.unshift(item);
    // keep last 50
    if (inbox.length > 50) inbox = inbox.slice(0, 50);

    await AsyncStorage.setItem(INBOX_KEY, JSON.stringify(inbox));

    const rawCount = await AsyncStorage.getItem(UNREAD_KEY);
    const prev = rawCount ? parseInt(rawCount, 10) || 0 : 0;
    await AsyncStorage.setItem(UNREAD_KEY, String(prev + 1));
  } catch {
    // ignore logging errors
  }
}

// Use this everywhere to send + log notifications
export async function logAndScheduleNotification(args: {
  title: string;
  body: string;
  data?: any;
  color?: string;
}) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: args.title,
      body: args.body,
      data: args.data,
      color: args.color,
    },
    trigger: null,
  });

  await appendNotificationToInbox(args);
}

/* ----------------------------------------------------------------------------
 * Notification handler (set once). This decides how notifs show on iOS.
 * --------------------------------------------------------------------------*/
// Guard across hot reloads/dev client
if (!(globalThis as any).__SNAPIGO_NOTIF_HANDLER_SET__) {
  Notifications.setNotificationHandler({
    handleNotification: async (): Promise<Notifications.NotificationBehavior> => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,   // 🔔 make alerts feel “alive”
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

    // Build catchy, coupon-specific copy
    const { title, body, color } = buildNearbyNotifContent(
      entry.storeName,
      entry.dealTitle,
      entry.validTo
    );

    await logAndScheduleNotification({
      title,
      body,
      data: { couponId: entry.couponId || null },
      color,
    });

    await markNotified(key);
  });

  (globalThis as any).__SNAPIGO_TASK_DEFINED__ = true;
}

/* ----------------------------------------------------------------------------
 * Public API
 * --------------------------------------------------------------------------*/

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
 * NEW:
 * Fetch BOTH:
 *  - coupons you own (owner_id = user)
 *  - coupons you saved from the public feed (coupon_saves)
 * and register geofences for the merged set.
 */
export async function registerFromSupabase(ownerId: string) {
  // 1) Owned coupons
  const { data: owned, error: ownedErr } = await supabase
    .from('coupons')
    .select('id,title,expires_at,store,attrs')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (ownedErr) throw ownedErr;

  // 2) Saved coupons (via coupon_saves → coupons)
  const { data: savedRows, error: savedErr } = await supabase
    .from('coupon_saves')
    .select('coupon:coupons ( id,title,expires_at,store,attrs )')
    .eq('user_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(400);

  if (savedErr) throw savedErr;

  // 3) Merge + dedupe by coupon id
  const byId = new Map<string, any>();

  for (const row of owned ?? []) {
    byId.set(row.id, row);
  }

  for (const row of savedRows ?? []) {
    const c = (row as any).coupon;
    if (c && !byId.has(c.id)) {
      byId.set(c.id, c);
    }
  }

  // 4) Convert into the shape registerFromCoupons expects
  const coupons = Array.from(byId.values()).map((row: any) => {
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
 */
export async function registerFromCoupons(
  coupons: Array<{ id: string; title?: string; valid_to?: string; store: Store }>
) {
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const anchor = { lat: pos.coords.latitude, lng: pos.coords.longitude };

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

  const scored = withCoords
    .map((c) => {
      const dist = haversine(anchor.lat, anchor.lng, c.store.lat!, c.store.lng!);
      const expBoost = Math.max(0, 1 - daysUntil(c.valid_to) / 14);
      return { c, score: dist - expBoost * 500 };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_REGIONS);

  const regions = scored.map(({ c }) => ({
    identifier: c.id,
    latitude: c.store.lat!,
    longitude: c.store.lng!,
    radius: clampRadius(c.store.default_radius_m ?? c.store.radius_m ?? DEFAULT_RADIUS),
    notifyOnEnter: true,
    notifyOnExit: false,
  }));

  const meta: Record<string, any> = {};
  scored.forEach(({ c }) => {
    meta[c.id] = {
      couponId: c.id,
      storeName: c.store.name ?? null,
      dealTitle: c.title ?? null,
      validTo: c.valid_to ?? null,
    };
  });

  try { await Location.stopGeofencingAsync(TASK); } catch {}
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  await Location.startGeofencingAsync(TASK, regions);

  // If you're already inside any region right now, send ONE immediate notification
  for (const r of regions) {
    const dist = haversine(anchor.lat, anchor.lng, r.latitude, r.longitude);
    if (dist <= r.radius) {
      const entry = meta[r.identifier];
      const key = entry.merchantId || entry.couponId || r.identifier;

      if (await allowNotify(key)) {
        const { title, body, color } = buildNearbyNotifContent(
          entry.storeName,
          entry.dealTitle,
          entry.validTo
        );

        await logAndScheduleNotification({
          title,
          body,
          data: { couponId: entry.couponId || null },
          color,
        });

        await markNotified(key);
        break; // 🔹 only one immediate banner
      }
    }
  }

  return { count: regions.length };
}

/**
 * One-tap test region
 */
export async function registerSingleTestHere(
  radiusM = DEFAULT_RADIUS,
  identifier = 'TEST_AREA'
) {
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = pos.coords;
  const radius = clampRadius(radiusM);

  try { await Location.stopGeofencingAsync(TASK); } catch {}
  await AsyncStorage.setItem(
    META_KEY,
    JSON.stringify({
      [identifier]: {
        couponId: null,
        storeName: 'Test spot',
        dealTitle: 'Geofence test',
        validTo: null,
      },
    })
  );

  await Location.startGeofencingAsync(TASK, [{
    identifier,
    latitude,
    longitude,
    radius,
    notifyOnEnter: true,
    notifyOnExit: false,
  }]);

  const key = identifier;
  if (await allowNotify(key)) {
    const { title, body, color } = buildNearbyNotifContent('Test spot', 'Geofence test', null);

    await logAndScheduleNotification({
      title,
      body,
      data: { couponId: null },
      color,
    });

    await markNotified(key);
  }
}

/**
 * "Notify once if I'm already inside any saved place."
 * Now considers both owned + saved coupons.
 */
export async function notifyOnceIfInsideNowFromSupabase(
  ownerId: string,
  fallbackRadiusM = 400
) {
  // 1) Owned coupons
  const { data: owned, error: ownedErr } = await supabase
    .from('coupons')
    .select('id,title,expires_at,store,attrs')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (ownedErr) throw ownedErr;

  // 2) Saved coupons
  const { data: savedRows, error: savedErr } = await supabase
    .from('coupon_saves')
    .select('coupon:coupons ( id,title,expires_at,store,attrs )')
    .eq('user_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(400);

  if (savedErr) throw savedErr;

  // 3) Merge + dedupe into a single array "rows"
  const byId = new Map<string, any>();

  for (const row of owned ?? []) {
    byId.set(row.id, row);
  }

  for (const row of savedRows ?? []) {
    const c = (row as any).coupon;
    if (c && !byId.has(c.id)) {
      byId.set(c.id, c);
    }
  }

  const data = Array.from(byId.values());

  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };

  type C = {
    id: string; title?: string; valid_to?: string | null;
    store: {
      name?: string;
      address?: string;
      lat: number;
      lng: number;
      radius_m?: number;
      default_radius_m?: number;
    };
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

  if (!withCoords.length) return { fired: false, reason: 'no_coords', nearestDistanceM: undefined };

  let best: { c: C; dist: number; radius: number } | null = null;
  for (const c of withCoords) {
    const dist = haversine(me.lat, me.lng, c.store.lat, c.store.lng);
    const r = clampRadius(c.store.default_radius_m ?? c.store.radius_m ?? fallbackRadiusM);
    if (!best || dist < best.dist) best = { c, dist, radius: r };
  }

  if (!best) return { fired: false, reason: 'no_best', nearestDistanceM: undefined };

  if (best.dist <= best.radius) {
    const entry = {
      couponId: best.c.id,
      storeName: best.c.store.name,
      dealTitle: best.c.title ?? null,
      validTo: best.c.valid_to ?? null,
    };

    if (await allowNotify(entry.couponId)) {
      const { title, body, color } = buildNearbyNotifContent(
        entry.storeName,
        entry.dealTitle,
        entry.validTo
      );

      await logAndScheduleNotification({
        title,
        body,
        data: { couponId: entry.couponId },
        color,
      });

      await markNotified(entry.couponId);
      return {
        fired: true,
        id: best.c.id,
        distanceM: Math.round(best.dist),
        radiusM: best.radius,
      };
    } else {
      return { fired: false, reason: 'throttled', nearestDistanceM: Math.round(best.dist) };
    }
  }

  return { fired: false, reason: 'outside', nearestDistanceM: Math.round(best.dist) };
}

/**
 * Count how many coupons (owned + saved) you are currently inside (based on location).
 * Returns { countInside, nearestDistanceM }.
 */
export async function countNearbyCoupons(
  ownerId: string,
  fallbackRadiusM = 400
): Promise<{ countInside: number; nearestDistanceM?: number }> {
  // 1) Owned
  const { data: owned, error: ownedErr } = await supabase
    .from('coupons')
    .select('id,title,expires_at,store,attrs')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (ownedErr) throw ownedErr;

  // 2) Saved
  const { data: savedRows, error: savedErr } = await supabase
    .from('coupon_saves')
    .select('coupon:coupons ( id,title,expires_at,store,attrs )')
    .eq('user_id', ownerId)
    .order('created_at', { ascending: false })
    .limit(400);

  if (savedErr) throw savedErr;

  // 3) Merge + dedupe
  const byId = new Map<string, any>();

  for (const row of owned ?? []) {
    byId.set(row.id, row);
  }

  for (const row of savedRows ?? []) {
    const c = (row as any).coupon;
    if (c && !byId.has(c.id)) {
      byId.set(c.id, c);
    }
  }

  const data = Array.from(byId.values());

  // Get current location
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };

  type C = {
    id: string;
    title?: string;
    valid_to?: string | null;
    store: {
      name?: string;
      address?: string;
      lat: number;
      lng: number;
      radius_m?: number;
      default_radius_m?: number;
    };
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
        if (r?.length) {
          lat = r[0].latitude;
          lng = r[0].longitude;
        }
      } catch {
        // ignore geocoding errors
      }
    }

    if (lat != null && lng != null) {
      withCoords.push({
        id: (row as any).id,
        title: (row as any).title || undefined,
        valid_to: (row as any).expires_at || undefined,
        store: {
          name,
          address,
          lat,
          lng,
          radius_m: attrs.radius_m,
          default_radius_m: attrs.default_radius_m,
        },
      });
    }
  }

  if (!withCoords.length) {
    return { countInside: 0, nearestDistanceM: undefined };
  }

  let countInside = 0;
  let nearest: number | undefined = undefined;

  for (const c of withCoords) {
    const dist = haversine(me.lat, me.lng, c.store.lat, c.store.lng);
    const r = clampRadius(
      c.store.default_radius_m ?? c.store.radius_m ?? fallbackRadiusM
    );

    if (nearest == null || dist < nearest) {
      nearest = dist;
    }

    if (dist <= r) {
      countInside += 1;
    }
  }

  return {
    countInside,
    nearestDistanceM: nearest != null ? Math.round(nearest) : undefined,
  };
}

/**
 * Stop all geofences
 */
export async function stopAllGeofences() {
  try { await Location.stopGeofencingAsync(TASK); } catch {}
}

/* ----------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------*/

function clampRadius(r: number) {
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, r));
}

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

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371e3;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function daysUntil(iso?: string | null) {
  if (!iso) return 9999;
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}
