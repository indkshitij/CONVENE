import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import * as messagesApi from "../../lib/backend/messages";
import { useAuth } from "../../lib/auth/auth-context";

export default function ChatsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [conversations, setConversations] = useState<messagesApi.ConversationCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) return;
    messagesApi
      .getConversations(session.accessToken)
      .then((result) => setConversations(result.conversations))
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, [session]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-paper-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (conversations.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-paper-white px-6">
        <Text className="text-body text-graphite">No conversations yet.</Text>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-paper-white"
      data={conversations}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Pressable
          onPress={() =>
            router.push({ pathname: "/chat/[conversationId]", params: { conversationId: item.id } })
          }
          className="min-h-11 border-b border-mist-gray px-4 py-3"
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-body-lg font-medium text-ink">
              {item.participant.full_name ?? "Member"}
            </Text>
            {item.unread_count > 0 && (
              <View className="rounded-tags bg-iris-blue px-2 py-0.5">
                <Text className="text-caption text-paper-white">{item.unread_count}</Text>
              </View>
            )}
          </View>
          {item.last_message?.body_preview && (
            <Text className="mt-1 text-body-sm text-graphite">
              {item.last_message.body_preview}
            </Text>
          )}
        </Pressable>
      )}
    />
  );
}
