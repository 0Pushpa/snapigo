import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { deleteCoupon } from '../../../lib/coupons';
import { listSavedCoupons, saveCoupon, unsaveCoupon } from '../../../lib/saves';
import { supabase } from '../../../lib/supabase';

type Visibility = 'private' | 'public';
type Category = 'food' | 'retail' | 'grocery' | 'other';

type FeedCoupon = {
  id: string;
  owner_id: string;
  store: string | null;
  title: string | null;
  terms: string | null;
  publication?: string | null;
  publication_slug?: string | null; // normalized, optional column
  expires_at: string | null;
  created_at: string;
  visibility: Visibility;
  category?: Category | null;
  saves_count?: number | null;
  attrs?: any | null; // geo + extra attrs
};

// ---------- UI helpers ----------
const PALETTE = ['#EAF4FF', '#FFF0E6', '#E9FFFA', '#FFF8D9'];
const PINK = '#FFD1E0';

const CATEGORY_PILLS: Array<{
  key: 'all' | Category;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'food', label: 'Food', icon: 'fast-food-outline' },
  { key: 'retail', label: 'Retail', icon: 'storefront-outline' },
  { key: 'grocery', label: 'Grocery', icon: 'cart-outline' },
  { key: 'other', label: 'Other', icon: 'pricetags-outline' },
];

const INDEPENDENT = '__INDEPENDENT__';
const escLike = (s: string) => s.replace(/[%_]/g, '\\$&');

// Icons instead of emoji (more reliable across platforms)
function pickIconName(store: string | null | undefined): keyof typeof Ionicons.glyphMap {
  const s = (store ?? '').toLowerCase();
  if (/\bpizza\b/.test(s)) return 'pizza-outline';
  if (/\b(taco|burrito|mex)\b/.test(s)) return 'restaurant-outline';
  if (/\b(coffee|cafe)\b/.test(s)) return 'cafe-outline';
  if (/\b(grill|burger|bar)\b/.test(s)) return 'fast-food-outline';
  return 'pricetags-outline';
}

function timeAgo(iso?: string | null) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function expiryText(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString();
  const daysLeft = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const left = daysLeft >= 0 ? `${daysLeft}d left` : `expired`;
  return `Expires ${date} • ${left}`;
}

function catLabel(cat: Category) {
  switch (cat) {
    case 'food':
      return 'Food';
    case 'retail':
      return 'Retail';
    case 'grocery':
      return 'Grocery';
    default:
      return 'Other';
  }
}

function catIcon(cat: Category): keyof typeof Ionicons.glyphMap {
  switch (cat) {
    case 'food':
      return 'fast-food-outline';
    case 'retail':
      return 'storefront-outline';
    case 'grocery':
      return 'cart-outline';
    default:
      return 'pricetags-outline';
  }
}

/**
 * Clean up title so we don't show ugly / wrong discount text.
 * - remove "undefined"/"null"
 * - if it looks like a discount (%, $, "off"), only keep it when the same number
 *   also appears somewhere in the terms.
 *   → avoids fake like "$25 off" when terms don't mention 25 at all.
 */
function sanitizeTitle(title?: string | null, terms?: string | null) {
  if (!title) return '';

  // Remove obvious junk
  let t = title.replace(/undefined/gi, '').replace(/null/gi, '').trim();
  if (!t) return '';

  const lower = t.toLowerCase();

  // If no discount language, just return cleaned title as-is
  const hasOff = lower.includes('off');
  const hasPct = lower.includes('%');
  const hasDollar = lower.includes('$');
  const looksLikeDiscount = hasOff || hasPct || hasDollar;

  if (!looksLikeDiscount) {
    return t;
  }

  // If it "looks" like discount but has no digits at all → junk
  const numMatches = t.match(/\d+/g) ?? [];
  if (numMatches.length === 0) {
    return '';
  }

  // If there are digits AND discount words,
  // require that at least one of those numbers appears in terms text.
  if (terms) {
    const termsLower = terms.toLowerCase();
    const hasAnyNumberInTerms = numMatches.some((n) => termsLower.includes(n));
    if (!hasAnyNumberInTerms) {
      // Numbers like "25" only appear in title, not in actual coupon text → hide.
      return '';
    }
  }

  return t;
}

// ---------- Distance helpers ----------
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371e3;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCouponCoords(c: FeedCoupon): { lat: number; lng: number } | null {
  const geo = c.attrs?.geo;
  if (geo?.lat != null && geo?.lng != null) {
    return { lat: geo.lat, lng: geo.lng };
  }
  if (c.attrs?.lat != null && c.attrs?.lng != null) {
    return { lat: c.attrs.lat, lng: c.attrs.lng };
  }
  return null;
}

// ---------- Screen ----------
export default function FeedScreen() {
  const [items, setItems] = useState<FeedCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [supportsCategory, setSupportsCategory] = useState(true);
  const [supportsPubSlug, setSupportsPubSlug] = useState(true);

  const [activeCat, setActiveCat] = useState<'all' | Category>('all');

  // search + publication dropdown
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  type PubOpt =
    | { label: string; slug: string }
    | { label: typeof INDEPENDENT; slug: typeof INDEPENDENT };
  const [pubOptions, setPubOptions] = useState<PubOpt[]>([]);
  const [pubFilter, setPubFilter] = useState<PubOpt['slug'] | null>(null);
  const [pubOpen, setPubOpen] = useState(false);

  const [myUid, setMyUid] = useState<string | null>(null);
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());

  // Near me state
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [nearMeOnly, setNearMeOnly] = useState(false);
  const [nearCount, setNearCount] = useState<number | null>(null); // count badge

  // race guard
  const querySeqRef = useRef(0);
  const [paging, setPaging] = useState(false);

  // radius
  const NEAR_RADIUS_M = 2000;

  // debounce typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const { data } = await supabase.auth.getSession();
        setMyUid(data.session?.user?.id ?? null);

        try {
          const perm = await Location.requestForegroundPermissionsAsync();
          if (perm.status === 'granted') {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            setMyLocation({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            });
          } else {
            setMyLocation(null);
          }
        } catch (e: any) {
          console.warn('[Feed] location error', e?.message);
          setMyLocation(null);
        }
      })();

      initialLoad();
      return () => {};
    }, [])
  );

  useEffect(() => {
    if (!loading) resetAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  function bumpSeq() {
    querySeqRef.current += 1;
    return querySeqRef.current;
  }

  function resetListForNewQuery() {
    setItems([]);
    setPage(0);
    setHasMore(true);
  }

  async function immediateReload(opts?: {
    pub?: string | null;
    cat?: 'all' | Category;
    term?: string;
  }) {
    bumpSeq();
    resetListForNewQuery();
    await loadPage(0, true, opts);
  }

  function resetAndLoad() {
    immediateReload();
  }

  async function initialLoad() {
    setLoading(true);
    try {
      await Promise.all([loadSavedSet(), loadPublicationOptions(), immediateReload()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadPublicationOptions() {
    try {
      const { data, error } = await supabase
        .from('coupons')
        .select('publication, publication_slug')
        .eq('visibility', 'public' as Visibility)
        .order('publication_slug', { ascending: true })
        .limit(2000);

      if (error) {
        setSupportsPubSlug(false);
        const alt = await supabase
          .from('coupons')
          .select('publication')
          .eq('visibility', 'public' as Visibility)
          .order('publication', { ascending: true })
          .limit(2000);
        if (alt.error) throw alt.error;

        const labels = (alt.data ?? [])
          .map((r: any) => (r.publication ?? '').trim())
          .filter(Boolean) as string[];
        const uniqLabels = Array.from(new Set(labels));

        const { error: nullErr } = await supabase
          .from('coupons')
          .select('id', { head: true })
          .eq('visibility', 'public' as Visibility)
          .is('publication', null);
        if (nullErr) {
          // ignore
        }
        const opts: PubOpt[] = [];
        opts.push({ label: INDEPENDENT, slug: INDEPENDENT });
        uniqLabels.forEach((l) =>
          opts.push({ label: l, slug: l.toLowerCase().trim().replace(/\s+/g, ' ') })
        );
        setPubOptions(opts);
        return;
      }

      const seen = new Set<string>();
      const opts: PubOpt[] = [];
      let hasNull = false;

      (data ?? []).forEach((row: any) => {
        const label: string | null = row.publication;
        const slug: string | null = row.publication_slug;
        if (label == null || !slug) {
          hasNull = true;
          return;
        }
        if (!seen.has(slug)) {
          seen.add(slug);
          opts.push({ label, slug });
        }
      });

      if (hasNull) opts.unshift({ label: INDEPENDENT, slug: INDEPENDENT });
      setPubOptions(opts);
    } catch (e: any) {
      console.warn('[Feed] pubs error', e?.message);
      setPubOptions([]);
    }
  }

  async function loadSavedSet() {
    try {
      const rows = await listSavedCoupons();
      const s = new Set<string>();
      for (const r of rows) {
        const id = r.coupon?.id;
        if (id) s.add(id);
      }
      setSavedSet(s);
    } catch (e: any) {
      console.warn('[Feed] savedSet error', e?.message);
    }
  }

  async function loadPage(
    pageIndex: number,
    replace = false,
    overrides?: { pub?: string | null; cat?: 'all' | Category; term?: string }
  ) {
    if (paging && !replace) return;
    setPaging(true);
    const mySeq = querySeqRef.current;

    const pageSize = 20;

    const effPub = overrides?.pub ?? pubFilter;
    const effCat = overrides?.cat ?? activeCat;
    const effTerm = overrides?.term ?? debouncedSearch;

    let q = supabase
      .from('coupons')
      .select(
        'id, owner_id, store, title, terms, publication, publication_slug, expires_at, created_at, visibility, category, saves_count, attrs'
      )
      .eq('visibility', 'public' as Visibility);

    if (effPub) {
      if (effPub === INDEPENDENT) {
        q = q.is('publication', null);
      } else if (supportsPubSlug) {
        q = q.eq('publication_slug', effPub);
      } else {
        const label = (pubOptions.find((o) => o.slug === effPub) as any)?.label;
        if (typeof label === 'string' && label.length) q = q.eq('publication', label);
      }
    }

    if (effCat !== 'all' && supportsCategory) {
      q = q.eq('category', effCat as Category);
    }

    if (effTerm && effTerm.length > 0) {
      const like = `%${escLike(effTerm)}%`;
      // @ts-ignore Supabase .or string form
      q = q.or(`store.ilike.${like},title.ilike.${like},publication.ilike.${like}`);
    }

    q = q
      .order('created_at', { ascending: false })
      .range(pageIndex * pageSize, pageIndex * pageSize + pageSize - 1);

    try {
      const { data, error } = await q;
      if (error) {
        if (
          String(error.message || '').includes('column') &&
          String(error.message).includes('category')
        ) {
          if (supportsCategory) {
            setSupportsCategory(false);
            setPaging(false);
            return loadPage(pageIndex, replace, overrides);
          }
        }
        throw error;
      }

      if (mySeq !== querySeqRef.current) {
        setPaging(false);
        return;
      }

      const rows = (data ?? []) as FeedCoupon[];
      setHasMore(rows.length === pageSize);
      setPage(pageIndex);
      setItems((prev) => (replace ? rows : prev.concat(rows)));
    } catch (e: any) {
      console.warn('[Feed] load error', e?.message);
    } finally {
      if (mySeq === querySeqRef.current) setPaging(false);
    }
  }

  const onRefresh = async () => {
    setRefreshing(true);
    bumpSeq();
    resetListForNewQuery();
    await Promise.all([loadSavedSet(), loadPublicationOptions(), loadPage(0, true)]);
    setRefreshing(false);
  };

  const onEndReached = () => {
    if (!loading && hasMore) loadPage(page + 1);
  };

  const countText = useMemo(
    () => (items.length === 1 ? '1 public coupon' : `${items.length} public coupons`),
    [items.length]
  );

  // Recompute how many coupons are inside the radius for the badge
  useEffect(() => {
    if (!myLocation) {
      setNearCount(null);
      return;
    }

    const nearby = items
      .map((c) => {
        const coords = getCouponCoords(c);
        if (!coords) return null;
        const dist = distanceMeters(
          myLocation.lat,
          myLocation.lng,
          coords.lat,
          coords.lng
        );
        return dist <= NEAR_RADIUS_M ? dist : null;
      })
      .filter((d) => d != null);

    setNearCount(nearby.length);
  }, [items, myLocation, NEAR_RADIUS_M]);

  // Which items show in the list
  const visibleItems = useMemo(() => {
    if (!nearMeOnly) return items;

    if (!myLocation) return [];

    const enriched = items
      .map((c) => {
        const coords = getCouponCoords(c);
        if (!coords) return { c, dist: Infinity };
        const dist = distanceMeters(
          myLocation.lat,
          myLocation.lng,
          coords.lat,
          coords.lng
        );
        return { c, dist };
      })
      .filter((x) => x.dist < Infinity);

    if (!enriched.length) return [];

    const nearby = enriched.filter((x) => x.dist <= NEAR_RADIUS_M);
    if (!nearby.length) return [];

    nearby.sort((a, b) => a.dist - b.dist);
    return nearby.map((x) => x.c);
  }, [items, nearMeOnly, myLocation, NEAR_RADIUS_M]);

  function toggleSave(couponId: string) {
    return async () => {
      try {
        const isSaved = savedSet.has(couponId);
        if (isSaved) {
          await unsaveCoupon(couponId);
          const next = new Set(savedSet);
          next.delete(couponId);
          setSavedSet(next);
          setItems((prev) =>
            prev.map((c) =>
              c.id === couponId
                ? { ...c, saves_count: Math.max((c.saves_count || 1) - 1, 0) }
                : c
            )
          );
        } else {
          await saveCoupon(couponId);
          const next = new Set(savedSet);
          next.add(couponId);
          setSavedSet(next);
          setItems((prev) =>
            prev.map((c) =>
              c.id === couponId ? { ...c, saves_count: (c.saves_count || 0) + 1 } : c
            )
          );
        }
      } catch (e: any) {
        console.warn('[Feed] save/unsave error', e?.message);
      }
    };
  }

  function clearSearch() {
    setSearch('');
    Keyboard.dismiss();
    resetAndLoad();
  }
  async function runSearch() {
    resetAndLoad();
  }

  function askDelete(couponId: string) {
    Alert.alert('Delete coupon?', 'This will remove it from the Feed and your list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setItems((prev) => prev.filter((c) => c.id !== couponId));
            await deleteCoupon(couponId);
          } catch (e: any) {
            await initialLoad();
            Alert.alert('Delete failed', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffebd5',
        }}
      >
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#ffebd5', paddingTop: 20 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#5a4636' }}>Explore</Text>
        <Text style={{ color: '#6b5b4d' }}>{countText}</Text>
      </View>

      {/* Search + Publication dropdown */}
      <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#fff',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#f2caa1',
            paddingHorizontal: 8,
            paddingVertical: 8,
          }}
        >
          <TouchableOpacity
            onPress={() => setPubOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: '#f8fafc',
              borderWidth: 1,
              borderColor: '#e5e7eb',
              marginRight: 8,
            }}
          >
            <Text style={{ color: '#374151', fontWeight: '700' }}>
              {pubFilter === INDEPENDENT
                ? 'Independent'
                : pubFilter
                ? (pubOptions.find((o) => o.slug === pubFilter) as any)?.label ??
                  'Publication'
                : 'All Publications'}
            </Text>
            <Ionicons
              name="chevron-down"
              size={16}
              color="#374151"
              style={{ marginLeft: 6 }}
            />
          </TouchableOpacity>

          <Ionicons name="search-outline" size={18} color="#6b5b4d" />
          <TextInput
            ref={searchRef}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={runSearch}
            placeholder="Search store, title, or publication"
            style={{ flex: 1, marginLeft: 6 }}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <TouchableOpacity onPress={clearSearch}>
              <Ionicons name="close-circle" size={18} color="#9ca3af" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Publication modal */}
      <Modal
        visible={pubOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPubOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setPubOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 420,
              maxHeight: '70%',
              backgroundColor: '#fff',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#f2caa1',
              overflow: 'hidden',
            }}
          >
            <ScrollView>
              <PubRow
                text="All Publications"
                active={!pubFilter}
                onPress={() => {
                  setPubOpen(false);
                  setPubFilter(null);
                  immediateReload({ pub: null });
                }}
              />
              {pubOptions.map((opt) => (
                <PubRow
                  key={opt.slug}
                  text={opt.slug === INDEPENDENT ? 'Independent' : (opt as any).label}
                  active={pubFilter === opt.slug}
                  onPress={() => {
                    setPubOpen(false);
                    setPubFilter(opt.slug);
                    immediateReload({ pub: opt.slug });
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Categories + Near Me */}
      <View style={{ paddingHorizontal: 12, marginBottom: 8 }}>
        <FlatList
          data={CATEGORY_PILLS}
          horizontal
          keyExtractor={(i) => i.key}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            const active = activeCat === item.key;
            return (
              <TouchableOpacity
                onPress={() => {
                  setActiveCat(item.key as any);
                  immediateReload({ cat: item.key as any });
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? '#2563eb' : '#f2caa1',
                  backgroundColor: active ? '#2563eb' : '#fff',
                }}
              >
                <Ionicons
                  name={item.icon}
                  size={16}
                  color={active ? '#fff' : '#5a4636'}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={{
                    color: active ? '#fff' : '#5a4636',
                    fontWeight: '700',
                  }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
        {!supportsCategory ? (
          <Text style={{ marginTop: 6, color: '#9ca3af', fontSize: 12 }}>
            (Category filter disabled—add a{' '}
            <Text style={{ fontWeight: '700' }}>category</Text> column in{' '}
            <Text style={{ fontWeight: '700' }}>public.coupons</Text> to enable.)
          </Text>
        ) : null}

        {/* Coupons Near Me pill with count only when active */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 8,
            paddingHorizontal: 4,
          }}
        >
          <TouchableOpacity
            onPress={() => setNearMeOnly((v) => !v)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: nearMeOnly ? '#2563eb' : '#f2caa1',
              backgroundColor: nearMeOnly ? '#2563eb' : '#fff',
            }}
          >
            <Ionicons
              name="location-outline"
              size={16}
              color={nearMeOnly ? '#fff' : '#5a4636'}
              style={{ marginRight: 6 }}
            />
            <Text
              style={{
                color: nearMeOnly ? '#fff' : '#5a4636',
                fontWeight: '700',
              }}
            >
              {nearMeOnly ? 'Showing coupons near you' : 'Coupons near me'}
            </Text>

            {/* 🔴 Show red count badge ONLY when active */}
            {nearMeOnly && nearCount !== null && (
              <View
                style={{
                  marginLeft: 8,
                  minWidth: 20,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 999,
                  backgroundColor: '#fee2e2', // light red
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: '#b91c1c', // red text
                  }}
                >
                  {nearCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Feed list */}
      <FlatList
        data={visibleItems}
        keyExtractor={(it) => it.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReachedThreshold={0.3}
        onEndReached={onEndReached}
        contentContainerStyle={{ padding: 12, paddingBottom: 32, gap: 8 }}
        renderItem={({ item, index }) => {
          const bg = PALETTE[index % PALETTE.length];
          const icon = pickIconName(item.store);
          const saved = savedSet.has(item.id);
          const saves = item.saves_count ?? 0;
          const cat = (item.category || 'other') as Category;
          const isOwner = myUid && item.owner_id === myUid;
          const displayTitle = sanitizeTitle(item.title, item.terms);

          return (
            <View
              style={{
                backgroundColor: bg,
                borderRadius: 14,
                padding: 10,
                borderWidth: 1,
                borderColor: '#f97316',
                shadowColor: '#000',
                shadowOpacity: 0.08,
                shadowOffset: { width: 0, height: 2 },
                shadowRadius: 3,
                elevation: 2,
                marginVertical: 2,
              }}
            >
              {/* top row */}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 999,
                      backgroundColor: 'rgba(0,0,0,0.05)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 8,
                    }}
                  >
                    <Ionicons name={icon} size={16} color="#472b1a" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ fontWeight: '700', color: '#472b1a', fontSize: 13 }}
                      numberOfLines={1}
                    >
                      {item.store ?? 'Unknown store'}
                    </Text>
                    <Text style={{ color: '#7b6a5f', fontSize: 10 }}>
                      {timeAgo(item.created_at)}
                    </Text>
                  </View>
                </View>
              </View>

              {/* title (deal highlight) */}
              {displayTitle ? (
                <Text
                  style={{
                    color: '#b91c1c',
                    marginBottom: 3,
                    fontSize: 13,
                    fontWeight: '700',
                  }}
                  numberOfLines={2}
                >
                  {displayTitle}
                </Text>
              ) : null}

              {/* terms */}
              {item.terms ? (
                <Text
                  numberOfLines={3}
                  style={{
                    color: '#6d5243',
                    lineHeight: 14,
                    marginBottom: 4,
                    fontSize: 11,
                  }}
                >
                  {item.terms}
                </Text>
              ) : null}

              {/* divider */}
              <View
                style={{
                  borderBottomWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: 'rgba(0,0,0,0.16)',
                  marginVertical: 4,
                }}
              />

              {/* chips */}
              <View
                style={{
                  flexDirection: 'row',
                  gap: 6,
                  flexWrap: 'wrap',
                  marginBottom: 6,
                }}
              >
                {/* no “Public” chip here – everything in Feed is public */}
                <Chip icon={catIcon(cat)} text={catLabel(cat)} variant="neutral" />
                {item.expires_at ? (
                  <Chip
                    icon="time-outline"
                    text={expiryText(item.expires_at) ?? ''}
                    variant="warning"
                  />
                ) : null}
                <Chip
                  icon="pricetags-outline"
                  text={`${saves} saved`}
                  variant="accent"
                />
                {item.publication ? (
                  <Chip
                    icon="newspaper-outline"
                    text={item.publication}
                    variant="neutral"
                  />
                ) : null}
              </View>

              {/* actions */}
              <View
                style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}
              >
                {isOwner ? (
                  <TouchableOpacity
                    onPress={() => askDelete(item.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: 999,
                      backgroundColor: '#fff1f2',
                      borderWidth: 1,
                      borderColor: '#fecdd3',
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color="#b91c1c" />
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  onPress={toggleSave(item.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    backgroundColor: saved ? '#2563eb' : '#ffffff',
                    borderWidth: 1,
                    borderColor: saved ? '#2563eb' : '#f2caa1',
                  }}
                >
                  <MaterialCommunityIcons
                    name={saved ? 'bookmark' : 'bookmark-outline'}
                    size={16}
                    color={saved ? '#fff' : '#5a4636'}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={{
                      color: saved ? '#fff' : '#5a4636',
                      fontWeight: '700',
                      fontSize: 12,
                    }}
                  >
                    {saved ? 'Saved' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 18, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, color: '#5a4636', marginBottom: 6 }}>
              {nearMeOnly ? 'No coupons near you yet' : 'No public coupons yet'}
            </Text>
            <Text style={{ color: '#6b5b4d', textAlign: 'center' }}>
              {nearMeOnly
                ? 'Try turning off "Coupons near me" or scan some coupons with addresses so we can locate them.'
                : 'Switch to Scan and post one as Public.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ---------- Small components ----------
function Chip({
  icon,
  text,
  variant = 'neutral',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  variant?: 'warning' | 'accent' | 'neutral';
}) {
  if (!text) return null;

  let bg = 'rgba(0,0,0,0.06)';
  let color = '#4b3a2e';

  if (variant === 'warning') {
    bg = '#fef3c7';
    color = '#92400e';
  } else if (variant === 'accent') {
    bg = PINK;
    color = '#9f1239';
  } else if (variant === 'neutral') {
    bg = '#e5e7eb';
    color = '#374151';
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: bg,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
      }}
    >
      <Ionicons name={icon} size={12} color={color} style={{ marginRight: 4 }} />
      <Text style={{ fontSize: 10, color, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

function PubRow({
  text,
  active,
  onPress,
}: {
  text: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
        backgroundColor: active ? '#f3f4f6' : '#fff',
      }}
    >
      <Ionicons
        name={active ? 'checkmark' : 'ellipse-outline'}
        size={16}
        color={active ? '#2563eb' : '#9ca3af'}
        style={{ marginRight: 8 }}
      />
      <Text style={{ color: '#111827', fontWeight: active ? '800' : '500' }}>
        {text}
      </Text>
    </TouchableOpacity>
  );
}
