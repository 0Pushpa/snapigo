import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Button, StyleSheet, TextInput, View } from "react-native";
import { useCoupons } from "../context/coupons";
import { toNum, toStr } from "../utils/params";

export default function ConfirmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { addCoupon } = useCoupons();

  const [merchant, setMerchant] = useState(() => toStr(params.merchant));
  const [offer, setOffer]       = useState(() => toStr(params.offer));
  const [expiry, setExpiry]     = useState(() => toStr(params.expiry));
  const [address, setAddress]   = useState(() => toStr(params.address));

  function handleSave() {
    const createdAt = toNum(params.createdAt, Date.now());
    const id        = toStr(params.id, String(createdAt));

    addCoupon({ id, merchant, offer, expiry, address, createdAt });

    // Jump to List tab
    router.replace("/(tabs)/list");
  }

  return (
    <View style={styles.container}>
      <TextInput style={styles.input} value={merchant} onChangeText={setMerchant} placeholder="Merchant" />
      <TextInput style={styles.input} value={offer}    onChangeText={setOffer}    placeholder="Offer" />
      <TextInput style={styles.input} value={expiry}   onChangeText={setExpiry}   placeholder="Expiry (YYYY-MM-DD)" />
      <TextInput style={styles.input} value={address}  onChangeText={setAddress}  placeholder="Address (optional)" />
      <Button title="Save Coupon" onPress={handleSave} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", padding: 10, borderRadius: 8 },
});
