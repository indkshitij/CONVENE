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

// PRD §10.3.8 `POST /availability/sessions`. `state` is restricted to the
// four states a user can directly activate (§10.3.3's diagram) —
// 'offline' is only ever reached by expiry/ending, never declared, and
// 'scheduled' is only ever system-created by the scheduler (P10.3), never
// posted directly here.
export const ACTIVATABLE_STATES = ["available_now", "busy", "away", "invisible"] as const;
export const activatableStateSchema = z.enum(ACTIVATABLE_STATES);

export const DURATION_REQUIRED_FOR_AVAILABLE_NOW_ERROR = "Available Now requires a duration";

// BR-AVAIL-01: "Available Now must carry a duration" — the DB schema
// itself makes duration_minutes nullable specifically because busy/away/
// invisible don't need one (§10.3.9's own comment: "NULL for
// busy/invisible/offline"), so the requiredness is conditional on state,
// not a plain required field — hence a factory like duration/radius
// schemas elsewhere in this package.
export function createSessionSchema(isPremium: boolean) {
  return z
    .object({
      state: activatableStateSchema,
      duration_minutes: durationMinutesSchema(isPremium).optional(),
      note: availabilityNoteSchema.optional(),
      session_intent_ids: sessionIntentIdsSchema.optional(),
      source: z.string().optional(),
    })
    .strict()
    .refine((body) => body.state !== "available_now" || body.duration_minutes !== undefined, {
      message: DURATION_REQUIRED_FOR_AVAILABLE_NOW_ERROR,
      path: ["duration_minutes"],
    });
}

// PRD §10.3.3: "extend(+15/30/60 min)."
export const ADDITIONAL_MINUTES_ERROR = "Choose 15, 30 or 60 minutes";
const ADDITIONAL_MINUTES_OPTIONS = [15, 30, 60] as const;

export const extendSessionSchema = z
  .object({
    additional_minutes: z
      .number()
      .int(ADDITIONAL_MINUTES_ERROR)
      .refine(
        (value): value is (typeof ADDITIONAL_MINUTES_OPTIONS)[number] =>
          (ADDITIONAL_MINUTES_OPTIONS as readonly number[]).includes(value),
        ADDITIONAL_MINUTES_ERROR,
      ),
  })
  .strict();

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

// PRD §10.3.8: `POST /availability/schedules`. §10.3.7's own two rows
// (schedule.start_at, schedule.duration_minutes) plus recurrenceSchema
// above, wrapped into the create-request shape. `timezone` isn't listed
// in §10.3.7's validation table but is required by §10.3.9's own DDL
// (`timezone TEXT NOT NULL`) and is exactly what makes DST-correct
// materialization possible (P10.3) — included here as a required field
// since the contract's own JSON example doesn't show it, an omission
// flagged rather than silently worked around.
export function createScheduleSchema(now: Date = new Date()) {
  return z
    .object({
      start_at: scheduleStartAtSchema(now),
      duration_minutes: scheduleDurationMinutesSchema,
      timezone: z.string().min(1),
      recurrence: recurrenceSchema.nullable().optional(),
      session_intent_ids: sessionIntentIdsSchema.optional(),
      reminder_minutes_before: z.number().int().min(0).max(120).optional(),
    })
    .strict();
}

export const updateScheduleSchema = z
  .object({
    start_at: z.string().optional(),
    duration_minutes: scheduleDurationMinutesSchema.optional(),
    session_intent_ids: sessionIntentIdsSchema.optional(),
    reminder_minutes_before: z.number().int().min(0).max(120).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();
