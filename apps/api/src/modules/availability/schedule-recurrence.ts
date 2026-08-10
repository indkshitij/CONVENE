import { Temporal } from "@js-temporal/polyfill";

// PRD BR-AVAIL-09 / P10.3: "Schedules stored as a local-time recurrence
// plus an IANA timezone, never as a UTC offset." Every occurrence's UTC
// instant is recomputed fresh from (calendar date + local wall-clock time
// + IANA zone) via Temporal.ZonedDateTime, which resolves the correct
// offset for that *specific* date — never by adding a fixed millisecond
// duration to the previous occurrence, which is exactly the bug that
// would shift a 6pm Thursday window by an hour across a DST boundary.
export interface RecurrenceRule {
  freq: "WEEKLY";
  byDay: ("MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU")[];
  count?: number;
  until?: Date;
}

const DAY_CODE_TO_ISO_WEEKDAY: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

// A generous but finite safety bound — weekly recurrence with a 1-year
// `until` cap (packages/validation/src/availability.ts's own
// recurrenceSchema already enforces that) never needs more than ~370
// daily steps to enumerate.
const MAX_DAY_STEPS = 370 * 2;

export function materializeOccurrences(
  startAt: Date,
  timezone: string,
  rule: RecurrenceRule | null,
  maxOccurrences: number,
  now: Date = new Date(),
): Date[] {
  if (!rule) {
    // One-off: the single stored start_at instant, only while still upcoming.
    return startAt.getTime() >= now.getTime() ? [startAt] : [];
  }

  const startZoned = Temporal.Instant.fromEpochMilliseconds(startAt.getTime()).toZonedDateTimeISO(
    timezone,
  );
  const wallTime = Temporal.PlainTime.from({
    hour: startZoned.hour,
    minute: startZoned.minute,
    second: startZoned.second,
  });
  const startDate = startZoned.toPlainDate();
  const targetWeekdays = new Set(rule.byDay.map((d) => DAY_CODE_TO_ISO_WEEKDAY[d]));

  const occurrences: Date[] = [];
  let lifetimeCount = 0;

  for (let dayOffset = 0; dayOffset < MAX_DAY_STEPS; dayOffset++) {
    if (occurrences.length >= maxOccurrences) break;

    const candidateDate = startDate.add({ days: dayOffset });
    if (!targetWeekdays.has(candidateDate.dayOfWeek)) continue;

    // Re-resolving the UTC offset for *this* candidate date is what makes
    // the whole function DST-correct — the same wallTime can map to a
    // different UTC instant on either side of a transition.
    const candidateZoned = candidateDate.toZonedDateTime({
      timeZone: timezone,
      plainTime: wallTime,
    });
    const candidateInstant = candidateZoned.toInstant();
    const candidateDateJs = new Date(candidateInstant.epochMilliseconds);

    if (candidateDateJs.getTime() < startAt.getTime()) continue; // before the rule's own declared start

    lifetimeCount += 1;
    if (rule.count !== undefined && lifetimeCount > rule.count) break;
    if (rule.until && candidateDateJs.getTime() > rule.until.getTime()) break;

    if (candidateDateJs.getTime() >= now.getTime()) {
      occurrences.push(candidateDateJs);
    }
  }

  return occurrences;
}

// BR-AVAIL-17: "Timezone overlap: two users are compatible if their
// windows intersect by >= 15 min after timezone normalisation." Both
// windows are already concrete UTC instants (whatever produced them —
// materializeOccurrences above, or a one-off) — timezone-awareness lives
// entirely in *how* those instants were derived, not in this comparison,
// which is plain interval intersection.
export interface ScheduleWindow {
  start: Date;
  durationMinutes: number;
}

const OVERLAP_COMPATIBILITY_THRESHOLD_MINUTES = 15;

export function computeOverlapMinutes(a: ScheduleWindow, b: ScheduleWindow): number {
  const aEnd = a.start.getTime() + a.durationMinutes * 60_000;
  const bEnd = b.start.getTime() + b.durationMinutes * 60_000;
  const overlapStart = Math.max(a.start.getTime(), b.start.getTime());
  const overlapEnd = Math.min(aEnd, bEnd);
  return Math.max(0, overlapEnd - overlapStart) / 60_000;
}

export function isScheduleCompatible(a: ScheduleWindow, b: ScheduleWindow): boolean {
  return computeOverlapMinutes(a, b) >= OVERLAP_COMPATIBILITY_THRESHOLD_MINUTES;
}
