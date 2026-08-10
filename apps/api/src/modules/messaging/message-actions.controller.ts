import { messaging as messagingValidation } from "@convene/validation";
import type { Message } from "@convene/db";
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { BadRequestAppError, UnauthorizedAppError } from "../../common/errors/app-error";
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

type EditMessageBody = z.infer<typeof messagingValidation.editMessageSchema>;
type ReactToMessageBody = z.infer<typeof messagingValidation.reactToMessageSchema>;
type ForwardMessageBody = z.infer<typeof messagingValidation.forwardMessageSchema>;

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

function toCard(message: Message): MessageCard {
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

// PRD §17.9 endpoints 40 (edit/delete), 41 (reactions), 42 (forward).
@Controller("messages/:id")
export class MessageActionsController {
  constructor(private readonly messagesService: MessagesService) {}

  @Patch()
  @Policy(anyAuthenticatedUser)
  async edit(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(messagingValidation.editMessageSchema)) body: EditMessageBody,
  ): Promise<MessageCard> {
    const { id: userId } = requireAuthContext(request);
    const message = await this.messagesService.editMessage(id, userId, body.body);
    return toCard(message);
  }

  // §10.7.6: "DELETE /messages/:id?scope=me|everyone."
  @Delete()
  @Policy(anyAuthenticatedUser)
  async remove(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Query("scope") scope?: string,
  ): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    if (scope !== "me" && scope !== "everyone") {
      throw new BadRequestAppError("BAD_REQUEST", "scope must be 'me' or 'everyone'");
    }
    await this.messagesService.deleteMessage(id, userId, scope);
  }

  @Post("reactions")
  @Policy(anyAuthenticatedUser)
  async react(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(messagingValidation.reactToMessageSchema)) body: ReactToMessageBody,
  ): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.messagesService.setReaction(id, userId, body.emoji);
  }

  @Delete("reactions")
  @Policy(anyAuthenticatedUser)
  async unreact(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.messagesService.removeReaction(id, userId);
  }

  @Post("forward")
  @Policy(anyAuthenticatedUser)
  async forward(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(messagingValidation.forwardMessageSchema)) body: ForwardMessageBody,
  ): Promise<{ messages: MessageCard[] }> {
    const { id: userId } = requireAuthContext(request);
    const forwarded = await this.messagesService.forwardMessage(id, userId, body.conversation_ids);
    return { messages: forwarded.map(toCard) };
  }
}

// GET /search/messages — a separate controller since the route prefix
// (search/messages, not messages/:id) doesn't share this class's @Controller.
@Controller("search/messages")
export class MessageSearchController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @Policy(anyAuthenticatedUser)
  async search(
    @Req() request: RequestLike,
    @Query("q") q?: string,
    @Query("conversation_id") conversationId?: string,
    @Query("limit") limit?: string,
  ): Promise<{ messages: MessageCard[] }> {
    const { id: userId } = requireAuthContext(request);
    if (!q || q.trim().length === 0) {
      throw new BadRequestAppError("BAD_REQUEST", "q is required");
    }
    const rows = await this.messagesService.searchMessages(
      userId,
      q,
      conversationId ?? null,
      limit ? Number(limit) : undefined,
    );
    return { messages: rows.map(toCard) };
  }
}
