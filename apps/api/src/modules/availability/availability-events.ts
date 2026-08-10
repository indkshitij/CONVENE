// PRD §17.2 Availability module "Publishes: availability.started/
// extended/ended/expired." BR-AVAIL-16: "changes emit a real-time event
// to (a) the user's other devices, (b) users with an open conversation
// with them, (c) the feed-invalidation channel. Never broadcast to
// non-connections in bulk." No WebSocket gateway exists yet to fan this
// out (that's the realtime app, a later phase) — emitting now costs
// nothing and means that phase doesn't need to touch this module, same
// precedent as profile.updated/intent.changed before their first listener
// existed.
export const AVAILABILITY_CHANGED_EVENT = "availability.changed";

export interface AvailabilityChangedEvent {
  userId: string;
  state: string;
  expiresAt: Date | null;
}
