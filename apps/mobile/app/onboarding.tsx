import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as intentsApi from "../lib/backend/intents";
import * as locationApi from "../lib/backend/location";
import * as profileApi from "../lib/backend/profile";
import { useAuth } from "../lib/auth/auth-context";
import { requestForegroundLocation } from "../lib/native/location";

const MAX_INTENTS = 5;
const INTENT_EXPIRY_DAYS = 30;

// P27.2 (§18.8 "parity on onboarding... — the persuasion core of
// onboarding"): a deliberately lean, single-screen pass rather than web's
// full 6-step wizard (design.md §14.6) — one scrollable screen covering
// the three fields onboarding genuinely can't skip (a headline, at least
// one intent, and a location signal), each hitting the same real
// apps/api endpoints web's wizard steps use. No prerequisite-dimming, no
// per-step server-side resume state, no LinkedIn import — flagged scope
// cuts, not silent omissions.
export default function OnboardingScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [taxonomy, setTaxonomy] = useState<intentsApi.IntentTaxonomyEntry[]>([]);
  const [headline, setHeadline] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [selectedIntents, setSelectedIntents] = useState<string[]>([]);
  const [locationStatus, setLocationStatus] = useState<"unset" | "granted" | "skipped">("unset");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!session) return;
    intentsApi
      .getIntentTaxonomy(session.accessToken)
      .then(setTaxonomy)
      .catch(() => undefined);
  }, [session]);

  function toggleIntent(type: string) {
    setSelectedIntents((current) => {
      if (current.includes(type)) return current.filter((value) => value !== type);
      if (current.length >= MAX_INTENTS) return current;
      return [...current, type];
    });
  }

  async function enableLocation() {
    const result = await requestForegroundLocation();
    if (result.status === "granted" && session) {
      await locationApi
        .updatePreciseLocation(session.accessToken, result.latitude, result.longitude)
        .catch(() => undefined);
      setLocationStatus("granted");
    } else {
      // BR-LOC/§14.6 step 5: denial is a first-class path, not an error —
      // onboarding still completes without a location signal.
      setLocationStatus("skipped");
    }
  }

  async function finish() {
    if (!session) return;
    setError(null);
    setIsSubmitting(true);
    try {
      if (headline.trim() || jobTitle.trim()) {
        const etag = await profileApi.getOwnProfileEtag(session.accessToken);
        if (etag) {
          await profileApi.updateOwnProfile(session.accessToken, etag, {
            ...(headline.trim() ? { headline: headline.trim() } : {}),
            ...(jobTitle.trim() ? { job_title: jobTitle.trim() } : {}),
          });
        }
      }
      for (const type of selectedIntents) {
        await intentsApi
          .createIntent(session.accessToken, type, INTENT_EXPIRY_DAYS)
          .catch(() => undefined);
      }
      router.replace("/(tabs)/home");
    } catch {
      setError("Something went wrong finishing setup. You can continue from your profile later.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-paper-white" contentContainerClassName="px-6 py-12">
      <Text className="mb-2 text-heading-sm font-semibold text-ink">Set up your profile</Text>
      <Text className="mb-8 text-body-sm text-graphite">
        Takes about a minute — you can always fill in more later.
      </Text>

      <Text className="mb-2 text-body-sm text-graphite">Headline</Text>
      <TextInput
        accessibilityLabel="Headline"
        placeholder="What do you do?"
        value={headline}
        onChangeText={setHeadline}
        className="mb-4 min-h-11 rounded-inputs border border-mist-gray px-4 py-2 text-ink"
      />

      <Text className="mb-2 text-body-sm text-graphite">Job title</Text>
      <TextInput
        accessibilityLabel="Job title"
        placeholder="e.g. Product Manager"
        value={jobTitle}
        onChangeText={setJobTitle}
        className="mb-6 min-h-11 rounded-inputs border border-mist-gray px-4 py-2 text-ink"
      />

      <Text className="mb-2 text-body-sm text-graphite">
        What are you here for? (up to {MAX_INTENTS})
      </Text>
      <View className="mb-6 flex-row flex-wrap gap-2">
        {taxonomy.map((entry) => (
          <Pressable
            key={entry.type}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedIntents.includes(entry.type) }}
            onPress={() => toggleIntent(entry.type)}
            className={`min-h-11 rounded-tags border px-4 py-2 ${selectedIntents.includes(entry.type) ? "border-iris-blue bg-lavender-wash" : "border-mist-gray"}`}
          >
            <Text className="text-ink">{entry.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text className="mb-2 text-body-sm text-graphite">Location</Text>
      <Text className="mb-3 text-caption text-graphite">
        Used only while the app is open, to show how far away other members are — always as a
        rounded distance bucket, never your exact address.
      </Text>
      {locationStatus === "unset" && (
        <View className="mb-6 flex-row gap-2">
          <Pressable
            onPress={() => void enableLocation()}
            className="min-h-11 items-center justify-center rounded-buttons bg-charcoal px-4 py-3"
          >
            <Text className="text-paper-white">Enable location</Text>
          </Pressable>
          <Pressable
            onPress={() => setLocationStatus("skipped")}
            className="min-h-11 items-center justify-center px-4 py-3"
          >
            <Text className="text-iris-blue">Not now</Text>
          </Pressable>
        </View>
      )}
      {locationStatus === "granted" && (
        <Text className="mb-6 text-body-sm text-ink">Location enabled.</Text>
      )}
      {locationStatus === "skipped" && (
        <Text className="mb-6 text-body-sm text-graphite">
          Skipped — you can enable this later.
        </Text>
      )}

      {error && (
        <Text accessibilityRole="alert" className="mb-4 text-danger-text">
          {error}
        </Text>
      )}

      <Pressable
        onPress={() => void finish()}
        disabled={isSubmitting}
        className="min-h-11 items-center justify-center rounded-buttons bg-charcoal px-4 py-3 disabled:opacity-50"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="text-paper-white">Finish setup</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
