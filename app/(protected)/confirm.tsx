import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function ConfirmScreen() {
  const params = useLocalSearchParams();
  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>Confirm Coupon</Text>
      <Text style={{ marginTop: 8 }}>id: {String(params.id ?? '')}</Text>
      <Text style={{ marginTop: 8 }}>{String(params.store ?? '')}</Text>
      <Text style={{ color: '#6b7280', marginTop: 4 }}>{String(params.title ?? '')}</Text>
    </View>
  );
}
