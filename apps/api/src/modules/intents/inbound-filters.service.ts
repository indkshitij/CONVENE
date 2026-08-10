import { inboundIntentFilters, type NewInboundIntentFilter } from "@convene/db";
import { intents as intentsValidation } from "@convene/validation";
import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { PostgresService } from "../../infra/postgres/postgres.service";

export type InboundIntentFiltersInput = z.infer<
  typeof intentsValidation.inboundIntentFiltersSchema
>;
type IntentType = intentsValidation.IntentType;

export interface InboundFiltersResponse {
  accepted_intents: string[] | null;
  min_experience_years: string | null;
  max_experience_years: string | null;
  industries: number[] | null;
  verified_only: boolean;
  max_inbound_per_day: number | null;
}

export interface InboundCheckFacts {
  intentType: IntentType;
  yearsExperience: number;
  industryId: number | null;
  verificationLevel: number;
}

// PRD §10.6.5's exact copy for the filtered-out case — reused verbatim
// (not re-derived) once the connections module (Phase 14) starts calling
// checkInbound() at POST /connections/requests.
export const INBOUND_FILTER_REJECT_MESSAGE = "This person isn't accepting requests for that intent";

export type InboundCheckResult =
  { allowed: true } | { allowed: false; reason: "INTENT_FILTERED"; message: string };

// PRD §10.4.6 (PUT /settings/inbound-intent-filters) + BR-INT-07. Owns
// inbound_intent_filters (per this module's README). checkInbound() is
// the reusable predicate P8.2's own testing requirement ("assert a
// filtered inbound intent is rejected at send time") exercises directly
// — POST /connections/requests itself doesn't exist yet (Phase 14), so
// there's no HTTP round trip to test this through until then; this
// method is what that future endpoint will call.
@Injectable()
export class InboundFiltersService {
  constructor(private readonly postgres: PostgresService) {}

  async getFilters(userId: string): Promise<InboundFiltersResponse> {
    const [row] = await this.postgres.db
      .select()
      .from(inboundIntentFilters)
      .where(eq(inboundIntentFilters.userId, userId))
      .limit(1);
    return this.toResponse(row);
  }

  async updateFilters(
    userId: string,
    input: InboundIntentFiltersInput,
  ): Promise<InboundFiltersResponse> {
    const values: NewInboundIntentFilter = {
      userId,
      acceptedIntents: input.accepted_intents ?? null,
      minExperienceYears:
        input.min_experience_years != null ? String(input.min_experience_years) : null,
      maxExperienceYears:
        input.max_experience_years != null ? String(input.max_experience_years) : null,
      industryIds: input.industries ?? null,
      verifiedOnly: input.verified_only ?? false,
      maxInboundPerDay: input.max_inbound_per_day ?? null,
      updatedAt: new Date(),
    };

    const [row] = await this.postgres.db
      .insert(inboundIntentFilters)
      .values(values)
      .onConflictDoUpdate({ target: inboundIntentFilters.userId, set: values })
      .returning();
    return this.toResponse(row);
  }

  // BR-INT-07: "a user may declare which intents they will accept
  // requests for. Requests whose declared intent is filtered out are
  // rejected ... with 403 INTENT_FILTERED." No filter row at all means
  // "accept everything" (every column is nullable/false by default) —
  // matches §10.4.7's "NULL = accept all" note on accepted_intents,
  // generalised to every dimension.
  async checkInbound(
    recipientUserId: string,
    senderFacts: InboundCheckFacts,
  ): Promise<InboundCheckResult> {
    const [row] = await this.postgres.db
      .select()
      .from(inboundIntentFilters)
      .where(eq(inboundIntentFilters.userId, recipientUserId))
      .limit(1);
    if (!row) return { allowed: true };

    if (
      row.acceptedIntents &&
      row.acceptedIntents.length > 0 &&
      !row.acceptedIntents.includes(senderFacts.intentType)
    ) {
      return this.rejected();
    }
    if (
      row.minExperienceYears !== null &&
      senderFacts.yearsExperience < Number(row.minExperienceYears)
    ) {
      return this.rejected();
    }
    if (
      row.maxExperienceYears !== null &&
      senderFacts.yearsExperience > Number(row.maxExperienceYears)
    ) {
      return this.rejected();
    }
    if (row.industryIds && row.industryIds.length > 0) {
      if (senderFacts.industryId === null || !row.industryIds.includes(senderFacts.industryId)) {
        return this.rejected();
      }
    }
    // "verified_only" is interpreted as any achieved ladder level (L1+),
    // not a specific tier — the PRD names the field without specifying a
    // threshold, flagged as an assumption.
    if (row.verifiedOnly && senderFacts.verificationLevel < 1) {
      return this.rejected();
    }

    return { allowed: true };
  }

  private rejected(): InboundCheckResult {
    return { allowed: false, reason: "INTENT_FILTERED", message: INBOUND_FILTER_REJECT_MESSAGE };
  }

  private toResponse(
    row: typeof inboundIntentFilters.$inferSelect | undefined,
  ): InboundFiltersResponse {
    if (!row) {
      return {
        accepted_intents: null,
        min_experience_years: null,
        max_experience_years: null,
        industries: null,
        verified_only: false,
        max_inbound_per_day: null,
      };
    }
    return {
      accepted_intents: row.acceptedIntents,
      min_experience_years: row.minExperienceYears,
      max_experience_years: row.maxExperienceYears,
      industries: row.industryIds,
      verified_only: row.verifiedOnly,
      max_inbound_per_day: row.maxInboundPerDay,
    };
  }
}
