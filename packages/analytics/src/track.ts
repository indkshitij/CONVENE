import type { EventRegistry } from "./events";
import type { AnalyticsEnvelope } from "./schema";

// PRD §21.4: "PostHog (self-host) + ClickHouse." No PostHog SDK
// dependency lives in this package (web/mobile each already own their
// own analytics-client wiring, and packages must not reach into an
// app — module boundary) — `configureAnalytics()` is the seam a host
// app plugs its real sink into; the default sink is a no-op so this
// package is safe to import (and its tests safe to run) with nothing
// configured.
export interface TrackedEvent<K extends keyof EventRegistry = keyof EventRegistry> {
  name: K;
  payload: EventRegistry[K];
  envelope: AnalyticsEnvelope;
}

export type AnalyticsSink = (event: TrackedEvent) => void;
export type EnvelopeProvider = () => AnalyticsEnvelope;

let sink: AnalyticsSink = () => undefined;
let envelopeProvider: EnvelopeProvider | null = null;

export function configureAnalytics(options: {
  sink: AnalyticsSink;
  getEnvelope: EnvelopeProvider;
}): void {
  sink = options.sink;
  envelopeProvider = options.getEnvelope;
}

// PRD §21.2: "a tracking call that does not match a registered schema
// fails the type check." `K extends keyof EventRegistry` rejects an
// unregistered event name outright; `EventRegistry[K]` pins the exact
// payload shape for whichever name was passed, so a shape mismatch
// (missing field, wrong type, extra field the registry doesn't declare)
// is a compile error at the call site — never a runtime `track()`
// validation this file would have to perform itself.
export function track<K extends keyof EventRegistry>(name: K, payload: EventRegistry[K]): void {
  if (!envelopeProvider) {
    throw new Error(
      "configureAnalytics() must be called before track() — no envelope provider is registered.",
    );
  }
  sink({ name, payload, envelope: envelopeProvider() });
}
