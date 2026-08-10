import { apiFetch } from "./client";

// Mirrors apps/api's ConversationsController/MessagesController directly
// (conversations.controller.ts, messages.controller.ts) — apps/web's own
// chat-window page is still a P19.2 placeholder (confirmed by reading it
// directly), so there's no BFF-side hydration pattern to mirror here;
// these wrap apps/api's real endpoints as-is.
export interface ConversationCard {
  id: string;
  participant: { user_id: string | null; full_name: string | null };
  last_message: {
    body_preview: string | null;
    sender_id: string | null;
    created_at: string | null;
    type: string | null;
  } | null;
  unread_count: number;
}

export interface MessageCard {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  client_msg_id: string;
  sequence: number;
  type: string;
  body: string | null;
  reply_to_id: string | null;
  created_at: string;
}

export function getConversations(
  accessToken: string,
): Promise<{ conversations: ConversationCard[] }> {
  return apiFetch<{ conversations: ConversationCard[] }>("/conversations", { accessToken });
}

// §10.7.2's gap-free-catch-up case: pass `afterSequence` (the last
// sequence this device has cached) to get exactly what was missed, not
// a fixed-size page that might skip messages sent while the socket was
// dead.
export function getMessageHistory(
  accessToken: string,
  conversationId: string,
  options: { afterSequence?: number; before?: number } = {},
): Promise<{ messages: MessageCard[] }> {
  const query = new URLSearchParams();
  if (options.afterSequence !== undefined)
    query.set("after_sequence", String(options.afterSequence));
  if (options.before !== undefined) query.set("before", String(options.before));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return apiFetch<{ messages: MessageCard[] }>(
    `/conversations/${conversationId}/messages${suffix}`,
    { accessToken },
  );
}

export function sendMessage(
  accessToken: string,
  conversationId: string,
  clientMsgId: string,
  body: string,
): Promise<MessageCard> {
  return apiFetch<MessageCard>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    accessToken,
    body: { conversation_id: conversationId, client_msg_id: clientMsgId, body },
  });
}
