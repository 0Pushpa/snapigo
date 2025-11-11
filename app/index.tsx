import '@/lib/geo';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// declare module '@react-native-ml-kit/text-recognition';

export default function Index() {
  const [to, setTo] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setTo(data.session?.user ? '/(protected)/(tabs)/list' : '/(auth)/auth');
    });
  }, []);
  if (!to) return null;
  return <Redirect href={to} />;
}
