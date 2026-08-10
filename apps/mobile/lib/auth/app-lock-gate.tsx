import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, Text, View } from "react-native";
import { authenticateWithBiometrics, isBiometricLockEnabled } from "../native/biometric-lock";

// §18.8: "Biometric app lock." Locks on cold start (if enabled) and
// re-locks whenever the app returns to the foreground from background —
// AppState is the one signal both platforms give for "the user just
// switched back to us," which is the moment a lock screen matters.
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const [isLocked, setIsLocked] = useState(() => isBiometricLockEnabled());
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextState === "active" &&
        isBiometricLockEnabled()
      ) {
        setIsLocked(true);
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, []);

  async function unlock() {
    setIsAuthenticating(true);
    try {
      const success = await authenticateWithBiometrics();
      if (success) setIsLocked(false);
    } finally {
      setIsAuthenticating(false);
    }
  }

  if (!isLocked) return <>{children}</>;

  return (
    <View className="flex-1 items-center justify-center bg-paper-white px-6">
      <Text className="mb-8 text-heading-sm font-semibold text-ink">Convene is locked</Text>
      <Pressable
        onPress={() => void unlock()}
        disabled={isAuthenticating}
        className="min-h-11 items-center justify-center rounded-buttons bg-charcoal px-6 py-3 disabled:opacity-50"
      >
        {isAuthenticating ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="text-paper-white">Unlock</Text>
        )}
      </Pressable>
    </View>
  );
}
