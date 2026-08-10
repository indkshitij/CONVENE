import { messaging as messagingValidation } from "@convene/validation";
import type { Message } from "@convene/db";
import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { RateLimit } from "../../common/rate-limit/rate-limit.decorator";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { MessagesService } from "./services/messages.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

type SendMessageBody = z.infer<typeof messagingValidation.sendMessageSchema>;

interface MessageCard {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  client_msg_id: string;
  sequence: number;
  type: Message["type"];
  body: string | null;
  reply_to_id: string | null;
  attachments: unknown;
  created_at: string;
}

interface SendMessageResponse extends MessageCard {
  quality_nudge: boolean;
}

// PRD §17.9 endpoints 38/39: history (after_sequence/before) and send
// (client_msg_id required). Edit/delete/reactions/forward/read/settings/
// search (endpoints 40-45) are P15.2/P15.3.
@Controller("conversations/:conversationId/messages")
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  // PRD §17.9 endpoint 39. anyAuthenticatedUser — the real authorization
  // decision (conversation membership) is I/O-bound and enforced inside
  // MessagesService, same pattern connections/discovery controllers use.
  // §10.7.3: "Rate limits 60/min per conversation, 200/min per user" —
  // both must pass (see RateLimitDecoratorOptions's array form).
  @Post()
  @Policy(anyAuthenticatedUser)
  @RateLimit({ scope: ["messages-per-conversation", "messages-per-user"] })
  async send(
    @Req() request: RequestLike,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(messagingValidation.sendMessageSchema)) body: SendMessageBody,
  ): Promise<SendMessageResponse> {
    const { id: senderId } = requireAuthContext(request);
    const result = await this.messagesService.sendMessage({
      conversationId,
      senderId,
      clientMsgId: body.client_msg_id,
      body: body.body,
      replyToId: body.reply_to_id ?? null,
      attachments: body.attachment_media_ids ?? [],
    });
    return { ...this.toCard(result.message), quality_nudge: result.qualityNudge };
  }

  // PRD §17.9 endpoint 38: "History (after_sequence/before)."
  // `after_sequence` takes priority when both are supplied — it's the
  // gap-free-catch-up-on-reconnect case §10.7.2 names explicitly;
  // `before` is the "scroll up for older history" case.
  @Get()
  @Policy(anyAuthenticatedUser)
  async history(
    @Req() request: RequestLike,
    @Param("conversationId") conversationId: string,
    @Query("after_sequence") afterSequence?: string,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ): Promise<{ messages: MessageCard[] }> {
    const { id: userId } = requireAuthContext(request);
    const parsedLimit = limit ? Number(limit) : undefined;

    const rows =
      afterSequence !== undefined
        ? await this.messagesService.getHistoryAfter(
            conversationId,
            userId,
            Number(afterSequence),
            parsedLimit,
          )
        : await this.messagesService.getHistoryBefore(
            conversationId,
            userId,
            before !== undefined ? Number(before) : null,
            parsedLimit,
          );

    return { messages: rows.map((row) => this.toCard(row)) };
  }

  private toCard(message: Message): MessageCard {
    return {
      id: message.id,
      conversation_id: message.conversationId,
      sender_id: message.senderId,
      client_msg_id: message.clientMsgId,
      sequence: message.sequence,
      type: message.type,
      body: message.body,
      reply_to_id: message.replyToId,
      attachments: message.attachments,
      created_at: message.createdAt.toISOString(),
    };
  }
}
