import { identityVerifications, profiles, users } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import {
  BadRequestAppError,
  ConflictAppError,
  GoneAppError,
  NotFoundAppError,
} from "../../common/errors/app-error";
import { EmailService } from "../notifications/email.service";
import { VerificationService } from "../auth/services/verification.service";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { deriveVerificationLevel, workEmailDomainMatchesCompany } from "./verification-ladder";

export type IdentityVerificationResult = "pending" | "approved" | "rejected";

export interface SubmitGovernmentIdInput {
  provider: string;
  providerReference: string;
  result: IdentityVerificationResult;
}

// PRD §10.2.5 + §10.2.9 (endpoint 16: POST /verification/work-email,
// /verification/work-email/confirm, POST /me/verification/government-id).
// L0/L1/L2 are read directly off users.email_verified_at/phone_verified_at
// (already maintained by the auth module) — this service only owns the
// L3/L4 mutation paths and the level recomputation that folds all four
// signals together.
@Injectable()
export class VerificationLadderService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly verificationService: VerificationService,
    private readonly emailService: EmailService,
  ) {}

  async sendWorkEmailCode(userId: string, target: string): Promise<{ expiresAt: Date }> {
    const [profile] = await this.postgres.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!profile) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");
    if (!profile.companyName) {
      throw new BadRequestAppError(
        "BAD_REQUEST",
        "Add a company name to your profile before verifying a work email.",
        {
          field: "company_name",
        },
      );
    }
    if (!workEmailDomainMatchesCompany(target, profile.companyName)) {
      throw new BadRequestAppError(
        "WORK_EMAIL_DOMAIN_MISMATCH",
        "This email's domain doesn't match your profile's company name.",
        { field: "target" },
      );
    }

    const { code, expiresAt } = await this.verificationService.createWorkEmailVerificationToken(
      userId,
      target,
    );
    await this.emailService.sendWorkEmailVerificationCode(target, code);
    return { expiresAt };
  }

  async confirmWorkEmailCode(userId: string, code: string): Promise<void> {
    const result = await this.verificationService.consumeWorkEmailVerificationToken(userId, code);
    if (!result.ok) {
      if (result.reason === "TOKEN_USED") {
        throw new ConflictAppError("TOKEN_USED", "This verification code has already been used.");
      }
      throw new GoneAppError("TOKEN_EXPIRED", "This verification code is invalid or has expired.");
    }

    await this.postgres.db
      .update(profiles)
      .set({ companyVerified: true })
      .where(eq(profiles.userId, userId));
    await this.recomputeAndPersist(userId);
  }

  // §10.2.5 L4: "ID images are never stored by Convene; only the
  // provider's verification reference and result" (§20.4) — this method's
  // entire input surface is exactly those two fields plus the provider
  // name, never document data. Real third-party KYC vendor integration
  // (submitting the actual document for verification) is explicitly out
  // of scope for this phase — this endpoint records the outcome a vendor
  // integration would eventually report, per the P7.3 prompt's own scope
  // ("never the document or its data").
  async submitGovernmentId(userId: string, input: SubmitGovernmentIdInput): Promise<void> {
    await this.postgres.db.insert(identityVerifications).values({
      userId,
      provider: input.provider,
      providerReference: input.providerReference,
      result: input.result,
    });

    if (input.result === "approved") {
      await this.recomputeAndPersist(userId);
    }
  }

  async getLevel(userId: string): Promise<number> {
    const [profile] = await this.postgres.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!profile) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");
    return profile.verificationLevel;
  }

  // Re-derives the level purely from persisted state (users.*_verified_at,
  // profiles.company_verified, the most recent identity_verifications
  // row) rather than trusting a transient "what just happened" flag from
  // the caller — so calling this after *any* of the three mutation paths
  // above always reflects every signal ever achieved, never just the most
  // recent one.
  private async recomputeAndPersist(userId: string): Promise<void> {
    const [row] = await this.postgres.db
      .select({ user: users, profile: profiles })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");
    const { user, profile } = row;

    const [latestIdentity] = await this.postgres.db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.userId, userId))
      .orderBy(desc(identityVerifications.createdAt))
      .limit(1);

    const level = deriveVerificationLevel({
      emailVerified: user.emailVerifiedAt !== null,
      phoneVerified: user.phoneVerifiedAt !== null,
      workEmailVerified: profile.companyVerified,
      governmentIdApproved: latestIdentity?.result === "approved",
    });

    await this.postgres.db
      .update(profiles)
      .set({ verificationLevel: level })
      .where(eq(profiles.userId, userId));
  }
}
