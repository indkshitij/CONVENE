import { profiles, users } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { eq } from "drizzle-orm";
import { type Clock, systemClock } from "../../common/clock";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { AVAILABILITY_CHANGED_EVENT } from "./availability-events";
import { parseStoredRecurrence } from "./schedules.service";
import { materializeOccurrences } from "./schedule-recurrence";
import {
  AvailabilityRepository,
  UniqueActiveSessionViolation,
} from "./repositories/availability.repository";
import { SchedulesRepository } from "./repositories/schedules.repository";

export const SCHEDULE_PENDING_CONFIRMATION_EVENT = "availability.schedule_pending_confirmation";

// How far apart generator ticks run — the "due" window checked each tick
// is exactly this wide, so ticking no less often than this is required to
// never miss an occurrence (documented tradeoff: unlike P10.2's session
// expiry, no independent second mechanism backs this one — BR-AVAIL-09/10
// don't carry the same "client killed mid-session" durability requirement
// BR-AVAIL-02 does).
export const GENERATOR_TICK_MS = 60_000;
const DORMANT_THRESHOLD_MS = 72 * 60 * 60 * 1000; // BR-AVAIL-10.

export interface GenerateDueSessionsResult {
  created: number;
  skippedDormant: number;
}

// PRD BR-AVAIL-10: "A scheduled window auto-transitions to Available Now
// at its start only if the user has been active in the last 72h;
// otherwise it becomes pending_confirmation." No `pending_confirmation`
// value exists in the availability_state enum (§10.3.9's own DDL never
// defines one) — modelled here as simply *not* creating a session and
// emitting an event for the not-yet-built notification system to consume
// ("a push asks 'go available?'"), rather than inventing a DB state
// nothing else reads. Flagged as a documented gap, not silently guessed.
@Injectable()
export class ScheduleGeneratorService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly schedulesRepository: SchedulesRepository,
    private readonly availabilityRepository: AvailabilityRepository,
    @Optional() private readonly clock: Clock = systemClock,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async generateDueSessions(): Promise<GenerateDueSessionsResult> {
    const now = this.clock.now();
    const windowStart = new Date(now.getTime() - GENERATOR_TICK_MS);
    const schedules = await this.schedulesRepository.listAllActive();

    let created = 0;
    let skippedDormant = 0;

    for (const schedule of schedules) {
      const rule = parseStoredRecurrence(schedule.rrule);
      const [next] = materializeOccurrences(
        schedule.startAt,
        schedule.timezone,
        rule,
        1,
        windowStart,
      );
      if (!next || next.getTime() > now.getTime()) continue; // not due this tick

      const [user] = await this.postgres.db
        .select({ lastActiveAt: users.lastActiveAt })
        .from(users)
        .where(eq(users.id, schedule.userId))
        .limit(1);
      const recentlyActive =
        !!user?.lastActiveAt && now.getTime() - user.lastActiveAt.getTime() <= DORMANT_THRESHOLD_MS;

      if (!recentlyActive) {
        this.events?.emit(SCHEDULE_PENDING_CONFIRMATION_EVENT, {
          userId: schedule.userId,
          scheduleId: schedule.id,
        });
        skippedDormant += 1;
        continue;
      }

      const [profile] = await this.postgres.db
        .select({ geohash5: profiles.geohash5, cityId: profiles.cityId })
        .from(profiles)
        .where(eq(profiles.userId, schedule.userId))
        .limit(1);

      const expiresAt = new Date(next.getTime() + schedule.durationMinutes * 60_000);
      try {
        await this.availabilityRepository.createSession({
          userId: schedule.userId,
          state: "available_now",
          durationMinutes: schedule.durationMinutes,
          expiresAt,
          note: null,
          source: "schedule",
          intentIds: schedule.sessionIntentIds ?? [],
          geohash5: profile?.geohash5 ?? null,
          cityId: profile?.cityId ?? null,
          now,
        });
      } catch (error) {
        // BR-AVAIL-03's own race guard — if the user's own action already
        // holds the active-session slot this exact instant, skip this
        // occurrence rather than fail the whole tick for every other
        // schedule; the next tick (or the user's own next state change)
        // resolves it.
        if (error instanceof UniqueActiveSessionViolation) continue;
        throw error;
      }

      this.events?.emit(AVAILABILITY_CHANGED_EVENT, {
        userId: schedule.userId,
        state: "available_now",
        expiresAt,
      });
      created += 1;
    }

    return { created, skippedDormant };
  }
}
