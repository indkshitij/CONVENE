import { Redirect, Tabs, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useAuth } from "../../lib/auth/auth-context";

// §18.8: "bottom tab navigator mirroring the web tab bar (Home /
// Discover / Available FAB / Chats / Profile)." The FAB isn't one of
// the four real tab routes below (design.md's own web tab bar treats
// "Go available" as an action, not a destination screen) — it's an
// absolutely-positioned button overlaid on the tab bar that opens
// /available as a modal, the same idea as web's GoAvailableForm being a
// sheet, not a route.
export default function TabsLayout() {
  const { session } = useAuth();
  const router = useRouter();
  if (!session) return <Redirect href="/(auth)/login" />;

  return (
    <View className="flex-1">
      <Tabs screenOptions={{ headerShown: false }}>
        <Tabs.Screen name="home" options={{ title: "Home" }} />
        <Tabs.Screen name="discover" options={{ title: "Discover" }} />
        <Tabs.Screen name="chats" options={{ title: "Chats" }} />
        <Tabs.Screen name="profile" options={{ title: "Profile" }} />
      </Tabs>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go available"
        onPress={() => router.push("/available")}
        className="absolute bottom-14 left-1/2 h-14 w-14 -translate-x-1/2 items-center justify-center rounded-buttons-pill bg-charcoal"
      >
        <Text className="text-body-lg font-medium text-paper-white">●</Text>
      </Pressable>
    </View>
  );
}
