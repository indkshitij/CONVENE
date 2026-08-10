import { auth as authValidation } from "@convene/validation";
import { Link } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { ApiError } from "../../lib/backend/client";
import { useAuth } from "../../lib/auth/auth-context";

export default function LoginScreen() {
  const { login } = useAuth();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit() {
    setError(null);
    const candidate =
      method === "email" ? { email: identifier, password } : { phone: identifier, password };
    const parsed = authValidation.loginSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details and try again.");
      return;
    }

    setIsSubmitting(true);
    try {
      await login(parsed.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 justify-center bg-paper-white px-6">
      <Text className="mb-8 text-heading font-semibold text-ink">Log in to Convene</Text>

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
          <Text className="text-paper-white">Log in</Text>
        )}
      </Pressable>

      <Link href="/(auth)/signup" className="mt-6 text-center text-iris-blue">
        Don&apos;t have an account? Sign up
      </Link>
    </View>
  );
}
