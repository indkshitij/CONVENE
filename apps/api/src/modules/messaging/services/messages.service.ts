import { Injectable, Optional } from "@nestjs/common";
import { isConversationParticipant } from "../../../common/auth/policies/is-conversation-participant.policy";
import {
  ConflictAppError,
  ForbiddenAppError,
  GoneAppError,
  NotFoundAppError,
  TooManyRequestsAppError,
} from "../../../common/errors/app-error";
import { conversationChannel } from "../../../infra/redis/channels";
import { RealtimePublisherService } from "../../realtime/realtime-publisher.service";
import { MessagesRepository, type SendMessageInput } from "../repositories/messages.repository";
import { extractFirstUrl, LinkUnfurlService } from "./link-unfurl.service";
import { ModerationFastPathService } from "./moderation-fast-path.service";
import { PushNotificationProducer } from "./push-notification.producer";
import type { Message } from "@convene/db";

const MAX_FORWARD_TARGETS = 3;

export interface SendMessageParams {
  conversationId: string;
  senderId: string;
  clientMsgId: string;
  body: string;
  replyToId: string | null;
  attachments: unknown[];
}

export interface SendMessageResult {
  message: Message;
  // BR-MSG-13: "a soft nudge, never a block" — the send always succeeds;
  // the client decides whether/how to show the nudge.
  qualityNudge: boolean;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

// BR-MSG-04: at most 3 consecutive messages from the same sender before
// any reply — the 4th is 429 AWAITING_REPLY.
const MONOLOGUE_LIMIT = 3;

// BR-MSG-13: "a first message under 10 characters, or matching a
// low-effort pattern ('hi', 'hello', 'hey')."
const LOW_EFFORT_BODY_MIN_LENGTH = 10;
const LOW_EFFORT_PATTERN = /^(hi|hello|hey|yo|sup)[!.? ]*$/i;

// P15.1 built the send path's four guarantees (§10.7.2) and gap-free
// catch-up (endpoints 38/39). P15.2 layers BR-MSG-01…14's business rules
// onto that same send path: the monologue limit, the first-message
// quality nudge, and the per-conversation/per-user rate limits (wired at
// the controller via @RateLimit — see messages.controller.ts). The
// synchronous "fast-path" classifier BR-MSG-05 also names (banned-
// pattern regex, link blocklist) is deliberately NOT implemented here:
// the PRD gives no actual word list or blocklist domains, and Trust &
// Safety (Phase 18) is where that data and its real toxicity/spam
// classifier live — shipping a fabricated word list here would be worse
// than flagging the gap. Message length (the other half of BR-MSG-05's
// fast path) is already enforced by messageBodySchema (≤4000 chars).
@Injectable()
export class MessagesService {
  constructor(
    private readonly repo: MessagesRepository,
    private readonly realtimePublisher: RealtimePublisherService,
    @Optional() private readonly linkUnfurl: LinkUnfurlService = new LinkUnfurlService(),
    @Optional()
    private readonly moderationFastPath: ModerationFastPathService = new ModerationFastPathService(),
    @Optional() private readonly pushProducer?: PushNotificationProducer,
  ) {}

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    await this.assertActiveParticipant(params.conversationId, params.senderId);
    await this.assertNotAwaitingReply(params.conversationId, params.senderId);
    // BR-MSG-05's synchronous fast path — see moderation-fast-path.service.ts
    // for what it does and doesn't check today. Purely synchronous/no I/O,
    // which is what keeps this under the 200ms budget by construction.
    this.moderationFastPath.assertAllowed(params.body);

    const input: SendMessageInput = {
      conversationId: params.conversationId,
      senderId: params.senderId,
      clientMsgId: params.clientMsgId,
      body: params.body,
      replyToId: params.replyToId,
      attachments: params.attachments,
    };
    const result = await this.repo.sendMessage(input);

    // Idempotent replay: the message was already committed and already
    // published on the original send — publishing it a second time would
    // be a spurious duplicate event on every subscribed client, which is
    // exactly what idempotency is supposed to prevent one layer up.
    if (!result.isReplay) {
      await this.realtimePublisher.publish(
        conversationChannel(params.conversationId),
        "message.sent",
        this.toWirePayload(result.message),
      );
      // Fire-and-forget: §10.7.3's link preview is best-effort and must
      // never add latency to the send path's ack. Errors (including
      // every SSRF-guard rejection) are swallowed inside unfurlAndAttach
      // itself — a send never fails because a preview couldn't be built.
      void this.unfurlAndAttach(result.message);
      void this.schedulePush(result.message, params.conversationId);
    }

    return {
      message: result.message,
      qualityNudge: !result.isReplay && isLowEffortFirstMessage(result.message),
    };
  }

  // BR-MSG-06: one delayed push job per recipient (never the sender).
  // Best-effort — a scheduling failure must never fail the send itself.
  private async schedulePush(message: Message, conversationId: string): Promise<void> {
    if (!this.pushProducer) return;
    try {
      const participantIds = await this.repo.loadParticipantIds(conversationId);
      const recipients = participantIds.filter((id) => id !== message.senderId);
      await Promise.all(
        recipients.map((recipientUserId) =>
          this.pushProducer?.enqueuePush({
            messageId: message.id,
            recipientUserId,
            conversationId,
          }),
        ),
      );
    } catch {
      // Best-effort.
    }
  }

  private async unfurlAndAttach(message: Message): Promise<void> {
    const url = message.body ? extractFirstUrl(message.body) : null;
    if (!url) return;
    try {
      const preview = await this.linkUnfurl.unfurl(url);
      if (preview) await this.repo.attachLinkPreview(message.id, preview);
    } catch {
      // Best-effort — never surfaces to the sender.
    }
  }

  private async assertNotAwaitingReply(conversationId: string, senderId: string): Promise<void> {
    const streak = await this.repo.trailingConsecutiveSenderCount(
      conversationId,
      senderId,
      MONOLOGUE_LIMIT,
    );
    if (streak >= MONOLOGUE_LIMIT) {
      throw new TooManyRequestsAppError(
        "AWAITING_REPLY",
        "Wait for a reply before sending another message.",
      );
    }
  }

  async getHistoryAfter(
    conversationId: string,
    userId: string,
    afterSequence: number,
    limit?: number,
  ): Promise<Message[]> {
    await this.assertParticipant(conversationId, userId);
    return this.repo.listAfterSequence(conversationId, afterSequence, clampLimit(limit));
  }

  async getHistoryBefore(
    conversationId: string,
    userId: string,
    beforeSequence: number | null,
    limit?: number,
  ): Promise<Message[]> {
    await this.assertParticipant(conversationId, userId);
    return this.repo.listBeforeSequence(conversationId, beforeSequence, clampLimit(limit));
  }

  private async assertParticipant(conversationId: string, userId: string): Promise<void> {
    const conversation = await this.repo.findConversationById(conversationId);
    if (!conversation)
      throw new NotFoundAppError("CONVERSATION_NOT_FOUND", "This conversation could not be found.");
    const participantIds = await this.repo.loadParticipantIds(conversationId);
    if (!isConversationParticipant(participantIds, userId)) {
      // §17.9: "404, not 403" for resources the caller shouldn't even
      // learn exist — same "identical copy either way" rule §10 error
      // tables use elsewhere (e.g. blocked-profile lookups).
      throw new NotFoundAppError("CONVERSATION_NOT_FOUND", "This conversation could not be found.");
    }
  }

  private async assertActiveParticipant(conversationId: string, userId: string): Promise<void> {
    const conversation = await this.repo.findConversationById(conversationId);
    if (!conversation)
      throw new NotFoundAppError("CONVERSATION_NOT_FOUND", "This conversation could not be found.");
    const participantIds = await this.repo.loadParticipantIds(conversationId);
    if (!isConversationParticipant(participantIds, userId)) {
      throw new NotFoundAppError("CONVERSATION_NOT_FOUND", "This conversation could not be found.");
    }
    if (conversation.state !== "active") {
      throw new ForbiddenAppError(
        "CONVERSATION_FROZEN",
        "This conversation is no longer accepting new messages.",
      );
    }
  }

  // §10.7.3 "Edit": own text messages only, within 15 min, max 3 edits.
  async editMessage(messageId: string, userId: string, newBody: string): Promise<Message> {
    const existing = await this.repo.findMessageById(messageId);
    if (!existing) throw new NotFoundAppError("NOT_FOUND", "This message could not be found.");
    if (existing.senderId !== userId)
      throw new ForbiddenAppError("FORBIDDEN", "You don't have permission to do that.");
    if (existing.deletedAt)
      throw new GoneAppError("MESSAGE_DELETED", "This message has been deleted.");

    const updated = await this.repo.editMessage(messageId, userId, newBody, new Date());
    if (!updated)
      throw new ConflictAppError("EDIT_WINDOW_EXPIRED", "This message can no longer be edited.");

    await this.realtimePublisher.publish(
      conversationChannel(existing.conversationId),
      "message.updated",
      this.toWirePayload(updated),
    );
    return updated;
  }

  // §10.7.3 "Delete for me" (message_hides, any participant, any time)
  // vs "Delete for everyone" (own messages, within 1h, tombstoned).
  async deleteMessage(messageId: string, userId: string, scope: "me" | "everyone"): Promise<void> {
    const existing = await this.repo.findMessageById(messageId);
    if (!existing) throw new NotFoundAppError("NOT_FOUND", "This message could not be found.");
    await this.assertParticipant(existing.conversationId, userId);

    if (scope === "me") {
      await this.repo.hideForUser(messageId, userId);
      return;
    }

    if (existing.senderId !== userId)
      throw new ForbiddenAppError("FORBIDDEN", "You don't have permission to do that.");
    const deleted = await this.repo.deleteForEveryone(messageId, userId, new Date());
    if (!deleted)
      throw new ConflictAppError("CONFLICT", "This message can no longer be deleted for everyone.");

    await this.realtimePublisher.publish(
      conversationChannel(existing.conversationId),
      "message.deleted",
      { message_id: messageId, scope: "everyone" },
    );
  }

  async setReaction(messageId: string, userId: string, emoji: string): Promise<void> {
    const existing = await this.repo.findMessageById(messageId);
    if (!existing) throw new NotFoundAppError("NOT_FOUND", "This message could not be found.");
    await this.assertParticipant(existing.conversationId, userId);

    await this.repo.setReaction(messageId, existing.createdAt, userId, emoji);
    await this.realtimePublisher.publish(
      conversationChannel(existing.conversationId),
      "reaction.updated",
      { message_id: messageId, emoji, user_id: userId, action: "set" },
    );
  }

  async removeReaction(messageId: string, userId: string): Promise<void> {
    const existing = await this.repo.findMessageById(messageId);
    if (!existing) throw new NotFoundAppError("NOT_FOUND", "This message could not be found.");
    await this.assertParticipant(existing.conversationId, userId);

    await this.repo.removeReaction(messageId, userId);
    await this.realtimePublisher.publish(
      conversationChannel(existing.conversationId),
      "reaction.updated",
      { message_id: messageId, user_id: userId, action: "remove" },
    );
  }

  // §10.7.3 "Forward": ≤3 conversations at once (enforced by
  // forwardConversationIdsSchema at the controller), each copy
  // attributed to the forwarder — edge case 14: the original sender's
  // identity is never carried into the forwarded copy at all (no field
  // for it), which trivially satisfies "included only if both parties
  // are connected to them" by never asserting it either way.
  async forwardMessage(
    messageId: string,
    forwarderId: string,
    targetConversationIds: readonly string[],
  ): Promise<Message[]> {
    if (targetConversationIds.length > MAX_FORWARD_TARGETS) {
      throw new ConflictAppError(
        "CONFLICT",
        `You can forward to up to ${MAX_FORWARD_TARGETS} conversations at once`,
      );
    }
    const original = await this.repo.findMessageById(messageId);
    if (!original) throw new NotFoundAppError("NOT_FOUND", "This message could not be found.");
    await this.assertParticipant(original.conversationId, forwarderId);

    const forwarded: Message[] = [];
    for (const targetConversationId of targetConversationIds) {
      await this.assertActiveParticipant(targetConversationId, forwarderId);
      const copy = await this.repo.forwardMessage(
        original.body,
        forwarderId,
        targetConversationId,
        original.id,
        new Date(),
      );
      await this.realtimePublisher.publish(
        conversationChannel(targetConversationId),
        "message.sent",
        this.toWirePayload(copy),
      );
      forwarded.push(copy);
    }
    return forwarded;
  }

  // §10.7.3 "Search": Postgres FTS, always scoped to conversations the
  // caller is actually a participant of — a requested conversation_id
  // outside that set silently yields no results rather than confirming
  // or denying the conversation exists.
  async searchMessages(
    userId: string,
    query: string,
    conversationId: string | null,
    limit?: number,
  ): Promise<Message[]> {
    const memberOf = await this.repo.loadConversationIdsForUser(userId);
    if (conversationId && !memberOf.includes(conversationId)) return [];
    return this.repo.searchMessages(memberOf, query, conversationId, clampLimit(limit));
  }

  private toWirePayload(message: Message): Record<string, unknown> {
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

function isLowEffortFirstMessage(message: Message): boolean {
  if (message.sequence !== 1) return false;
  const body = (message.body ?? "").trim();
  if (body.length === 0) return false;
  return body.length < LOW_EFFORT_BODY_MIN_LENGTH || LOW_EFFORT_PATTERN.test(body);
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return DEFAULT_HISTORY_LIMIT;
  return Math.min(limit, MAX_HISTORY_LIMIT);
}
