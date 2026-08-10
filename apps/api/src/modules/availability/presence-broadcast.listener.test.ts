import { describe, expect, it, vi } from "vitest";
import { PresenceBroadcastListener } from "./presence-broadcast.listener";
import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import type { PostgresService } from "../../infra/postgres/postgres.service";

function fakePostgres(geohash5: string | null): PostgresService {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (geohash5 === null ? [] : [{ geohash5 }]),
          }),
        }),
      }),
    },
  } as unknown as PostgresService;
}

function fakePublisher() {
  return { publish: vi.fn(async () => 1) } as unknown as RealtimePublisherService;
}

// Forbidden keys anywhere in a broadcast payload — coordinates or a
// distance figure would defeat the entire point of a "coarse" channel
// scoped by a 5-char geohash cell (~2.4km).
const FORBIDDEN_KEYS = [
  "lat",
  "lng",
  "latitude",
  "longitude",
  "coordinates",
  "distance",
  "distanceKm",
  "distance_km",
];

function assertNoLeak(payload: unknown): void {
  const json = JSON.stringify(payload).toLowerCase();
  for (const key of FORBIDDEN_KEYS) {
    expect(json).not.toContain(key.toLowerCase());
  }
}

describe("PresenceBroadcastListener", () => {
  it("broadcasts availability.started to rt:presence:{geohash5} with no coordinates or distance", async () => {
    const publisher = fakePublisher();
    const listener = new PresenceBroadcastListener(fakePostgres("u4pruy"), publisher);

    await listener.handleAvailabilityChanged({
      userId: "user-1",
      state: "available_now",
      expiresAt: new Date(),
    });

    expect(publisher.publish).toHaveBeenCalledWith("rt:presence:u4pruy", "availability.started", {
      userId: "user-1",
      state: "available_now",
    });
    const payload = (publisher.publish as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    assertNoLeak(payload);
  });

  it("broadcasts availability.ended when the state is offline", async () => {
    const publisher = fakePublisher();
    const listener = new PresenceBroadcastListener(fakePostgres("u4pruy"), publisher);

    await listener.handleAvailabilityChanged({
      userId: "user-1",
      state: "offline",
      expiresAt: null,
    });

    expect(publisher.publish).toHaveBeenCalledWith("rt:presence:u4pruy", "availability.ended", {
      userId: "user-1",
      state: "offline",
    });
  });

  it("does not broadcast for busy/away/invisible — only started/ended are named for this channel", async () => {
    const publisher = fakePublisher();
    const listener = new PresenceBroadcastListener(fakePostgres("u4pruy"), publisher);

    await listener.handleAvailabilityChanged({
      userId: "user-1",
      state: "away",
      expiresAt: new Date(),
    });

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("skips broadcasting when the user has no geohash5 on file", async () => {
    const publisher = fakePublisher();
    const listener = new PresenceBroadcastListener(fakePostgres(null), publisher);

    await listener.handleAvailabilityChanged({
      userId: "user-1",
      state: "available_now",
      expiresAt: new Date(),
    });

    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
