import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { preferences } from "../storage/preferences";

// §18.8/P27.2: "Android 13+ notification permission requested at the
// point of first value, not on launch." iOS has always required
// explicit opt-in for push regardless of OS version, so this same
// call site (never app launch/root layout) covers both platforms —
// Android just happens to be the platform where getting this wrong
// (asking on launch) would be a store-review-visible mistake.
const ASKED_KEY = "notifications.permission_asked";

// Call this from the point of first value (going available, sending a
// first message) — never from a root layout or app-launch effect.
export async function requestNotificationPermissionAtPointOfValue(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") return true;
  if (existing.status === "denied" && !existing.canAskAgain) return false;

  preferences.setBoolean(ASKED_KEY, true);
  const result = await Notifications.requestPermissionsAsync();
  return result.status === "granted";
}

export function hasAlreadyAskedForNotificationPermission(): boolean {
  return preferences.getBoolean(ASKED_KEY) ?? false;
}

// Android 13+ (API 33, `POST_NOTIFICATIONS`) is a runtime permission;
// below that, and on iOS, `requestPermissionsAsync()` alone is the
// complete story — nothing else to gate here.
export const notificationPermissionAppliesAtRuntime =
  Platform.OS === "android" ? Platform.Version >= 33 : true;
