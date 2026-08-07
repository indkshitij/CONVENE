import { z } from "zod";
import {
  DOB_ERROR,
  containsUrl,
  countEmoji,
  dobAdultSchema,
  otpSchema,
  passwordSchema,
  phoneE164Schema,
} from "./common";

// PRD §10.1.5 `email`: "RFC 5322, ≤ 254 chars, lowercased, MX-checked
// async, disposable-domain blocklist." The MX check is explicitly async
// (a DNS lookup) and doesn't belong in a schema shared with React Hook
// Form — enforced server-side by the auth service (P5.2).
//
// The PRD names "a disposable-domain blocklist" without enumerating it.
// This starter list is an assumption, not a transcription — flagged here
// and in the PR description. It's exported so the auth service can extend
// or replace it from a managed list without touching this schema's shape.
export const EMAIL_FORMAT_ERROR = "Enter a valid email address";
export const EMAIL_DISPOSABLE_ERROR = "This email provider isn't supported";

export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "yopmail.com",
  "trashmail.com",
]);

export const emailSchema = z
  .string()
  .max(254, EMAIL_FORMAT_ERROR)
  .email(EMAIL_FORMAT_ERROR)
  .transform((value) => value.toLowerCase())
  .refine((value) => {
    const domain = value.split("@")[1];
    return domain === undefined || !DISPOSABLE_EMAIL_DOMAINS.has(domain);
  }, EMAIL_DISPOSABLE_ERROR);

// PRD §10.1.5 `full_name`: "2–80 chars, Unicode letters/space/hyphen/
// apostrophe/period; no URLs, emoji, or ≥3 consecutive identical chars."
export const FULL_NAME_ERROR = "Enter your real name";

const FULL_NAME_ALLOWED_CHARS = /^[\p{L}\p{M}\s'.-]+$/u;
const THREE_CONSECUTIVE_IDENTICAL = /(.)\1{2,}/u;

export const fullNameSchema = z
  .string()
  .min(2, FULL_NAME_ERROR)
  .max(80, FULL_NAME_ERROR)
  .refine((value) => FULL_NAME_ALLOWED_CHARS.test(value), FULL_NAME_ERROR)
  .refine((value) => !containsUrl(value), FULL_NAME_ERROR)
  .refine((value) => countEmoji(value) === 0, FULL_NAME_ERROR)
  .refine((value) => !THREE_CONSECUTIVE_IDENTICAL.test(value), FULL_NAME_ERROR);

export { DOB_ERROR };
export const dobSchema = dobAdultSchema();

export { otpSchema, passwordSchema, phoneE164Schema as phoneSchema };

// PRD §10.1.7 registration contract. `method`, `device`, and `attribution`
// carry no stated validation rule in §10.1.5 and are deliberately left
// unconstrained here rather than inventing one.
export const registerSchema = z.object({
  method: z.enum(["email", "phone", "google", "linkedin", "apple"]),
  email: emailSchema.optional(),
  phone: phoneE164Schema.optional(),
  password: passwordSchema.optional(),
  full_name: fullNameSchema,
  date_of_birth: dobAdultSchema(),
  accepted_terms_version: z.string(),
  device: z
    .object({ platform: z.string(), fingerprint: z.string(), push_token: z.string().nullable() })
    .optional(),
  attribution: z.record(z.string(), z.string()).optional(),
});

export const otpSendSchema = z.object({
  identifier: z.union([emailSchema, phoneE164Schema]),
});

export const otpVerifySchema = z.object({
  identifier: z.union([emailSchema, phoneE164Schema]),
  otp: otpSchema,
});

export const loginSchema = z.object({
  email: emailSchema.optional(),
  phone: phoneE164Schema.optional(),
  password: z.string(),
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const passwordResetSchema = z.object({
  token: z.string(),
  password: passwordSchema,
});

// PRD §10.1.7 endpoint 8 (password/change) — authenticated, so no email/
// phone identifier is carried in the body; the caller is resolved from
// the access token.
export const passwordChangeSchema = z.object({
  current_password: z.string(),
  new_password: passwordSchema,
});

// PRD §10.1.7 endpoint 10 / P5.5: Google/LinkedIn OAuth. `start` and
// `confirmLink` aren't in the PRD's literal endpoint list — PKCE/state
// validation need an origination step, and "explicit confirmation, never
// silent" (§13 F1) needs a way to submit that confirmation — both
// additions are flagged in the auth service that uses these schemas.
export const oauthProviderSchema = z.enum(["google", "linkedin"]);

export const oauthStartSchema = z.object({
  redirect_uri: z.string().url(),
});

export const oauthCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
  accepted_terms_version: z.string(),
});

export const oauthConfirmLinkSchema = z.object({
  link_token: z.string(),
  password: z.string(),
});
