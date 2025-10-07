import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { extractCouponFields, type ParsedCoupon } from '../../../lib/coupon-parse';
import { addCoupon } from '../../../lib/coupons';
import { parseCouponBasics, prepareForOcr, runOcr } from '../../../lib/ocr';
import { supabase } from '../../../lib/supabase';

type ModeType = '' | 'dine-in' | 'pickup';

// const cleanPhone = (p: string) =>
//   p
//     .replace(/[•·●]/g, '')
//     .replace(/[–—−]/g, '-')
//     .replace(/\u00A0/g, ' ')
//     .replace(/[^\d().\-\s]/g, '')
//     .replace(/\s+/g, ' ')
//     .replace(/\s*-\s*/g, '-')
//     .trim();

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const [store, setStore] = useState('');
  const [title, setTitle] = useState('');
  const [terms, setTerms] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<ModeType>('');
  const [locationNote, setLocationNote] = useState('');

  const [fullText, setFullText] = useState('');
  const [details, setDetails] = useState<ParsedCoupon | null>(null);

  useEffect(() => {
    if (!permission) requestPermission();
  }, [permission, requestPermission]);

  if (!permission || !permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>We need camera permission to scan coupons.</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
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

      setFullText(text);
      setDetails(parsed);

      setStore(parsed.store ?? basic.storeGuess ?? '');
      setTitle(
        basic.discount_kind
          ? basic.discount_kind === 'percent'
            ? `${basic.discount_value}% off`
            : `$${basic.discount_value} off`
          : ''
      );
      setTerms((parsed.terms ?? text).slice(0, 400));
      setExpiresAt(basic.expires_guess ?? null);
      setAddress(parsed.address ?? '');
      setPhone(parsed.phone ?? '');
      setMode((parsed.mode as ModeType) ?? '');
      setLocationNote(parsed.location_note ?? '');

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

      const row = await addCoupon({
        owner_id: uid,
        store: nn(store),
        title: nn(title),
        terms: nn(terms),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        image_url: null,
        stable_id: store && title ? `${store}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') : null,
        attrs: {
          ocr: true,
          parser_version: 1,
          ocr_text: fullText || undefined,
          address: nn(address),
          phone: nn(phone || null),
          mode: mode || null,
          location_note: nn(locationNote),
        },
      });

      setModalOpen(false);
      router.push({ pathname: '/confirm', params: { id: row.id } });
    } catch (e: any) {
      Alert.alert('Save failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#ffebd5' }}>
      <View style={{ flex: 1, margin: 12, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: '#f6d2ad' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
      </View>

      <View style={{ padding: 12 }}>
        <TouchableOpacity style={styles.btnPrimary} onPress={takeAndOcr} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Scan Text</Text>}
        </TouchableOpacity>
      </View>

      <Modal visible={modalOpen} animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#ffebd5', padding: 16 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#5a4636', marginBottom: 8 }}>Confirm details</Text>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <Field label="Store" value={store} onChangeText={setStore} />
            <Field label="Title" value={title} onChangeText={setTitle} />
            <Field label="Address" value={address} onChangeText={setAddress} />
            <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <ModeRow mode={mode} setMode={setMode} />
            <Multiline label="Location note" value={locationNote} onChangeText={setLocationNote} />
            <Multiline label="Terms (from OCR)" value={terms} onChangeText={setTerms} />
            <Field label="Expires (YYYY-MM-DD or Jan 5, 2026)" value={expiresAt ?? ''} onChangeText={setExpiresAt} />
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

function ModeRow({ mode, setMode }: { mode: ModeType; setMode: (m: ModeType) => void }) {
  const isDine = mode === 'dine-in';
  const isPickup = mode === 'pickup';
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ color: '#6b5b4d', marginBottom: 4 }}>Mode</Text>
      <View style={{ flexDirection: 'row' }}>
        <TouchableOpacity
          onPress={() => setMode(isDine ? '' : 'dine-in')}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: isDine ? '#2563eb' : '#f2caa1',
            backgroundColor: isDine ? '#2563eb' : '#fff',
            marginRight: 8,
          }}>
          <Text style={{ color: isDine ? '#fff' : '#5a4636', fontWeight: '700' }}>Dine-in</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setMode(isPickup ? '' : 'pickup')}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: isPickup ? '#2563eb' : '#f2caa1',
            backgroundColor: isPickup ? '#2563eb' : '#fff',
          }}>
          <Text style={{ color: isPickup ? '#fff' : '#5a4636', fontWeight: '700' }}>Pickup</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: '#ffebd5' },
  text: { color: '#5a4636', textAlign: 'center', marginBottom: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
