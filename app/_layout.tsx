import { Stack } from "expo-router";
import { CouponsProvider } from "../context/coupons"; // adjust path if needed
import { useEffect } from "react";
import { ensureNotifPermissions } from "../utils/notifications";

export default function RootLayout() {
  useEffect(() => { ensureNotifPermissions(); }, []);

  return (
    <CouponsProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="confirm" options={{ title: "Confirm Coupon" }} />
      </Stack>
    </CouponsProvider>
  );
}
