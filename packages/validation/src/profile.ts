import { z } from "zod";
import {
  containsEmailOrPhone,
  countEmoji,
  countUrls,
  socialLinkUrlSchema,
  type SocialLinkProvider,
} from "./common";

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
