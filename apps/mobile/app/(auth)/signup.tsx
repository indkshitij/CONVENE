import { auth as authValidation } from "@convene/validation";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ApiError } from "../../lib/backend/client";
import * as authApi from "../../lib/backend/auth";
import { useAuth } from "../../lib/auth/auth-context";
import { CURRENT_TERMS_VERSION } from "../../lib/auth/terms-version";

export default function SignupScreen() {
  const router = useRouter();
  const { setSessionFromAuthResult } = useAuth();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [fullName, setFullName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    const candidate = {
      method,
      ...(method === "email" ? { email: identifier } : { phone: identifier }),
      password,
      full_name: fullName,
      date_of_birth: dateOfBirth,
      accepted_terms_version: CURRENT_TERMS_VERSION,
    };
    const parsed = authValidation.registerSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details and try again.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authApi.register(parsed.data);
      await setSessionFromAuthResult(result);
      // A freshly-registered user goes to onboarding, not straight into
      // (tabs) — overrides (auth)/_layout.tsx's own "session set ->
      // redirect to /(tabs)/home" default, which is what a returning
      // user hitting /login should get instead.
      router.replace("/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-paper-white"
      contentContainerClassName="justify-center px-6 py-12"
    >
      <Text className="mb-8 text-heading font-semibold text-ink">Create your account</Text>

      <TextInput
        accessibilityLabel="Full name"
        placeholder="Full name"
        value={fullName}
        onChangeText={setFullName}
        className="mb-4 min-h-11 rounded-inputs border border-mist-gray px-4 py-2 text-ink"
      />

      <View className="mb-4 flex-row gap-2">
        <Pressable
          onPress={() => setMethod("email")}
          className={`rounded-buttons px-4 py-2 ${method === "email" ? "bg-charcoal" : "bg-mist-gray"}`}
        >
          <Text className={method === "email" ? "text-paper-white" : "text-ink"}>Email</Text>
        </Pressable>
        <Pressable
          onPress={() => setMethod("phone")}
          className={`rounded-buttons px-4 py-2 ${method === "phone" ? "bg-charcoal" : "bg-mist-gray"}`}
        >
          <Text className={method === "phone" ? "text-paper-white" : "text-ink"}>Phone</Text>
        </Pressable>
      </View>

      <TextInput
        accessibilityLabel={method === "email" ? "Email" : "Phone"}
        placeholder={method === "email" ? "you@example.com" : "+1 555 000 0000"}
        autoCapitalize="none"
        keyboardType={method === "email" ? "email-address" : "phone-pad"}
        value={identifier}
        onChangeText={setIdentifier}
        className="mb-4 min-h-11 rounded-inputs border border-mist-gray px-4 py-2 text-ink"
      />
      <TextInput
        accessibilityLabel="Password"
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        className="mb-4 min-h-11 rounded-inputs border border-mist-gray px-4 py-2 text-ink"
      />
      <TextInput
        accessibilityLabel="Date of birth"
        placeholder="YYYY-MM-DD"
        value={dateOfBirth}
        onChangeText={setDateOfBirth}
        className="mb-4 min-h-11 rounded-inputs border border-mist-gray px-4 py-2 text-ink"
      />

      {error && (
        <Text accessibilityRole="alert" className="mb-4 text-danger-text">
          {error}
        </Text>
      )}

      <Pressable
        onPress={() => void onSubmit()}
        disabled={isSubmitting}
        className="min-h-11 items-center justify-center rounded-buttons bg-charcoal px-4 py-3 disabled:opacity-50"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="text-paper-white">Sign up</Text>
        )}
      </Pressable>

      <Link href="/(auth)/login" className="mt-6 text-center text-iris-blue">
        Already have an account? Log in
      </Link>
    </ScrollView>
  );
}
