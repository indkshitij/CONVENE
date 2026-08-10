import {
  devices,
  notifications,
  profiles,
  users,
  userSettings,
  type Device,
  type Notification,
} from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export interface NotificationPreferences {
  categories: Record<
    string,
    { push?: boolean | undefined; in_app?: boolean | undefined; email?: boolean | undefined }
  >;
  quiet_hours: { enabled: boolean; start: string; end: string };
}

const DEFAULT_QUIET_HOURS_START = "22:00";
const DEFAULT_QUIET_HOURS_END = "08:00";

@Injectable()
export class NotificationsRepository {
  constructor(private readonly postgres: PostgresService) {}

  async listForUser(userId: string, unreadOnly: boolean, limit: number): Promise<Notification[]> {
    const conditions = [eq(notifications.userId, userId)];
    if (unreadOnly) conditions.push(sql`${notifications.readAt} IS NULL`);
    return this.postgres.db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async countUnread(userId: string): Promise<number> {
    const [row] = await this.postgres.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), sql`${notifications.readAt} IS NULL`));
    return row?.count ?? 0;
  }

  async markRead(userId: string, ids: readonly string[] | null, now: Date): Promise<void> {
    const conditions = [eq(notifications.userId, userId), sql`${notifications.readAt} IS NULL`];
    if (ids) conditions.push(inArray(notifications.id, ids as string[]));
    await this.postgres.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(...conditions));
  }

  // BR-NOTIF-04: collapsible notifications upsert on the partial unique
  // index (user_id, collapse_key) WHERE collapse_key IS NOT NULL AND
  // read_at IS NULL — "a new event updates the existing notification
  // rather than adding one." Postgres itself is what makes "3 rapid
  // notifications collapse into one" true: the second and third calls
  // hit the same conflict target as the first and update in place.
  async upsertCollapsed(input: {
    userId: string;
    category: string;
    collapseKey: string;
    title: string;
    body: string | null;
    data: Record<string, unknown>;
    priority: string;
  }): Promise<Notification> {
    const [row] = await this.postgres.db
      .insert(notifications)
      .values({
        userId: input.userId,
        category: input.category,
        collapseKey: input.collapseKey,
        title: input.title,
        body: input.body,
        data: input.data,
        priority: input.priority,
      })
      .onConflictDoUpdate({
        target: [notifications.userId, notifications.collapseKey],
        targetWhere: sql`${notifications.collapseKey} IS NOT NULL AND ${notifications.readAt} IS NULL`,
        set: { title: input.title, body: input.body, data: input.data, createdAt: sql`now()` },
      })
      .returning();
    if (!row) throw new Error("NotificationsRepository: upsertCollapsed returned no row");
    return row;
  }

  async insert(input: {
    userId: string;
    category: string;
    title: string;
    body: string | null;
    data: Record<string, unknown>;
    priority: string;
  }): Promise<Notification> {
    const [row] = await this.postgres.db.insert(notifications).values(input).returning();
    if (!row) throw new Error("NotificationsRepository: insert returned no row");
    return row;
  }

  // The existing, still-unread collapsed row for this category, if any —
  // read before upsertCollapsed so the dispatch layer can build "3 new
  // matches" from "2 new matches" instead of guessing a count from
  // nothing.
  async findActiveCollapsed(userId: string, collapseKey: string): Promise<Notification | null> {
    const [row] = await this.postgres.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.collapseKey, collapseKey),
          sql`${notifications.readAt} IS NULL`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  // BR-NOTIF-08: "expire from the centre after 60 days."
  async deleteOlderThan(cutoff: Date, limit: number): Promise<number> {
    const rows = await this.postgres.db
      .delete(notifications)
      .where(lt(notifications.createdAt, cutoff))
      .returning({ id: notifications.id });
    void limit; // No batching primitive on a plain DELETE...RETURNING; kept for interface symmetry with other GC sweeps.
    return rows.length;
  }

  async loadPreferences(userId: string): Promise<NotificationPreferences> {
    const [row] = await this.postgres.db
      .select({
        notificationPrefs: userSettings.notificationPrefs,
        quietHoursEnabled: userSettings.quietHoursEnabled,
        quietHoursStart: userSettings.quietHoursStart,
        quietHoursEnd: userSettings.quietHoursEnd,
      })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    return {
      categories:
        (row?.notificationPrefs as NotificationPreferences["categories"] | undefined) ?? {},
      quiet_hours: {
        enabled: row?.quietHoursEnabled ?? false,
        start: row?.quietHoursStart ?? DEFAULT_QUIET_HOURS_START,
        end: row?.quietHoursEnd ?? DEFAULT_QUIET_HOURS_END,
      },
    };
  }

  async savePreferences(userId: string, prefs: NotificationPreferences): Promise<void> {
    await this.postgres.db
      .insert(userSettings)
      .values({
        userId,
        notificationPrefs: prefs.categories,
        quietHoursEnabled: prefs.quiet_hours.enabled,
        quietHoursStart: prefs.quiet_hours.start,
        quietHoursEnd: prefs.quiet_hours.end,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          notificationPrefs: prefs.categories,
          quietHoursEnabled: prefs.quiet_hours.enabled,
          quietHoursStart: prefs.quiet_hours.start,
          quietHoursEnd: prefs.quiet_hours.end,
          updatedAt: new Date(),
        },
      });
  }

  async loadTimezone(userId: string): Promise<string | null> {
    const [row] = await this.postgres.db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return row?.timezone ?? null;
  }

  async registerDevice(
    userId: string,
    platform: string,
    pushToken: string,
    appVersion: string | null,
  ): Promise<Device> {
    const [row] = await this.postgres.db
      .insert(devices)
      .values({ userId, platform, pushToken, appVersion, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: devices.pushToken,
        set: { userId, platform, appVersion, lastSeenAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("NotificationsRepository: registerDevice returned no row");
    return row;
  }

  async findDevice(id: string): Promise<Device | null> {
    const [row] = await this.postgres.db.select().from(devices).where(eq(devices.id, id)).limit(1);
    return row ?? null;
  }

  async deleteDevice(id: string): Promise<void> {
    await this.postgres.db.delete(devices).where(eq(devices.id, id));
  }

  // BR-NOTIF-06: "invalid-token responses from FCM/APNs prune the token
  // immediately." Called by the (stubbed) push sender's error handling.
  async pruneByToken(pushToken: string): Promise<void> {
    await this.postgres.db.delete(devices).where(eq(devices.pushToken, pushToken));
  }

  async listDevicesForUser(userId: string): Promise<Device[]> {
    return this.postgres.db.select().from(devices).where(eq(devices.userId, userId));
  }

  async loadEmail(userId: string): Promise<string | null> {
    const [row] = await this.postgres.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.email ?? null;
  }
}
