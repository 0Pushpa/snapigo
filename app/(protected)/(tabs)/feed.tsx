import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
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

// ---------- Types ----------
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
};

// ---------- UI helpers ----------
const PALETTE = ['#EAF4FF', '#FFF0E6', '#E9FFFA', '#FFF8D9'];

const CATEGORY_PILLS: Array<{
  key: 'all' | Category;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: 'all',     label: 'All',     icon: 'apps-outline' },
  { key: 'food',    label: 'Food',    icon: 'fast-food-outline' },
  { key: 'retail',  label: 'Retail',  icon: 'storefront-outline' },
  { key: 'grocery', label: 'Grocery', icon: 'cart-outline' },
  { key: 'other',   label: 'Other',   icon: 'pricetags-outline' },
];

const INDEPENDENT = '__INDEPENDENT__'; // token for NULL publications
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
    case 'food': return 'Food';
    case 'retail': return 'Retail';
    case 'grocery': return 'Grocery';
    default: return 'Other';
  }
}
function catIcon(cat: Category): keyof typeof Ionicons.glyphMap {
  switch (cat) {
    case 'food': return 'fast-food-outline';
    case 'retail': return 'storefront-outline';
    case 'grocery': return 'cart-outline';
    default: return 'pricetags-outline';
  }
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

  type PubOpt = { label: string; slug: string } | { label: typeof INDEPENDENT; slug: typeof INDEPENDENT };
  const [pubOptions, setPubOptions] = useState<PubOpt[]>([]);
  const [pubFilter, setPubFilter] = useState<PubOpt['slug'] | null>(null); // null => All
  const [pubOpen, setPubOpen] = useState(false);

  const [myUid, setMyUid] = useState<string | null>(null);
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());

  // race guard
  const querySeqRef = useRef(0);
  const [paging, setPaging] = useState(false);

  // debounce typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // run once per focus
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const { data } = await supabase.auth.getSession();
        setMyUid(data.session?.user?.id ?? null);
      })();
      initialLoad();
      return () => {};
    }, [])
  );

  // Also react to search once debounced (state-driven reloads)
  useEffect(() => {
    if (!loading) resetAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  function bumpSeq() {
    querySeqRef.current += 1; // cancels in-flight responses
    return querySeqRef.current;
  }

  function resetListForNewQuery() {
    setItems([]);
    setPage(0);
    setHasMore(true);
  }

  // Use when we already know the new filters but state might not be committed yet.
  async function immediateReload(opts?: { pub?: string | null; cat?: 'all' | Category; term?: string }) {
    bumpSeq();
    resetListForNewQuery();
    await loadPage(0, true, opts);
  }

  function resetAndLoad() {
    immediateReload(); // uses current state
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
        // fallback if column absent
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
        // quick null check
        const { data: nullCheck, error: nullErr } = await supabase
          .from('coupons')
          .select('id', { head: true })
          .eq('visibility', 'public' as Visibility)
          .is('publication', null);
        if (nullErr) {
          // ignore
        }
        const opts: PubOpt[] = [];
        // adding Independent on top is harmless even if none exist
        opts.push({ label: INDEPENDENT, slug: INDEPENDENT });
        uniqLabels.forEach(l => opts.push({ label: l, slug: l.toLowerCase().trim().replace(/\s+/g, ' ') }));
        setPubOptions(opts);
        return;
      }

      const seen = new Set<string>();
      const opts: PubOpt[] = [];
      let hasNull = false;

      (data ?? []).forEach((row: any) => {
        const label: string | null = row.publication;
        const slug: string | null = row.publication_slug;
        if (label == null || !slug) { hasNull = true; return; }
        if (!seen.has(slug)) { seen.add(slug); opts.push({ label, slug }); }
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

  // NOTE: overrides lets us query with freshly chosen values immediately
  async function loadPage(
    pageIndex: number,
    replace = false,
    overrides?: { pub?: string | null; cat?: 'all' | Category; term?: string }
  ) {
    if (paging && !replace) return;
    setPaging(true);
    const mySeq = querySeqRef.current;

    const pageSize = 20;

    // resolve filters (overrides > state)
    const effPub = overrides?.pub ?? pubFilter;
    const effCat = overrides?.cat ?? activeCat;
    const effTerm = overrides?.term ?? debouncedSearch;

    let q = supabase
      .from('coupons')
      .select('id, owner_id, store, title, terms, publication, publication_slug, expires_at, created_at, visibility, category, saves_count')
      .eq('visibility', 'public' as Visibility);

    // publication filter
    if (effPub) {
      if (effPub === INDEPENDENT) {
        q = q.is('publication', null);
      } else if (supportsPubSlug) {
        q = q.eq('publication_slug', effPub);
      } else {
        const label = (pubOptions.find(o => o.slug === effPub) as any)?.label;
        if (typeof label === 'string' && label.length) q = q.eq('publication', label);
      }
    }

    // category filter
    if (effCat !== 'all' && supportsCategory) {
      q = q.eq('category', effCat as Category);
    }

    // text search
    if (effTerm && effTerm.length > 0) {
      const like = `%${escLike(effTerm)}%`;
      // @ts-ignore Supabase .or string form
      q = q.or(`store.ilike.${like},title.ilike.${like},publication.ilike.${like}`);
    }

    q = q.order('created_at', { ascending: false })
         .range(pageIndex * pageSize, pageIndex * pageSize + pageSize - 1);

    try {
      const { data, error } = await q;
      if (error) {
        if (String(error.message || '').includes('column') && String(error.message).includes('category')) {
          if (supportsCategory) {
            setSupportsCategory(false);
            setPaging(false);
            // retry quickly with same overrides
            return loadPage(pageIndex, replace, overrides);
          }
        }
        throw error;
      }
      // cancel stale response
      if (mySeq !== querySeqRef.current) { setPaging(false); return; }

      const rows = (data ?? []) as FeedCoupon[];
      setHasMore(rows.length === pageSize);
      setPage(pageIndex);
      setItems(prev => (replace ? rows : prev.concat(rows)));
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

  function toggleSave(couponId: string) {
    return async () => {
      try {
        const isSaved = savedSet.has(couponId);
        if (isSaved) {
          await unsaveCoupon(couponId);
          const next = new Set(savedSet);
          next.delete(couponId);
          setSavedSet(next);
          setItems(prev =>
            prev.map(c => (c.id === couponId ? { ...c, saves_count: Math.max((c.saves_count || 1) - 1, 0) } : c))
          );
        } else {
          await saveCoupon(couponId);
          const next = new Set(savedSet);
          next.add(couponId);
          setSavedSet(next);
          setItems(prev =>
            prev.map(c => (c.id === couponId ? { ...c, saves_count: (c.saves_count || 0) + 1 } : c))
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
            setItems(prev => prev.filter(c => c.id !== couponId));
            await deleteCoupon(couponId);
          } catch (e: any) {
            await initialLoad();
            Alert.alert('Delete failed', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  }

  // ---------- Render ----------
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffebd5' }}>
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
                  ? (pubOptions.find(o => o.slug === pubFilter) as any)?.label ?? 'Publication'
                  : 'All Publications'}
            </Text>
            <Ionicons name="chevron-down" size={16} color="#374151" style={{ marginLeft: 6 }} />
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
      <Modal visible={pubOpen} transparent animationType="fade" onRequestClose={() => setPubOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setPubOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 20 }}
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
                  // reload immediately with override (pub=null)
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
                    setPubFilter(opt.slug); // state
                    // reload now using override to guarantee the fresh value
                    immediateReload({ pub: opt.slug });
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Categories */}
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
                  // reload immediately with override cat
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
                <Ionicons name={item.icon} size={16} color={active ? '#fff' : '#5a4636'} style={{ marginRight: 6 }} />
                <Text style={{ color: active ? '#fff' : '#5a4636', fontWeight: '700' }}>{item.label}</Text>
              </TouchableOpacity>
            );
          }}
        />
        {!supportsCategory ? (
          <Text style={{ marginTop: 6, color: '#9ca3af', fontSize: 12 }}>
            (Category filter disabled—add a <Text style={{ fontWeight: '700' }}>category</Text> column in <Text style={{ fontWeight: '700' }}>public.coupons</Text> to enable.)
          </Text>
        ) : null}
      </View>

      {/* Feed list */}
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReachedThreshold={0.3}
        onEndReached={onEndReached}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
        renderItem={({ item, index }) => {
          const bg = PALETTE[index % PALETTE.length];
          const icon = pickIconName(item.store);
          const saved = savedSet.has(item.id);
          const saves = item.saves_count ?? 0;
          const cat = (item.category || 'other') as Category;
          const isOwner = myUid && item.owner_id === myUid;

          return (
            <View
              style={{
                backgroundColor: bg,
                borderRadius: 18,
                padding: 14,
                borderWidth: 1,
                borderColor: 'rgba(0,0,0,0.05)',
              }}
            >
              {/* top row */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name={icon} size={18} color="#472b1a" style={{ marginRight: 8 }} />
                  <Text style={{ fontWeight: '800', color: '#472b1a' }}>
                    {item.store ?? 'Unknown store'}
                  </Text>
                </View>

                <Text style={{ color: '#7b6a5f', fontSize: 12 }}>{timeAgo(item.created_at)}</Text>
              </View>

              {/* title */}
              {item.title ? (
                <Text style={{ color: '#5b3b28', marginBottom: 6, fontSize: 16 }}>{item.title}</Text>
              ) : null}

              {/* terms */}
              {item.terms ? (
                <Text numberOfLines={3} style={{ color: '#6d5243', lineHeight: 18, marginBottom: 8 }}>
                  {item.terms}
                </Text>
              ) : null}

              {/* chips */}
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <Chip icon="earth" text="Public" />
                <Chip icon={catIcon(cat)} text={catLabel(cat)} />
                {item.expires_at ? <Chip icon="time-outline" text={expiryText(item.expires_at) ?? ''} /> : null}
                <Chip icon="pricetags-outline" text={`${saves} saved`} />
                {item.publication ? <Chip icon="newspaper-outline" text={`Publication: ${item.publication}`} /> : null}
              </View>

              {/* actions */}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                {isOwner ? (
                  <TouchableOpacity
                    onPress={() => askDelete(item.id)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      backgroundColor: '#fff1f2',
                      borderWidth: 1,
                      borderColor: '#fecdd3',
                    }}
                  >
                    <Ionicons name="trash-outline" size={18} color="#b91c1c" />
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  onPress={toggleSave(item.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 8,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    backgroundColor: saved ? '#2563eb' : '#ffffff',
                    borderWidth: 1,
                    borderColor: saved ? '#2563eb' : '#f2caa1',
                  }}
                >
                  <MaterialCommunityIcons
                    name={saved ? 'bookmark' : 'bookmark-outline'}
                    size={18}
                    color={saved ? '#fff' : '#5a4636'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={{ color: saved ? '#fff' : '#5a4636', fontWeight: '700' }}>
                    {saved ? 'Saved' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 18, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, color: '#5a4636', marginBottom: 6 }}>No public coupons yet</Text>
            <Text style={{ color: '#6b5b4d', textAlign: 'center' }}>
              Switch to <Text style={{ fontWeight: '700' }}>Scan</Text> and post one as <Text style={{ fontWeight: '700' }}>Public</Text>.
            </Text>
          </View>
        }
      />
    </View>
  );
}

// ---------- Small components ----------
function Chip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  if (!text) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.08)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
      }}
    >
      <Ionicons name={icon} size={14} color="#4b3a2e" style={{ marginRight: 6 }} />
      <Text style={{ fontSize: 12, color: '#4b3a2e' }}>{text}</Text>
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
