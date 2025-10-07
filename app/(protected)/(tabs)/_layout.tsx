import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="scan"
      screenOptions={{ lazy: true }}  // don’t mount other tabs until opened
    >
      <Tabs.Screen name="scan" options={{ title: 'Scan' }} />
      {/* Temporarily hide the rest while we debug */}
      {/* <Tabs.Screen name="list" options={{ title: 'List' }} /> */}
      {/* <Tabs.Screen name="notify" options={{ title: 'Notify' }} /> */}
      {/* <Tabs.Screen name="debug" options={{ title: 'Debug' }} /> */}
    </Tabs>
  );
}
