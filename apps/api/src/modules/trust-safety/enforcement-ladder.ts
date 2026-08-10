import { LADDER_DURATIONS_DAYS } from "./report-catalogue";

// PRD §10.10.3 ladder order (low -> high severity), used only to give the
// admin queue a natural sort order — the actual action a moderator takes
// isn't constrained to "the next step" (a first-time Critical report
// still goes straight to a ban candidate, it doesn't have to walk the
// ladder from notice).
export const LADDER_ORDER = [
  "notice",
  "warning",
  "throttle",
  "shadow_limit",
  "suspend",
  "ban",
] as const;

// §10.10.3: "all actions are reversible except a Critical ban, which
// requires two-admin approval."
export function requiresTwoAdminApproval(action: string): boolean {
  return action === "ban";
}

// Default expiry for a timed ladder step, in milliseconds from `from`.
// `null` means the action has no timer at all (notice/warning/reverse are
// point-in-time log entries; a caller-supplied expires_at always wins
// over this default — see ModerationActionsService.apply).
export function defaultExpiryFor(action: string, from: Date): Date | null {
  const days = LADDER_DURATIONS_DAYS[action as keyof typeof LADDER_DURATIONS_DAYS];
  if (days === undefined || days === null) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

// §10.10.3's mapping from a ladder action to the resulting users.status
// value (userStatus enum: pending_verification/active/restricted/
// shadow_limited/suspended/deleted). "notice"/"warning"/"reverse" don't
// change status — they're advisory/log-only.
export function userStatusForAction(
  action: string,
): "restricted" | "shadow_limited" | "suspended" | null {
  switch (action) {
    case "throttle":
      return "restricted";
    case "shadow_limit":
      return "shadow_limited";
    case "suspend":
    case "ban":
      return "suspended"; // No separate "banned" enum value exists (§16.3's user_status enum) — a permanent ban is a "suspended" row with no expiresAt, i.e. never auto-lifted. Flagged as an interpretation, not a schema addition, since the enum already models the restriction shape.
    default:
      return null;
  }
}
