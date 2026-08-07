// PRD BR-PROF-03: "years_experience auto-derives from non-overlapping
// experience date ranges." §10.2.12 edge case #1 clarifies the algorithm:
// "Overlapping experience ranges — union of intervals used for
// years_experience; overlaps allowed." So overlaps are never rejected —
// they're merged so the overlapping time isn't double-counted.
export interface ExperienceInterval {
  startDate: string;
  /** null means ongoing (is_current) — treated as running through `now`. */
  endDate: string | null;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export function computeYearsExperience(
  intervals: readonly ExperienceInterval[],
  now: Date = new Date(),
): number {
  if (intervals.length === 0) return 0;

  const ranges = intervals
    .map((iv) => ({
      start: new Date(iv.startDate).getTime(),
      end: iv.endDate ? new Date(iv.endDate).getTime() : now.getTime(),
    }))
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const totalMs = merged.reduce((sum, range) => sum + (range.end - range.start), 0);
  const years = totalMs / MS_PER_YEAR;
  // numeric(4,1) — one decimal place, never negative.
  return Math.max(0, Math.round(years * 10) / 10);
}

// BR-PROF-03: "Manual override is allowed but flagged if it exceeds the
// derived value by > 3 years (fake-profile signal)." No persistence
// mechanism exists yet for a "flagged" state (that's Trust & Safety's,
// Phase 18) — this only computes the boolean; the caller surfaces it as a
// non-fatal response warning.
export function isOverrideSuspicious(derivedYears: number, overrideYears: number): boolean {
  return overrideYears - derivedYears > 3;
}
