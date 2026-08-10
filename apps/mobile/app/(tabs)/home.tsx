import { Link } from "expo-router";
import { Text, View } from "react-native";
import { useAuth } from "../../lib/auth/auth-context";

// P27.1 scaffolded this as a placeholder; P27.2 (§18.8 "parity on
// onboarding, availability, discovery, requests, chat") adds the one
// thing Home genuinely needs to be a spine hub: real links into the
// other real screens. The nearby-now strip / top-matches list / requests
// strip web renders inline here are out of this lean pass's scope —
// Discover and Requests are their own full screens instead of being
// re-summarized on Home too.
export default function HomeScreen() {
  const { session } = useAuth();
  return (
    <View className="flex-1 bg-paper-white px-6 py-8">
      <Text className="text-heading-sm font-semibold text-ink">
        Welcome back, {session?.user.full_name}
      </Text>
      <View className="mt-8 flex flex-col gap-4">
        <Link href="/requests" className="text-body text-iris-blue">
          Requests
        </Link>
        <Link href="/(tabs)/discover" className="text-body text-iris-blue">
          Discover
        </Link>
        <Link href="/(tabs)/chats" className="text-body text-iris-blue">
          Chats
        </Link>
      </View>
    </View>
  );
}
