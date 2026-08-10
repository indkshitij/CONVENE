// PRD §10.3.3's state diagram, transcribed as edges. Only the transitions
// a user (or this endpoint) can trigger directly — auto-transitions
// (Away via inactivity, Offline via expiry/disconnect, Scheduled via the
// scheduler job, P10.3) live elsewhere and aren't validated here.
//
// Deliberately NOT a fully-connected "any state to any state" graph: the
// diagram has no Busy<->Away, Busy<->Invisible, or Away<->Invisible edge
// — from Busy you can only return to AvailableNow, never jump straight to
// Away or Invisible. This is enforced exactly as drawn, not loosened for
// convenience, per this phase's own "exactly as the state diagram allows."
export type ActivatableState = "available_now" | "busy" | "away" | "invisible";
export type FromState = "offline" | ActivatableState;

const ALLOWED_TRANSITIONS: Record<FromState, ActivatableState[]> = {
  offline: ["available_now"],
  available_now: ["busy", "away", "invisible"],
  busy: ["available_now"],
  away: ["available_now"],
  invisible: ["available_now"],
};

export function canTransition(from: FromState, to: ActivatableState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
