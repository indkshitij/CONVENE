import { Injectable, Optional } from "@nestjs/common";
import { NotFoundAppError } from "../../../common/errors/app-error";
import { conversationChannel } from "../../../infra/redis/channels";
import { NotificationsService } from "../../notifications/notifications.service";
import { RealtimePublisherService } from "../../realtime/realtime-publisher.service";
import { MessagesRepository } from "../repositories/messages.repository";

// BR-MSG-05's second tier: "asynchronous deep moderation (toxicity,
// spam classification). Async detection of a violation can retract the
// message and notify the recipient [sic — §10.7.8's own Gherkin scenario
// says the *sender* is notified, which is what's implemented here; a
// violating message's "recipient" learning about a policy violation of
// someone else's message wouldn't make sense]." The actual
// classification decision (what counts as "above the retraction
// threshold") is Trust & Safety (Phase 18) territory, same reasoning as
// ModerationFastPathService — this is the retraction *mechanism* every
// real classifier will eventually call, exercised directly here (no
// classifier exists yet to call it automatically).
@Injectable()
export class ModerationDeepScanService {
  constructor(
    private readonly repo: MessagesRepository,
    private readonly realtimePublisher: RealtimePublisherService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async retract(messageId: string, reason: string): Promise<void> {
    const existing = await this.repo.findMessageById(messageId);
    if (!existing) throw new NotFoundAppError("NOT_FOUND", "This message could not be found.");

    const retracted = await this.repo.retractMessage(messageId, new Date());
    if (!retracted) return; // Already retracted/deleted — nothing further to do.

    // "Replaced with a placeholder for the recipient" — the same
    // message.deleted event delete-for-everyone publishes, so both
    // clients render the identical tombstone regardless of which path
    // produced it.
    await this.realtimePublisher.publish(
      conversationChannel(retracted.conversationId),
      "message.deleted",
      { message_id: messageId, scope: "everyone", reason: "moderation" },
    );

    if (retracted.senderId) {
      await this.notifications?.notify({
        userId: retracted.senderId,
        category: "moderation_action",
        title: "Your message was removed",
        body: "A message you sent violated our community guidelines.",
        data: { message_id: messageId },
      });

      await this.repo.createModerationCase({
        targetUserId: retracted.senderId,
        targetMessageId: messageId,
        // "other" is the closest of §10.10.2's eight categories ("Other /
        // inappropriate content") — trust-safety/migrations/0016 adds a
        // DB CHECK restricting `reports.category` to those eight values,
        // so this string had to change from the free-text
        // "inappropriate_content" this method used before P18.1 existed.
        category: "other",
        description: reason,
      });
    }
  }
}
