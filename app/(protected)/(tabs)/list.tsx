// app/(tabs)/list.tsx
import '@/lib/geo';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';

// Prefer the new helper that supports search/publication filtering:
import { getCouponsByScope, deleteCoupon } from '../../../lib/coupons';
// If you haven't added getCouponsByScope yet, temporarily swap to:
// import { getMyCoupons as getCouponsByScopeShim, deleteCoupon } from '../../../lib/coupons';

type Visibility = 'private' | 'public';

type Row = {
  id: string;
  store: string | null;
  title: string | null;
  terms: string | null;
  publication?: string | null; // 👈 NEW
  category?: 'food' | 'retail' | 'grocery' | 'other';
  expires_at?: string | null;
  created_at?: string | null;
  visibility?: Visibility;
  saves_count?: number | null;
};

const PALETTE = ['#FFD1E0', '#E5FFF6', '#FFF9C7', '#FFCBA4'];

function pickEmoji(store?: string | null) {
  const s = (store || '').toLowerCase();
  if (s.includes('pizza')) return '🍕';
  if (s.includes('grill') || s.includes('bar') || s.includes('burger')) return '🍔';
  if (s.includes('mex') || s.includes('burrito') || s.includes('taco')) return '🌮';
  if (s.includes('coffee') || s.includes('cafe')) return '☕️';
  return '🎟️';
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

export default function ListScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search + publication filter
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pubOptions, setPubOptions] = useState<string[]>([]); // distinct publications for chips
  const [pubFilter, setPubFilter] = useState<string | null>(null); // null = All

  // Debounce the search box
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [q]);

  useFocusEffect(
    useCallback(() => {
      load(true); // initial load; also refresh pubOptions
      return () => {};
    }, [])
  );

  // Reload whenever search or publication filter changes
  useEffect(() => {
    if (!loading) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, pubFilter]);

  async function load(initial: boolean) {
    try {
      if (initial) setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Fetch rows using server-side search + publication filter
      const data = await getCouponsByScope({
        scope: 'private',
        publication: pubFilter || undefined,
        q: debouncedQ || undefined,
        limit: 200,
        offset: 0,
      });

      setRows(data as Row[]);

      // On first load only, fetch distinct publications for filter chips
      if (initial) {
        try {
          const { data: pubs } = await supabase
            .from('coupons')
            .select('publication')
            .eq('owner_id', uid)
            .order('publication', { ascending: true })
            .limit(200);

          const uniq = Array.from(
            new Set((pubs ?? [])
              .map((d) => (d.publication ?? '').trim())
              .filter(Boolean)
            )
          );
          // Add “Independent” chip if you store nulls for no-publisher
          // (Uncomment if you’d like to force show)
          // uniq.unshift('Independent');
          setPubOptions(uniq);
        } catch {
          // ignore; chips just won’t show if this fails
        }
      }
    } catch (e: any) {
      console.warn('load coupons error', e.message);
    } finally {
      if (initial) setLoading(false);
    }
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const countText = useMemo(
    () => (rows.length === 1 ? '1 coupon' : `${rows.length} coupons`),
    [rows.length]
  );

  function askDelete(couponId: string) {
    Alert.alert('Delete coupon?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // optimistic remove
          const prev = rows;
          setRows((r) => r.filter((x) => x.id !== couponId));
          try {
            await deleteCoupon(couponId);
          } catch (e: any) {
            setRows(prev); // rollback
            Alert.alert('Delete failed', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffebd5' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#ffebd5', padding: 10 }}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: '#5a4636' }}>My Coupons</Text>
            <Text style={{ color: '#6b5b4d', marginBottom: 8 }}>{countText}</Text>

            {/* Search box */}
            <View
              style={{
                backgroundColor: '#fff',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: '#f2caa1',
                paddingHorizontal: 12,
                paddingVertical: 8,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Ionicons name="search" size={16} color="#6b7280" />
              <TextInput
                placeholder="Search store, title, publication, or terms"
                value={q}
                onChangeText={setQ}
                style={{ flex: 1, paddingVertical: 6, color: '#2b221b' }}
                autoCorrect
                autoCapitalize="none"
                returnKeyType="search"
              />
              {q.length > 0 && (
                <TouchableOpacity onPress={() => setQ('')}>
                  <Ionicons name="close-circle" size={18} color="#9ca3af" />
                </TouchableOpacity>
              )}
            </View>

            {/* Publication chips (filter) */}
            {pubOptions.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 8 }}
                contentContainerStyle={{ gap: 8 }}
              >
                <FilterChip
                  text="All"
                  active={!pubFilter}
                  onPress={() => setPubFilter(null)}
                />
                {pubOptions.map((p) => (
                  <FilterChip
                    key={p}
                    text={p}
                    active={pubFilter === p}
                    onPress={() => setPubFilter(p === pubFilter ? null : p)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          const bg = PALETTE[index % PALETTE.length];
          const emoji = pickEmoji(item.store);
          const isPublic = (item.visibility ?? 'private') === 'public';
          const sc = item.saves_count ?? 0;

          return (
            <View
              style={{
                backgroundColor: bg,
                borderRadius: 16,
                padding: 14,
                borderWidth: 1,
                borderColor: 'rgba(0,0,0,0.05)',
              }}
            >
              {/* Header row: store + time + delete */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 18, marginRight: 8 }}>{emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', color: '#472b1a' }}>
                    {item.store ?? 'Unknown store'}
                  </Text>
                  <Text style={{ color: '#7b6a5f', fontSize: 12 }}>{timeAgo(item.created_at)}</Text>
                </View>

                {/* Delete button (owner only; enforced by RLS too) */}
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
              </View>

              {/* Title */}
              {item.title ? (
                <Text style={{ color: '#5b3b28', marginBottom: 6 }}>{item.title}</Text>
              ) : null}

              {/* Terms */}
              {item.terms ? (
                <Text numberOfLines={3} style={{ color: '#6d5243', lineHeight: 18 }}>
                  {item.terms}
                </Text>
              ) : null}

              {/* Chips */}
              <View style={{ marginTop: 8, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Chip text={isPublic ? 'Public' : 'Private'} />
                {typeof sc === 'number' ? <Chip text={`${sc} saved`} /> : null}
                {item.expires_at ? (
                  <Chip text={`Expires: ${new Date(item.expires_at).toLocaleDateString()}`} />
                ) : null}
                {item.publication ? <Chip text={`Publication: ${item.publication}`} /> : null}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 16, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, color: '#5a4636', marginBottom: 6 }}>No coupons found</Text>
            <Text style={{ color: '#6b5b4d', textAlign: 'center' }}>
              Try clearing the search or filter above.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function Chip({ text }: { text: string }) {
  if (!text) return null;
  return (
    <View
      style={{
        backgroundColor: 'rgba(0,0,0,0.08)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
      }}
    >
      <Text style={{ fontSize: 12, color: '#4b3a2e' }}>{text}</Text>
    </View>
  );
}

function FilterChip({
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
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        backgroundColor: active ? '#2563eb' : '#fff',
        borderColor: active ? '#2563eb' : '#f2caa1',
      }}
    >
      <Text style={{ color: active ? '#fff' : '#5a4636', fontWeight: '700' }}>{text}</Text>
    </TouchableOpacity>
  );
}
