import { Tabs } from 'expo-router';
import { View, Text } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="scan" options={{ title: 'Scan' }} />
      <Tabs.Screen name="list" options={{ title: 'List' }} />
      <Tabs.Screen name="notify" options={{ title: 'Notify' }} />
      <Tabs.Screen name="debug" options={{ title: 'debug' }} />
    </Tabs>
  );
}
