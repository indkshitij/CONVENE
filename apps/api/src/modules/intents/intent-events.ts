// PRD §17.2 Intents module "Publishes: intent.changed" — BR-INT-11:
// "Changing intents invalidates the user's precomputed candidate set and
// triggers a re-match within 60s." No consumer exists yet (the
// match-precompute worker is P13.1) — same situation profile.updated was
// in before P7.4 added its first listener; emitting now costs nothing and
// means P13.1 doesn't need to touch this module to wire up.
export const INTENT_CHANGED_EVENT = "intent.changed";

export interface IntentChangedEvent {
  userId: string;
  intentId: string;
  type: string;
}
