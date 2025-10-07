import 'dotenv/config';

export default {
  expo: {
    name: 'Snapigo',
    slug: 'snapigo',
    scheme: 'snapigo',
    plugins: [
      './plugins/with-apple-vision-ocr',
      'expo-location',
      'expo-notifications'
    ],
    ios: {
      bundleIdentifier: 'com.pushpa.snapigo',
      deploymentTarget: '16.0',
      infoPlist: {
        NSCameraUsageDescription: 'We use the camera to scan coupons.',
        NSLocationWhenInUseUsageDescription: 'Snapigo uses your location to alert you about nearby coupons you saved.',
        NSLocationAlwaysAndWhenInUseUsageDescription: 'Allow Always so Snapigo can alert you near a store even if the app is closed.',
        NSLocationAlwaysUsageDescription: 'Background location is required to trigger geofence notifications.',
        UIBackgroundModes: ['location']
      }
    },
    android: {
      permissions: [
        'CAMERA',
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE'
      ]
    },
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    }
  }
};
