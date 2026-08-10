import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import * as requestsApi from "../lib/backend/requests";
import { useAuth } from "../lib/auth/auth-context";

export default function RequestsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [requests, setRequests] = useState<requestsApi.RequestCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const result = await requestsApi.getReceivedRequests(session.accessToken).catch(() => null);
    setRequests(result?.requests ?? []);
  }, [session]);

  useEffect(() => {
    setIsLoading(true);
    void load().finally(() => setIsLoading(false));
  }, [load]);

  async function accept(id: string) {
    if (!session) return;
    setBusyId(id);
    try {
      const result = await requestsApi.acceptRequest(session.accessToken, id);
      setRequests((current) => current.filter((r) => r.id !== id));
      router.push({
        pathname: "/chat/[conversationId]",
        params: { conversationId: result.conversation.id },
      });
    } catch {
      // Left in the list — the honest outcome is "nothing changed," not
      // a silent optimistic removal.
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!session) return;
    setBusyId(id);
    try {
      await requestsApi.rejectRequest(session.accessToken, id);
      setRequests((current) => current.filter((r) => r.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-paper-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (requests.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-paper-white px-6">
        <Text className="text-body text-graphite">No pending requests.</Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-paper-white"
      contentContainerClassName="px-4 py-4"
      data={requests}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View className="mb-3 rounded-cardssmall border border-mist-gray p-4">
          <Text className="text-body-lg font-medium text-ink">
            Member {item.sender_id.slice(0, 8)}
          </Text>
          {item.intent && (
            <Text className="mt-1 text-body-sm text-graphite">{item.intent.type}</Text>
          )}
          {item.note && <Text className="mt-1 text-body-sm text-ink">{item.note}</Text>}
          <View className="mt-3 flex-row gap-2">
            <Pressable
              onPress={() => void accept(item.id)}
              disabled={busyId === item.id}
              className="min-h-11 flex-1 items-center justify-center rounded-buttons bg-charcoal px-4 py-2 disabled:opacity-50"
            >
              <Text className="text-paper-white">Accept</Text>
            </Pressable>
            <Pressable
              onPress={() => void reject(item.id)}
              disabled={busyId === item.id}
              className="min-h-11 flex-1 items-center justify-center rounded-buttons bg-mist-gray px-4 py-2 disabled:opacity-50"
            >
              <Text className="text-ink">Decline</Text>
            </Pressable>
          </View>
        </View>
      )}
    />
  );
}
