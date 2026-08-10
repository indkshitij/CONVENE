import { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useAuth } from "../../lib/auth/auth-context";
import {
  isBiometricLockAvailable,
  isBiometricLockEnabled,
  setBiometricLockEnabled,
} from "../../lib/native/biometric-lock";

export default function ProfileScreen() {
  const { session, logout } = useAuth();
  const [biometricEnabled, setBiometricEnabledState] = useState(isBiometricLockEnabled());
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    void isBiometricLockAvailable().then(setBiometricAvailable);
  }, []);

  function toggleBiometricLock(next: boolean) {
    setBiometricLockEnabled(next);
    setBiometricEnabledState(next);
  }

  return (
    <View className="flex-1 bg-paper-white px-6 py-8">
      <Text className="text-heading-sm font-semibold text-ink">{session?.user.full_name}</Text>

      {biometricAvailable && (
        <View className="mt-8 flex-row items-center justify-between">
          <Text className="text-body text-ink">Biometric app lock</Text>
          <Switch value={biometricEnabled} onValueChange={toggleBiometricLock} />
        </View>
      )}

      <Pressable
        onPress={() => void logout()}
        className="mt-8 min-h-11 items-center justify-center rounded-buttons bg-mist-gray px-4 py-3"
      >
        <Text className="text-ink">Log out</Text>
      </Pressable>
    </View>
  );
}
