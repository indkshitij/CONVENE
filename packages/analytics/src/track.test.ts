import { describe, expect, it, vi } from "vitest";
import type { AnalyticsEnvelope } from "./schema";
import { configureAnalytics, track, type TrackedEvent } from "./track";

function fakeEnvelope(): AnalyticsEnvelope {
  return {
    user_id: "u1",
    session_id: "s1",
    device_id: "d1",
    platform: "web",
    app_version: "1.0.0",
    timestamp: "2026-01-01T00:00:00.000Z",
    request_id: "r1",
    plan: "free",
    city_id: 1,
    tenure_days: 3,
    experiments: {},
  };
}

describe("track", () => {
  it("throws if called before configureAnalytics()", async () => {
    vi.resetModules();
    const fresh = await import("./track");
    expect(() =>
      fresh.track("message_sent", { type: "text", length_bucket: "short", is_first: true }),
    ).toThrow(/configureAnalytics/);
  });

  it("merges the envelope from the configured provider onto every tracked event", () => {
    const sink = vi.fn<AnalyticsSinkFn>();
    const envelope = fakeEnvelope();
    configureAnalytics({ sink, getEnvelope: () => envelope });

    track("message_sent", { type: "text", length_bucket: "short", is_first: true });

    expect(sink).toHaveBeenCalledWith({
      name: "message_sent",
      payload: { type: "text", length_bucket: "short", is_first: true },
      envelope,
    });
  });

  it("calls getEnvelope() fresh on every track() call (envelope fields like tenure_days can change between events)", () => {
    let call = 0;
    const sink = vi.fn<AnalyticsSinkFn>();
    configureAnalytics({
      sink,
      getEnvelope: () => {
        call += 1;
        return { ...fakeEnvelope(), tenure_days: call };
      },
    });

    track("message_sent", { type: "text", length_bucket: "short", is_first: true });
    track("message_sent", { type: "text", length_bucket: "short", is_first: false });

    const events = sink.mock.calls.map(([event]) => event.envelope.tenure_days);
    expect(events).toEqual([1, 2]);
  });
});

type AnalyticsSinkFn = (event: TrackedEvent) => void;
