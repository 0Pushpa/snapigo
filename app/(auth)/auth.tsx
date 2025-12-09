// app/(auth)/auth.tsx
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';

type Mode = 'signin' | 'signup';

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // mode
  const [mode, setMode] = useState<Mode>('signin');

  // --- Sign In state ---
  const [siEmail, setSiEmail] = useState('');
  const [siPassword, setSiPassword] = useState('');
  const siPassRef = useRef<TextInput>(null);

  // --- Sign Up state ---
  const [suFullName, setSuFullName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suConfirm, setSuConfirm] = useState('');
  const [suAcceptTerms, setSuAcceptTerms] = useState(false);
  const suFullNameRef = useRef<TextInput>(null);
  const suEmailRef = useRef<TextInput>(null);
  const suPassRef = useRef<TextInput>(null);
  const suConfirmRef = useRef<TextInput>(null);

  // ui state
  const [secureSi, setSecureSi] = useState(true);
  const [secureSu, setSecureSu] = useState(true);
  const [secureSu2, setSecureSu2] = useState(true);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // animations
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 450, useNativeDriver: true }),
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
  const emailOk = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());
  const passwordIssues = (v: string) => {
    const issues: string[] = [];
    if (v.length < 8) issues.push('8+ chars');
    if (!/[a-z]/.test(v)) issues.push('lowercase');
    if (!/[A-Z]/.test(v)) issues.push('uppercase');
    if (!/[0-9]/.test(v)) issues.push('number');
    if (!/[^\w\s]/.test(v)) issues.push('symbol');
    return issues;
  };

  const strength = (() => {
    const issues = passwordIssues(suPassword);
    if (!suPassword) return '';
    if (issues.length >= 3) return 'Weak';
    if (issues.length === 2) return 'Okay';
    return 'Strong';
  })();

  // validation per mode
  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (mode === 'signin') {
      if (!emailOk(siEmail)) e.siEmail = 'Enter a valid email.';
      if (!siPassword) e.siPassword = 'Enter your password.';
    } else {
      if (!suFullName.trim()) e.suFullName = 'What should we call you?';
      if (!emailOk(suEmail)) e.suEmail = 'Enter a valid email.';
      const issues = passwordIssues(suPassword);
      if (issues.length) e.suPassword = `Password needs: ${issues.join(', ')}.`;
      if (suConfirm !== suPassword) e.suConfirm = 'Passwords do not match.';
      if (!suAcceptTerms) e.suTerms = 'Please accept Terms & Privacy.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleAuth = async () => {
    if (!validate()) return;

    try {
      setLoading(true);

      if (mode === 'signup') {
        const redirectTo = Linking.createURL('/auth/callback');
        const { error } = await supabase.auth.signUp({
          email: suEmail.trim(),
          password: suPassword,
          options: {
            data: { full_name: suFullName.trim() },
            emailRedirectTo: redirectTo,
          },
        });
        if (error) throw error;
        Alert.alert('Check your email', 'We sent a confirmation link to finish creating your account.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: siEmail.trim(),
          password: siPassword,
        });
        if (error) throw error;
      }
    } catch (e: any) {
      Alert.alert('Auth error', e?.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const signOut = () => supabase.auth.signOut();

  const headerTop = 80;

  return (
    <ImageBackground source={require('../../assets/bg3.png')} style={{ flex: 1, paddingTop:60 }} resizeMode="cover">
      <SafeAreaView style={{ flex: 1 }}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.select({ ios: 0, android: 0 }) ?? 0}
          >
            {/* Header */}
            <View style={{ paddingTop: headerTop, paddingHorizontal: 24 }}>
              <Text style={{ fontSize: 36, fontWeight: '800', textAlign: 'center', color: '#111827' }}>
                Snapigo
              </Text>
              <Text style={{ marginTop: 6, textAlign: 'center', fontWeight: '600', color: '#1f2937' }}>
                Scan, save & never miss a deal again.
              </Text>
            </View>

            {/* Animated card */}
            <Animated.View
              style={{
                flex: 1,
                marginTop: 16,
                paddingHorizontal: 16,
                opacity: fade,
                transform: [{ translateY: slide }],
              }}
            >
              {/* Toggle */}
              <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                <TouchableOpacity
                  onPress={() => {
                    setMode('signin');
                    setErrors({});
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 10,
                    alignItems: 'center',
                    backgroundColor: mode === 'signin' ? '#f55179' : '#e5e7eb',
                    marginRight: 6,
                  }}
                >
                  <Text style={{ color: mode === 'signin' ? '#fff' : '#111827', fontWeight: '700' }}>
                    Sign In
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setMode('signup');
                    setErrors({});
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 10,
                    alignItems: 'center',
                    backgroundColor: mode === 'signup' ? '#5376c1' : '#e5e7eb',
                    marginLeft: 6,
                  }}
                >
                  <Text style={{ color: mode === 'signup' ? '#fff' : '#111827', fontWeight: '700' }}>
                    Create Account
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Card */}
              <View
                style={{
                  backgroundColor: 'rgba(255,255,255,0.95)',
                  borderRadius: 20,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  // Stretch only on signup so Sign In stays compact
                  ...(mode === 'signup' ? { flex: 1 } : {}),
                }}
              >
                {/* ---------- SIGN IN (compact, no ScrollView) ---------- */}
                {mode === 'signin' && (
                  <View>
                    {/* Email */}
                    <View style={{ marginBottom: 12 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderBottomWidth: 1,
                          borderColor: '#d1d5db',
                        }}
                      >
                        <Ionicons name="mail" size={18} color="#374151" style={{ marginRight: 6 }} />
                        <TextInput
                          placeholder="email@domain.com"
                          autoCapitalize="none"
                          keyboardType="email-address"
                          value={siEmail}
                          onChangeText={setSiEmail}
                          style={{ flex: 1, paddingVertical: 10, color: '#111827' }}
                          returnKeyType="next"
                          onSubmitEditing={() => siPassRef.current?.focus()}
                        />
                      </View>
                      {!!errors.siEmail && (
                        <Text style={{ color: '#b91c1c', marginTop: 6 }}>{errors.siEmail}</Text>
                      )}
                    </View>

                    {/* Password */}
                    <View style={{ marginBottom: 8 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderBottomWidth: 1,
                          borderColor: '#d1d5db',
                        }}
                      >
                        <Ionicons name="lock-closed" size={18} color="#374151" style={{ marginRight: 6 }} />
                        <TextInput
                          ref={siPassRef}
                          placeholder="Password"
                          secureTextEntry={secureSi}
                          value={siPassword}
                          onChangeText={setSiPassword}
                          style={{ flex: 1, paddingVertical: 10, color: '#111827' }}
                          returnKeyType="done"
                          onSubmitEditing={Keyboard.dismiss}
                        />
                        <TouchableOpacity onPress={() => setSecureSi(s => !s)}>
                          <Ionicons name={secureSi ? 'eye' : 'eye-off'} size={18} color="#374151" />
                        </TouchableOpacity>
                      </View>
                      {!!errors.siPassword && (
                        <Text style={{ color: '#b91c1c', marginTop: 6 }}>{errors.siPassword}</Text>
                      )}
                    </View>

                    {/* Primary (Sign In) */}
                    <TouchableOpacity
                      onPress={handleAuth}
                      disabled={loading}
                      style={{
                        backgroundColor: '#f55179',
                        paddingVertical: 14,
                        borderRadius: 12,
                        alignItems: 'center',
                        marginTop: 6,
                      }}
                    >
                      {loading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={{ color: '#fff', fontWeight: '700' }}>Sign In</Text>
                      )}
                    </TouchableOpacity>

                    {/* Sign out (if logged in) */}
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
                )}

                {/* ---------- SIGN UP (scrollable; can grow) ---------- */}
                {mode === 'signup' && (
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
                    showsVerticalScrollIndicator={false}
                  >
                    {/* Full name */}
                    <View style={{ marginBottom: 12 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderBottomWidth: 1,
                          borderColor: '#d1d5db',
                        }}
                      >
                        <Ionicons name="person" size={18} color="#374151" style={{ marginRight: 6 }} />
                        <TextInput
                          ref={suFullNameRef}
                          placeholder="Full name"
                          value={suFullName}
                          onChangeText={setSuFullName}
                          style={{ flex: 1, paddingVertical: 10, color: '#111827' }}
                          autoCapitalize="words"
                          returnKeyType="next"
                          onSubmitEditing={() => suEmailRef.current?.focus()}
                        />
                      </View>
                      {!!errors.suFullName && (
                        <Text style={{ color: '#b91c1c', marginTop: 6 }}>{errors.suFullName}</Text>
                      )}
                    </View>

                    {/* Email */}
                    <View style={{ marginBottom: 12 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderBottomWidth: 1,
                          borderColor: '#d1d5db',
                        }}
                      >
                        <Ionicons name="mail" size={18} color="#374151" style={{ marginRight: 6 }} />
                        <TextInput
                          ref={suEmailRef}
                          placeholder="email@domain.com"
                          autoCapitalize="none"
                          keyboardType="email-address"
                          value={suEmail}
                          onChangeText={setSuEmail}
                          style={{ flex: 1, paddingVertical: 10, color: '#111827' }}
                          returnKeyType="next"
                          onSubmitEditing={() => suPassRef.current?.focus()}
                        />
                      </View>
                      {!!errors.suEmail && (
                        <Text style={{ color: '#b91c1c', marginTop: 6 }}>{errors.suEmail}</Text>
                      )}
                    </View>

                    {/* Password */}
                    <View style={{ marginBottom: 8 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderBottomWidth: 1,
                          borderColor: '#d1d5db',
                        }}
                      >
                        <Ionicons name="lock-closed" size={18} color="#374151" style={{ marginRight: 6 }} />
                        <TextInput
                          ref={suPassRef}
                          placeholder="Password"
                          secureTextEntry={secureSu}
                          value={suPassword}
                          onChangeText={setSuPassword}
                          style={{ flex: 1, paddingVertical: 10, color: '#111827' }}
                          returnKeyType="next"
                          onSubmitEditing={() => suConfirmRef.current?.focus()}
                        />
                        <TouchableOpacity onPress={() => setSecureSu(s => !s)}>
                          <Ionicons name={secureSu ? 'eye' : 'eye-off'} size={18} color="#374151" />
                        </TouchableOpacity>
                      </View>
                      {!!errors.suPassword && (
                        <Text style={{ color: '#b91c1c', marginTop: 6 }}>{errors.suPassword}</Text>
                      )}
                    </View>

                    {/* Strength */}
                    {!!suPassword && (
                      <Text style={{ marginBottom: 8, color: '#374151' }}>Strength: {strength}</Text>
                    )}

                    {/* Confirm */}
                    <View style={{ marginBottom: 8 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderBottomWidth: 1,
                          borderColor: '#d1d5db',
                        }}
                      >
                        <Ionicons name="lock-open" size={18} color="#374151" style={{ marginRight: 6 }} />
                        <TextInput
                          ref={suConfirmRef}
                          placeholder="Confirm password"
                          secureTextEntry={secureSu2}
                          value={suConfirm}
                          onChangeText={setSuConfirm}
                          style={{ flex: 1, paddingVertical: 10, color: '#111827' }}
                          returnKeyType="done"
                          onSubmitEditing={Keyboard.dismiss}
                        />
                        <TouchableOpacity onPress={() => setSecureSu2(s => !s)}>
                          <Ionicons name={secureSu2 ? 'eye' : 'eye-off'} size={18} color="#374151" />
                        </TouchableOpacity>
                      </View>
                      {!!errors.suConfirm && (
                        <Text style={{ color: '#b91c1c', marginTop: 6 }}>{errors.suConfirm}</Text>
                      )}
                    </View>

                    {/* Terms */}
                    <TouchableOpacity
                      onPress={() => setSuAcceptTerms(v => !v)}
                      style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 12 }}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={suAcceptTerms ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={suAcceptTerms ? '#5376c1' : '#6b7280'}
                      />
                      <Text style={{ marginLeft: 10, color: '#111827', flex: 1 }}>
                        I agree to the Terms of Service and Privacy Policy.
                      </Text>
                    </TouchableOpacity>
                    {!!errors.suTerms && (
                      <Text style={{ color: '#b91c1c', marginBottom: 8 }}>{errors.suTerms}</Text>
                    )}

                    {/* Primary (Create Account) */}
                    <TouchableOpacity
                      onPress={handleAuth}
                      disabled={loading}
                      style={{
                        backgroundColor: '#5376c1',
                        paddingVertical: 14,
                        borderRadius: 12,
                        alignItems: 'center',
                        marginTop: 6,
                      }}
                    >
                      {loading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={{ color: '#fff', fontWeight: '700' }}>Create Account</Text>
                      )}
                    </TouchableOpacity>

                    {/* Sign out (if logged in) */}
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
                  </ScrollView>
                )}
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    </ImageBackground>
  );
}
