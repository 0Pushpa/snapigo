import Constants from 'expo-constants';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../../../lib/supabase';

export default function DebugScreen() {
  const extra = (Constants.expoConfig?.extra ?? {}) as any;
  const [sessionInfo, setSessionInfo] = useState<string>('(tap “Check Session”)');
  const [pingResult, setPingResult] = useState<string>('(tap “Ping DB”)');

  const checkSession = async () => {
    const { data } = await supabase.auth.getSession();
    setSessionInfo(data.session ? `Logged in as ${data.session.user.id}` : 'Not logged in');
  };

  const pingDb = async () => {
    // Try a harmless SELECT. If you’re not logged in, RLS should block it.
    const { data, error, status } = await supabase
      .from('coupons')
      .select('id')
      .limit(1);

    if (error) {
      setPingResult(`Reached backend ✅ (status ${status}): ${error.message}`);
    } else {
      setPingResult(`Reached backend ✅ rows: ${data?.length ?? 0}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Debug</Text>

      <Text style={styles.label}>supabaseUrl</Text>
      <Text style={styles.mono}>{String(extra.supabaseUrl || '(missing)')}</Text>

      <Text style={styles.label}>Session</Text>
      <Text style={styles.mono}>{sessionInfo}</Text>

      <View style={{ height: 12 }} />

      <TouchableOpacity style={styles.btn} onPress={checkSession}>
        <Text style={styles.btnText}>Check Session</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btn, { backgroundColor: '#2563eb' }]} onPress={pingDb}>
        <Text style={styles.btnText}>Ping DB</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Ping Result</Text>
      <Text style={styles.mono}>{pingResult}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 8 },
  h1: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  label: { marginTop: 12, fontWeight: '600' },
  mono: { fontFamily: 'Courier', color: '#374151' },
  btn: { backgroundColor: '#10b981', padding: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: '600' },
});
