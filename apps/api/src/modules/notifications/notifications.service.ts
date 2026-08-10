import type { Notification } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import { NotFoundAppError, ValidationAppError } from "../../common/errors/app-error";
import { notificationPushDailyKey, notificationPushHourlyKey } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import {
  isNotificationCategory,
  NOTIFICATION_CATALOGUE,
  type NotificationCatalogueEntry,
  type NotificationChannel,
} from "./notification-catalogue";
import { EmailService } from "./email.service";
import {
  NotificationsRepository,
  type NotificationPreferences,
} from "./repositories/notifications.repository";
import { PushSender } from "./services/push-sender";

export interface NotifyInput {
  userId: string;
  category: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
  /** Overrides the catalogue-default collapse scope (e.g. per-conversation for new_message) — see notification-catalogue.ts's own note on why new_message itself isn't marked collapsible generically. */
  collapseKey?: string;
}

const DAILY_PUSH_CAP = 6; // BR-NOTIF-02.
const HOURLY_PUSH_CAP = 2;
const DAILY_KEY_TTL_SECONDS = 26 * 60 * 60; // A little past 24h, so a slow day-boundary clock skew can't leave the counter expiring early.
const HOURLY_KEY_TTL_SECONDS = 65 * 60;

// PRD §10.8: the full catalogue-aware dispatch — forced-on enforcement,
// per-category-per-channel preferences, quiet hours, collapse (BR-NOTIF-04),
// frequency caps (BR-NOTIF-02), and a digest-email fallback when push
// fails for a high-priority category. Always writes the in-app row
// first (BR-NOTIF-08: "regardless of channel delivery success") — every
// other channel is best-effort layered on top of that guaranteed write.
@Injectable()
export class NotificationsService {
  constructor(
    private readonly repo: NotificationsRepository,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly pushSender: PushSender = new PushSender(),
    @Optional() private readonly emailService?: EmailService,
  ) {}

  // Kept for backward compatibility with earlier phases' call sites
  // (ConnectionsService, ModerationDeepScanService) — delegates into the
  // full catalogue-aware path rather than the old unconditional insert.
  async notify(input: NotifyInput): Promise<void> {
    await this.dispatch(input);
  }

  async listNotifications(
    userId: string,
    unreadOnly: boolean,
    limit: number,
  ): Promise<{ items: Notification[]; unreadCount: number }> {
    const [items, unreadCount] = await Promise.all([
      this.repo.listForUser(userId, unreadOnly, limit),
      this.repo.countUnread(userId),
    ]);
    return { items, unreadCount };
  }

  async markRead(userId: string, ids: readonly string[] | null): Promise<void> {
    await this.repo.markRead(userId, ids, new Date());
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    return this.repo.loadPreferences(userId);
  }

  // BR-NOTIF-01 / §10.8.4 Gherkin "Forced categories": a preference write
  // that tries to disable any channel of a forced-on category (moderation_
  // action, security_alert, plan_billing) is rejected outright at the
  // endpoint, not silently ignored the way dispatch()'s own resolveChannels
  // ignores it at delivery time — the Gherkin scenario requires a 422, not
  // a no-op success.
  async updatePreferences(
    userId: string,
    patch: {
      categories?: NotificationPreferences["categories"] | undefined;
      quiet_hours?: NotificationPreferences["quiet_hours"] | undefined;
    },
  ): Promise<NotificationPreferences> {
    if (patch.categories) {
      for (const [category, channels] of Object.entries(patch.categories)) {
        const entry = isNotificationCategory(category)
          ? NOTIFICATION_CATALOGUE[category]
          : undefined;
        if (!entry?.forcedOn) continue;
        const disablesAny = Object.values(channels).some((enabled) => enabled === false);
        if (disablesAny) {
          throw new ValidationAppError(
            "CATEGORY_NOT_CONFIGURABLE",
            `"${category}" notifications cannot be disabled.`,
            { field: `categories.${category}` },
          );
        }
      }
    }

    const current = await this.repo.loadPreferences(userId);
    const merged: NotificationPreferences = {
      categories: { ...current.categories, ...(patch.categories ?? {}) },
      quiet_hours: patch.quiet_hours ?? current.quiet_hours,
    };
    await this.repo.savePreferences(userId, merged);
    return merged;
  }

  async registerDevice(
    userId: string,
    platform: string,
    pushToken: string,
    appVersion: string | null,
  ) {
    return this.repo.registerDevice(userId, platform, pushToken, appVersion);
  }

  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.repo.findDevice(deviceId);
    if (!device || device.userId !== userId) {
      // 404 not 403 (§17.7's own convention, reused here): a caller can't
      // learn whether another user's device id even exists.
      throw new NotFoundAppError("DEVICE_NOT_FOUND", "That device isn't registered to you.");
    }
    await this.repo.deleteDevice(deviceId);
  }

  async dispatch(input: NotifyInput): Promise<Notification> {
    const entry = isNotificationCategory(input.category)
      ? NOTIFICATION_CATALOGUE[input.category]
      : undefined;
    if (!entry) {
      // An uncatalogued category still gets written (robustness), just
      // without any of the catalogue-aware behaviour below.
      return this.repo.insert({
        userId: input.userId,
        category: input.category,
        title: input.title,
        body: input.body ?? null,
        data: input.data ?? {},
        priority: "medium",
      });
    }

    const prefs = await this.repo.loadPreferences(input.userId);
    const allowedChannels = resolveChannels(entry, prefs);

    const row = await this.writeInAppRow(input, entry);

    if (!allowedChannels.has("push")) return row;

    if (entry.priority !== "critical") {
      if (await this.isQuietHours(input.userId, prefs)) return row; // BR-NOTIF-03: batched into the next morning's digest (not built — see class comment).
      if (this.redis && !(await this.checkFrequencyCap(input.userId))) return row; // BR-NOTIF-02.
    }

    await this.sendPush(input.userId, row, entry, allowedChannels);
    return row;
  }

  private async writeInAppRow(
    input: NotifyInput,
    entry: NotificationCatalogueEntry,
  ): Promise<Notification> {
    if (!entry.collapsible) {
      return this.repo.insert({
        userId: input.userId,
        category: entry.category,
        title: input.title,
        body: input.body ?? null,
        data: input.data ?? {},
        priority: entry.priority,
      });
    }

    // BR-NOTIF-04: one collapse key per (user, category) by default, or a
    // caller-supplied narrower scope (e.g. per-conversation).
    const collapseKey = input.collapseKey ?? entry.category;
    const existing = await this.repo.findActiveCollapsed(input.userId, collapseKey);
    const priorCount = existing
      ? Number((existing.data as Record<string, unknown>).collapsed_count) || 1
      : 0;
    const count = priorCount + 1;
    const title = count > 1 ? collapsedTitle(entry.category, count, input.title) : input.title;

    return this.repo.upsertCollapsed({
      userId: input.userId,
      category: entry.category,
      collapseKey,
      title,
      body: input.body ?? null,
      data: { ...(input.data ?? {}), collapsed_count: count },
      priority: entry.priority,
    });
  }

  private async isQuietHours(userId: string, prefs: NotificationPreferences): Promise<boolean> {
    if (!prefs.quiet_hours.enabled) return false;
    const timezone = (await this.repo.loadTimezone(userId)) ?? "UTC";
    const nowLocal = currentLocalTime(timezone);
    return isWithinWindow(nowLocal, prefs.quiet_hours.start, prefs.quiet_hours.end);
  }

  private async checkFrequencyCap(userId: string): Promise<boolean> {
    if (!this.redis) return true;
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const hourKey = now.toISOString().slice(0, 13);
    const dailyKey = notificationPushDailyKey(userId, dateKey);
    const hourlyKey = notificationPushHourlyKey(userId, hourKey);

    const dayCount = await this.redis.client.incr(dailyKey);
    if (dayCount === 1) await this.redis.client.expire(dailyKey, DAILY_KEY_TTL_SECONDS);
    const hourCount = await this.redis.client.incr(hourlyKey);
    if (hourCount === 1) await this.redis.client.expire(hourlyKey, HOURLY_KEY_TTL_SECONDS);

    if (dayCount > DAILY_PUSH_CAP || hourCount > HOURLY_PUSH_CAP) {
      await this.redis.client.decr(dailyKey);
      await this.redis.client.decr(hourlyKey);
      return false;
    }
    return true;
  }

  private async sendPush(
    userId: string,
    row: Notification,
    entry: NotificationCatalogueEntry,
    allowedChannels: Set<NotificationChannel>,
  ): Promise<void> {
    const devices = await this.repo.listDevicesForUser(userId);
    let sent = false;
    for (const device of devices) {
      const result = await this.pushSender.send({
        pushToken: device.pushToken,
        title: row.title,
        body: row.body,
        data: row.data as Record<string, unknown>,
      });
      if (result === "invalid_token") await this.repo.pruneByToken(device.pushToken); // BR-NOTIF-06.
      if (result === "sent") sent = true;
    }

    const isHighPriority = entry.priority === "high" || entry.priority === "critical";
    if (!sent && devices.length > 0 && isHighPriority && allowedChannels.has("email")) {
      // §21.9: "digest email fallback for high-priority categories when push fails."
      const email = await this.repo.loadEmail(userId);
      if (email) await this.emailService?.sendNotificationFallbackEmail(email, row.title, row.body);
    }
  }
}

function resolveChannels(
  entry: NotificationCatalogueEntry,
  prefs: NotificationPreferences,
): Set<NotificationChannel> {
  if (entry.forcedOn) return new Set(entry.channels); // BR-NOTIF-01.
  const override = prefs.categories[entry.category];
  const allowed = new Set<NotificationChannel>();
  for (const channel of entry.channels) {
    const enabled = override?.[channel] ?? entry.defaultOn;
    if (enabled) allowed.add(channel);
  }
  return allowed;
}

// No exact collapsed copy is given per-category in §10.8.1 beyond two
// illustrative examples ("3 strong matches", "5 views today") — this
// generalises those into one template per category rather than
// inventing prose for the other collapsible categories, flagged as an
// interpretation, not a transcription.
function collapsedTitle(category: string, count: number, latestTitle: string): string {
  switch (category) {
    case "new_match_high":
      return `${count} strong matches`;
    case "profile_view":
      return `${count} views today`;
    case "connection_request":
      return `${count} new connection requests`;
    case "saved_search_alert":
      return `${count} new saved-search matches`;
    case "intent_expiring":
      return `${count} intents expiring soon`;
    default:
      return latestTitle;
  }
}

function currentLocalTime(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  }
}

// BR-NOTIF-03's default window (22:00-08:00) wraps midnight — "within"
// means >= start OR < end when start > end, and the ordinary >= start
// AND < end range otherwise.
function isWithinWindow(currentHHmm: string, startHHmm: string, endHHmm: string): boolean {
  if (startHHmm === endHHmm) return false;
  const current = toMinutes(currentHHmm);
  const start = toMinutes(startHHmm);
  const end = toMinutes(endHHmm);
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
