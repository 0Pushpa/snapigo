// app/(tabs)/list.tsx
import '@/lib/geo';
import { Ionicons } from '@expo/vector-icons';
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
import { supabase } from '../../../lib/supabase';

// Prefer the new helper that supports search/publication filtering:
import { deleteCoupon, getCouponsByScope } from '../../../lib/coupons';

type Visibility = 'private' | 'public';

type Row = {
  id: string;
  store: string | null;
  title: string | null;
  terms: string | null;
  publication?: string | null;
  category?: 'food' | 'retail' | 'grocery' | 'other';
  expires_at?: string | null;
  created_at?: string | null;
  visibility?: Visibility;
  saves_count?: number | null;
};

const SCREEN_BG = '#ffebd5';
const PINK = '#FFD1E0';

// Alternating coupon themes
const THEMES = [
  {
    stub: '#FFE8D9',
    border: '#FB923C',
    body: '#FFFDF8',
  },
  {
    stub: '#D9FFE8',
    border: '#34D399',
    body: '#F8FFFB',
  },
  {
    stub: '#E9D9FF',
    border: '#A78BFA',
    body: '#FBF8FF',
  },
];

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

/**
 * Clean up title so we don't show ugly "undefined off" / "% off" / "$ off".
 * Rules:
 * - strip "undefined" / "null"
 * - collapse spaces
 * - if it contains "off" but NO digits at all → hide it
 * - hide incomplete things like "$ off", "$", "off"
 */
function sanitizeTitle(title?: string | null) {
  if (!title) return '';

  // remove junk fragments first
  let t = title
    .replace(/undefined/gi, '')
    .replace(/null/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!t) return '';

  const lower = t.toLowerCase();

  // If mentions "off" but has no digits at all (no 5, 10, 20, etc.) → useless
  if (lower.includes('off') && !/\d/.test(lower)) {
    return '';
  }

  // Incomplete patterns to hide
  if (/^\$+\s*off$/i.test(lower)) return ''; // "$ off"
  if (/^\$+$/.test(lower)) return '';        // "$"
  if (/^off$/i.test(lower)) return '';       // "off"

  return t;
}

export default function ListScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search + publication filter
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pubOptions, setPubOptions] = useState<string[]>([]);
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
            new Set(
              (pubs ?? [])
                .map((d) => (d.publication ?? '').trim())
                .filter(Boolean)
            )
          );
          setPubOptions(uniq);
        } catch {
          // ignore
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
          const prev = rows;
          setRows((r) => r.filter((x) => x.id !== couponId));
          try {
            await deleteCoupon(couponId);
          } catch (e: any) {
            setRows(prev);
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
          backgroundColor: SCREEN_BG,
        }}
      >
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: SCREEN_BG }}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 10, marginTop: 10 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: '#5a4636' }}>
              My Coupons
            </Text>
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
                shadowColor: '#000',
                shadowOpacity: 0.05,
                shadowOffset: { width: 0, height: 2 },
                shadowRadius: 4,
                elevation: 2,
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
          const emoji = pickEmoji(item.store);
          const isPublic = (item.visibility ?? 'private') === 'public';
          const sc = item.saves_count ?? 0;

          const theme = THEMES[index % THEMES.length];
          const displayStore = (item.store ?? '').trim() || 'Unknown store';
          const displayTitle = sanitizeTitle(item.title);

          const expiresLabel = item.expires_at
            ? `Expires ${new Date(item.expires_at).toLocaleDateString()}`
            : null;

          return (
            <View
              style={{
                borderRadius: 22,
                shadowColor: '#000',
                shadowOpacity: 0.18,
                shadowOffset: { width: 0, height: 4 },
                shadowRadius: 8,
                elevation: 5,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  backgroundColor: theme.body,
                  borderRadius: 22,
                  overflow: 'hidden',
                  borderWidth: 1.5,
                  borderColor: theme.border,
                }}
              >
                {/* Left Stub */}
                <View
                  style={{
                    width: 78,
                    backgroundColor: theme.stub,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 18,
                    borderRightWidth: 1.5,
                    borderRightColor: theme.border,
                  }}
                >
                  <Text style={{ fontSize: 30, marginBottom: 4 }}>{emoji}</Text>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      color: isPublic ? '#15803d' : '#7c2d12',
                    }}
                  >
                    {isPublic ? 'PUBLIC' : 'PRIVATE'}
                  </Text>
                </View>

                {/* Main Body */}
                <View style={{ flex: 1, padding: 12 }}>
                  {/* Top row: store + time + delete */}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      marginBottom: 4,
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 6 }}>
                      <Text
                        style={{
                          fontWeight: '900',
                          color: '#3f1d0b',
                          fontSize: 17,
                          marginBottom: 2,
                        }}
                        numberOfLines={1}
                      >
                        {displayStore}
                      </Text>
                      <Text style={{ color: '#7b6b5f', fontSize: 11 }}>
                        {timeAgo(item.created_at)}
                      </Text>
                    </View>

                    {/* Delete button */}
                    <TouchableOpacity
                      onPress={() => askDelete(item.id)}
                      style={{
                        paddingVertical: 4,
                        paddingHorizontal: 8,
                        borderRadius: 999,
                        backgroundColor: '#fff1f2',
                        borderWidth: 1,
                        borderColor: '#fecdd3',
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      <Ionicons name="trash-outline" size={14} color="#b91c1c" />
                    </TouchableOpacity>
                  </View>

                  {/* Title = main deal highlight (only if not junk) */}
                  {displayTitle ? (
                    <Text
                      style={{
                        color: '#b91c1c',
                        marginBottom: 4,
                        fontSize: 15,
                        fontWeight: '800',
                      }}
                      numberOfLines={2}
                    >
                      {displayTitle}
                    </Text>
                  ) : null}

                  {/* Terms snippet */}
                  {item.terms ? (
                    <Text
                      numberOfLines={3}
                      style={{
                        color: '#6d5243',
                        fontSize: 13,
                        marginBottom: 6,
                      }}
                    >
                      {item.terms}
                    </Text>
                  ) : null}

                  {/* Dashed divider */}
                  <View
                    style={{
                      borderBottomWidth: 1,
                      borderStyle: 'dashed',
                      borderColor: 'rgba(0,0,0,0.15)',
                      marginVertical: 6,
                    }}
                  />

                  {/* Bottom row: badges */}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    {/* Left badges */}
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: 6,
                        flex: 1,
                      }}
                    >
                      {expiresLabel && <Badge text={expiresLabel} type="warning" />}
                      {item.publication ? (
                        <Badge text={item.publication} type="neutral" />
                      ) : null}
                    </View>

                    {/* Saves pill */}
                    <View style={{ marginLeft: 6 }}>
                      <Badge text={`${sc} saved`} type="accent" />
                    </View>
                  </View>
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 16, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, color: '#5a4636', marginBottom: 6 }}>
              No coupons found
            </Text>
            <Text style={{ color: '#6b5b4d', textAlign: 'center' }}>
              Try clearing the search or filter above.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function Badge({
  text,
  type,
}: {
  text: string;
  type?: 'warning' | 'accent' | 'neutral';
}) {
  if (!text) return null;

  let bg = 'rgba(0,0,0,0.06)';
  let color = '#4b3a2e';

  if (type === 'warning') {
    bg = '#fef3c7';
    color = '#92400e';
  } else if (type === 'accent') {
    bg = PINK;
    color = '#9f1239';
  } else if (type === 'neutral') {
    bg = '#e5e7eb';
    color = '#374151';
  }

  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 999,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '600', color }}>{text}</Text>
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
        backgroundColor: active ? PINK : '#fff',
        borderColor: active ? PINK : '#f2caa1',
      }}
    >
      <Text style={{ color: '#5a4636', fontWeight: '700' }}>{text}</Text>
    </TouchableOpacity>
  );
}
