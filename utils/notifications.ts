// utils/notifications.ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Show banners even when the app is foregrounded (iOS 14+ API)
Notifications.setNotificationHandler({
  handleNotification: async (): Promise<Notifications.NotificationBehavior> => ({
    shouldShowBanner: true,  // replaces deprecated shouldShowAlert
    shouldShowList: true,    // show in Notification Center
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensureNotifPermissions(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();

  const granted =
    !!current.granted ||
    current.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (!granted) {
    const req = await Notifications.requestPermissionsAsync();
    const ok =
      !!req.granted ||
      req.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
      req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!ok) return false;
  }

  await setupAndroidChannel();
  return true;
}

async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('snapigo-default', {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function sendNow(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body }, // no channelId on iOS
    trigger: null,            // fire immediately
  });
}
