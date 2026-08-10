import { messaging as messagingValidation } from "@convene/validation";
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import type {
  ConversationFilter,
  ConversationListRow,
} from "./repositories/conversations.repository";
import { ConversationsService } from "./services/conversations.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

const VALID_FILTERS: readonly ConversationFilter[] = ["all", "unread", "pinned", "archived"];
function isConversationFilter(value: string | undefined): value is ConversationFilter {
  return value !== undefined && (VALID_FILTERS as readonly string[]).includes(value);
}

type MarkReadBody = z.infer<typeof messagingValidation.markReadSchema>;
type UpdateConversationSettingsBody = z.infer<
  typeof messagingValidation.updateConversationSettingsSchema
>;

interface ConversationCard {
  id: string;
  participant: { user_id: string | null; full_name: string | null };
  last_message: {
    body_preview: string | null;
    sender_id: string | null;
    created_at: string | null;
    type: string | null;
  } | null;
  unread_count: number;
  is_pinned: boolean;
  is_muted_until: string | null;
  is_archived: boolean;
  connection: { intent: string | null };
}

function toCard(row: ConversationListRow): ConversationCard {
  return {
    id: row.conversationId,
    participant: { user_id: row.otherUserId, full_name: row.otherFullName },
    last_message: row.lastMessageCreatedAt
      ? {
          body_preview: row.lastMessageBody,
          sender_id: row.lastMessageSenderId,
          created_at: row.lastMessageCreatedAt.toISOString(),
          type: row.lastMessageType,
        }
      : null,
    unread_count: row.unreadCount,
    is_pinned: row.isPinned,
    is_muted_until: row.mutedUntil?.toISOString() ?? null,
    is_archived: row.isArchived,
    connection: { intent: row.intentType },
  };
}

// PRD §17.9 endpoints 37 (list), 43 (read), 44 (settings).
@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @Policy(anyAuthenticatedUser)
  async list(
    @Req() request: RequestLike,
    @Query("filter") filter?: string,
    @Query("limit") limit?: string,
  ): Promise<{ conversations: ConversationCard[] }> {
    const { id: userId } = requireAuthContext(request);
    const rows = await this.conversationsService.listConversations(
      userId,
      isConversationFilter(filter) ? filter : "all",
      limit ? Number(limit) : undefined,
    );
    return { conversations: rows.map(toCard) };
  }

  // §10.7.6: "POST /conversations/:id/read { up_to_sequence }."
  @Post(":id/read")
  @Policy(anyAuthenticatedUser)
  async markRead(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(messagingValidation.markReadSchema)) body: MarkReadBody,
  ): Promise<{ unread_count: number; last_read_seq: number }> {
    const { id: userId } = requireAuthContext(request);
    const result = await this.conversationsService.markRead(id, userId, body.up_to_sequence);
    return { unread_count: result.unreadCount, last_read_seq: result.lastReadSeq };
  }

  // §10.7.6: "PATCH /conversations/:id { is_pinned, muted_until, is_archived }."
  @Patch(":id")
  @Policy(anyAuthenticatedUser)
  async updateSettings(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(messagingValidation.updateConversationSettingsSchema))
    body: UpdateConversationSettingsBody,
  ): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.conversationsService.updateSettings(id, userId, {
      ...(body.is_pinned !== undefined ? { isPinned: body.is_pinned } : {}),
      ...(body.muted_until !== undefined
        ? { mutedUntil: body.muted_until ? new Date(body.muted_until) : null }
        : {}),
      ...(body.is_archived !== undefined ? { isArchived: body.is_archived } : {}),
    });
  }
}
