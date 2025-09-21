import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal, TextInput, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';

import { prepareForOcr, runOcr, parseCouponBasics } from '../../../lib/ocr';
import { addCoupon } from '../../../lib/coupons';
import { supabase } from '../../../lib/supabase';

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // editable fields
  const [store, setStore] = useState('');
  const [title, setTitle] = useState('');
  const [terms, setTerms] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => { if (!permission) requestPermission(); }, [permission, requestPermission]);

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

      // 1) capture
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: true });
      // 2) resize
      const prepped = await prepareForOcr(photo.uri);
      // 3) OCR
      const result = await runOcr(prepped);
      const fullText = result.text ?? '';

      if (!fullText.trim()) {
        Alert.alert('No text detected', 'Try again with better lighting and keep the coupon flat.');
        setBusy(false);
        return;
      }

      // 4) parse basics
      const basic = parseCouponBasics(fullText);
      setStore(basic.storeGuess ?? '');
      setTitle(
        basic.discount_kind
          ? (basic.discount_kind === 'percent' ? `${basic.discount_value}% off` : `$${basic.discount_value} off`)
          : ''
      );
      setTerms(fullText.slice(0, 400)); // keep short for v1
      setExpiresAt(basic.expires_guess ?? null);

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
      if (!uid) { Alert.alert('Not signed in', 'Please sign in first.'); return; }

      // Use YOUR existing addCoupon(partial: Partial<Coupon>)
      const row = await addCoupon({
        owner_id: uid,
        store: store || null,
        title: title || null,
        terms: terms || null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        image_url: null, // (v2: attach photo + upload to Storage)
        stable_id: (store && title) ? `${store}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g,'-') : null,
        attrs: { ocr: true }, // mark as OCR-sourced
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
        <ScrollView contentContainerStyle={{ gap: 10 }}>
            <Field label="Store" value={store} onChangeText={setStore} />
            <Field label="Title" value={title} onChangeText={setTitle} />
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

function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (s: string) => void }) {
  return (
    <View>
      <Text style={{ color: '#6b5b4d', marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={label}
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

function Multiline({ label, value, onChangeText }: { label: string; value: string; onChangeText: (s: string) => void }) {
  return (
    <View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: '#ffebd5' },
  text: { color: '#5a4636', textAlign: 'center', marginBottom: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
