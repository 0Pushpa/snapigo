import { Button, StyleSheet, View } from "react-native";
import { sendNow } from "../utils/notifications";

export default function NotificationTest() {
  return (
    <View style={styles.container}>
      <Button
        title="Send Test Notification"
        onPress={() => sendNow("Nearby Offer!", "50% off Starbucks")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
});
