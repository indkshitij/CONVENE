import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";
import * as discoverApi from "../../lib/backend/discover";
import { useAuth } from "../../lib/auth/auth-context";

const EMPTY_STATE_COPY: Record<discoverApi.DiscoveryEmptyStateReason, string> = {
  no_supply: "No one's around right now — check back soon.",
  all_filtered: "Nothing matches your current filters.",
  all_seen: "You've seen everyone for now — check back later.",
  profile_incomplete: "Finish setting up your profile to see matches.",
};

export default function DiscoverScreen() {
  const { session } = useAuth();
  const [result, setResult] = useState<discoverApi.DiscoveryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isError, setIsError] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setIsError(false);
    try {
      const data = await discoverApi.getDiscoveryFeed(session.accessToken);
      setResult(data);
    } catch {
      setIsError(true);
    }
  }, [session]);

  useEffect(() => {
    setIsLoading(true);
    void load().finally(() => setIsLoading(false));
  }, [load]);

  async function onRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-paper-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-paper-white px-6">
        <Text className="text-body text-danger-text">Couldn&apos;t load matches.</Text>
      </View>
    );
  }

  if (result?.empty_state) {
    return (
      <View className="flex-1 items-center justify-center bg-paper-white px-6">
        <Text className="text-body text-graphite">{EMPTY_STATE_COPY[result.empty_state]}</Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-paper-white"
      contentContainerClassName="px-4 py-4"
      data={result?.data ?? []}
      keyExtractor={(item) => item.candidate_id}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={() => void onRefresh()} />
      }
      renderItem={({ item }) => (
        <View className="mb-3 rounded-cardssmall border border-mist-gray p-4">
          <Text className="text-body-lg font-medium text-ink">
            Member {item.candidate_id.slice(0, 8)}
          </Text>
          {item.reasons.slice(0, 2).map((reason) => (
            <Text key={reason} className="mt-1 text-body-sm text-graphite">
              {reason}
            </Text>
          ))}
        </View>
      )}
    />
  );
}
