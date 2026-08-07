import {
  certifications,
  education,
  experiences,
  languages,
  portfolioItems,
  profiles,
  userInterests,
  userLanguages,
  userSkills,
  users,
  type Certification,
  type Education,
  type Experience,
  type PortfolioItem,
} from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { profile as profileValidation } from "@convene/validation";
import {
  BadRequestAppError,
  NotFoundAppError,
  ValidationAppError,
} from "../../common/errors/app-error";
import { type Clock, systemClock } from "../../common/clock";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { TaxonomyService } from "../taxonomy/taxonomy.service";
import { PROFILE_UPDATED_EVENT } from "./profile-events";
import {
  computeYearsExperience,
  isOverrideSuspicious,
  type ExperienceInterval,
} from "./years-experience";

export type SkillsReplaceInput = z.infer<typeof profileValidation.skillsReplaceSchema>;
export type InterestsReplaceInput = z.infer<typeof profileValidation.interestsListSchema>;
export type LanguagesReplaceInput = z.infer<typeof profileValidation.languagesListSchema>;
// experienceCreateSchema is a factory (needs dob/now), so its z.infer
// can't be captured as a single static type — this mirrors its shape by
// hand instead.
export interface ExperienceCreateInput {
  company_name: string;
  title: string;
  employment_type?: Experience["employmentType"] | undefined;
  location_text?: string | undefined;
  description?: string | undefined;
  start_date: string;
  end_date: string | null;
  is_current: boolean;
}
export type ExperienceUpdateInput = z.infer<typeof profileValidation.experienceUpdateSchema>;
export type EducationCreateInput = z.infer<typeof profileValidation.educationCreateSchema>;
export type EducationUpdateInput = z.infer<typeof profileValidation.educationUpdateSchema>;
export type CertificationCreateInput = z.infer<typeof profileValidation.certificationCreateSchema>;
export type CertificationUpdateInput = z.infer<typeof profileValidation.certificationUpdateSchema>;
export type PortfolioItemCreateInput = z.infer<typeof profileValidation.portfolioItemCreateSchema>;
export type PortfolioItemUpdateInput = z.infer<typeof profileValidation.portfolioItemUpdateSchema>;

export interface ExperienceMutationResult {
  experience: Experience;
  years_experience: string;
  years_experience_override_suspicious: boolean;
}

// PRD §10.2.9 endpoint 15. "One consistent controller pattern with
// ownership enforced in the repository layer, not only the handler" —
// every UPDATE/DELETE below is scoped `WHERE id = :id AND user_id =
// :userId` in the query itself, not a separate lookup-then-trust check;
// a row belonging to another user is indistinguishable from a
// nonexistent id (both 404), the same enumeration-safety pattern P7.1
// established for profiles themselves.
@Injectable()
export class ProfileChildrenService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly taxonomyService: TaxonomyService,
    // See otp.service.ts's constructor comment: Clock is an interface, so
    // @Optional() is required for Nest DI to fall through to the default.
    @Optional() private readonly clock: Clock = systemClock,
    // See profile.service.ts's constructor comment for why this is optional.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  // ---- Skills (full replace) ----

  async replaceSkills(userId: string, input: SkillsReplaceInput): Promise<void> {
    const resolved = await Promise.all(
      input.skills.map((entry) => this.taxonomyService.resolveOrCreateSkill(entry.name)),
    );

    await this.postgres.db.transaction(async (tx) => {
      await tx.delete(userSkills).where(eq(userSkills.userId, userId));
      if (resolved.length === 0) return;

      await tx.insert(userSkills).values(
        resolved.map((skill, index) => ({
          userId,
          skillId: skill.id,
          proficiency: input.skills[index]?.proficiency ?? null,
          years: this.toNumericString(input.skills[index]?.years),
          position: index,
        })),
      );
    });

    // BR-PROF-09: a full replace is always treated as "skills changed,"
    // even one that happens to reproduce the exact prior set — computing
    // a real before/after diff to suppress that edge case isn't worth the
    // complexity for a debounced, hash-guarded refresh (embedding.service.ts
    // skips the actual provider call anyway if the composed text is
    // unchanged).
    this.events?.emit(PROFILE_UPDATED_EVENT, { userId, changedFields: ["skills"] });
  }

  // ---- Interests (full replace) ----

  async replaceInterests(userId: string, input: InterestsReplaceInput): Promise<void> {
    const resolved = await Promise.all(
      input.map((name) => this.taxonomyService.resolveOrCreateInterest(name)),
    );

    await this.postgres.db.transaction(async (tx) => {
      await tx.delete(userInterests).where(eq(userInterests.userId, userId));
      if (resolved.length === 0) return;

      await tx
        .insert(userInterests)
        .values(
          resolved.map((interest, index) => ({ userId, interestId: interest.id, position: index })),
        );
    });
  }

  // ---- Languages (full replace) ----
  // Unlike skills/interests, language codes are a fixed curated set (ISO
  // 639-1) — the taxonomy table is never extended on the fly here, an
  // unrecognised code is a validation error, not a new taxonomy request.

  async replaceLanguages(userId: string, input: LanguagesReplaceInput): Promise<void> {
    if (input.length > 0) {
      const codes = input.map((entry) => entry.code);
      const known = await this.postgres.db.select().from(languages);
      const knownCodes = new Set(known.map((l) => l.code));
      const unknownCode = codes.find((code) => !knownCodes.has(code));
      if (unknownCode) {
        throw new BadRequestAppError(
          "BAD_REQUEST",
          `"${unknownCode}" isn't a recognised language code.`,
          {
            field: "code",
          },
        );
      }
    }

    await this.postgres.db.transaction(async (tx) => {
      await tx.delete(userLanguages).where(eq(userLanguages.userId, userId));
      if (input.length === 0) return;

      await tx.insert(userLanguages).values(
        input.map((entry, index) => ({
          userId,
          languageCode: entry.code,
          proficiency: entry.proficiency,
          position: index,
        })),
      );
    });
  }

  // ---- Experience ----

  // Validated here (not via the controller's usual static ZodValidationPipe)
  // because §10.2.7's start_date floor is "≥ DOB + 14 yrs" — a per-user
  // value the schema factory needs at parse time, which a route-level
  // pipe (built once, no request context) can't supply.
  async createExperienceValidated(
    userId: string,
    rawInput: unknown,
  ): Promise<ExperienceMutationResult> {
    const dob = await this.getUserDob(userId);
    const schema = profileValidation.experienceCreateSchema(dob, this.clock.now());
    const result = schema.safeParse(rawInput);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      throw new ValidationAppError("VALIDATION_FAILED", "The request could not be validated.", {
        field: firstIssue ? firstIssue.path.join(".") : null,
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return this.createExperience(userId, result.data);
  }

  private async getUserDob(userId: string): Promise<Date> {
    const [user] = await this.postgres.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");
    return new Date(user.dateOfBirth);
  }

  async createExperience(
    userId: string,
    input: ExperienceCreateInput,
  ): Promise<ExperienceMutationResult> {
    const rows = await this.postgres.db
      .select()
      .from(experiences)
      .where(eq(experiences.userId, userId));

    const [created] = await this.postgres.db
      .insert(experiences)
      .values({
        userId,
        companyName: input.company_name,
        title: input.title,
        employmentType: input.employment_type ?? null,
        locationText: input.location_text ?? null,
        startDate: input.start_date,
        endDate: input.end_date,
        isCurrent: input.is_current,
        description: input.description ?? null,
        position: rows.length,
      })
      .returning();
    if (!created) throw new Error("ProfileChildrenService: experience insert returned no row");

    return this.recomputeYearsExperience(userId, created);
  }

  async updateExperience(
    userId: string,
    experienceId: string,
    input: ExperienceUpdateInput,
  ): Promise<ExperienceMutationResult> {
    const [existing] = await this.postgres.db
      .select()
      .from(experiences)
      .where(and(eq(experiences.id, experienceId), eq(experiences.userId, userId)))
      .limit(1);
    if (!existing)
      throw new NotFoundAppError("NOT_FOUND", "This experience entry could not be found.");

    const merged = {
      start_date: input.start_date ?? existing.startDate,
      end_date: input.end_date !== undefined ? input.end_date : existing.endDate,
      is_current: input.is_current ?? existing.isCurrent,
    };
    if (input.start_date !== undefined) {
      const dob = await this.getUserDob(userId);
      this.assertStartDateFloor(merged.start_date, dob);
    }
    this.assertExperienceDatesConsistent(merged);

    const [updated] = await this.postgres.db
      .update(experiences)
      .set({
        companyName: input.company_name ?? existing.companyName,
        title: input.title ?? existing.title,
        employmentType:
          input.employment_type !== undefined
            ? (input.employment_type as Experience["employmentType"])
            : existing.employmentType,
        locationText:
          input.location_text !== undefined ? input.location_text : existing.locationText,
        startDate: merged.start_date,
        endDate: merged.end_date,
        isCurrent: merged.is_current,
        description: input.description !== undefined ? input.description : existing.description,
        position: input.position ?? existing.position,
      })
      .where(and(eq(experiences.id, experienceId), eq(experiences.userId, userId)))
      .returning();
    if (!updated)
      throw new NotFoundAppError("NOT_FOUND", "This experience entry could not be found.");

    return this.recomputeYearsExperience(userId, updated);
  }

  async deleteExperience(userId: string, experienceId: string): Promise<void> {
    const deleted = await this.postgres.db
      .delete(experiences)
      .where(and(eq(experiences.id, experienceId), eq(experiences.userId, userId)))
      .returning();
    if (deleted.length === 0)
      throw new NotFoundAppError("NOT_FOUND", "This experience entry could not be found.");

    await this.recomputeYearsExperienceForUser(userId);
  }

  // §10.2.7 `experience.start_date`: "≤ today; ≥ DOB + 14 yrs." Only
  // checked on update when start_date is actually being changed — the
  // floor was already enforced by experienceCreateSchema at creation time.
  private assertStartDateFloor(startDate: string, dob: Date): void {
    const floor = new Date(dob);
    floor.setFullYear(floor.getFullYear() + 14);
    const start = new Date(startDate);
    if (
      Number.isNaN(start.getTime()) ||
      start.getTime() < floor.getTime() ||
      start.getTime() > this.clock.now().getTime()
    ) {
      throw new BadRequestAppError("BAD_REQUEST", "Start date looks incorrect", {
        field: "start_date",
      });
    }
  }

  private assertExperienceDatesConsistent(entry: {
    start_date: string;
    end_date: string | null;
    is_current: boolean;
  }): void {
    if (entry.is_current && entry.end_date !== null) {
      throw new BadRequestAppError("BAD_REQUEST", "End date must be after the start date", {
        field: "end_date",
      });
    }
    if (!entry.is_current && entry.end_date === null) {
      throw new BadRequestAppError("BAD_REQUEST", "End date must be after the start date", {
        field: "end_date",
      });
    }
    if (
      entry.end_date !== null &&
      new Date(entry.end_date).getTime() <= new Date(entry.start_date).getTime()
    ) {
      throw new BadRequestAppError("BAD_REQUEST", "End date must be after the start date", {
        field: "end_date",
      });
    }
  }

  // BR-PROF-03: recomputes years_experience from the union of all of the
  // user's experience intervals, unless years_experience_override is set
  // — in which case the stored value is left alone and only the
  // suspicious-override flag (>3 years above the derived value) is
  // computed and returned as a non-persisted warning. Takes the row the
  // caller just created/updated explicitly, rather than re-deriving
  // "which row is relevant" from a fresh SELECT — that would be
  // ambiguous (row order isn't the same as "the one just touched").
  private async recomputeYearsExperience(
    userId: string,
    justChanged: Experience,
  ): Promise<ExperienceMutationResult> {
    const { years_experience, years_experience_override_suspicious } =
      await this.recomputeYearsExperienceForUser(userId);
    return { experience: justChanged, years_experience, years_experience_override_suspicious };
  }

  private async recomputeYearsExperienceForUser(
    userId: string,
  ): Promise<{ years_experience: string; years_experience_override_suspicious: boolean }> {
    const [profile] = await this.postgres.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!profile) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");

    const rows = await this.postgres.db
      .select()
      .from(experiences)
      .where(eq(experiences.userId, userId));
    const intervals: ExperienceInterval[] = rows.map((r) => ({
      startDate: r.startDate,
      endDate: r.endDate,
    }));
    const derivedYears = computeYearsExperience(intervals, this.clock.now());

    if (profile.yearsExperienceOverride) {
      const overrideYears = Number(profile.yearsExperience);
      return {
        years_experience: profile.yearsExperience,
        years_experience_override_suspicious: isOverrideSuspicious(derivedYears, overrideYears),
      };
    }

    const derivedString = derivedYears.toFixed(1);
    await this.postgres.db
      .update(profiles)
      .set({ yearsExperience: derivedString })
      .where(eq(profiles.userId, userId));

    return { years_experience: derivedString, years_experience_override_suspicious: false };
  }

  // ---- Education ----

  async createEducation(userId: string, input: EducationCreateInput): Promise<Education> {
    const rows = await this.postgres.db
      .select()
      .from(education)
      .where(eq(education.userId, userId));
    const [created] = await this.postgres.db
      .insert(education)
      .values({
        userId,
        school: input.school,
        degree: input.degree ?? null,
        fieldOfStudy: input.field_of_study ?? null,
        startDate: input.start_date ?? null,
        endDate: input.end_date ?? null,
        description: input.description ?? null,
        position: rows.length,
      })
      .returning();
    if (!created) throw new Error("ProfileChildrenService: education insert returned no row");
    return created;
  }

  async updateEducation(
    userId: string,
    educationId: string,
    input: EducationUpdateInput,
  ): Promise<Education> {
    const [existing] = await this.postgres.db
      .select()
      .from(education)
      .where(and(eq(education.id, educationId), eq(education.userId, userId)))
      .limit(1);
    if (!existing)
      throw new NotFoundAppError("NOT_FOUND", "This education entry could not be found.");

    const [updated] = await this.postgres.db
      .update(education)
      .set({
        school: input.school ?? existing.school,
        degree: input.degree !== undefined ? input.degree : existing.degree,
        fieldOfStudy:
          input.field_of_study !== undefined ? input.field_of_study : existing.fieldOfStudy,
        startDate: input.start_date !== undefined ? input.start_date : existing.startDate,
        endDate: input.end_date !== undefined ? input.end_date : existing.endDate,
        description: input.description !== undefined ? input.description : existing.description,
        position: input.position ?? existing.position,
      })
      .where(and(eq(education.id, educationId), eq(education.userId, userId)))
      .returning();
    if (!updated)
      throw new NotFoundAppError("NOT_FOUND", "This education entry could not be found.");
    return updated;
  }

  async deleteEducation(userId: string, educationId: string): Promise<void> {
    const deleted = await this.postgres.db
      .delete(education)
      .where(and(eq(education.id, educationId), eq(education.userId, userId)))
      .returning();
    if (deleted.length === 0)
      throw new NotFoundAppError("NOT_FOUND", "This education entry could not be found.");
  }

  // ---- Certifications ----

  async createCertification(
    userId: string,
    input: CertificationCreateInput,
  ): Promise<Certification> {
    const rows = await this.postgres.db
      .select()
      .from(certifications)
      .where(eq(certifications.userId, userId));
    const [created] = await this.postgres.db
      .insert(certifications)
      .values({
        userId,
        name: input.name,
        issuer: input.issuer,
        issuedAt: input.issued_at ?? null,
        expiresAt: input.expires_at ?? null,
        credentialUrl: input.credential_url ?? null,
        position: rows.length,
      })
      .returning();
    if (!created) throw new Error("ProfileChildrenService: certification insert returned no row");
    return created;
  }

  async updateCertification(
    userId: string,
    certificationId: string,
    input: CertificationUpdateInput,
  ): Promise<Certification> {
    const [existing] = await this.postgres.db
      .select()
      .from(certifications)
      .where(and(eq(certifications.id, certificationId), eq(certifications.userId, userId)))
      .limit(1);
    if (!existing)
      throw new NotFoundAppError("NOT_FOUND", "This certification could not be found.");

    const [updated] = await this.postgres.db
      .update(certifications)
      .set({
        name: input.name ?? existing.name,
        issuer: input.issuer ?? existing.issuer,
        issuedAt: input.issued_at !== undefined ? input.issued_at : existing.issuedAt,
        expiresAt: input.expires_at !== undefined ? input.expires_at : existing.expiresAt,
        credentialUrl:
          input.credential_url !== undefined ? input.credential_url : existing.credentialUrl,
        position: input.position ?? existing.position,
      })
      .where(and(eq(certifications.id, certificationId), eq(certifications.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundAppError("NOT_FOUND", "This certification could not be found.");
    return updated;
  }

  async deleteCertification(userId: string, certificationId: string): Promise<void> {
    const deleted = await this.postgres.db
      .delete(certifications)
      .where(and(eq(certifications.id, certificationId), eq(certifications.userId, userId)))
      .returning();
    if (deleted.length === 0)
      throw new NotFoundAppError("NOT_FOUND", "This certification could not be found.");
  }

  // ---- Portfolio ----

  async createPortfolioItem(
    userId: string,
    input: PortfolioItemCreateInput,
  ): Promise<PortfolioItem> {
    const rows = await this.postgres.db
      .select()
      .from(portfolioItems)
      .where(eq(portfolioItems.userId, userId));
    const [created] = await this.postgres.db
      .insert(portfolioItems)
      .values({
        userId,
        title: input.title,
        url: input.url,
        description: input.description ?? null,
        position: rows.length,
      })
      .returning();
    if (!created) throw new Error("ProfileChildrenService: portfolio item insert returned no row");
    return created;
  }

  async updatePortfolioItem(
    userId: string,
    portfolioItemId: string,
    input: PortfolioItemUpdateInput,
  ): Promise<PortfolioItem> {
    const [existing] = await this.postgres.db
      .select()
      .from(portfolioItems)
      .where(and(eq(portfolioItems.id, portfolioItemId), eq(portfolioItems.userId, userId)))
      .limit(1);
    if (!existing)
      throw new NotFoundAppError("NOT_FOUND", "This portfolio item could not be found.");

    const [updated] = await this.postgres.db
      .update(portfolioItems)
      .set({
        title: input.title ?? existing.title,
        url: input.url ?? existing.url,
        description: input.description !== undefined ? input.description : existing.description,
        position: input.position ?? existing.position,
      })
      .where(and(eq(portfolioItems.id, portfolioItemId), eq(portfolioItems.userId, userId)))
      .returning();
    if (!updated)
      throw new NotFoundAppError("NOT_FOUND", "This portfolio item could not be found.");
    return updated;
  }

  async deletePortfolioItem(userId: string, portfolioItemId: string): Promise<void> {
    const deleted = await this.postgres.db
      .delete(portfolioItems)
      .where(and(eq(portfolioItems.id, portfolioItemId), eq(portfolioItems.userId, userId)))
      .returning();
    if (deleted.length === 0)
      throw new NotFoundAppError("NOT_FOUND", "This portfolio item could not be found.");
  }

  private toNumericString(value: number | null | undefined): string | null {
    if (value === undefined || value === null) return null;
    return String(value);
  }
}
