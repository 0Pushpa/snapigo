import 'dotenv/config';

export default {
  expo: {
    name: 'Snapigo',
    slug: 'snapigo',
    ios: {
      bundleIdentifier: "com.pushpa.snapigo",
      deploymentTarget: "16.0",   // bump from 15.5 → 16.0 (or 17.0 if you prefer)
      infoPlist: { NSCameraUsageDescription: "We use the camera to scan coupons." },
    },
    android: { permissions: ['CAMERA'] },
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    },
  },
};
