// import '@/lib/geo';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated, ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Text, TextInput, TouchableOpacity,
  View
} from 'react-native';
import { supabase } from '../../lib/supabase';
export default function AuthScreen() {
  const router = useRouter();

  // form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secure, setSecure] = useState(true);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // animations
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 550, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 550, useNativeDriver: true }),
    ]).start();
  }, [fade, slide]);

  // redirect on login
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (uid) router.replace('/(protected)/(tabs)/scan');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) router.replace('/(protected)/(tabs)/scan');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  // helpers
  const validate = () => {
    if (!email.includes('@')) return 'Enter a valid email.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  };

  const handleAuth = async (mode: 'signin' | 'signup') => {
    const err = validate();
    if (err) return Alert.alert('Oops', err);

    try {
      setLoading(true);
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        Alert.alert('Account created', 'Check your email if confirmation is required.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e: any) {
      Alert.alert('Auth error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const signOut = () => supabase.auth.signOut();

  return (
    <ImageBackground
      source={require('../../assets/bg3.png')} // add your own image here
      style={{ flex: 1 }}
      resizeMode="cover"
    >
      {/* overlay for readability */}
      <View style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          {/* header */}
          <View style={{ paddingTop: 160, paddingHorizontal: 24 }}>
            <Text style={{ color: '', fontSize: 36, fontWeight: '800', textAlign:'center'}}>
              Snapigo
            </Text>
            <Text style={{ color: '', marginTop: 6, textAlign:'center',fontWeight:"600" }}>
              Scan, save & never miss a deal again.
            </Text>
          </View>

          {/* animated login card */}
          <Animated.View
            style={{
              flex: 1,
              marginTop: 24,
              paddingHorizontal: 16,
              opacity: fade,
              transform: [{ translateY: slide }],
            }}
          >
            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.9)',
                borderRadius: 20,
                padding: 18,
                boxShadow:"0px 2px 5px 0px"
              }}
            >
              {/* email input */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 12,
                  borderBottomWidth: 1,
                  borderColor: '#d1d5db',
                }}
              >
                <Ionicons name="mail" size={18} color="#374151" style={{ marginRight: 6 }} />
                <TextInput
                  placeholder="email@domain.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  style={{ flex: 1, paddingVertical: 10, color:"black" }}
                />
              </View>

              {/* password input */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginBottom: 12,
                  borderBottomWidth: 1,
                  borderColor: '#d1d5db',
                }}
              >
                <Ionicons name="lock-closed" size={18} color="#374151" style={{ marginRight: 6 }} />
                <TextInput
                  placeholder="password"
                  secureTextEntry={secure}
                  value={password}
                  onChangeText={setPassword}
                  style={{ flex: 1, paddingVertical: 10 }}
                />
                <TouchableOpacity onPress={() => setSecure(s => !s)}>
                  <Ionicons name={secure ? 'eye' : 'eye-off'} size={18} color="#374151" />
                </TouchableOpacity>
              </View>

              {/* buttons */}
              <TouchableOpacity
                onPress={() => handleAuth('signin')}
                disabled={loading}
                style={{
                  backgroundColor: '#f55179',
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Sign In</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleAuth('signup')}
                disabled={loading}
                style={{
                  backgroundColor: '#5376c1',
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: 'center',
                }}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Create Account</Text>
                )}
              </TouchableOpacity>

              {/* sign out (if logged in) */}
              {userId && (
                <TouchableOpacity
                  onPress={signOut}
                  style={{
                    backgroundColor: '#374151',
                    paddingVertical: 12,
                    borderRadius: 12,
                    alignItems: 'center',
                    marginTop: 12,
                  }}
                >
                  <Text style={{ color: '#fff' }}>Sign Out</Text>
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </ImageBackground>
  );
}
