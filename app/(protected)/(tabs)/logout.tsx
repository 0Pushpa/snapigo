import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../../lib/supabase';

export default function LogoutScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const doSignOut = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      // AuthGate will redirect to /(auth)/auth automatically,
      // but we can also push for immediate UX:
      router.replace('/(auth)/auth');
    } catch (e: any) {
      Alert.alert('Sign out failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#ffebd5', padding: 24, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: '#5a4636', marginBottom: 12 }}>
        Ready to leave?
      </Text>
      <Text style={{ color: '#6b5b4d', marginBottom: 20 }}>
        You can sign back in anytime.
      </Text>

      <TouchableOpacity
        onPress={doSignOut}
        disabled={loading}
        style={{
          backgroundColor: '#ef4444',
          paddingVertical: 14,
          borderRadius: 14,
          alignItems: 'center',
        }}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff', fontWeight: '700' }}>Sign Out</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
