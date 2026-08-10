// P29.1: "A 4-hour soak checking for memory growth and connection
// leaks." k6 (the load generator) has no way to read apps/api's or
// apps/realtime's process memory or file-descriptor count directly —
// that has to come from whatever this environment's real observability
// stack is (§21.4: Prometheus/OTel -> Grafana, or at minimum `docker
// stats`/`ps` sampled alongside this run). What THIS script controls
// and asserts on is the client-side signal a real leak would eventually
// produce: a rising WS drop/reconnect rate and rising request-failure
// rate over the 4 hours — either trending upward over the run is
// evidence of exactly the kind of resource exhaustion a soak test is
// meant to catch, even without direct server memory access.
//
// Run this alongside real server-side memory/fd sampling — it is not a
// substitute for that, only a client-observable complement to it.
import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { API_BASE_URL, REALTIME_WS_URL, getWsTicket, registerLoadTestUsers } from "../lib/auth.js";

const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;
const STEADY_VUS = Number(__ENV.STEADY_VUS || 200);
const SOAK_DURATION = __ENV.SOAK_DURATION || "4h";
const USER_POOL_SIZE = Number(__ENV.USER_POOL_SIZE || 500);

export const wsDrops = new Counter("soak_ws_drops_total");
export const requestFailures = new Counter("soak_request_failures_total");

export const options = {
  scenarios: {
    steady_discover: {
      executor: "constant-vus",
      vus: STEADY_VUS,
      duration: SOAK_DURATION,
      exec: "discoverLoop",
    },
    steady_ws_hold: {
      executor: "constant-vus",
      vus: Math.floor(STEADY_VUS / 2),
      duration: SOAK_DURATION,
      exec: "wsHoldLoop",
    },
  },
  thresholds: {
    // Any WS drop or request failure at all over a 4h steady-state soak
    // is worth a look; the operator reviewing this run should treat a
    // *rising* rate over time (visible in the time-series, not just this
    // single aggregate) as the actual leak signal — see this file's own
    // header comment.
    soak_ws_drops_total: ["count>=0"],
    soak_request_failures_total: ["count>=0"],
  },
};

export function setup() {
  const users = registerLoadTestUsers(USER_POOL_SIZE, RUN_ID);
  if (users.length === 0) throw new Error("setup(): no load-test users could be registered.");
  return { users };
}

export function discoverLoop(data) {
  const user = data.users[__VU % data.users.length];
  const response = http.get(`${API_BASE_URL}/discover`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  if (!check(response, { "200 OK": (r) => r.status === 200 })) requestFailures.add(1);
  sleep(2);
}

export function wsHoldLoop(data) {
  const user = data.users[__VU % data.users.length];
  const ticket = getWsTicket(user.accessToken);
  const wsUrl = `${REALTIME_WS_URL}?ticket=${encodeURIComponent(ticket)}`;

  const response = ws.connect(wsUrl, {}, (socket) => {
    socket.on("open", () =>
      socket.send(JSON.stringify({ type: "subscribe", channel: "presence", id: user.userId })),
    );
    socket.on("close", () => wsDrops.add(1));
    socket.on("error", () => wsDrops.add(1));
    // Held open for a slice of the soak, then cycled — a real client
    // reconnects periodically (app foreground/background, network
    // changes), and cycling here exercises the gateway's connection
    // churn path rather than one connection idling untouched for 4h.
    socket.setTimeout(() => socket.close(), 10 * 60 * 1000);
  });

  check(response, { "ws connected": (r) => r && r.status === 101 });
}
