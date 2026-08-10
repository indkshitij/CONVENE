import * as Location from "expo-location";

// §18.8/P27.2: "expo-location foreground-only, requested with an
// in-context rationale — no background location code path may exist."
// This file is deliberately the ONLY place this app touches
// expo-location, and it never imports `startLocationUpdatesAsync`,
// `TaskManager`, or anything else that could run in the background —
// that's what makes "no background location" an audit of this one file,
// not a promise. app.json's own "expo-location" plugin config also
// pins `isIosBackgroundLocationEnabled`/`isAndroidBackgroundLocationEnabled`
// to `false`, so the native permission the OS ever shows the user is
// "while using the app," never "always."
export type ForegroundLocationResult =
  | { status: "granted"; latitude: number; longitude: number }
  | { status: "denied" }
  | { status: "unavailable" };

// Called only at the point of first value (design.md §14.6 step 5's
// "location permission with the honest in-context rationale") — never
// on app launch. The system permission dialog's own copy is
// app.json's `locationWhenInUsePermission` string; this function is
// what a screen calls once the user has already seen the in-context
// rationale UI and tapped "Enable location."
export async function requestForegroundLocation(): Promise<ForegroundLocationResult> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return { status: "denied" };

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      status: "granted",
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function hasForegroundLocationPermission(): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === "granted";
}
