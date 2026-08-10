# P29.1 — Load and soak testing

k6 scenarios for the NFR-S/NFR-P targets named in `docs/CLAUDE_CODE_PROMPTS.md`'s
P29.1 prompt (PRD §9). **These scripts have not been executed against a real
environment as part of this change** — the sandbox this was written in has no
deployed `apps/api`/`apps/realtime`/Postgres/Redis at any meaningful scale, and
no cloud load-generation capacity, so there is no honest way to produce real
p95/throughput numbers here. Running them, and filling in the results table
below, is the remaining step before this phase's acceptance criterion ("all §9
performance NFRs met or an explicit documented remediation plan exists for
each miss") can actually be signed off.

## Prerequisites

- A deployed `apps/api` + `apps/realtime` + Postgres + Redis environment —
  staging or a dedicated load-test environment, **never production**.
- [k6](https://k6.io/) installed (`brew install k6` / see k6's own install docs).
- `API_BASE_URL` and `REALTIME_WS_URL` pointed at that environment (env vars,
  see each script — both default to `localhost` for a local dev run).
- For `websocket-connections.js` at its real 250,000-connection target: **k6
  Cloud, or several load-generator machines run concurrently** — a single k6
  process on one machine cannot open 250k concurrent sockets (OS ephemeral-
  port/file-descriptor limits land well below that on one source IP). The
  script defaults `MAX_CONNECTIONS` to 50,000 (the PRD's own "50k per gateway
  node" figure) for a single-node-safe run; reaching the full 250k figure is
  an infrastructure decision for whoever runs this, not something the script
  can paper over.
- Server-side memory/file-descriptor monitoring running alongside `soak.js`'s
  4-hour run (Grafana/Prometheus if this environment has it wired up per
  §21.4, otherwise `docker stats`/`ps` sampled on an interval) — k6 has no
  way to read the server process's own memory from outside, so `soak.js`
  only asserts on the client-observable proxy signal (rising WS drop /
  request-failure rate over the run), not memory directly. Real memory-growth
  evidence has to come from that server-side monitoring.
- A user pool with real passwords to log in with. `packages/db/seeds/users.ts`'s
  generated population has no password hash set (it's built for
  browsing/matching fixtures, not login) — every scenario's own `setup()`
  registers a fresh pool of load-test users via the real `POST /auth/register`
  endpoint instead, tagged `k6-loadtest-<runId>-*@example.invalid`. Clean
  these up afterward (or point at a disposable environment) — this repo has
  no automated teardown for them.

## Scenarios

| File                                 | Targets                                                                                             | Run                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `scenarios/discovery-feed.js`        | NFR-P-001 (feed p50<180ms/p95<400ms/p99<800ms), NFR-S-004 (3,000 rps peak)                          | `k6 run -e TARGET_RPS=3000 -e API_BASE_URL=... scenarios/discovery-feed.js`                                      |
| `scenarios/messaging-throughput.js`  | NFR-S-003 (8,000 msg/s sustained), NFR-P-002 (delivery p50<120ms/p95<350ms)                         | `k6 run -e TARGET_MSG_PER_SEC=8000 -e API_BASE_URL=... -e REALTIME_WS_URL=... scenarios/messaging-throughput.js` |
| `scenarios/websocket-connections.js` | NFR-S-002 (250k concurrent, defaults to a 50k single-node-safe run), NFR-P-003 (presence p95<500ms) | `k6 run -e MAX_CONNECTIONS=50000 scenarios/websocket-connections.js` (see Prerequisites for reaching 250k)       |
| `scenarios/soak.js`                  | 4h memory-growth / connection-leak check                                                            | `k6 run -e SOAK_DURATION=4h scenarios/soak.js`                                                                   |

Every script accepts `RUN_ID` to tag its own user pool distinctly across
concurrent/repeated runs against a shared environment.

## Known simplifications (documented, not silent)

- **Message delivery latency** (`messaging-throughput.js`) is measured as a
  single VU's own send-then-receive round trip (it sends as itself and is
  also subscribed to the conversation channel, so it receives its own
  message's fan-out echo) — a faithful measurement of the gateway's fan-out
  path, but not a true two-separate-processes measurement with independent
  clocks. Documented in that file's own header comment.
- **Presence propagation latency** (`websocket-connections.js`) is measured
  as time-to-first-event-after-subscribe, not a true write-to-fanout
  measurement correlated against a separate VU's `POST /availability/sessions`
  call. A more faithful version would pair a "writer" VU with a "listener"
  VU per user and correlate timestamps across them — left as a documented
  follow-up, not built here, to keep the script single-VU-simple.
- **`soak.js`'s user pool** defaults to 500 registered users cycling through
  200+100 steady VUs — real memory-growth signal is far more convincing at
  higher steady concurrency; scale `STEADY_VUS`/`USER_POOL_SIZE` up for a
  real production-readiness soak.

## Results

Not yet run. Fill in after a real execution against a real environment:

| NFR       | Target                              | Measured | Met? | Remediation (if missed) |
| --------- | ----------------------------------- | -------- | ---- | ----------------------- |
| NFR-S-002 | 250,000 concurrent WS               | —        | —    | —                       |
| NFR-S-003 | 8,000 msg/s sustained               | —        | —    | —                       |
| NFR-S-004 | 3,000 feed rps peak                 | —        | —    | —                       |
| NFR-P-001 | Feed p95 < 400ms                    | —        | —    | —                       |
| NFR-P-002 | Delivery p95 < 350ms                | —        | —    | —                       |
| NFR-P-003 | Presence p95 < 500ms                | —        | —    | —                       |
| Soak (4h) | No memory growth / connection leaks | —        | —    | —                       |
