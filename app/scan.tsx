// import { useRouter } from "expo-router";
// import { Button, StyleSheet, View } from "react-native";
// import { fakeOcr } from "../services/FakeOcrService";

// function makeId() {
//   // stable-ish id: timestamp + random
//   return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
// }

// export default function ScanScreen() {
//   const router = useRouter();

//   async function handleScan() {
//     const result = await fakeOcr();
//     const id = makeId();

//     router.push({
//       pathname: "/confirm",
//       params: {
//         id,
//         merchant: String(result.merchant ?? ""),
//         address: String(result.address ?? ""),
//         offer: String(result.offer ?? ""),
//         expiry: String(result.expiry ?? ""),
//         createdAt: String(result.createdAt ?? Date.now()),
//       },
//     });
//   }

//   return (
//     <View style={styles.container}>
//       <Button title="📷 Scan" onPress={handleScan} />
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   container: { flex: 1, alignItems: "center", justifyContent: "center" },
// });
