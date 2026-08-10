// BR-INT-02: "Active-intent limits by plan: Free 3 · Premium 8 · Pro 12 ·
// Enterprise 14." AuthContext.plan is always "free" until the billing
// module creates real subscription rows (see auth-context.ts's own
// comment) — this map is written against the plan *codes* billing will
// eventually use, not against what's reachable today, so it doesn't need
// revisiting when that module lands.
export const PLAN_INTENT_LIMITS: Record<string, number> = {
  free: 3,
  premium: 8,
  pro: 12,
  enterprise: 14,
};

const DEFAULT_LIMIT = PLAN_INTENT_LIMITS.free!;

export function getIntentLimit(plan: string): number {
  return PLAN_INTENT_LIMITS[plan] ?? DEFAULT_LIMIT;
}
