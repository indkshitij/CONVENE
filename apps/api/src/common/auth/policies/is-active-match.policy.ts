// PRD §11: a "match" (both users mutually available and paired) is only
// actionable while it hasn't expired. The matching module (a later phase)
// owns the actual match/status/expiry shape; this function only decides
// given already-resolved facts, per §20.3's "policies are pure functions."
export function isActiveMatch(matchStatus: string, expiresAt: Date, now: Date): boolean {
  return matchStatus === "active" && expiresAt.getTime() > now.getTime();
}
