// P29.1 / NFR-P-001 + NFR-S-004: "Discovery feed API latency p95 < 400ms"
// and "Feed requests per second (peak): 3,000." GET /discover under
// sustained peak RPS, asserting the p95 threshold directly via a k6
// threshold (a failed threshold fails the whole run's exit code, so CI
// can gate on it once this is wired into a pipeline).
import http from "k6/http";
import { check, sleep } from "k6";
import { API_BASE_URL, registerLoadTestUsers } from "../lib/auth.js";

const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;
const TARGET_RPS = Number(__ENV.TARGET_RPS || 3000);
const POOL_SIZE = Number(__ENV.USER_POOL_SIZE || 200); // requests are spread across a small pool of real, distinct users — not one shared token, since GET /discover's ranking is per-caller

export const options = {
  scenarios: {
    discovery_feed_peak: {
      executor: "constant-arrival-rate",
      rate: TARGET_RPS,
      timeUnit: "1s",
      duration: __ENV.DURATION || "5m",
      preAllocatedVUs: Math.min(TARGET_RPS, 500),
      maxVUs: Math.min(TARGET_RPS * 2, 2000),
    },
  },
  thresholds: {
    // NFR-P-001's three bands, transcribed exactly.
    http_req_duration: ["p(50)<180", "p(95)<400", "p(99)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

let users;
export function setup() {
  users = registerLoadTestUsers(POOL_SIZE, RUN_ID);
  if (users.length === 0)
    throw new Error("setup(): no load-test users could be registered — is API_BASE_URL reachable?");
  return { users };
}

export default function (data) {
  const user = data.users[Math.floor(Math.random() * data.users.length)];
  const response = http.get(`${API_BASE_URL}/discover`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  });
  check(response, { "200 OK": (r) => r.status === 200 });
  sleep(0); // constant-arrival-rate executor paces iterations itself
}
