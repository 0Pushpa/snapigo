// app/(protected)/(tabs)/logout.tsx
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { listSavedCoupons, unsaveCoupon, type SavedRow } from '../../../lib/saves';
import { supabase } from '../../../lib/supabase';

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

function pickIconName(store: string | null | undefined): keyof typeof Ionicons.glyphMap {
  const s = (store ?? '').toLowerCase();
  if (/\bpizza\b/.test(s)) return 'pizza-outline';
  if (/\b(taco|burrito|mex)\b/.test(s)) return 'restaurant-outline';
  if (/\b(coffee|cafe)\b/.test(s)) return 'cafe-outline';
  if (/\b(grill|burger|bar)\b/.test(s)) return 'fast-food-outline';
  return 'pricetags-outline';
}

// 🔹 Hide junk titles like "undefined off" etc.
function sanitizeTitle(title?: string | null) {
  if (!title) return '';
  const trimmed = title.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();

  if (
    lower === 'undefined off' ||
    lower === 'null off' ||
    lower === '% off' ||
    lower === '$ off' ||
    lower === 'off'
  ) {
    return '';
  }

  return trimmed;
}

export default function Profile() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRow[]>([]);

  // Load saved coupons on mount
  useEffect(() => {
    loadSaved();
  }, []);

  async function loadSaved() {
    try {
      setSavedLoading(true);
      setSavedError(null);
      const rows = await listSavedCoupons();
      setSaved(rows);
    } catch (e: any) {
      console.warn('[Profile] loadSaved error', e?.message);
      setSavedError(e?.message ?? 'Failed to load saved coupons.');
    } finally {
      setSavedLoading(false);
    }
  }

  const doSignOut = async () => {
    try {
      setSigningOut(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.replace('/(auth)/auth');
    } catch (e: any) {
      Alert.alert('Sign out failed', e.message);
    } finally {
      setSigningOut(false);
    }
  };

  async function removeSaved(rowId: string, couponId?: string) {
    try {
      if (couponId) {
        await unsaveCoupon(couponId);
      }
      setSaved(prev => prev.filter(r => r.id !== rowId));
    } catch (e: any) {
      Alert.alert('Remove failed', e?.message ?? 'Please try again.');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#ffebd5', paddingTop: 40 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: '#5a4636' }}>My Profile </Text>
        <Text style={{ color: '#6b5b4d', marginTop: 4 }}>
          See your saved coupons and manage your account.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 24,
          gap: 16,
        }}
      >
        {/* Saved coupons card */}
        <View
          style={{
            backgroundColor: '#fff7ec',
            borderRadius: 18,
            padding: 14,
            borderWidth: 1,
            borderColor: '#f2caa1',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 8,
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons name="bookmark" size={20} color="#5a4636" />
              <Text
                style={{
                  marginLeft: 8,
                  fontWeight: '800',
                  fontSize: 16,
                  color: '#5a4636',
                }}
              >
                Saved coupons
              </Text>
            </View>

            <TouchableOpacity onPress={loadSaved} disabled={savedLoading}>
              {savedLoading ? (
                <ActivityIndicator size="small" color="#5a4636" />
              ) : (
                <Ionicons name="refresh" size={18} color="#5a4636" />
              )}
            </TouchableOpacity>
          </View>

          {savedError ? (
            <Text style={{ color: '#b91c1c', marginBottom: 8 }}>{savedError}</Text>
          ) : null}

          {savedLoading && !saved.length ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator color="#5a4636" />
            </View>
          ) : null}

          {!savedLoading && saved.length === 0 ? (
            <View style={{ paddingVertical: 10 }}>
              <Text style={{ color: '#6b5b4d' }}>
                You haven&apos;t saved any coupons yet. Explore the feed and tap{' '}
                <Text style={{ fontWeight: '700' }}>Save</Text> on a coupon to see it here.
              </Text>
            </View>
          ) : null}

          {saved.length > 0 ? (
            <FlatList
              data={saved}
              keyExtractor={(row) => row.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => (
                <View style={{ height: 8 }} />
              )}
              renderItem={({ item }) => {
                const c = item.coupon;
                if (!c) return null;
                const icon = pickIconName(c.store);
                const exp = expiryText(c.expires_at);
                const displayTitle = sanitizeTitle(c.title);

                return (
                  <View
                    style={{
                      backgroundColor: '#fff',
                      borderRadius: 14,
                      padding: 10,
                      borderWidth: 1,
                      borderColor: '#f2caa1',
                    }}
                  >
                    {/* top row: store + time saved */}
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name={icon} size={18} color="#472b1a" style={{ marginRight: 6 }} />
                        <Text
                          style={{
                            fontWeight: '800',
                            color: '#472b1a',
                          }}
                        >
                          {c.store ?? 'Unknown store'}
                        </Text>
                      </View>
                      <Text style={{ color: '#7b6a5f', fontSize: 11 }}>
                        {timeAgo(item.created_at)}
                      </Text>
                    </View>

                    {/* title (only if not junk) */}
                    {displayTitle ? (
                      <Text
                        style={{
                          color: '#5b3b28',
                          marginBottom: 4,
                          fontSize: 15,
                        }}
                      >
                        {displayTitle}
                      </Text>
                    ) : null}

                    {/* terms */}
                    {c.terms ? (
                      <Text
                        numberOfLines={3}
                        style={{
                          color: '#6d5243',
                          lineHeight: 18,
                          marginBottom: 4,
                          fontSize: 13,
                        }}
                      >
                        {c.terms}
                      </Text>
                    ) : null}

                    {/* expiry + chip row */}
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 4,
                      }}
                    >
                      {exp ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: 'rgba(0,0,0,0.05)',
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: 999,
                          }}
                        >
                          <Ionicons
                            name="time-outline"
                            size={13}
                            color="#4b3a2e"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={{ fontSize: 11, color: '#4b3a2e' }}>{exp}</Text>
                        </View>
                      ) : (
                        <View />
                      )}

                      <TouchableOpacity
                        onPress={() => removeSaved(item.id, c.id)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: '#fff1f2',
                          borderWidth: 1,
                          borderColor: '#fecdd3',
                        }}
                      >
                        <MaterialCommunityIcons
                          name="bookmark-remove-outline"
                          size={16}
                          color="#b91c1c"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={{ fontSize: 12, color: '#b91c1c', fontWeight: '700' }}>
                          Remove
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          ) : null}
        </View>

        {/* Sign out card */}
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 18,
            padding: 14,
            borderWidth: 1,
            borderColor: '#fecaca',
          }}
        >
          <Text style={{ color: '#6b5b4d', marginBottom: 12 }}>
            Sign out of this device. You can sign back in anytime.
          </Text>

          <TouchableOpacity
            onPress={doSignOut}
            disabled={signingOut}
            style={{
              backgroundColor: '#ef4444',
              paddingVertical: 12,
              borderRadius: 14,
              alignItems: 'center',
            }}
          >
            {signingOut ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontWeight: '700' }}>Sign Out</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
