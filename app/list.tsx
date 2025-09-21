// app/(protected)/(tabs)/list.tsx
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getMyCoupons } from '../lib/coupons';

type Row = {
  id: string;
  store: string | null;
  title: string | null;
  terms: string | null;
  expires_at?: string | null;
  created_at?: string;
};

const PALETTE = [
  '#FFD1E0', // pink ticket
  '#E5FFF6', // mint
  '#FFF9C7', // lemon
  '#FFCBA4', // peach accent
];

function pickEmoji(store?: string | null) {
  const s = (store || '').toLowerCase();
  if (s.includes('pizza')) return '🍕';
  if (s.includes('grill') || s.includes('bar')) return '🍔';
  if (s.includes('mex') || s.includes('burrito') || s.includes('taco')) return '🌮';
  if (s.includes('coffee')) return '☕️';
  return '🎟️';
}

export default function ListScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const data = await getMyCoupons();
      setRows(data as Row[]);
    } catch (e: any) {
      console.warn('load coupons error', e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const countText = useMemo(
    () => (rows.length === 1 ? '1 coupon' : `${rows.length} coupons`),
    [rows.length]
  );

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffebd5' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#ffebd5' }}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: '#5a4636' }}>My Coupons</Text>
            <Text style={{ color: '#6b5b4d' }}>{countText}</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const bg = PALETTE[index % PALETTE.length];
          const emoji = pickEmoji(item.store);
          return (
            <TouchableOpacity
              activeOpacity={0.9}
              style={{
                backgroundColor: bg,
                borderRadius: 16,
                padding: 14,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ fontSize: 18, marginRight: 8 }}>{emoji}</Text>
                <Text style={{ fontWeight: '800', color: '#472b1a' }}>
                  {item.store ?? 'Unknown store'}
                </Text>
              </View>

              {item.title ? (
                <Text style={{ color: '#5b3b28', marginBottom: 4 }}>{item.title}</Text>
              ) : null}

              {item.terms ? (
                <Text numberOfLines={3} style={{ color: '#6d5243', lineHeight: 18 }}>
                  {item.terms}
                </Text>
              ) : null}

              <View style={{ marginTop: 8, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <View
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.08)',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ fontSize: 12, color: '#4b3a2e' }}>Saved</Text>
                </View>
                {item.expires_at ? (
                  <View
                    style={{
                      backgroundColor: 'rgba(0,0,0,0.08)',
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: 999,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: '#4b3a2e' }}>
                      Expires: {new Date(item.expires_at).toLocaleDateString()}
                    </Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 16, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, color: '#5a4636', marginBottom: 6 }}>No coupons yet</Text>
            <Text style={{ color: '#6b5b4d', textAlign: 'center' }}>
              Tap <Text style={{ fontWeight: '700' }}>Scan</Text> to add your first coupon. 🎟️
            </Text>
          </View>
        }
      />
    </View>
  );
}
