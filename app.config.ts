import 'dotenv/config';

export default {
  expo: {
    name: "Snapigo",
    slug: "snapigo",

    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    },

    ios: {
      deploymentTarget: '15.5',                  // ⬅️ add this line
      infoPlist: {
        NSCameraUsageDescription: "We use the camera to scan coupons.",
      },
    },

    android: {
      permissions: ["CAMERA"],
    },
  },
};
