import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../lib/auth/auth-context";

// Mirrors apps/web's own login-when-unauthenticated guard, inverted: a
// signed-in user has no business seeing the auth screens, same as an
// unauthenticated one has no business in (tabs).
export default function AuthLayout() {
  const { session } = useAuth();
  if (session) return <Redirect href="/(tabs)/home" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
