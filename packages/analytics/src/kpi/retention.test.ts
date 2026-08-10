import { describe, expect, it } from "vitest";
import {
  computeRetention,
  segmentRetentionCohort,
  type ActivityRecord,
  type RetentionCohortUser,
} from "./retention";

const SIGNUP = new Date("2026-01-01T00:00:00.000Z");
function daysAfter(base: Date, n: number): Date {
  return new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
}

describe("computeRetention", () => {
  it("classic D1: only counts a user active on exactly day+1", () => {
    const users: RetentionCohortUser[] = [
      { userId: "u1", signupDate: SIGNUP },
      { userId: "u2", signupDate: SIGNUP },
    ];
    const activity: ActivityRecord[] = [
      { userId: "u1", activeDate: daysAfter(SIGNUP, 1) },
      { userId: "u2", activeDate: daysAfter(SIGNUP, 2) }, // active, but not on day 1 specifically
    ];
    const [d1] = computeRetention(users, activity, [1]);
    expect(d1!.classicRetained).toBe(1);
    expect(d1!.classicRate).toBeCloseTo(0.5);
  });

  it("unbounded D1: counts a user active on day+1 OR any later day", () => {
    const users: RetentionCohortUser[] = [
      { userId: "u1", signupDate: SIGNUP },
      { userId: "u2", signupDate: SIGNUP },
    ];
    const activity: ActivityRecord[] = [
      { userId: "u1", activeDate: daysAfter(SIGNUP, 1) },
      { userId: "u2", activeDate: daysAfter(SIGNUP, 5) }, // never day 1, but active later — counts unbounded
    ];
    const [d1] = computeRetention(users, activity, [1]);
    expect(d1!.classicRetained).toBe(1);
    expect(d1!.unboundedRetained).toBe(2);
  });

  it("a user with no activity at all retains 0 on every offset", () => {
    const users: RetentionCohortUser[] = [{ userId: "u1", signupDate: SIGNUP }];
    const [d1, d7] = computeRetention(users, [], [1, 7]);
    expect(d1!.classicRetained).toBe(0);
    expect(d7!.classicRetained).toBe(0);
  });

  it("returns 0 rates (not NaN) for an empty cohort", () => {
    const [d1] = computeRetention([], [], [1]);
    expect(d1!.cohortSize).toBe(0);
    expect(Number.isFinite(d1!.classicRate)).toBe(true);
    expect(Number.isFinite(d1!.unboundedRate)).toBe(true);
  });
});

describe("segmentRetentionCohort", () => {
  it("partitions the cohort by the given key, e.g. whether the user went available in week 1", () => {
    const users = [
      { userId: "u1", signupDate: SIGNUP, wentAvailableWeek1: true },
      { userId: "u2", signupDate: SIGNUP, wentAvailableWeek1: false },
      { userId: "u3", signupDate: SIGNUP, wentAvailableWeek1: true },
    ];
    const segments = segmentRetentionCohort(users, (u) =>
      u.wentAvailableWeek1 ? "went_available_week1" : "did_not",
    );
    expect(segments.get("went_available_week1")?.map((u) => u.userId)).toEqual(["u1", "u3"]);
    expect(segments.get("did_not")?.map((u) => u.userId)).toEqual(["u2"]);
  });
});
