// components/AuthGate.tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) { setAuthed(!!data.session?.user); setLoading(false); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) setAuthed(!!session?.user);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  if (loading) return (
    <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}>
      <ActivityIndicator />
    </View>
  );
  if (!authed) return <Redirect href="/(auth)/auth" />;

  return <>{children}</>;
}
