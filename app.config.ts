import 'dotenv/config';
import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Snapigo',
  slug: 'snapigo',
  scheme: 'snapigo',
  version: '1.0.0',
  orientation: 'portrait',
  newArchEnabled: true,

  ios: {
    bundleIdentifier: 'com.pushpa.snapigo',
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: 'Allow Snapigo to use your camera to scan coupons.',
      NSLocationWhenInUseUsageDescription: 'Allow Snapigo to detect nearby stores while you use the app.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Allow Snapigo to alert you near stores even when the app is closed.',
      UIBackgroundModes: ['location', 'fetch', 'remote-notification'],
    },
  },

  android: {
    package: 'com.pushpa.snapigo',
    edgeToEdgeEnabled: true,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    permissions: [
      'CAMERA',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'RECEIVE_BOOT_COMPLETED',
      'WAKE_LOCK',
    ],
  },

  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },

  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: {
      projectId: 'replace-this-with-your-eas-project-id',
    },
  },

  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
      },
    ],
    'expo-camera',
    'expo-location',
    'expo-task-manager',
    'expo-notifications',

    // ✅ Proper way to set iOS deployment target
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '16.0', // or bump to '17.0' if you want
        },
      },
    ],
  ],
};

export default config;
