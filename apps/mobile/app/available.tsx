import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import * as availabilityApi from "../lib/backend/availability";
import { ApiError } from "../lib/backend/client";
import { useAuth } from "../lib/auth/auth-context";
import { hapticAvailabilityToggle } from "../lib/native/haptics";
import { requestNotificationPermissionAtPointOfValue } from "../lib/native/notifications";

// design.md §14.6 step 6 / §21.1's duration set, reused verbatim from
// apps/web's go-available-form.tsx (free plan's fixed discrete set;
// Premium's custom-up-to-240 picker isn't built here, same documented
// scope cut as web's own form).
const DURATION_OPTIONS = [15, 30, 60, 120] as const;

function formatRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min remaining`;
}

export default function AvailableModal() {
  const router = useRouter();
  const { session } = useAuth();
  const [current, setCurrent] = useState<availabilityApi.SessionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [duration, setDuration] = useState<(typeof DURATION_OPTIONS)[number]>(30);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!session) return;
    availabilityApi
      .getCurrentAvailability(session.accessToken)
      .then((result) => setCurrent(result.current_session))
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, [session]);

  async function goAvailable() {
    if (!session) return;
    setError(null);
    setIsSubmitting(true);
    try {
      // §18.8/P27.2: notification permission "at the point of first
      // value" — going available (the moment a push about an incoming
      // request becomes genuinely useful) is exactly that point, not
      // app launch.
      void requestNotificationPermissionAtPointOfValue();
      const result = await availabilityApi.createAvailabilitySession(session.accessToken, {
        state: "available_now",
        duration_minutes: duration,
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
      });
      hapticAvailabilityToggle();
      setCurrent(result.session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function endSession() {
    if (!session || !current) return;
    setIsSubmitting(true);
    try {
      await availabilityApi.endAvailabilitySession(session.accessToken, current.id);
      hapticAvailabilityToggle();
      setCurrent(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-paper-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (current && current.state === "available_now") {
    return (
      <View className="flex-1 items-center justify-center bg-paper-white px-6">
        <Text className="text-heading-sm font-semibold text-ink">You&apos;re available now</Text>
        <Text className="mt-2 text-body text-graphite">{formatRemaining(current.expires_at)}</Text>
        <Pressable
          onPress={() => void endSession()}
          disabled={isSubmitting}
          className="mt-8 min-h-11 items-center justify-center rounded-buttons bg-mist-gray px-6 py-3 disabled:opacity-50"
        >
          {isSubmitting ? <ActivityIndicator /> : <Text className="text-ink">End session</Text>}
        </Pressable>
        <Pressable
          onPress={() => router.back()}
          className="mt-4 min-h-11 items-center justify-center px-6 py-3"
        >
          <Text className="text-iris-blue">Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper-white px-6 py-8">
      <Text className="mb-6 text-heading-sm font-semibold text-ink">Go available</Text>

      <Text className="mb-2 text-body-sm text-graphite">Duration</Text>
      <View className="mb-6 flex-row flex-wrap gap-2">
        {DURATION_OPTIONS.map((minutes) => (
          <Pressable
            key={minutes}
            accessibilityRole="button"
            accessibilityState={{ selected: duration === minutes }}
            onPress={() => setDuration(minutes)}
            className={`min-h-11 rounded-tags border px-4 py-2 ${duration === minutes ? "border-iris-blue bg-lavender-wash" : "border-mist-gray"}`}
          >
            <Text className="text-ink">{minutes} min</Text>
          </Pressable>
        ))}
      </View>

      <Text className="mb-2 text-body-sm text-graphite">Note (optional)</Text>
      <TextInput
        accessibilityLabel="Note"
        placeholder="What are you up for right now?"
        value={note}
        onChangeText={setNote}
        maxLength={120}
        className="mb-6 min-h-11 rounded-inputs border border-mist-gray px-4 py-2 text-ink"
      />

      {error && (
        <Text accessibilityRole="alert" className="mb-4 text-danger-text">
          {error}
        </Text>
      )}

      <Pressable
        onPress={() => void goAvailable()}
        disabled={isSubmitting}
        className="min-h-11 items-center justify-center rounded-buttons bg-charcoal px-4 py-3 disabled:opacity-50"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="text-paper-white">Go available for {duration} min</Text>
        )}
      </Pressable>
      <Pressable
        onPress={() => router.back()}
        className="mt-4 min-h-11 items-center justify-center px-6 py-3"
      >
        <Text className="text-iris-blue">Cancel</Text>
      </Pressable>
    </View>
  );
}
