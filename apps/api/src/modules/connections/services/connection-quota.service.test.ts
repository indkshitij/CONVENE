import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEvalSlidingWindow = vi.fn();
vi.mock("../../../common/rate-limit/sliding-window", () => ({
  evalSlidingWindow: (...args: unknown[]) => mockEvalSlidingWindow(...args),
}));

import { ConnectionQuotaService } from "./connection-quota.service";
import type { RedisService } from "../../../infra/redis/redis.service";

interface FakeStore {
  counters: Map<string, number>;
  lists: Map<string, string[]>;
  strings: Map<string, string>;
}

function fakeRedisService(): { redis: RedisService; store: FakeStore } {
  const store: FakeStore = { counters: new Map(), lists: new Map(), strings: new Map() };
  const client = {
    incr: vi.fn(async (key: string) => {
      const next = (store.counters.get(key) ?? 0) + 1;
      store.counters.set(key, next);
      return next;
    }),
    decr: vi.fn(async (key: string) => {
      const next = (store.counters.get(key) ?? 0) - 1;
      store.counters.set(key, next);
      return next;
    }),
    pexpire: vi.fn(async () => 1),
    get: vi.fn(async (key: string) => store.strings.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.strings.set(key, value);
      return "OK";
    }),
    lrange: vi.fn(async (key: string, start: number, stop: number) => {
      const list = store.lists.get(key) ?? [];
      return list.slice(start, stop === -1 ? undefined : stop + 1);
    }),
    lpush: vi.fn(async (key: string, value: string) => {
      const list = store.lists.get(key) ?? [];
      list.unshift(value);
      store.lists.set(key, list);
      return list.length;
    }),
    ltrim: vi.fn(async () => "OK"),
    expire: vi.fn(async () => 1),
  };
  return { redis: { client } as unknown as RedisService, store };
}

describe("ConnectionQuotaService", () => {
  let redis: RedisService;
  let store: FakeStore;
  let service: ConnectionQuotaService;

  beforeEach(() => {
    ({ redis, store } = fakeRedisService());
    service = new ConnectionQuotaService(redis);
    mockEvalSlidingWindow.mockReset();
  });

  describe("checkDailyQuota — §10.6.7 matrix row 1 (8/30/120)", () => {
    it.each([
      ["free", 8],
      ["premium", 30],
      ["pro", 120],
    ] as const)(
      "allows up to the %s plan's limit of %d and denies the next",
      async (plan, limit) => {
        const now = new Date("2026-08-08T10:00:00Z");
        for (let i = 1; i <= limit; i++) {
          const result = await service.checkDailyQuota("user-1", plan, "UTC", now);
          expect(result.allowed).toBe(true);
          expect(result.used).toBe(i);
          expect(result.limit).toBe(limit);
        }

        const denied = await service.checkDailyQuota("user-1", plan, "UTC", now);
        expect(denied.allowed).toBe(false);
        expect(denied.used).toBe(limit);
      },
    );

    it("rolls back the counter on denial so a later successful request still sees the correct count", async () => {
      const now = new Date("2026-08-08T10:00:00Z");
      for (let i = 0; i < 8; i++) await service.checkDailyQuota("user-1", "free", "UTC", now);
      await service.checkDailyQuota("user-1", "free", "UTC", now);
      // The rollback keeps the stored counter at 8, not 9 — a client that
      // retries after the deny still sees "used: 8", never a rising count
      // from failed attempts.
      const counterValues = [...store.counters.values()];
      expect(counterValues).toEqual([8]);
    });
  });

  describe("checkVelocity — §10.6.7 matrix row 2 (5/5/8 per 60s)", () => {
    it.each([
      ["free", "connection-requests-velocity", 5],
      ["premium", "connection-requests-velocity", 5],
      ["pro", "connection-requests-velocity-pro", 8],
    ] as const)(
      "uses the %s plan's scope and limit",
      async (plan, expectedScope, expectedLimit) => {
        mockEvalSlidingWindow.mockResolvedValue({ allowed: true, count: 1 });
        await service.checkVelocity("user-1", plan, new Date());

        expect(mockEvalSlidingWindow).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining(expectedScope),
          expect.any(Number),
          60_000,
          expectedLimit,
          expect.any(String),
        );
      },
    );

    it("returns false when the sliding window denies", async () => {
      mockEvalSlidingWindow.mockResolvedValue({ allowed: false, count: 6 });
      const allowed = await service.checkVelocity("user-1", "free", new Date());
      expect(allowed).toBe(false);
    });
  });

  describe("soft-block", () => {
    it("is not soft-blocked by default, and is after applySoftBlock", async () => {
      expect(await service.isSoftBlocked("user-1")).toBe(false);
      await service.applySoftBlock("user-1");
      expect(await service.isSoftBlocked("user-1")).toBe(true);
    });
  });

  describe("recordNoteAndCheckDuplicate — BR-CONN-06 identical-note detection", () => {
    it("does not flag distinct notes", async () => {
      const now = new Date("2026-08-08T10:00:00Z");
      expect(
        await service.recordNoteAndCheckDuplicate(
          "user-1",
          "Hi, saw your work on payments ML.",
          now,
        ),
      ).toBe(false);
      expect(
        await service.recordNoteAndCheckDuplicate(
          "user-1",
          "Would love to chat about hiring for our team.",
          now,
        ),
      ).toBe(false);
      expect(
        await service.recordNoteAndCheckDuplicate(
          "user-1",
          "Interested in your cofounder search, let's connect.",
          now,
        ),
      ).toBe(false);
    });

    it("flags the 4th near-identical note within 24h and applies a soft-block", async () => {
      const now = new Date("2026-08-08T10:00:00Z");
      const note = "Saw you lead NLP at Xenon, would value 20 minutes of your time.";
      expect(await service.recordNoteAndCheckDuplicate("user-1", note, now)).toBe(false);
      expect(await service.recordNoteAndCheckDuplicate("user-1", note, now)).toBe(false);
      expect(await service.recordNoteAndCheckDuplicate("user-1", note, now)).toBe(false);
      expect(await service.recordNoteAndCheckDuplicate("user-1", note, now)).toBe(true);
      expect(await service.isSoftBlocked("user-1")).toBe(true);
    });

    it("ignores notes outside the 24h window", async () => {
      const start = new Date("2026-08-08T10:00:00Z");
      const note = "Saw you lead NLP at Xenon, would value 20 minutes of your time.";
      await service.recordNoteAndCheckDuplicate("user-1", note, start);
      await service.recordNoteAndCheckDuplicate("user-1", note, start);
      await service.recordNoteAndCheckDuplicate("user-1", note, start);

      const later = new Date(start.getTime() + 25 * 60 * 60 * 1000);
      expect(await service.recordNoteAndCheckDuplicate("user-1", note, later)).toBe(false);
    });

    it("treats an empty/null note as never spam", async () => {
      const now = new Date();
      expect(await service.recordNoteAndCheckDuplicate("user-1", null, now)).toBe(false);
      expect(await service.recordNoteAndCheckDuplicate("user-1", "   ", now)).toBe(false);
    });
  });
});
