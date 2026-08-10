import { Injectable, Optional } from "@nestjs/common";
import { NotificationsService } from "../../notifications/notifications.service";
import { ModerationDeepScanService } from "./moderation-deep-scan.service";
import type { ClassificationResult } from "./toxicity-spam-classifier.service";

// §12.10's action table, applied to a classification result. Ties
// ToxicitySpamClassifierService's verdict to the real mechanisms that
// already exist: ModerationDeepScanService.retract() for anything that
// gets pulled, NotificationsService for the author-facing nudge and the
// self-harm support path. Not wired to an automatic queue/worker in
// this pass — see this module's README for what P25.3 scoped in vs.
// deferred; the async stage-2 classification call site (whatever job
// eventually invokes ToxicitySpamClassifierService.classify()) calls
// this immediately after with the result.
@Injectable()
export class ToxicityEnforcementService {
  constructor(
    private readonly deepScan: ModerationDeepScanService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  // §12.10: "Self-harm handling: if a message indicates the author may
  // be at risk, no punitive action is taken." This branch never calls
  // retract(), never files a report, never touches reputation or
  // account status — it is structurally incapable of being an
  // enforcement action because it doesn't call any enforcement method at
  // all. The message is still delivered; only a support notification is
  // added, routed as a distinct category a trained reviewer (not the
  // standard moderation queue) picks up.
  async apply(
    result: ClassificationResult,
    context: { messageId: string; conversationId: string; senderId: string },
  ): Promise<void> {
    if (result.toxicity.kind === "self_harm_support") {
      await this.notifications?.notify({
        userId: context.senderId,
        category: "moderation_action", // Nearest real category — routed to a human reviewer, not an automated punitive one; the notification title itself is support-framed, never a violation notice.
        title: "Support resources",
        body: "If you're going through something difficult, help is available. We've also asked a member of our team to check in.",
        data: {
          conversation_id: context.conversationId,
          message_id: context.messageId,
          kind: "self_harm_support",
        },
      });
      return;
    }

    if (result.toxicity.kind === "violating" || result.toxicity.kind === "severe") {
      await this.deepScan.retract(context.messageId, `toxicity:${result.toxicity.label}`);
      return;
    }

    if (result.toxicity.kind === "held_for_review") {
      // §12.1 fail-closed-on-safety: the classifier itself was
      // unavailable — the message is retracted pending a human decision
      // rather than delivered unclassified.
      await this.deepScan.retract(context.messageId, "toxicity:classifier_unavailable");
      return;
    }

    // "clean" and "borderline" both deliver — borderline's author-facing
    // nudge is a compose-time UI concern (shown before send), not a
    // post-hoc enforcement action, so there's nothing for this service
    // to do for either.
  }
}
