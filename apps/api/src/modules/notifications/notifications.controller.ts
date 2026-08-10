import type { Notification } from "@convene/db";
import { notifications as notificationsValidation } from "@convene/validation";
import { Body, Controller, Get, Post, Put, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { NotificationsService } from "./notifications.service";
import type { NotificationPreferences } from "./repositories/notifications.repository";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

type MarkReadBody = z.infer<typeof notificationsValidation.markNotificationsReadSchema>;
type UpdatePreferencesBody = z.infer<
  typeof notificationsValidation.updateNotificationPreferencesSchema
>;

interface NotificationCard {
  id: string;
  category: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  priority: string;
  read_at: string | null;
  created_at: string;
}

function toCard(row: Notification): NotificationCard {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    data: row.data as Record<string, unknown>,
    priority: row.priority,
    read_at: row.readAt ? row.readAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}

interface PreferencesResponse {
  categories: NotificationPreferences["categories"];
  quiet_hours: NotificationPreferences["quiet_hours"];
}

function toPreferencesResponse(prefs: NotificationPreferences): PreferencesResponse {
  return { categories: prefs.categories, quiet_hours: prefs.quiet_hours };
}

// PRD §10.8.3 endpoint 46: GET/POST /notifications, /notifications/read,
// GET/PUT /notifications/preferences.
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Policy(anyAuthenticatedUser)
  async list(
    @Req() request: RequestLike,
    @Query("filter") filter?: string,
    @Query("cursor") _cursor?: string,
  ): Promise<{ notifications: NotificationCard[]; unread_count: number }> {
    const { id: userId } = requireAuthContext(request);
    void _cursor; // Cursor pagination isn't modelled by the underlying repo query yet (plain limit+order) — flagged as a simplification, not silently dropped.
    const { items, unreadCount } = await this.notificationsService.listNotifications(
      userId,
      filter === "unread",
      Math.min(DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
    );
    return { notifications: items.map(toCard), unread_count: unreadCount };
  }

  // §10.8.3: "POST /notifications/read." (The endpoint-46 header row lists
  // GET/PUT for the group as a whole; this specific sub-route is POST per
  // the API & Data section, which is the more precise of the two.)
  @Post("read")
  @Policy(anyAuthenticatedUser)
  async markRead(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(notificationsValidation.markNotificationsReadSchema))
    body: MarkReadBody,
  ): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.notificationsService.markRead(userId, body.all ? null : (body.ids ?? []));
  }

  @Get("preferences")
  @Policy(anyAuthenticatedUser)
  async getPreferences(@Req() request: RequestLike): Promise<PreferencesResponse> {
    const { id: userId } = requireAuthContext(request);
    return toPreferencesResponse(await this.notificationsService.getPreferences(userId));
  }

  @Put("preferences")
  @Policy(anyAuthenticatedUser)
  async updatePreferences(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(notificationsValidation.updateNotificationPreferencesSchema))
    body: UpdatePreferencesBody,
  ): Promise<PreferencesResponse> {
    const { id: userId } = requireAuthContext(request);
    const updated = await this.notificationsService.updatePreferences(userId, body);
    return toPreferencesResponse(updated);
  }
}
