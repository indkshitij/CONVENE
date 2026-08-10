import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import * as messagesApi from "../../lib/backend/messages";
import { useAuth } from "../../lib/auth/auth-context";
import { hapticMessageSent } from "../../lib/native/haptics";
import { requestNotificationPermissionAtPointOfValue } from "../../lib/native/notifications";
import type { RealtimeEventEnvelope } from "../../lib/realtime/socket";
import { RealtimeSocket } from "../../lib/realtime/socket";
import {
  cacheMessages,
  enqueueOutboxMessage,
  getCachedMessages,
  getPendingOutboxMessages,
  markOutboxMessageSent,
  type CachedMessage,
} from "../../lib/storage/db";
import { randomUuid } from "../../lib/util/uuid";

// P27.2 (§18.8): "graceful socket death: fall back to push and
// reconcile on foreground via after_sequence." The socket (live
// updates while foregrounded) and the AppState-driven `reconcile()`
// REST call (runs on every foreground transition, socket state
// irrelevant) are deliberately two independent paths to the same
// data — reconcile() alone is what makes a force-quit-then-reopen gap-
// free even if the socket hasn't reconnected yet by the time the
// screen mounts.
export default function ChatWindowScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { session } = useAuth();
  const [messages, setMessages] = useState<CachedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const socketRef = useRef<RealtimeSocket | null>(null);
  const appState = useRef(AppState.currentState);

  const lastSequence = useCallback(
    () => messages.reduce((max, m) => Math.max(max, m.sequence), 0),
    [messages],
  );

  const applyIncoming = useCallback((incoming: messagesApi.MessageCard[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const byId = new Map(current.map((m) => [m.id, m]));
      for (const message of incoming)
        byId.set(message.id, { ...message, sender_id: message.sender_id } as CachedMessage);
      return Array.from(byId.values()).sort((a, b) => a.sequence - b.sequence);
    });
    void cacheMessages(
      incoming.map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        sender_id: m.sender_id,
        body: m.body,
        type: m.type,
        sequence: m.sequence,
        created_at: m.created_at,
      })),
    );
  }, []);

  const reconcile = useCallback(async () => {
    if (!session || !conversationId) return;

    // Drain the outbox first — a message queued while offline should
    // land before the history fetch below, so it shows up in the same
    // reconcile pass rather than waiting for the next one.
    const pending = await getPendingOutboxMessages();
    for (const entry of pending.filter((e) => e.conversation_id === conversationId)) {
      try {
        const sent = await messagesApi.sendMessage(
          session.accessToken,
          conversationId,
          entry.client_msg_id,
          entry.body,
        );
        applyIncoming([sent]);
        await markOutboxMessageSent(entry.client_msg_id);
      } catch {
        // Left pending — retried on the next reconcile.
      }
    }

    const after = lastSequence();
    const result = await messagesApi
      .getMessageHistory(
        session.accessToken,
        conversationId,
        after > 0 ? { afterSequence: after } : {},
      )
      .catch(() => null);
    if (result) applyIncoming(result.messages);
  }, [session, conversationId, lastSequence, applyIncoming]);

  // Initial load: cached first (instant), then reconcile against the server.
  useEffect(() => {
    if (!conversationId) return;
    void getCachedMessages(conversationId).then((cached) => {
      if (cached.length > 0) setMessages(cached);
    });
  }, [conversationId]);

  // Deliberately keyed on conversationId/session identity only, not on
  // `reconcile` itself (which is recreated whenever `messages` changes) —
  // this should run once per conversation/session, not on every message.
  useEffect(() => {
    void reconcile();
  }, [conversationId, session]);

  // Live updates while foregrounded; AppState reconcile covers the rest.
  useEffect(() => {
    if (!session || !conversationId) return;
    const socket = new RealtimeSocket({
      accessToken: session.accessToken,
      onEvent: (envelope: RealtimeEventEnvelope) => {
        if (
          envelope.channel === "conversation" &&
          envelope.id === conversationId &&
          envelope.event === "message.sent"
        ) {
          applyIncoming([envelope.payload as messagesApi.MessageCard]);
        }
      },
      onResyncRequired: () => void reconcile(),
    });
    socketRef.current = socket;
    void socket.connect().then(() => socket.subscribe("conversation", conversationId));

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") void reconcile();
      appState.current = nextState;
    });

    return () => {
      socket.unsubscribe("conversation", conversationId);
      socket.close();
      appStateSubscription.remove();
    };
    // Deliberately keyed on session/conversationId identity only, not on
    // `reconcile` (recreated whenever `messages` changes) — the socket
    // should connect/subscribe once per conversation/session, not
    // reconnect on every message.
  }, [session, conversationId]);

  async function send() {
    if (!session || !conversationId || !draft.trim()) return;
    const body = draft.trim();
    const clientMsgId = randomUuid();
    setDraft("");

    void requestNotificationPermissionAtPointOfValue();

    try {
      const sent = await messagesApi.sendMessage(
        session.accessToken,
        conversationId,
        clientMsgId,
        body,
      );
      applyIncoming([sent]);
      hapticMessageSent();
    } catch {
      // §18.8's outbox exists for exactly this — queue for retry once
      // connectivity returns rather than silently dropping the message.
      await enqueueOutboxMessage({
        client_msg_id: clientMsgId,
        conversation_id: conversationId,
        body,
        created_at: new Date().toISOString(),
        status: "pending",
      });
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-paper-white"
    >
      <FlatList
        className="flex-1"
        contentContainerClassName="px-4 py-4"
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View
            className={`mb-2 max-w-[80%] rounded-cardssmall px-4 py-2 ${item.sender_id === session?.user.id ? "self-end bg-lavender-wash" : "self-start bg-mist-gray"}`}
          >
            <Text className="text-body-sm text-ink">{item.body}</Text>
          </View>
        )}
      />
      <View className="flex-row items-center gap-2 border-t border-mist-gray px-4 py-3">
        <TextInput
          accessibilityLabel="Message"
          placeholder="Message"
          value={draft}
          onChangeText={setDraft}
          className="min-h-11 flex-1 rounded-inputs border border-mist-gray px-4 py-2 text-ink"
        />
        <Pressable
          onPress={() => void send()}
          disabled={!draft.trim()}
          className="min-h-11 items-center justify-center rounded-buttons bg-charcoal px-4 py-2 disabled:opacity-50"
        >
          <Text className="text-paper-white">Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
