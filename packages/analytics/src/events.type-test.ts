import type { DeniedKeysOf } from "./schema";
import { track } from "./track";

// 0. Directly exercises the deny-list mechanism itself (events.ts's
// `_NoDeniedAnalyticsFieldsReachable` reuses this same `DeniedKeysOf`
// helper against the real registry) — a standalone proof that *any*
// interface declaring a denied field name is caught, independent of
// call-site excess-property checks (cases 3/4 below), which is what
// actually protects against a future payload interface being added to
// EventRegistry with a `body`/`coordinates` field baked in, not just a
// stray extra field at a call site.
interface HypotheticalLeakyPayload {
  ok_field: string;
  coordinates: { lat: number; lng: number };
}
type AssertNever<T extends never> = T;
// @ts-expect-error — coordinates is a denied key; DeniedKeysOf resolves to "coordinates", not never
type _LeakCaught = AssertNever<DeniedKeysOf<HypotheticalLeakyPayload>>;

// PRD §21.2's own testing bar: "Assert an unregistered event fails to
// compile. Assert a payload containing a body or coordinates field
// fails to compile." This file is exercised by `pnpm typecheck` (it's
// plain .ts, included in tsconfig's default `src` glob) — not by
// vitest, since there is nothing to run: a `// @ts-expect-error` line
// that stops being an error is itself a compile error (an "unused
// ts-expect-error directive"), which is what actually enforces these
// two assertions. If the taxonomy ever drifts (an event added without a
// registry entry, or a payload gains a denied field), this file — and
// therefore the whole package's typecheck — goes red.

// 1. An unregistered event name must fail to compile.
// @ts-expect-error — "profile_viewed" was never added to EventRegistry
track("profile_viewed", {});

// 2. A registered event with the wrong payload shape must fail to compile.
// @ts-expect-error — message_sent requires {type, length_bucket, is_first}, not {}
track("message_sent", {});

// 3. A call site tacking a denied field onto an otherwise-valid payload
// must also fail — enforced here by ordinary object-literal excess-
// property checking (message_sent's own registered shape has no `body`
// field), a second, independent line of defence on top of case 0's
// registry-level guarantee.
// @ts-expect-error — `body` isn't part of message_sent's registered payload shape
track("message_sent", { type: "text", length_bucket: "short", is_first: true, body: "hello" });

// 4. Same, for a coordinates-shaped field.
// @ts-expect-error — `latitude`/`longitude` aren't part of location_permission_granted's registered payload shape
track("location_permission_granted", { context: "onboarding", latitude: 12.9, longitude: 77.6 });

// 5. A correctly-shaped, registered event must compile clean (the
// negative control — if this line ever needs a ts-expect-error too,
// something upstream broke).
track("message_sent", { type: "text", length_bucket: "short", is_first: true });
