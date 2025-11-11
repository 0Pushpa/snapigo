import { Stack } from 'expo-router';
import AuthGate from '../../components/AuthGate';

export default function ProtectedLayout() {
  return (
    <AuthGate>
      <Stack>
        {/* Tabs are a child route */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* Any extra screens in the protected area */}
        {/* <Stack.Screen name="confirm" options={{ title: 'Confirm Coupon' }} /> */}
      </Stack>
    </AuthGate>
  );
}
