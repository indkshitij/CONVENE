import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

// PRD §10.1.5: "password ... 10–128 chars; ≥ 1 letter, ≥ 1 number; not in
// top-100k breached list (k-anonymity check against HIBP range API); not
// similar to email/name." The breach check and the email/name-similarity
// check both require live network access (a k-anonymity range lookup) and
// registration context (the email/name being registered against) — neither
// is a pure, synchronous, client-safe rule, so neither belongs in a schema
// shared with React Hook Form. This schema enforces only the structural
// part; the auth service (P5.1/5.2) composes the breach/similarity checks
// server-side on top of it.
export const PASSWORD_ERROR = "Password must be at least 10 characters with a letter and a number";
export const PASSWORD_BREACHED_ERROR = "This password has appeared in a data breach";

export const passwordSchema = z
  .string()
  .min(10, PASSWORD_ERROR)
  .max(128, PASSWORD_ERROR)
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), PASSWORD_ERROR);

// PRD §10.1.5: "phone: E.164, valid for country, mobile line type."
// libphonenumber-js/max (full metadata, needed for accurate line-type
// detection — the /min bundle can't reliably distinguish mobile from
// fixed-line for many regions).
export const PHONE_ERROR = "Enter a valid mobile number";

const ACCEPTABLE_MOBILE_TYPES = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE"]);

export const phoneE164Schema = z.string().refine((value) => {
  const parsed = parsePhoneNumberFromString(value);
  if (!parsed || !parsed.isValid()) return false;
  const type = parsed.getType();
  return type !== undefined && ACCEPTABLE_MOBILE_TYPES.has(type);
}, PHONE_ERROR);

// PRD §10.1.5: "otp: Exactly 6 digits, numeric."
export const OTP_ERROR = "Enter the 6-digit code";
export const otpSchema = z.string().regex(/^\d{6}$/, OTP_ERROR);

// PRD §10.1.5: "dob: Valid date, age ≥ 18 and ≤ 100." The table gives a
// single error message covering the whole rule (both bounds), so both ends
// of the range use it rather than inventing a second string.
export const DOB_ERROR = "You must be 18 or older to use Convene";

function ageInYears(dob: Date, now: Date): number {
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

export function dobAdultSchema(now: Date = new Date()) {
  return z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), DOB_ERROR)
    .refine((value) => {
      const age = ageInYears(new Date(value), now);
      return age >= 18 && age <= 100;
    }, DOB_ERROR);
}

// PRD §10.2.2 `timezone`: "IANA string ... valid tz." Validated via
// Intl.DateTimeFormat's own rejection of unknown zone identifiers rather
// than Intl.supportedValuesOf (not available in every browser target this
// package's client consumer — React Hook Form — may run in).
export const TIMEZONE_ERROR = "Enter a valid timezone";

export const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, TIMEZONE_ERROR);

// PRD §10.5.2/§10.5.7: coordinates are geography(Point,4326) — standard
// WGS84 bounds. Never stored/echoed beyond this package's own validation;
// serialisation rules live in apps/api/src/common/serialization.
export const LATITUDE_ERROR = "Enter a valid latitude";
export const LONGITUDE_ERROR = "Enter a valid longitude";

export const latitudeSchema = z.number().min(-90, LATITUDE_ERROR).max(90, LATITUDE_ERROR);
export const longitudeSchema = z.number().min(-180, LONGITUDE_ERROR).max(180, LONGITUDE_ERROR);

// PRD §10.3.5 BR-AVAIL-01: "Options: 15, 30, 60, 120 min; custom up to 240
// min (Premium)." A stateless schema can't know the caller's plan, so this
// is a factory: pass isPremium to get the right bound. Both variants share
// the §10.3.7 error message verbatim.
export const DURATION_MINUTES_ERROR = "Choose a duration between 15 and 240 minutes";

const STANDARD_DURATION_OPTIONS = [15, 30, 60, 120] as const;

export function durationMinutesSchema(isPremium: boolean) {
  const base = z.number().int(DURATION_MINUTES_ERROR);
  if (isPremium) {
    return base.min(1, DURATION_MINUTES_ERROR).max(240, DURATION_MINUTES_ERROR);
  }
  return base.refine(
    (value): value is (typeof STANDARD_DURATION_OPTIONS)[number] =>
      (STANDARD_DURATION_OPTIONS as readonly number[]).includes(value),
    DURATION_MINUTES_ERROR,
  );
}

// PRD §10.2.7 `social_links.*`: "https, host must match the expected
// provider domain" (LinkedIn given as the worked example). The PRD states
// "7 known keys" for social_links (§10.2.2) without enumerating them —
// this is the one place that list has to be invented rather than
// transcribed. Chosen as a defensible set for a professional-networking
// product; flagged here (and in the PR description) as an assumption, not
// a transcription.
export const SOCIAL_LINK_PROVIDERS = {
  linkedin: { hosts: ["linkedin.com", "www.linkedin.com"], label: "LinkedIn" },
  github: { hosts: ["github.com", "www.github.com"], label: "GitHub" },
  twitter: { hosts: ["twitter.com", "www.twitter.com", "x.com", "www.x.com"], label: "Twitter/X" },
  instagram: { hosts: ["instagram.com", "www.instagram.com"], label: "Instagram" },
  behance: { hosts: ["behance.net", "www.behance.net"], label: "Behance" },
  dribbble: { hosts: ["dribbble.com", "www.dribbble.com"], label: "Dribbble" },
  personal_website: { hosts: null, label: "personal website" },
} as const;

export type SocialLinkProvider = keyof typeof SOCIAL_LINK_PROVIDERS;

export function socialLinkUrlSchema(provider: SocialLinkProvider) {
  const { hosts, label } = SOCIAL_LINK_PROVIDERS[provider];
  const message = `That doesn't look like a ${label} URL`;
  return z.string().refine((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:") return false;
    if (hosts === null) return true;
    return (hosts as readonly string[]).includes(parsed.hostname.toLowerCase());
  }, message);
}

// Contact-info/URL/emoji detection, reused by every "no contact details"
// or "limited URLs"/"limited emoji" rule across the PRD — §10.1.5
// (full_name), §10.2.7 (headline, about), §10.3.7 (availability note),
// §10.4.5 (intent detail), §10.6.5 (connection note). Each domain keeps
// its own exact error string per its own table; only the detection logic
// is shared. The PRD states the *behaviour* ("no contact info", "URLs
// allowed max 3") without specifying the detection algorithm, so these are
// documented heuristics, not a transcription of a PRD-given regex.
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_LIKE = /(\+?\d[\d\-.\s]{6,}\d)/;
const URL_PATTERN = /https?:\/\/\S+|www\.\S+/gi;
// Single-codepoint emoji ranges (misc symbols, transport, supplemental
// symbols/pictographs, dingbats) — not exhaustive of every Unicode emoji
// sequence (flags/ZWJ sequences), but covers the overwhelming majority of
// realistic input.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export function containsEmailOrPhone(value: string): boolean {
  return EMAIL_LIKE.test(value) || PHONE_LIKE.test(value);
}

export function containsUrl(value: string): boolean {
  return new RegExp(URL_PATTERN).test(value);
}

export function countUrls(value: string): number {
  return value.match(URL_PATTERN)?.length ?? 0;
}

export function countEmoji(value: string): number {
  return value.match(EMOJI_PATTERN)?.length ?? 0;
}
