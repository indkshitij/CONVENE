// Message-delivery/messaging-throughput scenarios need real
// conversations to send into. packages/db/seeds/users.ts's generated
// population has no usable password (it's for browsing/matching
// fixtures, not login), so this walks the real endpoint sequence
// instead: sender creates an intent -> sender sends a connection
// request naming that intent -> recipient accepts it (BR-CONN-08: this
// also creates the conversation, atomically, with the request note as
// the first message).
import http from "k6/http";
import { check } from "k6";
import { API_BASE_URL } from "./auth.js";

function authHeaders(accessToken) {
  return {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  };
}

// Creates `count` conversations, one per (sender, recipient) pair drawn
// sequentially from `users` (so `users` should have at least 2*count
// entries). Returns [{ conversationId, senderAccessToken, recipientAccessToken }].
export function createConversationPairs(users, count) {
  const pairs = [];
  for (let i = 0; i < count && i * 2 + 1 < users.length; i++) {
    const sender = users[i * 2];
    const recipient = users[i * 2 + 1];

    const intentResponse = http.post(
      `${API_BASE_URL}/intents`,
      JSON.stringify({ type: "coffee_chat", expires_in_days: 30 }),
      authHeaders(sender.accessToken),
    );
    if (!check(intentResponse, { "intent created": (r) => r.status === 200 || r.status === 201 }))
      continue;
    const intentId = JSON.parse(intentResponse.body).intent.id;

    const requestResponse = http.post(
      `${API_BASE_URL}/connections/requests`,
      JSON.stringify({
        recipient_id: recipient.userId,
        intent_id: intentId,
        note: "Load test setup — please ignore.",
      }),
      authHeaders(sender.accessToken),
    );
    if (!check(requestResponse, { "request sent": (r) => r.status === 200 || r.status === 201 }))
      continue;
    const requestId = JSON.parse(requestResponse.body).id;

    const acceptResponse = http.post(
      `${API_BASE_URL}/connections/requests/${requestId}/accept`,
      null,
      authHeaders(recipient.accessToken),
    );
    if (!check(acceptResponse, { "request accepted": (r) => r.status === 200 })) continue;
    const conversationId = JSON.parse(acceptResponse.body).conversation.id;

    pairs.push({
      conversationId,
      senderAccessToken: sender.accessToken,
      recipientAccessToken: recipient.accessToken,
    });
  }
  return pairs;
}
