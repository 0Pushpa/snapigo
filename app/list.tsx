import { View, Text, FlatList, StyleSheet, Button } from "react-native";
import { useCoupons } from "../context/coupons";
import { sendNow } from "../utils/notifications";

export default function ListScreen() {
  const { coupons } = useCoupons();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Saved Coupons</Text>
      <FlatList
        data={coupons}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.merchant}>{item.merchant || "(no merchant)"}</Text>
            <Text>{item.offer || "(no offer)"}</Text>
            <Text>Expires: {item.expiry || "N/A"}</Text>
            {!!item.address && <Text>📍 {item.address}</Text>}
            <View style={{ marginTop: 8 }}>
              <Button
                title="Simulate I'm here → notify"
                onPress={() =>
                  sendNow(`You're near ${item.merchant}`, item.offer || "Open Snapigo to view")
                }
              />
            </View>
          </View>
        )}
        ListEmptyComponent={<Text>No coupons yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 12 },
  item: { paddingVertical: 12, borderBottomWidth: 1, borderColor: "#eee" },
  merchant: { fontWeight: "bold" },
});
