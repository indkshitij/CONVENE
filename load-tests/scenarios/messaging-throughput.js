// P29.1 / NFR-S-003 ("Messages per second (sustained): 8,000") and
// NFR-P-002 ("Message delivery (send -> recipient socket) p50<120ms ·
// p95<350ms"). Each VU owns one conversation and both sends (REST
// POST /conversations/:id/messages) and listens (WS, subscribed to that
// same conversation channel) as the *same* user — the gateway fans a
// sent message out to every subscriber of the conversation channel,
// including the sender's own connection, so timing "send -> this
// socket's message.sent receipt" measures the same fan-out path a real
// second participant's socket would see. A true two-participant,
// two-process measurement would need out-of-band clock sync between
// separate VUs; this single-VU round-trip is the documented, honest
// substitute.
import ws from "k6/ws";
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";
import { API_BASE_URL, REALTIME_WS_URL, getWsTicket, registerLoadTestUsers } from "../lib/auth.js";
import { createConversationPairs } from "../lib/conversations.js";

const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;
const CONVERSATION_POOL_SIZE = Number(__ENV.CONVERSATION_POOL_SIZE || 100);
const TARGET_MSG_PER_SEC = Number(__ENV.TARGET_MSG_PER_SEC || 8000);

export const messageDeliveryLatency = new Trend("message_delivery_latency_ms", true);

export const options = {
  scenarios: {
    messaging_throughput: {
      executor: "constant-arrival-rate",
      rate: TARGET_MSG_PER_SEC,
      timeUnit: "1s",
      duration: __ENV.DURATION || "5m",
      preAllocatedVUs: CONVERSATION_POOL_SIZE,
      maxVUs: CONVERSATION_POOL_SIZE,
    },
  },
  thresholds: {
    // NFR-P-002, transcribed exactly.
    message_delivery_latency_ms: ["p(50)<120", "p(95)<350"],
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  const users = registerLoadTestUsers(CONVERSATION_POOL_SIZE * 2, RUN_ID);
  const pairs = createConversationPairs(users, CONVERSATION_POOL_SIZE);
  if (pairs.length === 0)
    throw new Error(
      "setup(): no conversations could be created — check API_BASE_URL and the connection-request/accept flow.",
    );
  return { pairs };
}

export default function (data) {
  const pair = data.pairs[__VU % data.pairs.length];
  const clientMsgId = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const ticket = getWsTicket(pair.senderAccessToken);

  const wsUrl = `${REALTIME_WS_URL}?ticket=${encodeURIComponent(ticket)}`;
  const response = ws.connect(wsUrl, {}, (socket) => {
    let sentAt = 0;

    socket.on("open", () => {
      socket.send(
        JSON.stringify({ type: "subscribe", channel: "conversation", id: pair.conversationId }),
      );
      sentAt = Date.now();
      http.post(
        `${API_BASE_URL}/conversations/${pair.conversationId}/messages`,
        JSON.stringify({
          conversation_id: pair.conversationId,
          client_msg_id: clientMsgId,
          body: "Load test message — please ignore.",
        }),
        {
          headers: {
            Authorization: `Bearer ${pair.senderAccessToken}`,
            "Content-Type": "application/json",
          },
        },
      );
    });

    socket.on("message", (raw) => {
      const frame = JSON.parse(raw);
      if (
        frame.type === "event" &&
        frame.event === "message.sent" &&
        frame.payload &&
        frame.payload.client_msg_id === clientMsgId
      ) {
        messageDeliveryLatency.add(Date.now() - sentAt);
        socket.close();
      }
    });

    socket.setTimeout(() => socket.close(), 5000);
  });

  check(response, { "ws connected": (r) => r && r.status === 101 });
}
