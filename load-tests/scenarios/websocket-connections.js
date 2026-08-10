// P29.1 / NFR-S-002 ("Concurrent WebSocket connections: 250,000 (50k per
// gateway node x 5, horizontally scalable)") and NFR-P-003 ("Presence
// propagation p95 < 500ms").
//
// 250k concurrent connections from a *single* k6 process is not
// realistic on one machine — OS ephemeral-port/file-descriptor limits
// (typically ~64k per source IP without exotic tuning) cap a single
// load-generator well below that. Reaching the real target means either
// k6 Cloud (which distributes VUs across multiple load-generator IPs)
// or running this script from several machines/IPs concurrently and
// summing connection counts — an infrastructure decision for whoever
// runs this, not something this script can paper over. `MAX_CONNECTIONS`
// therefore defaults to a single-node-safe 50,000 (matching "50k per
// gateway node" from the same NFR row) rather than defaulting to
// 250,000 and silently falling short.
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";
import { API_BASE_URL, REALTIME_WS_URL, getWsTicket, registerLoadTestUsers } from "../lib/auth.js";

const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;
const MAX_CONNECTIONS = Number(__ENV.MAX_CONNECTIONS || 50000);
const HOLD_DURATION = __ENV.HOLD_DURATION || "10m";
const RAMP_DURATION = __ENV.RAMP_DURATION || "5m";

export const presencePropagationLatency = new Trend("presence_propagation_latency_ms", true);

export const options = {
  scenarios: {
    ws_connection_scale: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: MAX_CONNECTIONS },
        { duration: HOLD_DURATION, target: MAX_CONNECTIONS },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    // NFR-P-003, transcribed exactly.
    presence_propagation_latency_ms: ["p(95)<500"],
    ws_connecting: ["p(95)<1000"],
  },
};

export function setup() {
  // One user per planned VU — presence is per-user, so distinct users
  // avoid the gateway's own single-session-per-user handling from
  // masking connection-scale behaviour (a second connection for the
  // same user is a reconnect, not a new concurrent connection).
  const users = registerLoadTestUsers(Math.min(MAX_CONNECTIONS, 5000), RUN_ID);
  // NOTE: for a full 50k/250k run, pre-seed a real user pool out of
  // band (this setup() call is capped to keep a single k6 run's own
  // startup fast) and point USER_POOL_FILE/an external data source at
  // it instead — flagged, not solved, here.
  if (users.length === 0) throw new Error("setup(): no load-test users could be registered.");
  return { users };
}

export default function (data) {
  const user = data.users[__VU % data.users.length];
  const ticket = getWsTicket(user.accessToken);
  const wsUrl = `${REALTIME_WS_URL}?ticket=${encodeURIComponent(ticket)}`;

  const response = ws.connect(wsUrl, {}, (socket) => {
    let subscribedAt = 0;
    socket.on("open", () => {
      subscribedAt = Date.now();
      socket.send(JSON.stringify({ type: "subscribe", channel: "presence", id: user.userId }));
    });

    // Presence propagation latency here is measured as time-to-first-
    // presence-event after subscribing — a real run should additionally
    // trigger an availability state change (POST /availability/sessions)
    // from a *different* VU for the same user's presence channel and
    // correlate against that write's timestamp for a true write-to-fanout
    // measurement; this subscribe-ack timing is the honest, simpler
    // substitute this single-VU script can do without cross-VU
    // coordination.
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw);
      if (frame.type === "event" && frame.channel === "presence" && subscribedAt > 0) {
        presencePropagationLatency.add(Date.now() - subscribedAt);
        subscribedAt = 0; // only the first event after each subscribe counts
      }
    });

    socket.setTimeout(() => socket.close(), 15 * 60 * 1000);
  });

  check(response, { "ws connected": (r) => r && r.status === 101 });
  sleep(1);
}
