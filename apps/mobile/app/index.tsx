import { Redirect } from "expo-router";
import { useAuth } from "../lib/auth/auth-context";

// The one entry route Expo Router lands on first — RootLayout already
// held the splash screen until isRestoring settled, so by the time this
// renders `session` is final for this app run.
export default function Index() {
  const { session } = useAuth();
  return <Redirect href={session ? "/(tabs)/home" : "/(auth)/login"} />;
}
