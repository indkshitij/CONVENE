import { z } from "zod";
import {
  containsEmailOrPhone,
  countEmoji,
  countUrls,
  socialLinkUrlSchema,
  timezoneSchema,
  type SocialLinkProvider,
} from "./common";
import { emailSchema, fullNameSchema } from "./auth";

// PRD §10.2.7 `headline`: "10–120 chars; no email/phone/URL; ≤ 2 emoji;
// not all-caps."
export const HEADLINE_ERROR = "Headlines can't contain contact details";

function isAllCaps(value: string): boolean {
  const letters = value.replace(/[^\p{L}]/gu, "");
  return (
    letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
  );
}

export const headlineSchema = z
  .string()
  .min(10, HEADLINE_ERROR)
  .max(120, HEADLINE_ERROR)
  .refine((value) => !containsEmailOrPhone(value), HEADLINE_ERROR)
  .refine((value) => countUrls(value) === 0, HEADLINE_ERROR)
  .refine((value) => countEmoji(value) <= 2, HEADLINE_ERROR)
  .refine((value) => !isAllCaps(value), HEADLINE_ERROR);

// PRD §10.2.7 `about`: "≤ 2,000; no phone/email (anti-circumvention); URLs
// allowed max 3."
export const ABOUT_ERROR = "Please keep contact details out of your About section";

export const aboutSchema = z
  .string()
  .max(2000, ABOUT_ERROR)
  .refine((value) => !containsEmailOrPhone(value), ABOUT_ERROR)
  .refine((value) => countUrls(value) <= 3, ABOUT_ERROR);

// PRD §10.2.7 `skill`: "2–50 chars; deduplicated case-insensitively; max
// 30." The table gives one error message for the whole row.
export const SKILL_ERROR = "You've reached the 30-skill limit";

export const skillSchema = z.string().min(2, SKILL_ERROR).max(50, SKILL_ERROR);

export const skillsListSchema = z
  .array(skillSchema)
  .max(30, SKILL_ERROR)
  .refine((skills) => {
    const seen = new Set(skills.map((skill) => skill.toLowerCase()));
    return seen.size === skills.length;
  }, SKILL_ERROR);

// PRD §10.2.7 `experience.start_date` / `experience.end_date`. The DOB+14yr
// floor needs the user's DOB, so start_date is a factory; end_date/
// is_current is a cross-field rule expressed with superRefine on the
// whole experience entry.
export const EXPERIENCE_START_DATE_ERROR = "Start date looks incorrect";
export const EXPERIENCE_END_DATE_ERROR = "End date must be after the start date";

export function experienceStartDateSchema(dob: Date, now: Date = new Date()) {
  const floor = new Date(dob);
  floor.setFullYear(floor.getFullYear() + 14);

  return z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), EXPERIENCE_START_DATE_ERROR)
    .refine((value) => new Date(value).getTime() <= now.getTime(), EXPERIENCE_START_DATE_ERROR)
    .refine((value) => new Date(value).getTime() >= floor.getTime(), EXPERIENCE_START_DATE_ERROR);
}

export function experienceEntrySchema(dob: Date, now: Date = new Date()) {
  return z
    .object({
      start_date: experienceStartDateSchema(dob, now),
      end_date: z.string().nullable(),
      is_current: z.boolean(),
    })
    .superRefine((entry, ctx) => {
      if (entry.is_current && entry.end_date !== null) {
        ctx.addIssue({ code: "custom", path: ["end_date"], message: EXPERIENCE_END_DATE_ERROR });
        return;
      }
      if (!entry.is_current && entry.end_date === null) {
        ctx.addIssue({ code: "custom", path: ["end_date"], message: EXPERIENCE_END_DATE_ERROR });
        return;
      }
      if (
        entry.end_date !== null &&
        new Date(entry.end_date).getTime() <= new Date(entry.start_date).getTime()
      ) {
        ctx.addIssue({ code: "custom", path: ["end_date"], message: EXPERIENCE_END_DATE_ERROR });
      }
    });
}

// PRD §10.2.9 endpoint 15 (POST/PATCH .../experience). Create requires
// every field the DB does; update makes them all optional — a partial
// PATCH validates the shape of whatever fields ARE present, and the
// cross-field date/is_current consistency check (experienceEntrySchema's
// superRefine, above) runs in the service against the *merged* row, since
// a partial update might not even touch a date field.
export const employmentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "self_employed",
  "student",
  "unemployed",
  "founder",
]);

export function experienceCreateSchema(dob: Date, now: Date = new Date()) {
  return z
    .object({
      company_name: z.string().min(1).max(100),
      title: z.string().min(1).max(100),
      employment_type: employmentTypeSchema.optional(),
      location_text: z.string().max(120).optional(),
      description: z.string().max(1200).optional(),
    })
    .and(experienceEntrySchema(dob, now));
}

export const experienceUpdateSchema = z
  .object({
    company_name: z.string().min(1).max(100).optional(),
    title: z.string().min(1).max(100).optional(),
    employment_type: employmentTypeSchema.nullable().optional(),
    location_text: z.string().max(120).nullable().optional(),
    description: z.string().max(1200).nullable().optional(),
    start_date: z.string().optional(),
    end_date: z.string().nullable().optional(),
    is_current: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
  })
  .strict();

export const educationCreateSchema = z
  .object({
    school: z.string().min(1).max(150),
    degree: z.string().max(100).optional(),
    field_of_study: z.string().max(100).optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    description: z.string().max(500).optional(),
  })
  .strict();

export const educationUpdateSchema = educationCreateSchema.partial().extend({
  position: z.number().int().min(0).optional(),
});

export const CREDENTIAL_URL_ERROR = "That credential URL doesn't look right";

export const certificationCreateSchema = z
  .object({
    name: z.string().min(1).max(150),
    issuer: z.string().min(1).max(150),
    issued_at: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    credential_url: z
      .string()
      .refine((value) => value.startsWith("https://"), CREDENTIAL_URL_ERROR)
      .nullable()
      .optional(),
  })
  .strict();

export const certificationUpdateSchema = certificationCreateSchema.partial().extend({
  position: z.number().int().min(0).optional(),
});

// PRD §10.2.2 `interests[]`: "≤ 15." No dedicated validation row exists in
// §10.2.7 the way skills/headline/about do — the limit itself is the only
// stated rule.
export const INTERESTS_ERROR = "You've reached the 15-interest limit";

export const interestsListSchema = z
  .array(z.string().min(2).max(50))
  .max(15, INTERESTS_ERROR)
  .refine(
    (values) => new Set(values.map((v) => v.toLowerCase())).size === values.length,
    INTERESTS_ERROR,
  );

// PRD §10.2.2 `languages[]`: "≤ 8." Proficiency values match the DB's own
// CHECK constraint (migrations/0001_profile_geo.sql's user_languages
// table) — "basic"/"conversational"/"fluent"/"native" — not
// packages/matching's independently-built "professional" vocabulary (see
// profile.service.ts's own note reconciling the two).
export const LANGUAGES_ERROR = "You've reached the 8-language limit";

export const languageProficiencySchema = z.enum(["basic", "conversational", "fluent", "native"]);

export const languagesListSchema = z
  .array(z.object({ code: z.string().length(2), proficiency: languageProficiencySchema }))
  .max(8, LANGUAGES_ERROR)
  .refine(
    (values) => new Set(values.map((v) => v.code.toLowerCase())).size === values.length,
    LANGUAGES_ERROR,
  );

// PRD §10.2.9: `PUT /profiles/me/skills — full replace:
// {skills:[{name,proficiency,years}]}`. Mirrors skillsListSchema's own
// limits (≤30, deduplicated case-insensitively) but over the `.name` of
// each entry object rather than raw strings, since this endpoint's body
// carries proficiency/years alongside the name.
export const skillEntrySchema = z.object({
  name: skillSchema,
  proficiency: z.enum(["beginner", "intermediate", "advanced", "expert"]).nullable().optional(),
  years: z.number().min(0).max(60).nullable().optional(),
});

export const skillEntryListSchema = z
  .array(skillEntrySchema)
  .max(30, SKILL_ERROR)
  .refine(
    (entries) => new Set(entries.map((e) => e.name.toLowerCase())).size === entries.length,
    SKILL_ERROR,
  );

export const skillsReplaceSchema = z.object({ skills: skillEntryListSchema });

// PRD §10.2.7 `portfolio.url`: "https only; not a known malware host; HEAD
// returns < 400." The malware-host check (a dynamic, externally-maintained
// list) and the HEAD-reachability check are both async, external calls —
// out of scope for a synchronous schema; enforced by the media/link
// pipeline (§17.7), not here. This schema enforces only the https-only
// structural part.
export const PORTFOLIO_URL_ERROR = "We couldn't reach that link";

export const portfolioUrlSchema = z.string().refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, PORTFOLIO_URL_ERROR);

// PRD §10.2.9 endpoint 15 (POST/PATCH .../portfolio).
export const portfolioItemCreateSchema = z
  .object({
    title: z.string().min(1).max(150),
    url: portfolioUrlSchema,
    description: z.string().max(500).optional(),
  })
  .strict();

export const portfolioItemUpdateSchema = z
  .object({
    title: z.string().min(1).max(150).optional(),
    url: portfolioUrlSchema.optional(),
    description: z.string().max(500).nullable().optional(),
    position: z.number().int().min(0).optional(),
  })
  .strict();

// PRD §10.2.2: social_links has "7 known keys" (enumerated as an
// assumption in common.ts's SOCIAL_LINK_PROVIDERS).
export const socialLinksSchema = z.object({
  linkedin: socialLinkUrlSchema("linkedin").optional(),
  github: socialLinkUrlSchema("github").optional(),
  twitter: socialLinkUrlSchema("twitter").optional(),
  instagram: socialLinkUrlSchema("instagram").optional(),
  behance: socialLinkUrlSchema("behance").optional(),
  dribbble: socialLinkUrlSchema("dribbble").optional(),
  personal_website: socialLinkUrlSchema("personal_website").optional(),
} satisfies Record<SocialLinkProvider, unknown>);

// PRD §10.2.7 `avatar`: "jpeg/png/webp/heic; ≤ 5 MB; ≥ 200×200; single
// detected face recommended (not enforced)." Face detection is explicitly
// not enforced by the PRD's own wording, so it's not modelled. Operates on
// upload metadata (the actual bytes are validated by the media pipeline,
// §17.7), not raw file content.
export const AVATAR_ERROR = "Use an image at least 200×200 pixels";

const AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export const avatarMetadataSchema = z
  .object({
    mimeType: z.string(),
    sizeBytes: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .refine((meta) => AVATAR_MIME_TYPES.has(meta.mimeType), AVATAR_ERROR)
  .refine((meta) => meta.sizeBytes <= AVATAR_MAX_BYTES, AVATAR_ERROR)
  .refine((meta) => meta.width >= 200 && meta.height >= 200, AVATAR_ERROR);

// PRD §10.2.7 `resume`: "pdf/docx; ≤ 10 MB; ≤ 15 pages; text-extractable
// (warn if scanned)." Page count and text-extractability are only knowable
// after processing the file (async, §17.7) — out of scope for a
// synchronous schema. This validates only mime type and size.
export const RESUME_ERROR = "We couldn't read text from this file";

const RESUME_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const RESUME_MAX_BYTES = 10 * 1024 * 1024;

export const resumeMetadataSchema = z
  .object({ mimeType: z.string(), sizeBytes: z.number() })
  .refine((meta) => RESUME_MIME_TYPES.has(meta.mimeType), RESUME_ERROR)
  .refine((meta) => meta.sizeBytes <= RESUME_MAX_BYTES, RESUME_ERROR);

// PRD §10.2.9: `PATCH /profiles/me — partial update, optimistic
// concurrency via If-Match`. Only the scalar profile fields this endpoint
// owns — skills/interests/languages/experience/education/certifications/
// portfolio each have their own dedicated endpoint (§10.2.9's own contract
// list) and are P7.2's scope, not this one's. `full_name` lives on `users`,
// not `profiles`, but is included here since it's part of the same PATCH
// body per the contract's single `PATCH /profiles/me` shape; BR-PROF-07's
// 2-per-90-days limit is enforced by the service, not this schema.
export const profileUpdateSchema = z
  .object({
    full_name: fullNameSchema.optional(),
    headline: headlineSchema.optional(),
    about: aboutSchema.nullable().optional(),
    industry_id: z.number().int().optional(),
    job_title: z.string().min(2).max(100).optional(),
    company_name: z.string().max(100).nullable().optional(),
    employment_type: z
      .enum([
        "full_time",
        "part_time",
        "contract",
        "freelance",
        "self_employed",
        "student",
        "unemployed",
        "founder",
      ])
      .nullable()
      .optional(),
    years_experience: z.number().min(0).max(60).optional(),
    years_experience_override: z.boolean().optional(),
    timezone: timezoneSchema.optional(),
    remote_preference: z.enum(["onsite", "hybrid", "remote", "any"]).optional(),
    open_to_relocate: z.boolean().optional(),
    social_links: socialLinksSchema.optional(),
  })
  .strict();

// PRD §10.2.5 L3 / §10.2.9 (POST /verification/work-email,
// /verification/work-email/confirm).
export const workEmailSendSchema = z.object({ target: emailSchema }).strict();

export const WORK_EMAIL_CODE_ERROR = "Enter the 6-digit code";
export const workEmailConfirmSchema = z
  .object({ code: z.string().regex(/^\d{6}$/, WORK_EMAIL_CODE_ERROR) })
  .strict();

// PRD §10.2.5 L4 / §20.4: "only the provider's verification reference and
// result" — this schema's own shape is the enforcement mechanism for that
// constraint: there is no field here a document or its data could occupy.
export const governmentIdSubmissionSchema = z
  .object({
    provider: z.string().min(1).max(100),
    provider_reference: z.string().min(1).max(200),
    result: z.enum(["pending", "approved", "rejected"]),
  })
  .strict();
