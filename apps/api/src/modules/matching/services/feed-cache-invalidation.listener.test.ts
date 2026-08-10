import { describe, expect, it, vi } from "vitest";
import { FeedCacheInvalidationListener } from "./feed-cache-invalidation.listener";
import type { MatchingService } from "./matching.service";

describe("FeedCacheInvalidationListener", () => {
  it("invalidates the user's own feed cache on profile.updated", async () => {
    const matchingService = {
      invalidateFeedCache: vi.fn(async () => undefined),
    } as unknown as MatchingService;
    const listener = new FeedCacheInvalidationListener(matchingService);

    await listener.handleProfileUpdated({ userId: "user-1", changedFields: ["headline"] });

    expect(matchingService.invalidateFeedCache).toHaveBeenCalledWith("user-1");
  });

  it("invalidates on profile.location_changed", async () => {
    const matchingService = {
      invalidateFeedCache: vi.fn(async () => undefined),
    } as unknown as MatchingService;
    const listener = new FeedCacheInvalidationListener(matchingService);

    await listener.handleProfileLocationChanged({ userId: "user-1" });

    expect(matchingService.invalidateFeedCache).toHaveBeenCalledWith("user-1");
  });

  it("invalidates on intent.changed", async () => {
    const matchingService = {
      invalidateFeedCache: vi.fn(async () => undefined),
    } as unknown as MatchingService;
    const listener = new FeedCacheInvalidationListener(matchingService);

    await listener.handleIntentChanged({
      userId: "user-1",
      intentId: "intent-1",
      type: "coffee_chat",
    });

    expect(matchingService.invalidateFeedCache).toHaveBeenCalledWith("user-1");
  });

  it("invalidates on availability.changed and availability.expired", async () => {
    const matchingService = {
      invalidateFeedCache: vi.fn(async () => undefined),
    } as unknown as MatchingService;
    const listener = new FeedCacheInvalidationListener(matchingService);

    await listener.handleAvailabilityChanged({
      userId: "user-1",
      state: "available_now",
      expiresAt: new Date(),
    });
    await listener.handleAvailabilityExpired({ userId: "user-2" });

    expect(matchingService.invalidateFeedCache).toHaveBeenCalledWith("user-1");
    expect(matchingService.invalidateFeedCache).toHaveBeenCalledWith("user-2");
  });
});
