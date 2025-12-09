// app/(protected)/(tabs)/_layout.tsx
import "@/lib/geo";
import { supabase } from "@/lib/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { UNREAD_KEY } from "@/lib/geo";

// ⬇️ Custom icon showing user's initial
function ProfileTabIcon({
  color,
  size,
  focused,
}: {
  color: string;
  size: number;
  focused: boolean;
}) {
  const [initial, setInitial] = useState<string>("?");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;

        const fullName =
          (user?.user_metadata?.full_name as string | undefined) ||
          (user?.user_metadata?.name as string | undefined) ||
          user?.email ||
          "";

        const first = fullName.trim().charAt(0).toUpperCase();
        setInitial(first || "?");
      } catch {
        setInitial("?");
      }
    })();
  }, []);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: focused ? "#2563eb" : "#ffe4c7",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: focused ? "#ffffff" : color,
          fontWeight: "800",
          fontSize: size * 0.55,
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const [notifCount, setNotifCount] = useState(0);

  // 🔁 Keep unread count in sync with AsyncStorage
  useEffect(() => {
    let isMounted = true;

    const loadCount = async () => {
      try {
        const raw = await AsyncStorage.getItem(UNREAD_KEY);
        const n = raw ? parseInt(raw, 10) || 0 : 0;
        if (isMounted) setNotifCount(n);
      } catch {
        if (isMounted) setNotifCount(0);
      }
    };

    // initial load
    loadCount();

    // refresh whenever a notification is received in foreground
    const sub = Notifications.addNotificationReceivedListener(() => {
      loadCount();
    });

    // small polling safety net (covers background → foreground cases)
    const interval = setInterval(loadCount, 3000);

    return () => {
      isMounted = false;
      sub.remove();
      clearInterval(interval);
    };
  }, []);

  // Wrap an icon with a badge
  const withBadge = (icon: React.ReactNode) => {
    if (!notifCount) return icon;

    return (
      <View>
        {icon}
        <View
          style={{
            position: "absolute",
            top: -4,
            right: -10,
            backgroundColor: "#ef4444",
            borderRadius: 999,
            minWidth: 16,
            paddingHorizontal: 4,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: "#fff",
              fontSize: 10,
              fontWeight: "700",
            }}
          >
            {notifCount > 9 ? "9+" : notifCount}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Tabs
      initialRouteName="scan"
      screenOptions={{
        headerShown: false,
        lazy: true,
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: { backgroundColor: "#fff" },
      }}
    >
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "scan" : "scan-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="list"
        options={{
          title: "List",
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "ticket-percent" : "ticket-percent-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="feed"
        options={{
          title: "Feed",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? "newspaper" : "newspaper-outline"}
              size={size}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="notify"
        options={{
          title: "Notify",
          tabBarIcon: ({ color, size, focused }) =>
            withBadge(
              <Ionicons
                name={focused ? "notifications" : "notifications-outline"}
                size={size}
                color={color}
              />
            ),
        }}
      />

      {/* ⭐ PROFILE TAB WITH INITIAL ICON */}
      <Tabs.Screen
        name="Profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size, focused }) => (
            <ProfileTabIcon color={color} size={size} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
