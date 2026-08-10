import * as LocalAuthentication from "expo-local-authentication";
import { preferences } from "../storage/preferences";

// §18.8: "Biometric app lock." An opt-in setting (Profile/Settings), not
// forced — enabling it stores a local preference; the root layout
// checks it on foreground and gates the app behind Face ID/Touch
// ID/fingerprint before showing any screen content.
const ENABLED_KEY = "security.biometric_lock_enabled";

export function isBiometricLockEnabled(): boolean {
  return preferences.getBoolean(ENABLED_KEY) ?? false;
}

export function setBiometricLockEnabled(enabled: boolean): void {
  preferences.setBoolean(ENABLED_KEY, enabled);
}

export async function isBiometricLockAvailable(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Convene",
    disableDeviceFallback: false,
  });
  return result.success;
}
