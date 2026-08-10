import "../global.css";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppLockGate } from "../lib/auth/app-lock-gate";
import { AuthProvider, useAuth } from "../lib/auth/auth-context";

void SplashScreen.preventAutoHideAsync();

// §18.8: Expo Router root — (auth) and (tabs) are the two route groups
// every screen lives under; this layout only owns session
// restoration (the splash screen stays up until it's done) and the
// stack shell around both groups, mirroring apps/web's root
// (app)/layout.tsx + (auth) route-group split.
function RootLayoutNav() {
  const { isRestoring } = useAuth();

  useEffect(() => {
    if (!isRestoring) void SplashScreen.hideAsync();
  }, [isRestoring]);

  if (isRestoring) return null;

  return (
    <AppLockGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen
          name="available"
          options={{ presentation: "modal", headerShown: true, title: "Go available" }}
        />
        <Stack.Screen name="requests" options={{ headerShown: true, title: "Requests" }} />
        <Stack.Screen name="chat/[conversationId]" options={{ headerShown: true, title: "" }} />
      </Stack>
    </AppLockGate>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
