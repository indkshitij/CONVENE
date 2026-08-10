// PRD §21.3: "Retention is measured as classic and unbounded D1/D7/D30/D90
// cohorts, segmented by acquisition city, persona proxy (primary
// intent), verification level, and whether the user completed an
// availability session in week 1 — the last of which we expect to be
// the dominant retention predictor." This file computes both retention
// flavours and lets a caller segment by any of those four dimensions
// (or combinations) via a plain key function, rather than hard-coding
// one segmentation.
const DAY_MS = 24 * 60 * 60 * 1000;

function dayIndex(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

export interface RetentionCohortUser {
  userId: string;
  signupDate: Date;
}

export interface ActivityRecord {
  userId: string;
  activeDate: Date;
}

export interface RetentionResult {
  dayOffset: number;
  cohortSize: number;
  // "Classic": active on exactly signup_date + N.
  classicRetained: number;
  classicRate: number;
  // "Unbounded": active on signup_date + N *or any day after*.
  unboundedRetained: number;
  unboundedRate: number;
}

export function computeRetention(
  users: RetentionCohortUser[],
  activity: ActivityRecord[],
  dayOffsets: readonly number[] = [1, 7, 30, 90],
): RetentionResult[] {
  const activeDaysByUser = new Map<string, Set<number>>();
  for (const record of activity) {
    const set = activeDaysByUser.get(record.userId) ?? new Set<number>();
    set.add(dayIndex(record.activeDate));
    activeDaysByUser.set(record.userId, set);
  }

  const cohortSize = users.length;

  return dayOffsets.map((offset) => {
    let classicRetained = 0;
    let unboundedRetained = 0;

    for (const user of users) {
      const signupDay = dayIndex(user.signupDate);
      const activeDays = activeDaysByUser.get(user.userId);
      if (!activeDays) continue;

      if (activeDays.has(signupDay + offset)) classicRetained += 1;
      for (const activeDay of activeDays) {
        if (activeDay >= signupDay + offset) {
          unboundedRetained += 1;
          break;
        }
      }
    }

    return {
      dayOffset: offset,
      cohortSize,
      classicRetained,
      classicRate: cohortSize === 0 ? 0 : classicRetained / cohortSize,
      unboundedRetained,
      unboundedRate: cohortSize === 0 ? 0 : unboundedRetained / cohortSize,
    };
  });
}

// §21.3's four segmentation dimensions, as a single discriminated key a
// caller derives per user however it likes (a real caller reads these
// off the users/profiles/availability_sessions tables; fixtures just
// supply the string directly) — segmentation itself is just "partition
// the cohort by this key, then run computeRetention() per partition."
export type RetentionSegmentKey = string;

export function segmentRetentionCohort<T extends RetentionCohortUser>(
  users: T[],
  keyFn: (user: T) => RetentionSegmentKey,
): Map<RetentionSegmentKey, T[]> {
  const segments = new Map<RetentionSegmentKey, T[]>();
  for (const user of users) {
    const key = keyFn(user);
    const list = segments.get(key) ?? [];
    list.push(user);
    segments.set(key, list);
  }
  return segments;
}
