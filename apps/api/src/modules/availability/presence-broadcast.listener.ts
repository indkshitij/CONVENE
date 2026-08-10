import { profiles } from "@convene/db";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { eq } from "drizzle-orm";
import { presenceGeoChannel } from "../../infra/redis/channels";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import { AVAILABILITY_CHANGED_EVENT, type AvailabilityChangedEvent } from "./availability-events";

// PRD §17.5 channel table: rt:presence:{geohash5} carries
// "availability.started / ended (coarse, no coordinates)" to "users
// viewing that area's feed." This is the first real consumer of
// availability.changed (BR-AVAIL-16) — the event already anticipated a
// listener like this (see availability-events.ts's own comment).
//
// Deliberately looks up geohash5 by userId itself rather than having the
// emitting call sites (availability.service.ts, availability-expiry.
// service.ts, schedule-generator.service.ts) carry it on the event
// payload — those five call sites are already covered by their own
// passing test suites from P10.1-10.3; broadening the event's shape to
// serve one new listener risks nothing there only by not touching them.
@Injectable()
export class PresenceBroadcastListener {
  private readonly logger = new Logger(PresenceBroadcastListener.name);

  constructor(
    private readonly postgres: PostgresService,
    private readonly publisher: RealtimePublisherService,
  ) {}

  @OnEvent(AVAILABILITY_CHANGED_EVENT)
  async handleAvailabilityChanged(event: AvailabilityChangedEvent): Promise<void> {
    // Only the two events §17.5 names for this channel — busy/away/
    // invisible transitions aren't broadcast here (BR-AVAIL-16's "never
    // broadcast to non-connections in bulk" is exactly why this channel
    // stays coarse: presence tier, not full state).
    const broadcastEvent =
      event.state === "available_now"
        ? "availability.started"
        : event.state === "offline"
          ? "availability.ended"
          : null;
    if (!broadcastEvent) return;

    const [profile] = await this.postgres.db
      .select({ geohash5: profiles.geohash5 })
      .from(profiles)
      .where(eq(profiles.userId, event.userId))
      .limit(1);
    if (!profile?.geohash5) return; // no location on file — nothing to broadcast into.

    try {
      // Payload is intentionally just userId + state — never coordinates,
      // never a distance figure. The 5-char geohash cell (~2.4km) the
      // channel itself is scoped to is the only spatial information any
      // subscriber ever learns.
      await this.publisher.publish(presenceGeoChannel(profile.geohash5), broadcastEvent, {
        userId: event.userId,
        state: event.state,
      });
    } catch (error) {
      this.logger.error(`Failed to broadcast presence for user ${event.userId}`, error);
    }
  }
}
