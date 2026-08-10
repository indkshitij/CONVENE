import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ForbiddenAppError, NotFoundAppError } from "../../../common/errors/app-error";
import type { AuthContext } from "../../../common/auth/auth-context";
import { MessagesRepository } from "../../messaging/repositories/messages.repository";
import { AiGatewayService } from "../gateway.service";
import type { GroundingFacts } from "../prompt-builder";

const MIN_MESSAGES = 15; // §12.7: "triggered manually on conversations with >= 15 messages."
const MESSAGE_WINDOW = 300; // A generous cap on how far back a summary looks — bounds prompt size without needing real pagination for this feature.

export const conversationSummaryOutputSchema = z
  .object({
    bullets: z.array(z.string()).min(3).max(5),
    decisions: z.array(z.object({ who: z.string(), what: z.string() }).strict()),
    open_questions: z.array(z.string()),
    suggested_follow_up: z
      .object({ time_proposal: z.string().nullable(), note: z.string() })
      .strict(),
  })
  .strict();

export type ConversationSummaryOutput = z.infer<typeof conversationSummaryOutputSchema>;

export interface ConversationSummaryResult {
  status: "ok" | "unavailable" | "too_few_messages";
  data?: ConversationSummaryOutput;
}

// §12.7: "available only to conversation participants; both participants
// may generate independently (each summary is private to the
// generator); ... excluded content: anything in a retracted or deleted
// message; summaries are not stored beyond 30 days."
@Injectable()
export class ConversationSummaryService {
  constructor(
    private readonly messagesRepository: MessagesRepository,
    private readonly gateway: AiGatewayService,
  ) {}

  async generate(
    authContext: AuthContext,
    conversationId: string,
  ): Promise<ConversationSummaryResult> {
    const conversation = await this.messagesRepository.findConversationById(conversationId);
    if (!conversation)
      throw new NotFoundAppError("CONVERSATION_NOT_FOUND", "This conversation could not be found.");
    const participantIds = await this.messagesRepository.loadParticipantIds(conversationId);
    if (!participantIds.includes(authContext.id)) {
      throw new ForbiddenAppError(
        "NOT_CONVERSATION_MEMBER",
        "You're not a participant in this conversation.",
      );
    }

    const messages = await this.messagesRepository.listBeforeSequence(
      conversationId,
      null,
      MESSAGE_WINDOW,
    );
    // §12.7: "excluded content: anything in a retracted or deleted
    // message" — a null body (set by ModerationDeepScanService.retract())
    // or a non-null deletedScope both mean the content is gone; this
    // filter runs before the message even reaches the model, not after.
    const visibleMessages = messages.filter(
      (message) =>
        message.body !== null &&
        message.deletedScope === null &&
        message.moderationState !== "retracted",
    );

    if (visibleMessages.length < MIN_MESSAGES) return { status: "too_few_messages" };

    const groundingFacts: GroundingFacts = {
      // §12.7's own privacy rule ("private to the generator") — the
      // generator's own id is a real grounding fact (it's who's asking),
      // which is also what makes the gateway's per-(feature,facts) cache
      // key naturally private per generator rather than shared between
      // both participants of the same conversation.
      generator_user_id: authContext.id,
      message_count: visibleMessages.length,
    };

    const untrustedUserContent = visibleMessages.map(
      (message) => `[${message.senderId === authContext.id ? "you" : "them"}] ${message.body}`,
    );

    const result = await this.gateway.invoke({
      userId: authContext.id,
      plan: authContext.plan,
      feature: "conversation_summary",
      tier: "large",
      systemInstructions: CONVERSATION_SUMMARY_SYSTEM_INSTRUCTIONS,
      groundingFacts,
      untrustedUserContent,
      outputSchema: conversationSummaryOutputSchema,
      // §12.7: "not stored beyond 30 days" — the gateway's own cache is
      // the storage this feature relies on (no dedicated summaries
      // table exists), so its TTL is the retention window, not merely
      // a performance optimisation.
      cacheTtlSeconds: 30 * 24 * 60 * 60,
      mode: "feature",
    });

    if (result.status !== "ok") return { status: "unavailable" };
    return { status: "ok", data: result.data };
  }
}

const CONVERSATION_SUMMARY_SYSTEM_INSTRUCTIONS = `You summarise a professional networking conversation for one of its two participants (the one asking, labelled "you" in the transcript; the other party is labelled "them").
Produce: 3-5 bullet recap of what was discussed; explicit decisions/commitments with who owes what; open questions; a suggested follow-up (a concrete time proposal if the transcript makes one derivable, otherwise null, plus a short note).
Never reveal anything as fact that isn't in the transcript. Never fabricate a commitment neither party actually made.`;
