import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { extractCouponFields, extractStoreAndAddressFromBlocks, type ParsedCoupon } from '../../../lib/coupon-parse';
import { registerFromSupabase } from '../../../lib/geo';
import { parseCouponBasics, prepareForOcr, runOcr } from '../../../lib/ocr';
import { supabase } from '../../../lib/supabase';

// Import your API (assumes you added `publication` support there)
import { addCoupon, type Category, type Visibility } from '../../../lib/coupons';

type ModeType = '' | 'dine-in' | 'pickup';

const KNOWN_BRANDS = [
  'Starbucks','Subway','Chipotle','Dunkin','Panera',"Wendy's","Domino's",'Target','Walmart',
  'Kroger','Meijer','Aldi','Costco',"Sam's Club",'CVS','Walgreens','Best Buy','Taco Bell','Burger King',
];

const CATEGORY_OPTIONS: { value: Category; label: string; emoji: string }[] = [
  { value: 'food',    label: 'Food & Dining',       emoji: '🍔' },
  { value: 'retail',  label: 'Retail & Shopping',   emoji: '🛍️' },
  { value: 'grocery', label: 'Grocery',             emoji: '🛒' },
  { value: 'other',   label: 'Other',               emoji: '🎟️' },
];

function categoryLabel(c: Category) {
  const hit = CATEGORY_OPTIONS.find(o => o.value === c)!;
  return `${hit.emoji} ${hit.label}`;
}

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  const [store, setStore] = useState('');
  const [title, setTitle] = useState('');
  const [terms, setTerms] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<ModeType>('');
  const [locationNote, setLocationNote] = useState('');

  const [publication, setPublication] = useState('');            // 👈 NEW
  const [pubSuggestions, setPubSuggestions] = useState<string[]>([]); // 👈 NEW

  const [fullText, setFullText] = useState('');
  const [details, setDetails] = useState<ParsedCoupon | null>(null);

  const [visibility, setVisibility] = useState<Visibility>('private');
  const [category, setCategory] = useState<Category>('other');
  const [catPickerOpen, setCatPickerOpen] = useState(false); // compact dropdown modal

  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  // Fetch simple publication suggestions when modal opens
  useEffect(() => {
    const loadSuggestions = async () => {
      try {
        const { data, error } = await supabase
          .from('coupons')
          .select('publication')
          .not('publication', 'is', null)
          .neq('publication', '')
          .order('publication', { ascending: true })
          .limit(50);
        if (error) return;
        const uniq = Array.from(
          new Set((data ?? []).map(d => (d.publication ?? '').trim()).filter(Boolean))
        );
        setPubSuggestions(uniq.slice(0, 20));
      } catch {}
    };
    if (modalOpen) loadSuggestions();
  }, [modalOpen]);

  const openCamera = async () => {
    if (!permission || !permission.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('Camera needed', 'Please allow camera to scan coupons.');
        return;
      }
    }
    setShowCamera(true);
  };

  function guessCategory(s: string, t: string): Category {
    const x = `${s} ${t}`.toLowerCase();
    if (/(pizza|taco|grill|burger|cafe|coffee|restaurant|bar|deli|burrito|sushi)/.test(x)) return 'food';
    if (/(kroger|aldi|meijer|whole foods|grocery|supermarket|costco|sam's club)/.test(x)) return 'grocery';
    if (/(target|walmart|best buy|electronics|clothes|mall|boutique)/.test(x)) return 'retail';
    return 'other';
  }

  const takeAndOcr = async () => {
    try {
      if (!cameraRef.current) return;
      setBusy(true);

      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: true });
      const prepped = await prepareForOcr(photo.uri);
      const result = await runOcr(prepped);
      const text = result.text ?? '';

      if (!text.trim()) {
        Alert.alert('No text detected', 'Try again with better lighting and keep the coupon flat.');
        setBusy(false);
        return;
      }

      const basic = parseCouponBasics(text);
      const parsed = extractCouponFields(text, result.blocks);

      const layout = await extractStoreAndAddressFromBlocks(
        (result.blocks?.map(b => ({ text: b.text, bbox: b.bbox })) ?? []),
        text,
        { tryGeocode: true, brands: KNOWN_BRANDS }
      );

      setFullText(text);
      setDetails(parsed);

      const nextStore = layout.store ?? parsed.store ?? basic.storeGuess ?? '';
      setStore(nextStore);
      setAddress(layout.address ?? parsed.address ?? '');
      setPhone(layout.phone ?? parsed.phone ?? '');

      const nextTitle =
        basic.discount_kind
          ? (basic.discount_kind === 'percent' ? `${basic.discount_value}% off` : `$${basic.discount_value} off`)
          : (parsed.title ?? '');
      setTitle(nextTitle);

      setTerms((parsed.terms ?? text).slice(0, 400));
      setExpiresAt(basic.expires_guess ?? null);
      setMode((parsed.mode as ModeType) ?? '');
      setLocationNote(parsed.location_note ?? '');

      // Try to auto-detect publication from OCR (simple heuristic)
      const pubGuess = (() => {
        const lower = text.toLowerCase();
        if (lower.includes('entertainment book')) return 'Entertainment';
        if (lower.includes('entertainment®')) return 'Entertainment';
        if (lower.includes('key card')) return 'Key Card';
        if (lower.includes('valpak')) return 'Valpak';
        return '';
      })();
      setPublication(pubGuess);

      setCategory(guessCategory(nextStore, nextTitle));
      setModalOpen(true);
    } catch (e: any) {
      Alert.alert('Scan failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    try {
      setBusy(true);
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) {
        Alert.alert('Not signed in', 'Please sign in first.');
        return;
      }

      const nn = (s?: string | null) => (s && s.trim().length ? s.trim() : null);

      let geo: { lat: number; lng: number } | undefined = undefined;
      if (address) {
        try {
          const r = await Location.geocodeAsync(address);
          if (r?.length) geo = { lat: r[0].latitude, lng: r[0].longitude };
        } catch {}
      }

      const row = await addCoupon({
        owner_id: uid,
        store: nn(store),
        title: nn(title),
        terms: nn(terms),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        image_url: null,
        stable_id:
          store && title ? `${store}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null,
        attrs: {
          ocr: true,
          parser_version: 1,
          ocr_text: fullText || undefined,
          address: nn(address),
          phone: nn(phone || null),
          mode: mode || null,
          location_note: nn(locationNote),
          geo,
        },
        visibility,
        category,
        publication: nn(publication), // 👈 NEW
      });

      const res = await registerFromSupabase(uid);
      Alert.alert('Nearby alerts ready', `Watching ${res.count} place(s).`);

      setModalOpen(false);
      setShowCamera(false);
      router.push({ pathname: '/list', params: { id: row.id } });
    } catch (e: any) {
      Alert.alert('Save failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!showCamera) {
    return (
      <View style={styles.landing}>
        <Text style={styles.title}>Scan a Coupon</Text>
        <Text style={styles.subtitle}>Snap → Read → Save → Get nearby alerts</Text>

        <Animated.View style={{ transform: [{ scale: pulse }], width: '100%' }}>
          <TouchableOpacity onPress={openCamera} style={styles.scanCta} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.scanCtaText}>Start Scan</Text>}
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.tipsBox}>
          <Text style={styles.tipsTitle}>Tips</Text>
          <Text style={styles.tip}>Good lighting • Fill the frame • Keep flat</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#ffebd5', paddingTop:20 }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Scan</Text>
        <TouchableOpacity onPress={() => setShowCamera(false)} style={styles.headerClose}>
          <Text style={{ color: '#5a4636', fontWeight: '800' }}>Close</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.cameraWrap}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.frame} />
        </View>
      </View>

      <View style={{ padding: 12 }}>
        <TouchableOpacity style={styles.btnPrimary} onPress={takeAndOcr} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Scan Text</Text>}
        </TouchableOpacity>
      </View>

      <Modal visible={modalOpen} animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#ffebd5', padding: 10, paddingTop: 40, paddingBottom: 10 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#5a4636', marginBottom: 8 }}>
            Confirm details
          </Text>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Visibility (chips) */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: '#6b5b4d', marginBottom: 6, fontWeight: '700' }}>Visibility</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['private','public'] as Visibility[]).map(v => {
                  const active = visibility === v;
                  return (
                    <TouchableOpacity
                      key={v}
                      onPress={() => setVisibility(v)}
                      style={[
                        styles.chip,
                        { borderColor: active ? '#2563eb' : '#f2caa1', backgroundColor: active ? '#2563eb' : '#fff' }
                      ]}>
                      <Text style={{ color: active ? '#fff' : '#5a4636', fontWeight: '700' }}>
                        {v === 'private' ? 'Private' : 'Public (Feed)'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: '#6b5b4d', marginTop: 6, fontSize: 12 }}>
                Private → only in My List. Public → also appears in Feed; others can Save it.
              </Text>
            </View>

            {/* Category – compact dropdown (chip that opens tiny modal) */}
            <View style={{ marginBottom: 10 }}>
              <Text style={{ color: '#6b5b4d', marginBottom: 6, fontWeight: '700' }}>Category</Text>

              <Pressable
                onPress={() => setCatPickerOpen(true)}
                style={({ pressed }) => [
                  styles.dropdownTrigger,
                  { opacity: pressed ? 0.85 : 1 }
                ]}
              >
                <Text style={{ color: '#5a4636', fontWeight: '700' }}>{categoryLabel(category)}</Text>
                <Text style={{ color: '#5a4636' }}>{Platform.OS === 'ios' ? '▾' : '▼'}</Text>
              </Pressable>

              <Modal
                visible={catPickerOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setCatPickerOpen(false)}
              >
                <Pressable style={styles.sheetBackdrop} onPress={() => setCatPickerOpen(false)}>
                  <View style={styles.sheet}>
                    {CATEGORY_OPTIONS.map(opt => {
                      const active = opt.value === category;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[
                            styles.sheetRow,
                            active && { backgroundColor: '#f3f4f6' }
                          ]}
                          onPress={() => { setCategory(opt.value); setCatPickerOpen(false); }}
                        >
                          <Text style={{ fontSize: 16 }}>{opt.emoji}</Text>
                          <Text style={{ marginLeft: 8, color: '#1f2937', fontWeight: active ? '800' : '500' }}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </Pressable>
              </Modal>
            </View>

            {/* Publication */}
            <View style={{ marginBottom: 10 }}>
              <Field label="Publication (optional)" value={publication} onChangeText={setPublication} />
              {pubSuggestions.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                  {pubSuggestions.map(p => (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setPublication(p)}
                      style={[styles.chip, { borderColor: '#f2caa1', backgroundColor: '#fff', marginRight: 8 }]}
                    >
                      <Text style={{ color: '#5a4636' }}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <Text style={{ color: '#8a7a6b', fontSize: 12, marginTop: 4 }}>
                Examples: Entertainment, Key Card, Valpak, Independent
              </Text>
            </View>

            <Field label="Store Name" value={store} onChangeText={setStore} />
            {/* <Field label="Title" value={title} onChangeText={setTitle} /> */}
            <Field label="Address" value={address} onChangeText={setAddress} />
            <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Field label="Expires (YYYY-MM-DD or Jan 5, 2026)" value={expiresAt ?? ''} onChangeText={setExpiresAt} />
            <Multiline label="Location Notes" value={terms} onChangeText={setTerms} />
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#6b7280' }]} onPress={() => setModalOpen(false)}>
              <Text style={styles.btnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad' | 'email-address';
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: '#6b5b4d', marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={label}
        keyboardType={keyboardType ?? 'default'}
        style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: '#f2caa1',
        }}
      />
    </View>
  );
}

function Multiline({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: '#6b5b4d', marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={label}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
        style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: '#f2caa1',
          minHeight: 120,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  landing: { flex: 1, backgroundColor: '#ffebd5', padding: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '900', color: '#5a4636', marginBottom: 6 },
  subtitle: { color: '#6b5b4d', marginBottom: 22 },
  scanCta: { backgroundColor: '#2563eb', paddingVertical: 18, borderRadius: 18, alignItems: 'center' },
  scanCtaText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  tipsBox: { marginTop: 18, backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#f2caa1' },
  tipsTitle: { fontWeight: '800', color: '#5a4636', marginBottom: 4 },
  tip: { color: '#6b5b4d' },

  header: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#5a4636' },
  headerClose: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#f6d2ad55' },

  cameraWrap: { flex: 1, margin: 12, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: '#f6d2ad' },

  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '80%', height: '55%', borderRadius: 16, borderWidth: 3, borderColor: '#ffffffaa' },

  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 14, alignItems: 'center', padding: 10 },
  btnText: { color: '#fff', fontWeight: '700' },

  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
  },

  // Compact dropdown trigger
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f2caa1',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },

  // Tiny modal sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: '#00000055',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#f2caa1',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
});
