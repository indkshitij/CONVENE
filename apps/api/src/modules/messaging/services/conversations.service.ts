import { Injectable, Optional } from "@nestjs/common";
import { ConflictAppError, NotFoundAppError } from "../../../common/errors/app-error";
import {
  ConversationsRepository,
  type ConversationFilter,
  type ConversationListRow,
} from "../repositories/conversations.repository";
import { PushNotificationProducer } from "./push-notification.producer";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const MAX_PINNED_CONVERSATIONS = 5; // §10.7.3 "Pin conversations: Max 5."

export interface UpdateConversationSettingsInput {
  isPinned?: boolean;
  mutedUntil?: Date | null;
  isArchived?: boolean;
}

// PRD §17.9 endpoints 37 (list), 43 (read), 44 (settings).
@Injectable()
export class ConversationsService {
  constructor(
    private readonly repo: ConversationsRepository,
    @Optional() private readonly pushProducer?: PushNotificationProducer,
  ) {}

  async listConversations(
    userId: string,
    filter: ConversationFilter,
    limit?: number,
  ): Promise<ConversationListRow[]> {
    return this.repo.listForUser(userId, filter, clampLimit(limit));
  }

  // §10.7.2/edge case 3: "Read to a sequence (never to a timestamp)."
  // §10.7.9 edge case 12: last_read_seq only ever moves forward.
  async markRead(
    conversationId: string,
    userId: string,
    upToSequence: number,
  ): Promise<{ unreadCount: number; lastReadSeq: number }> {
    await this.assertParticipant(conversationId, userId);
    const { previousLastReadSeq, newLastReadSeq } = await this.repo.markRead(
      conversationId,
      userId,
      upToSequence,
    );

    // BR-MSG-06: reading cancels the still-pending 8s delayed push for
    // every message this read call just covered.
    if (this.pushProducer && newLastReadSeq > previousLastReadSeq) {
      const coveredMessageIds = await this.repo.loadMessageIdsInSequenceRange(
        conversationId,
        previousLastReadSeq,
        newLastReadSeq,
      );
      await Promise.all(
        coveredMessageIds.map((messageId) => this.pushProducer?.cancelPush(messageId, userId)),
      );
    }

    const participant = await this.repo.loadParticipant(conversationId, userId);
    return { unreadCount: participant?.unreadCount ?? 0, lastReadSeq: newLastReadSeq };
  }

  async updateSettings(
    conversationId: string,
    userId: string,
    patch: UpdateConversationSettingsInput,
  ): Promise<void> {
    await this.assertParticipant(conversationId, userId);

    if (patch.isPinned === true) {
      const pinnedCount = await this.repo.countPinned(userId);
      if (pinnedCount >= MAX_PINNED_CONVERSATIONS) {
        throw new ConflictAppError(
          "CONFLICT",
          `You can pin up to ${MAX_PINNED_CONVERSATIONS} conversations`,
        );
      }
    }

    await this.repo.updateSettings(conversationId, userId, patch);
  }

  private async assertParticipant(conversationId: string, userId: string): Promise<void> {
    const participant = await this.repo.loadParticipant(conversationId, userId);
    if (!participant)
      throw new NotFoundAppError("CONVERSATION_NOT_FOUND", "This conversation could not be found.");
  }
}

function clampLimit(limit: number | undefined): number {
  if (!limit || limit <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(limit, MAX_LIST_LIMIT);
}
