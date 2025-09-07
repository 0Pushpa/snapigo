import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// Show alerts even when app is foregrounded (so you can see it during dev)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensureNotifPermissions(): Promise<boolean> {
  // If already granted/provisional on iOS, we're good
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    await setupAndroidChannel();
    return true;
  }
  // Ask user
  const req = await Notifications.requestPermissionsAsync();
  await setupAndroidChannel();
  return !!req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

async function setupAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("snapigo-default", {
    name: "General",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function sendNow(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null, // fire immediately
  });
}
