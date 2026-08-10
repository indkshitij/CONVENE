import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type { AuthContext } from "../../../common/auth/auth-context";
import { ProfileService } from "../../profile/profile.service";
import { AiGatewayService } from "../gateway.service";
import type { GroundingFacts } from "../prompt-builder";

// §12.4: "Sensitive attributes present in a resume (photo, DOB, marital
// status, caste, religion — common in Indian resumes) are flagged for
// removal advice and are explicitly excluded from any matching signal."
// This is the complete, closed set — the schema below can't produce a
// type the rest of the system doesn't already know is display-only.
const SENSITIVE_ATTRIBUTE_TYPES = [
  "photo",
  "date_of_birth",
  "marital_status",
  "caste",
  "religion",
  "gender",
] as const;

const sensitiveAttributeFlagSchema = z
  .object({
    type: z.enum(SENSITIVE_ATTRIBUTE_TYPES),
    advice: z.string().min(1),
  })
  .strict();

const impactRewriteSchema = z
  .object({
    original: z.string(),
    rewritten: z.string(),
  })
  .strict();

export const resumeReviewOutputSchema = z
  .object({
    ats_score: z.number().int().min(0).max(100),
    ats_failures: z.array(z.string()),
    impact_rewrites: z.array(impactRewriteSchema).max(10),
    skill_gap: z
      .object({
        missing: z.array(z.string()),
        present: z.array(z.string()),
      })
      .strict(),
    length_format_issues: z.array(z.string()),
    // §12.4: "flags discrepancies to the user only." Each entry cites a
    // grounding-fact key on each side of the comparison — same
    // citation-checking mechanism as icebreakers/profile-optimisation,
    // so a discrepancy claim can't be fabricated against a profile field
    // that doesn't exist.
    consistency_flags: z.array(
      z.object({ issue: z.string(), grounded_in: z.array(z.string()) }).strict(),
    ),
    priority_actions: z.array(z.string()).min(1).max(5),
    // Response-only, never persisted as a structured field — see
    // ResumeReviewService.generate's own comment on exactly where that
    // guarantee is enforced.
    sensitive_attributes_detected: z.array(sensitiveAttributeFlagSchema),
  })
  .strict();

export type ResumeReviewOutput = z.infer<typeof resumeReviewOutputSchema>;

export type ResumeReviewRejectionReason = "UNGROUNDED_CONSISTENCY_CLAIM";

export function validateResumeReviewHardRules(
  output: ResumeReviewOutput,
  groundingFactKeys: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: ResumeReviewRejectionReason } {
  for (const flag of output.consistency_flags) {
    for (const key of flag.grounded_in) {
      if (!groundingFactKeys.has(key)) return { ok: false, reason: "UNGROUNDED_CONSISTENCY_CLAIM" };
    }
  }
  return { ok: true };
}

export interface ResumeReviewResult {
  status: "ok" | "unavailable";
  data?: ResumeReviewOutput;
}

// §12.4's pipeline is "upload -> text extraction -> structure detection
// -> analysis -> structured report." Text extraction (PDF/DOCX parsing,
// OCR fallback) is a real document-processing integration this pass
// doesn't build — apps/media has no text-extraction capability yet (see
// this module's own README/P3.1 history) — so `resumeText` is accepted
// as already-extracted text from the caller rather than a file. The
// review logic and — the part §20.6 actually cares about — the
// sensitive-attribute handling are real. Flagged, not silently faked.
@Injectable()
export class ResumeReviewService {
  constructor(
    private readonly profileService: ProfileService,
    private readonly gateway: AiGatewayService,
  ) {}

  async generate(authContext: AuthContext, resumeText: string): Promise<ResumeReviewResult> {
    const profile = await this.profileService.getMyProfile(authContext.id);

    // §20.6 / §12.4: the grounding facts handed to the model — and
    // everything the model can therefore cite in consistency_flags — are
    // exclusively the user's own real profile fields. There is no field
    // here (or anywhere in GroundingFacts, a plain string-keyed bag) a
    // caste/religion/marital-status/photo value could be threaded
    // through into a matching input even if a future change tried to —
    // this service never writes to a matching-consumed table at all.
    const groundingFacts: GroundingFacts = {
      profile_company: profile.company?.name ?? null,
      profile_job_title: profile.job_title ?? null,
      profile_years_experience: profile.years_experience,
      profile_experience_titles: profile.experience.map((entry) => entry.title),
      profile_experience_companies: profile.experience.map((entry) => entry.company),
      profile_skills: profile.skills.map((skill) => skill.name),
      target_intent: profile.intents[0]?.type ?? null,
      resume_text: resumeText,
    };
    const groundingFactKeys = new Set(Object.keys(groundingFacts));

    const result = await this.gateway.invoke({
      userId: authContext.id,
      plan: authContext.plan,
      feature: "resume_review",
      tier: "large",
      systemInstructions: RESUME_REVIEW_SYSTEM_INSTRUCTIONS,
      groundingFacts,
      // The resume text itself is the one piece of untrusted free text
      // here — a resume can legitimately contain almost anything,
      // including text an attacker controls (this is exactly the
      // §12.1 prompt-injection scenario) — so it's fenced, not folded
      // into the trusted grounding-fact object.
      untrustedUserContent: [resumeText],
      outputSchema: resumeReviewOutputSchema,
      // §12.2: "Per file-hash, permanent" — the grounding hash already
      // includes resume_text, so identical resume text always hits the
      // same cache entry; "permanent" itself isn't modelled (the
      // gateway's cache is TTL-only), so this uses a long-but-bounded
      // 30-day approximation rather than a fixed 24h default.
      cacheTtlSeconds: 30 * 24 * 60 * 60,
      mode: "feature",
    });

    if (result.status !== "ok") return { status: "unavailable" };

    const hardRules = validateResumeReviewHardRules(result.data, groundingFactKeys);
    if (!hardRules.ok) return { status: "unavailable" };

    // Nothing above this line, and nothing after it, writes any part of
    // `result.data` — sensitive_attributes_detected included — to a
    // database column. It is returned to the caller (§12.4: "flagged
    // for removal advice") and never stored as a structured field,
    // exactly as §20.6 requires.
    return { status: "ok", data: result.data };
  }
}

const RESUME_REVIEW_SYSTEM_INSTRUCTIONS = `You review a resume for a professional networking platform.
Rules:
- Produce an ATS-parseability score and specific structural failures (tables, multi-column layouts, images, non-standard headings).
- Rewrite weak bullets into quantified, impact-oriented versions — show the transformation, don't just critique.
- Compare the resume's skills and experience against the grounding facts (the person's real profile) and flag discrepancies for the user's own eyes only, e.g. differing years-at-company — cite which grounding fact keys each discrepancy claim is based on in grounded_in.
- If the resume text contains sensitive personal attributes (a photo reference, date of birth, marital status, caste, religion, gender), flag each one with brief removal advice. Do not comment on or evaluate the person based on these attributes — flag their presence only.
- End with a prioritised list of at most 5 actions.
- Never fabricate an employer, credential, or experience not present in the resume text or grounding facts.`;
