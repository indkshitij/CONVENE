import { userIntents, type AvailabilitySchedule } from "@convene/db";
import { availability as availabilityValidation } from "@convene/validation";
import { Injectable, Optional } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import type { z } from "zod";
import {
  BadRequestAppError,
  ConflictAppError,
  NotFoundAppError,
  PaymentRequiredAppError,
} from "../../common/errors/app-error";
import { type Clock, systemClock } from "../../common/clock";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { IntentsService } from "../intents/intents.service";
import {
  computeOverlapMinutes,
  materializeOccurrences,
  type RecurrenceRule,
} from "./schedule-recurrence";
import { SchedulesRepository } from "./repositories/schedules.repository";
import type { SessionIntentSummary } from "./availability.service";

export type CreateScheduleInput = z.infer<
  ReturnType<typeof availabilityValidation.createScheduleSchema>
>;
export type UpdateScheduleInput = z.infer<typeof availabilityValidation.updateScheduleSchema>;

export interface ScheduleResponse {
  id: string;
  start_at: string;
  duration_minutes: number;
  timezone: string;
  recurrence: { freq: "WEEKLY"; byday: string[]; count?: number; until?: string } | null;
  reminder_minutes_before: number | null;
  is_active: boolean;
  session_intents: SessionIntentSummary[];
}

export interface CreateScheduleResult {
  schedule: ScheduleResponse;
  next_occurrences: string[];
}

// exactOptionalPropertyTypes:true means an optional field must be either
// present-with-a-value or entirely absent — never explicitly `undefined`.
// Same helper/rationale as profile.service.ts's own copy.
function omitUndefined<T extends object>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result as T;
}

const MAX_ACTIVE_SCHEDULES = 20; // BR-AVAIL-09, all plans.
const FREE_PLAN_MAX_SCHEDULES = 3; // BR-AVAIL-09, free plan.
const OVERLAP_CHECK_HORIZON_COUNT = 8;
const NEXT_OCCURRENCES_PREVIEW_COUNT = 5;

// PRD §10.3.8 endpoint 22 (BR-AVAIL-09). The `rrule` column stores this
// module's own JSON encoding of RecurrenceRule, not an RFC 5545 RRULE
// string despite the column name (inherited from §10.3.9's own DDL) — no
// RRULE parser exists anywhere in this codebase, and re-deriving one for
// the single FREQ=WEEKLY+BYDAY subset packages/validation's
// recurrenceSchema already restricts this to would be pure overhead;
// flagged as a deliberate simplification.
export function serializeRecurrence(rule: RecurrenceRule): string {
  return JSON.stringify({
    freq: rule.freq,
    byDay: rule.byDay,
    count: rule.count,
    until: rule.until?.toISOString(),
  });
}

export function parseStoredRecurrence(raw: string | null): RecurrenceRule | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as {
    freq: "WEEKLY";
    byDay: RecurrenceRule["byDay"];
    count?: number;
    until?: string;
  };
  return omitUndefined<RecurrenceRule>({
    freq: parsed.freq,
    byDay: parsed.byDay,
    count: parsed.count,
    until: parsed.until ? new Date(parsed.until) : undefined,
  });
}

@Injectable()
export class SchedulesService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly schedulesRepository: SchedulesRepository,
    private readonly intentsService: IntentsService,
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  async createSchedule(
    userId: string,
    plan: string,
    input: CreateScheduleInput,
  ): Promise<CreateScheduleResult> {
    const now = this.clock.now();
    const isPremium = plan !== "free";

    const activeCount = await this.schedulesRepository.countActive(userId);
    if (!isPremium && activeCount >= FREE_PLAN_MAX_SCHEDULES) {
      throw new PaymentRequiredAppError(
        "PLAN_LIMIT_REACHED",
        "Upgrade to add more scheduled windows.",
      );
    }
    if (activeCount >= MAX_ACTIVE_SCHEDULES) {
      throw new ConflictAppError("CONFLICT", "You've reached the maximum of 20 active schedules.");
    }

    const activeIntents = await this.intentsService.listIntents(userId, false);
    const activeIntentIds = new Set(activeIntents.map((i) => i.id));
    for (const id of input.session_intent_ids ?? []) {
      if (!activeIntentIds.has(id)) {
        throw new BadRequestAppError("BAD_REQUEST", "That intent isn't active on your profile.", {
          field: "session_intent_ids",
        });
      }
    }

    const startAt = new Date(input.start_at);
    const rule: RecurrenceRule | null = input.recurrence
      ? omitUndefined<RecurrenceRule>({
          freq: "WEEKLY",
          byDay: input.recurrence.byday,
          count: input.recurrence.count,
          until: input.recurrence.until ? new Date(input.recurrence.until) : undefined,
        })
      : null;

    await this.assertNoOverlap(userId, startAt, input.duration_minutes, input.timezone, rule, now);

    const created = await this.schedulesRepository.create({
      userId,
      startAt,
      durationMinutes: input.duration_minutes,
      timezone: input.timezone,
      rrule: rule ? serializeRecurrence(rule) : null,
      untilAt: rule?.until ?? null,
      reminderMinutesBefore: input.reminder_minutes_before ?? 10,
      sessionIntentIds: input.session_intent_ids ?? null,
    });

    const nextOccurrences = materializeOccurrences(
      startAt,
      input.timezone,
      rule,
      NEXT_OCCURRENCES_PREVIEW_COUNT,
      now,
    );

    return {
      schedule: await this.toResponse(created),
      next_occurrences: nextOccurrences.map((d) => d.toISOString()),
    };
  }

  async updateSchedule(
    userId: string,
    scheduleId: string,
    patch: UpdateScheduleInput,
  ): Promise<ScheduleResponse> {
    const existing = await this.schedulesRepository.findById(scheduleId, userId);
    if (!existing)
      throw new NotFoundAppError("SCHEDULE_NOT_FOUND", "This schedule could not be found.");

    if (patch.session_intent_ids !== undefined) {
      const activeIntents = await this.intentsService.listIntents(userId, false);
      const activeIntentIds = new Set(activeIntents.map((i) => i.id));
      for (const id of patch.session_intent_ids) {
        if (!activeIntentIds.has(id)) {
          throw new BadRequestAppError("BAD_REQUEST", "That intent isn't active on your profile.", {
            field: "session_intent_ids",
          });
        }
      }
    }

    const updated = await this.schedulesRepository.update(
      scheduleId,
      userId,
      omitUndefined({
        startAt: patch.start_at !== undefined ? new Date(patch.start_at) : undefined,
        durationMinutes: patch.duration_minutes,
        reminderMinutesBefore: patch.reminder_minutes_before,
        sessionIntentIds: patch.session_intent_ids,
        isActive: patch.is_active,
      }),
    );
    if (!updated)
      throw new NotFoundAppError("SCHEDULE_NOT_FOUND", "This schedule could not be found.");

    return this.toResponse(updated);
  }

  async deleteSchedule(userId: string, scheduleId: string): Promise<void> {
    const deleted = await this.schedulesRepository.delete(scheduleId, userId);
    if (!deleted)
      throw new NotFoundAppError("SCHEDULE_NOT_FOUND", "This schedule could not be found.");
  }

  async listSchedules(
    userId: string,
    expandUntil: Date | null,
  ): Promise<{ schedules: ScheduleResponse[]; occurrences: Record<string, string[]> }> {
    const now = this.clock.now();
    const schedules = await this.schedulesRepository.listActive(userId);
    const responses = await Promise.all(schedules.map((s) => this.toResponse(s)));

    const occurrences: Record<string, string[]> = {};
    if (expandUntil) {
      for (const schedule of schedules) {
        const rule = parseStoredRecurrence(schedule.rrule);
        const materialized = materializeOccurrences(
          schedule.startAt,
          schedule.timezone,
          rule,
          500,
          now,
        ).filter((d) => d.getTime() <= expandUntil.getTime());
        occurrences[schedule.id] = materialized.map((d) => d.toISOString());
      }
    }

    return { schedules: responses, occurrences };
  }

  private async assertNoOverlap(
    userId: string,
    startAt: Date,
    durationMinutes: number,
    timezone: string,
    rule: RecurrenceRule | null,
    now: Date,
  ): Promise<void> {
    const newOccurrences = materializeOccurrences(
      startAt,
      timezone,
      rule,
      OVERLAP_CHECK_HORIZON_COUNT,
      startAt,
    );
    const existingSchedules = await this.schedulesRepository.listActive(userId);

    for (const existing of existingSchedules) {
      const existingRule = parseStoredRecurrence(existing.rrule);
      const existingOccurrences = materializeOccurrences(
        existing.startAt,
        existing.timezone,
        existingRule,
        OVERLAP_CHECK_HORIZON_COUNT,
        now,
      );

      for (const newOcc of newOccurrences) {
        for (const existOcc of existingOccurrences) {
          const overlap = computeOverlapMinutes(
            { start: newOcc, durationMinutes },
            { start: existOcc, durationMinutes: existing.durationMinutes },
          );
          if (overlap > 0) {
            throw new ConflictAppError("SCHEDULE_OVERLAP", "This overlaps an existing window.");
          }
        }
      }
    }
  }

  private async toResponse(schedule: AvailabilitySchedule): Promise<ScheduleResponse> {
    const rule = parseStoredRecurrence(schedule.rrule);
    const sessionIntents = await this.sessionIntentSummaries(schedule.sessionIntentIds ?? []);
    return {
      id: schedule.id,
      start_at: schedule.startAt.toISOString(),
      duration_minutes: schedule.durationMinutes,
      timezone: schedule.timezone,
      recurrence: rule
        ? omitUndefined<NonNullable<ScheduleResponse["recurrence"]>>({
            freq: rule.freq,
            byday: rule.byDay,
            count: rule.count,
            until: rule.until?.toISOString(),
          })
        : null,
      reminder_minutes_before: schedule.reminderMinutesBefore,
      is_active: schedule.isActive,
      session_intents: sessionIntents,
    };
  }

  private async sessionIntentSummaries(ids: string[]): Promise<SessionIntentSummary[]> {
    if (ids.length === 0) return [];
    return this.postgres.db
      .select({ id: userIntents.id, type: userIntents.type })
      .from(userIntents)
      .where(inArray(userIntents.id, ids));
  }
}
