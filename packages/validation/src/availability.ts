import { z } from "zod";
import {
  DURATION_MINUTES_ERROR,
  containsEmailOrPhone,
  containsUrl,
  durationMinutesSchema,
} from "./common";

export { durationMinutesSchema, DURATION_MINUTES_ERROR };

// PRD §10.3.7 `note`: "≤ 120 chars, no URLs/emails/phone,
// moderation-checked." Moderation is an async classifier call, not a
// synchronous schema rule — enforced by the moderation service, not here.
export const AVAILABILITY_NOTE_ERROR = "Keep contact details out of your note";

export const availabilityNoteSchema = z
  .string()
  .max(120, AVAILABILITY_NOTE_ERROR)
  .refine((value) => !containsEmailOrPhone(value), AVAILABILITY_NOTE_ERROR)
  .refine((value) => !containsUrl(value), AVAILABILITY_NOTE_ERROR);

// PRD §10.3.7 `session_intent_ids[]`: "Must be a subset of the user's
// active intents; ≤ 5." Whether a given id is actually one of the caller's
// *active* intents requires the user's current intent records — a DB
// lookup, not a pure schema check. This validates only the structural
// part (an array of ids, max 5); the subset check is the intents service's
// job at request time.
export const SESSION_INTENT_IDS_ERROR = "That intent isn't active on your profile";

export const sessionIntentIdsSchema = z.array(z.string()).max(5, SESSION_INTENT_IDS_ERROR);

// PRD §10.3.7 `schedule.start_at`: "Future, ≤ 90 days ahead."
export const SCHEDULE_START_AT_ERROR = "Pick a time in the future";

export function scheduleStartAtSchema(now: Date = new Date()) {
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + 90);

  return z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), SCHEDULE_START_AT_ERROR)
    .refine((value) => new Date(value).getTime() > now.getTime(), SCHEDULE_START_AT_ERROR)
    .refine((value) => new Date(value).getTime() <= maxDate.getTime(), SCHEDULE_START_AT_ERROR);
}

// PRD §10.3.7 `schedule.duration_minutes`: "15–240." The table gives no
// distinct error string for this row (shown as "—"), so it reuses the
// general duration message from common.ts rather than inventing a new one.
export const scheduleDurationMinutesSchema = z
  .number()
  .int(DURATION_MINUTES_ERROR)
  .min(15, DURATION_MINUTES_ERROR)
  .max(240, DURATION_MINUTES_ERROR);

// PRD §10.3.7 `recurrence`: "RRULE subset: FREQ=WEEKLY, BYDAY, max
// COUNT/UNTIL 1 yr."
export const RECURRENCE_ERROR = "Unsupported recurrence";

const RRULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

export const recurrenceSchema = z
  .object({
    freq: z.literal("WEEKLY"),
    byday: z.array(z.enum(RRULE_DAYS)).min(1),
    count: z.number().int().positive().optional(),
    until: z.string().optional(),
  })
  .refine((rule) => rule.count === undefined || rule.count <= 52, RECURRENCE_ERROR)
  .refine((rule) => {
    if (rule.until === undefined) return true;
    const untilDate = new Date(rule.until);
    if (Number.isNaN(untilDate.getTime())) return false;
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    return untilDate.getTime() <= oneYearFromNow.getTime();
  }, RECURRENCE_ERROR);
