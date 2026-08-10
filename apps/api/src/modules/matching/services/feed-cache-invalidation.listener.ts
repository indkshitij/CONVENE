import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  AVAILABILITY_CHANGED_EVENT,
  type AvailabilityChangedEvent,
} from "../../availability/availability-events";
import { AVAILABILITY_EXPIRED_EVENT } from "../../availability/availability-expiry.service";
import { INTENT_CHANGED_EVENT, type IntentChangedEvent } from "../../intents/intent-events";
import {
  PROFILE_LOCATION_CHANGED_EVENT,
  PROFILE_UPDATED_EVENT,
  type ProfileLocationChangedEvent,
  type ProfileUpdatedEvent,
} from "../../profile/profile-events";
import { MatchingService } from "./matching.service";

// PRD §17.6 cache-invalidation triggers for the discovery feed: "intent
// change (own set only), profile edit (own set + re-embed), availability
// change (publishes to affected geohash cells)." This listener covers the
// "own set" half of every trigger — the changed user's own cached feed
// entries. It deliberately does NOT invalidate *other* viewers' cached
// feeds just because this user's availability/profile changed (the
// "affected geohash cells" half) — that needs a reverse index from
// geohash cell to every viewer currently caching a feed touching it,
// which doesn't exist yet; those other viewers still get a correct (if
// briefly stale, within the 90s TTL) feed regardless. Flagged as a scope
// gap, not silently narrowed.
@Injectable()
export class FeedCacheInvalidationListener {
  constructor(private readonly matchingService: MatchingService) {}

  @OnEvent(PROFILE_UPDATED_EVENT)
  async handleProfileUpdated(event: ProfileUpdatedEvent): Promise<void> {
    await this.matchingService.invalidateFeedCache(event.userId);
  }

  @OnEvent(PROFILE_LOCATION_CHANGED_EVENT)
  async handleProfileLocationChanged(event: ProfileLocationChangedEvent): Promise<void> {
    await this.matchingService.invalidateFeedCache(event.userId);
  }

  @OnEvent(INTENT_CHANGED_EVENT)
  async handleIntentChanged(event: IntentChangedEvent): Promise<void> {
    await this.matchingService.invalidateFeedCache(event.userId);
  }

  @OnEvent(AVAILABILITY_CHANGED_EVENT)
  async handleAvailabilityChanged(event: AvailabilityChangedEvent): Promise<void> {
    await this.matchingService.invalidateFeedCache(event.userId);
  }

  @OnEvent(AVAILABILITY_EXPIRED_EVENT)
  async handleAvailabilityExpired(event: { userId: string }): Promise<void> {
    await this.matchingService.invalidateFeedCache(event.userId);
  }
}
