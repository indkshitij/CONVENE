import type { Notification } from "@convene/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisService } from "../../infra/redis/redis.service";
import { NOTIFICATION_CATALOGUE } from "./notification-catalogue";
import { NotificationsService } from "./notifications.service";
import type {
  NotificationPreferences,
  NotificationsRepository,
} from "./repositories/notifications.repository";
import type { PushSender } from "./services/push-sender";
import type { EmailService } from "./email.service";

function fakePrefs(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    categories: {},
    quiet_hours: { enabled: false, start: "22:00", end: "08:00" },
    ...overrides,
  };
}

function fakeRow(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-1",
    userId: "user-1",
    category: "new_match_high",
    title: "New match",
    body: null,
    data: {},
    collapseKey: null,
    priority: "high",
    readAt: null,
    createdAt: new Date(),
    ...overrides,
  } as Notification;
}

function fakeRepo(
  overrides: Partial<Record<keyof NotificationsRepository, unknown>> = {},
): NotificationsRepository {
  return {
    listForUser: vi.fn(async () => []),
    countUnread: vi.fn(async () => 0),
    markRead: vi.fn(async () => undefined),
    upsertCollapsed: vi.fn(async () => fakeRow()),
    insert: vi.fn(async () => fakeRow()),
    findActiveCollapsed: vi.fn(async () => null),
    deleteOlderThan: vi.fn(async () => 0),
    loadPreferences: vi.fn(async () => fakePrefs()),
    savePreferences: vi.fn(async () => undefined),
    loadTimezone: vi.fn(async () => "UTC"),
    registerDevice: vi.fn(async () => ({ id: "device-1" })),
    findDevice: vi.fn(async () => null),
    deleteDevice: vi.fn(async () => undefined),
    pruneByToken: vi.fn(async () => undefined),
    listDevicesForUser: vi.fn(async () => []),
    loadEmail: vi.fn(async () => "user@example.com"),
    ...overrides,
  } as unknown as NotificationsRepository;
}

function fakeRedis(): RedisService {
  const counters = new Map<string, number>();
  const client = {
    incr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    decr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) - 1;
      counters.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
  return { client } as unknown as RedisService;
}

function fakePushSender(result: "sent" | "invalid_token" | "failed" = "sent"): PushSender {
  return { send: vi.fn(async () => result) } as unknown as PushSender;
}

function fakeEmailService(): EmailService {
  return { sendNotificationFallbackEmail: vi.fn(async () => undefined) } as unknown as EmailService;
}

describe("NotificationsService.dispatch", () => {
  let repo: NotificationsRepository;

  beforeEach(() => {
    repo = fakeRepo();
  });

  // §10.8.4 Gherkin: "3 rapid notifications collapse into one."
  it("collapses three rapid notifications into a single row with an incrementing count", async () => {
    let stored: Notification | null = null;
    repo = fakeRepo({
      findActiveCollapsed: vi.fn(async () => stored),
      upsertCollapsed: vi.fn(async (input: { title: string; data: Record<string, unknown> }) => {
        stored = fakeRow({ title: input.title, data: input.data, category: "new_match_high" });
        return stored;
      }),
    });
    const service = new NotificationsService(repo, undefined, fakePushSender(), fakeEmailService());

    await service.dispatch({ userId: "user-1", category: "new_match_high", title: "New match 1" });
    await service.dispatch({ userId: "user-1", category: "new_match_high", title: "New match 2" });
    const third = await service.dispatch({
      userId: "user-1",
      category: "new_match_high",
      title: "New match 3",
    });

    expect((third.data as Record<string, unknown>).collapsed_count).toBe(3);
    expect(third.title).toBe("3 strong matches");
    expect(repo.upsertCollapsed).toHaveBeenCalledTimes(3);
  });

  // §10.8.4 Gherkin: "Forced categories" — 422 CATEGORY_NOT_CONFIGURABLE.
  it("rejects a preference write that disables a forced-on category", async () => {
    const service = new NotificationsService(repo);
    await expect(
      service.updatePreferences("user-1", { categories: { security_alert: { push: false } } }),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_CONFIGURABLE" });
    expect(repo.savePreferences).not.toHaveBeenCalled();
  });

  it("allows a non-forced category preference write", async () => {
    const service = new NotificationsService(repo);
    const result = await service.updatePreferences("user-1", {
      categories: { profile_view: { push: false } },
    });
    expect(result.categories.profile_view).toEqual({ push: false });
    expect(repo.savePreferences).toHaveBeenCalledOnce();
  });

  // §10.8.4 Gherkin: "quiet hours defer, not drop" — the in-app row is
  // still written, only the push send is skipped.
  it("defers push during quiet hours but still writes the in-app row", async () => {
    repo = fakeRepo({
      loadPreferences: vi.fn(async () =>
        fakePrefs({ quiet_hours: { enabled: true, start: "22:00", end: "08:00" } }),
      ),
    });
    const pushSender = fakePushSender();
    const service = new NotificationsService(repo, undefined, pushSender, fakeEmailService());

    // 23:00 UTC falls inside the wraparound 22:00-08:00 window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T23:00:00.000Z"));
    try {
      const row = await service.dispatch({
        userId: "user-1",
        category: "availability_expiring",
        title: "Expiring soon",
      });
      expect(row).toBeDefined();
      expect(repo.insert).toHaveBeenCalledOnce();
      expect(pushSender.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends push outside quiet hours", async () => {
    repo = fakeRepo({
      loadPreferences: vi.fn(async () =>
        fakePrefs({ quiet_hours: { enabled: true, start: "22:00", end: "08:00" } }),
      ),
      listDevicesForUser: vi.fn(async () => [
        { id: "d1", userId: "user-1", pushToken: "tok", platform: "ios" },
      ]),
    });
    const pushSender = fakePushSender();
    const service = new NotificationsService(repo, undefined, pushSender, fakeEmailService());

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    try {
      await service.dispatch({
        userId: "user-1",
        category: "availability_expiring",
        title: "Expiring soon",
      });
      expect(pushSender.send).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  // BR-NOTIF-02: max 6/day, max 2/hour, excluding critical priority.
  it("enforces the hourly push frequency cap for non-critical categories", async () => {
    repo = fakeRepo({
      listDevicesForUser: vi.fn(async () => [
        { id: "d1", userId: "user-1", pushToken: "tok", platform: "ios" },
      ]),
    });
    const redis = fakeRedis();
    const pushSender = fakePushSender();
    const service = new NotificationsService(repo, redis, pushSender, fakeEmailService());

    await service.dispatch({ userId: "user-1", category: "availability_expiring", title: "1" });
    await service.dispatch({ userId: "user-1", category: "availability_expiring", title: "2" });
    await service.dispatch({ userId: "user-1", category: "availability_expiring", title: "3" });

    expect(pushSender.send).toHaveBeenCalledTimes(2);
  });

  it("never caps critical-priority push (new_message)", async () => {
    repo = fakeRepo({
      listDevicesForUser: vi.fn(async () => [
        { id: "d1", userId: "user-1", pushToken: "tok", platform: "ios" },
      ]),
    });
    const redis = fakeRedis();
    const pushSender = fakePushSender();
    const service = new NotificationsService(repo, redis, pushSender, fakeEmailService());

    for (let i = 0; i < 5; i += 1) {
      await service.dispatch({ userId: "user-1", category: "new_message", title: `msg ${i}` });
    }

    expect(pushSender.send).toHaveBeenCalledTimes(5);
  });

  it("prunes an invalid push token and falls back to email for high-priority categories", async () => {
    repo = fakeRepo({
      listDevicesForUser: vi.fn(async () => [
        { id: "d1", userId: "user-1", pushToken: "bad-tok", platform: "ios" },
      ]),
    });
    const pushSender = fakePushSender("invalid_token");
    const emailService = fakeEmailService();
    const service = new NotificationsService(repo, undefined, pushSender, emailService);

    await service.dispatch({ userId: "user-1", category: "request_accepted", title: "Accepted!" });

    expect(repo.pruneByToken).toHaveBeenCalledWith("bad-tok");
    expect(emailService.sendNotificationFallbackEmail).toHaveBeenCalledOnce();
  });

  it("writes a plain row for an uncatalogued category without catalogue-aware behaviour", async () => {
    const service = new NotificationsService(repo);
    const row = await service.dispatch({
      userId: "user-1",
      category: "not_a_real_category",
      title: "x",
    });
    expect(row).toBeDefined();
    expect(repo.insert).toHaveBeenCalledOnce();
    expect(repo.loadPreferences).not.toHaveBeenCalled();
  });

  it("every catalogue category has the required metadata fields", () => {
    for (const entry of Object.values(NOTIFICATION_CATALOGUE)) {
      expect(entry.category).toBeTruthy();
      expect(entry.trigger).toBeTruthy();
      expect(entry.channels.length).toBeGreaterThan(0);
      expect(typeof entry.defaultOn).toBe("boolean");
      expect(typeof entry.collapsible).toBe("boolean");
      expect(["low", "medium", "high", "critical"]).toContain(entry.priority);
      expect(typeof entry.forcedOn).toBe("boolean");
    }
  });

  it("marks moderation_action, security_alert and plan_billing as forced-on (BR-NOTIF-01)", () => {
    expect(NOTIFICATION_CATALOGUE.moderation_action.forcedOn).toBe(true);
    expect(NOTIFICATION_CATALOGUE.security_alert.forcedOn).toBe(true);
    expect(NOTIFICATION_CATALOGUE.plan_billing.forcedOn).toBe(true);
  });
});
