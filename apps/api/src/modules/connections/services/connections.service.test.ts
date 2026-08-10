import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsService, type SendConnectionRequestInput } from "./connections.service";
import type { ConnectionsRepository } from "../repositories/connections.repository";
import type { ConnectionQuotaService } from "./connection-quota.service";
import type { MatchingDataRepository } from "../../matching/repositories/matching-data.repository";
import type { InboundFiltersService } from "../../intents/inbound-filters.service";
import type { NotificationsService } from "../../notifications/notifications.service";
import type { ConnectionRequest, UserIntent } from "@convene/db";

const NOW = new Date("2026-08-08T10:00:00Z");

function fakeIntent(overrides: Partial<UserIntent> = {}): UserIntent {
  return {
    id: "intent-1",
    userId: "sender-1",
    type: "hiring",
    detail: null,
    metadata: {},
    isPrimary: true,
    isPaused: false,
    status: "active",
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    renewedCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as UserIntent;
}

function fakeRequestRow(overrides: Partial<ConnectionRequest> = {}): ConnectionRequest {
  return {
    id: "request-1",
    senderId: "sender-1",
    recipientId: "recipient-1",
    intentId: "intent-1",
    note: null,
    matchScore: 70,
    matchReasons: null,
    source: null,
    status: "pending",
    isQueued: false,
    respondedAt: null,
    expiresAt: new Date("2026-08-22T10:00:00Z"),
    createdAt: NOW,
    ...overrides,
  } as ConnectionRequest;
}

function fakeRepo(
  overrides: Partial<Record<keyof ConnectionsRepository, unknown>> = {},
): ConnectionsRepository {
  return {
    findRecipientStatus: vi.fn(async () => "active"),
    isBlockedEitherWay: vi.fn(async () => false),
    findOwnedActiveIntent: vi.fn(async () => fakeIntent()),
    findActiveConnectionBetween: vi.fn(async () => false),
    findPendingRequestBetween: vi.fn(async () => null),
    findMostRecentRemoval: vi.fn(async () => null),
    findMostRecentTerminalRequest: vi.fn(async () => null),
    countRejectedRequests: vi.fn(async () => 0),
    loadTimezone: vi.fn(async () => "UTC"),
    loadInboundThrottleDailyCap: vi.fn(async () => null),
    countInboundToday: vi.fn(async () => 0),
    countQueuedForRecipient: vi.fn(async () => 0),
    createRequest: vi.fn(async () => fakeRequestRow()),
    findRequestById: vi.fn(async () => fakeRequestRow()),
    withdrawRequest: vi.fn(async () => fakeRequestRow({ status: "cancelled" })),
    listRequests: vi.fn(async () => []),
    loadIntentSummaries: vi.fn(async () => new Map()),
    rejectRequest: vi.fn(async () => fakeRequestRow({ status: "rejected", respondedAt: NOW })),
    acceptRequest: vi.fn(async () => ({
      connection: { id: "connection-1", connectedAt: NOW },
      conversationId: "conversation-1",
      firstMessageId: "message-1",
    })),
    acceptMutualRequests: vi.fn(async () => ({
      connection: { id: "connection-1", connectedAt: NOW },
      conversationId: "conversation-1",
      firstMessageId: "message-1",
      newRequest: fakeRequestRow({ id: "request-2", status: "accepted", respondedAt: NOW }),
      existingRequest: fakeRequestRow({
        id: "request-1",
        senderId: "recipient-1",
        recipientId: "sender-1",
        status: "accepted",
        respondedAt: NOW,
      }),
    })),
    expirePendingRequests: vi.fn(async () => []),
    ...overrides,
  } as unknown as ConnectionsRepository;
}

function fakeQuota(
  overrides: Partial<Record<keyof ConnectionQuotaService, unknown>> = {},
): ConnectionQuotaService {
  return {
    isSoftBlocked: vi.fn(async () => false),
    recordNoteAndCheckDuplicate: vi.fn(async () => false),
    checkVelocity: vi.fn(async () => true),
    checkDailyQuota: vi.fn(async () => ({
      allowed: true,
      used: 1,
      limit: 8,
      resetsAt: new Date("2026-08-09T00:00:00Z"),
    })),
    applySoftBlock: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ConnectionQuotaService;
}

function fakeMatchingData(
  overrides: Partial<Record<keyof MatchingDataRepository, unknown>> = {},
): MatchingDataRepository {
  return {
    loadIntentRefsForUsers: vi.fn(
      async () =>
        new Map([
          ["sender-1", [{ type: "hiring", isPrimary: true }]],
          ["recipient-1", [{ type: "looking_for_job", isPrimary: true }]],
        ]),
    ),
    loadProfileScoringFields: vi.fn(
      async () =>
        new Map([
          [
            "sender-1",
            {
              yearsExperience: 3,
              industryId: 1,
              verificationLevel: "L1",
              createdAt: NOW,
              companyName: null,
            },
          ],
        ]),
    ),
    loadReputationScores: vi.fn(async () => new Map([["recipient-1", 50]])),
    ...overrides,
  } as unknown as MatchingDataRepository;
}

function fakeInboundFilters(
  overrides: Partial<Record<keyof InboundFiltersService, unknown>> = {},
): InboundFiltersService {
  return {
    checkInbound: vi.fn(async () => ({ allowed: true })),
    ...overrides,
  } as unknown as InboundFiltersService;
}

function fakeNotifications(
  overrides: Partial<Record<keyof NotificationsService, unknown>> = {},
): NotificationsService {
  return { notify: vi.fn(async () => undefined), ...overrides } as unknown as NotificationsService;
}

function buildService(
  parts: {
    repo?: ConnectionsRepository;
    quota?: ConnectionQuotaService;
    matchingData?: MatchingDataRepository;
    inboundFilters?: InboundFiltersService;
    notifications?: NotificationsService;
  } = {},
): ConnectionsService {
  return new ConnectionsService(
    parts.repo ?? fakeRepo(),
    parts.quota ?? fakeQuota(),
    parts.matchingData ?? fakeMatchingData(),
    parts.inboundFilters ?? fakeInboundFilters(),
    parts.notifications ?? fakeNotifications(),
    { now: () => NOW },
  );
}

const input: SendConnectionRequestInput = {
  recipientId: "recipient-1",
  intentId: "intent-1",
  note: "Would love to connect.",
  source: "discover",
  matchScore: 78,
};

describe("ConnectionsService.sendRequest", () => {
  it("creates a pending request on the happy path", async () => {
    const repo = fakeRepo();
    const service = buildService({ repo });
    const result = await service.sendRequest("sender-1", "free", input);

    expect(result.status).toBe(201);
    expect(result.request.status).toBe("pending");
    expect(result.queued_position).toBeNull();
    expect(repo.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: "sender-1",
        recipientId: "recipient-1",
        isQueued: false,
      }),
    );
  });

  it("rejects sending a request to yourself", async () => {
    const service = buildService();
    await expect(
      service.sendRequest("sender-1", "free", { ...input, recipientId: "sender-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects when the recipient doesn't exist or isn't active", async () => {
    const repo = fakeRepo({ findRecipientStatus: vi.fn(async () => "suspended") });
    const service = buildService({ repo });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects when either party has blocked the other", async () => {
    const repo = fakeRepo({ isBlockedEitherWay: vi.fn(async () => true) });
    const service = buildService({ repo });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "BLOCKED",
    });
  });

  it("rejects when the intent isn't owned/active", async () => {
    const repo = fakeRepo({ findOwnedActiveIntent: vi.fn(async () => null) });
    const service = buildService({ repo });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "INTENT_NOT_FOUND",
    });
  });

  it("rejects when already connected", async () => {
    const repo = fakeRepo({ findActiveConnectionBetween: vi.fn(async () => true) });
    const service = buildService({ repo });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "ALREADY_CONNECTED",
    });
  });

  it("rejects when a pending request already exists", async () => {
    const repo = fakeRepo({ findPendingRequestBetween: vi.fn(async () => fakeRequestRow()) });
    const service = buildService({ repo });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "REQUEST_ALREADY_PENDING",
    });
  });

  describe("BR-CONN-12 cooldowns", () => {
    it("blocks re-request within 30d of a rejection", async () => {
      const repo = fakeRepo({
        findMostRecentTerminalRequest: vi.fn(async () =>
          fakeRequestRow({ status: "rejected", respondedAt: new Date("2026-08-01T00:00:00Z") }),
        ),
        countRejectedRequests: vi.fn(async () => 1),
      });
      const service = buildService({ repo });
      await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
        code: "COOLDOWN_ACTIVE",
      });
    });

    it("allows re-request past the 30d rejection cooldown", async () => {
      const repo = fakeRepo({
        findMostRecentTerminalRequest: vi.fn(async () =>
          fakeRequestRow({ status: "rejected", respondedAt: new Date("2026-06-01T00:00:00Z") }),
        ),
        countRejectedRequests: vi.fn(async () => 1),
      });
      const service = buildService({ repo });
      const result = await service.sendRequest("sender-1", "free", input);
      expect(result.status).toBe(201);
    });

    it("permanently blocks re-request after a second rejection ('only one retry ever')", async () => {
      const repo = fakeRepo({
        findMostRecentTerminalRequest: vi.fn(async () =>
          fakeRequestRow({ status: "rejected", respondedAt: new Date("2020-01-01T00:00:00Z") }),
        ),
        countRejectedRequests: vi.fn(async () => 2),
      });
      const service = buildService({ repo });
      await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
        code: "COOLDOWN_ACTIVE",
      });
    });

    it("blocks re-request within 7d of expiry", async () => {
      const repo = fakeRepo({
        findMostRecentTerminalRequest: vi.fn(async () =>
          fakeRequestRow({ status: "expired", respondedAt: new Date("2026-08-05T00:00:00Z") }),
        ),
      });
      const service = buildService({ repo });
      await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
        code: "COOLDOWN_ACTIVE",
      });
    });

    it("blocks re-request within 24h of cancellation", async () => {
      const repo = fakeRepo({
        findMostRecentTerminalRequest: vi.fn(async () =>
          fakeRequestRow({ status: "cancelled", respondedAt: new Date("2026-08-08T02:00:00Z") }),
        ),
      });
      const service = buildService({ repo });
      await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
        code: "COOLDOWN_ACTIVE",
      });
    });

    it("blocks re-request within 7d of a connection removal", async () => {
      const repo = fakeRepo({
        findMostRecentRemoval: vi.fn(async () => new Date("2026-08-05T00:00:00Z")),
      });
      const service = buildService({ repo });
      await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
        code: "COOLDOWN_ACTIVE",
      });
    });
  });

  it("rejects below the 0.20 intent floor even on the highest (pro) plan", async () => {
    // investment_discussion x learning is 0.15 in the default
    // complementarity matrix (packages/matching/src/subscores/intent.ts)
    // — deterministically under the 0.20 floor regardless of plan,
    // proving BR-CONN-02's "no plan bypasses the floor" acceptance
    // criterion.
    const matchingData = fakeMatchingData({
      loadIntentRefsForUsers: vi.fn(
        async () =>
          new Map([
            ["sender-1", [{ type: "investment_discussion", isPrimary: false }]],
            ["recipient-1", [{ type: "learning", isPrimary: false }]],
          ]),
      ),
    });
    const service = buildService({ matchingData });
    await expect(service.sendRequest("sender-1", "pro", input)).rejects.toMatchObject({
      code: "INTENT_MISMATCH",
    });
  });

  it("rejects when the recipient's inbound filter rejects the sender", async () => {
    const inboundFilters = fakeInboundFilters({
      checkInbound: vi.fn(async () => ({
        allowed: false,
        reason: "INTENT_FILTERED",
        message: "no",
      })),
    });
    const service = buildService({ inboundFilters });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "INTENT_FILTERED",
    });
  });

  it("rejects when the sender is currently soft-blocked", async () => {
    const quota = fakeQuota({ isSoftBlocked: vi.fn(async () => true) });
    const service = buildService({ quota });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "VELOCITY_LIMIT",
    });
  });

  it("rejects on identical-note spam detection", async () => {
    const quota = fakeQuota({ recordNoteAndCheckDuplicate: vi.fn(async () => true) });
    const service = buildService({ quota });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "VELOCITY_LIMIT",
    });
  });

  it("rejects when the 60s velocity cap is exceeded", async () => {
    const quota = fakeQuota({ checkVelocity: vi.fn(async () => false) });
    const service = buildService({ quota });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "VELOCITY_LIMIT",
    });
  });

  it("rejects when the daily quota is exhausted and creates no request row", async () => {
    const repo = fakeRepo();
    const quota = fakeQuota({
      checkDailyQuota: vi.fn(async () => ({
        allowed: false,
        used: 8,
        limit: 8,
        resetsAt: new Date("2026-08-09T00:00:00Z"),
      })),
    });
    const service = buildService({ repo, quota });
    await expect(service.sendRequest("sender-1", "free", input)).rejects.toMatchObject({
      code: "DAILY_LIMIT_REACHED",
    });
    expect(repo.createRequest).not.toHaveBeenCalled();
  });

  describe("BR-CONN-07 inbound throttle", () => {
    it("queues the request with a 202 when the recipient's explicit cap is exceeded", async () => {
      const repo = fakeRepo({
        loadInboundThrottleDailyCap: vi.fn(async () => 5),
        countInboundToday: vi.fn(async () => 5),
        countQueuedForRecipient: vi.fn(async () => 3),
        createRequest: vi.fn(async () => fakeRequestRow({ isQueued: true })),
      });
      const service = buildService({ repo });
      const result = await service.sendRequest("sender-1", "free", input);
      expect(result.status).toBe(202);
      expect(result.queued_position).toBe(4);
      expect(repo.createRequest).toHaveBeenCalledWith(expect.objectContaining({ isQueued: true }));
    });

    it("auto-defaults the cap to 10/day for a >=8yrs-experience recipient with no override", async () => {
      const repo = fakeRepo({
        loadInboundThrottleDailyCap: vi.fn(async () => null),
        countInboundToday: vi.fn(async () => 10),
        countQueuedForRecipient: vi.fn(async () => 0),
        createRequest: vi.fn(async () => fakeRequestRow({ isQueued: true })),
      });
      const matchingData = fakeMatchingData({
        loadProfileScoringFields: vi.fn(async (userIds: readonly string[]) => {
          const map = new Map<
            string,
            {
              yearsExperience: number;
              industryId: number | null;
              verificationLevel: string;
              createdAt: Date;
              companyName: string | null;
            }
          >();
          for (const id of userIds) {
            map.set(id, {
              yearsExperience: id === "recipient-1" ? 14 : 3,
              industryId: 1,
              verificationLevel: "L1",
              createdAt: NOW,
              companyName: null,
            });
          }
          return map;
        }),
        loadReputationScores: vi.fn(async () => new Map([["recipient-1", 50]])),
      });
      const service = buildService({ repo, matchingData });
      const result = await service.sendRequest("sender-1", "free", input);
      expect(result.status).toBe(202);
    });

    it("stays unlimited for a non-senior recipient with no override", async () => {
      const repo = fakeRepo({ countInboundToday: vi.fn(async () => 500) });
      const service = buildService({ repo });
      const result = await service.sendRequest("sender-1", "free", input);
      expect(result.status).toBe(201);
    });
  });
});

describe("ConnectionsService.withdrawRequest", () => {
  it("withdraws a pending request owned by the sender", async () => {
    const repo = fakeRepo();
    const service = buildService({ repo });
    await service.withdrawRequest("sender-1", "request-1");
    expect(repo.withdrawRequest).toHaveBeenCalledWith("request-1", NOW);
  });

  it("404s when the request doesn't exist", async () => {
    const repo = fakeRepo({ findRequestById: vi.fn(async () => null) });
    const service = buildService({ repo });
    await expect(service.withdrawRequest("sender-1", "missing")).rejects.toMatchObject({
      code: "REQUEST_NOT_FOUND",
    });
  });

  it("forbids withdrawing someone else's request", async () => {
    const repo = fakeRepo({
      findRequestById: vi.fn(async () => fakeRequestRow({ senderId: "someone-else" })),
    });
    const service = buildService({ repo });
    await expect(service.withdrawRequest("sender-1", "request-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("409s when the request is no longer pending", async () => {
    const repo = fakeRepo({ withdrawRequest: vi.fn(async () => null) });
    const service = buildService({ repo });
    await expect(service.withdrawRequest("sender-1", "request-1")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("ConnectionsService.acceptRequest", () => {
  it("accepts and notifies the sender", async () => {
    const repo = fakeRepo();
    const notifications = fakeNotifications();
    const service = buildService({ repo, notifications });

    const result = await service.acceptRequest("recipient-1", "request-1");

    expect(result.connection.id).toBe("connection-1");
    expect(result.conversation.id).toBe("conversation-1");
    expect(result.conversation.first_message_id).toBe("message-1");
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "sender-1", category: "request_accepted" }),
    );
  });

  it("404s when the request doesn't exist", async () => {
    const repo = fakeRepo({ findRequestById: vi.fn(async () => null) });
    const service = buildService({ repo });
    await expect(service.acceptRequest("recipient-1", "missing")).rejects.toMatchObject({
      code: "REQUEST_NOT_FOUND",
    });
  });

  it("forbids accepting a request addressed to someone else", async () => {
    const repo = fakeRepo({
      findRequestById: vi.fn(async () => fakeRequestRow({ recipientId: "someone-else" })),
    });
    const service = buildService({ repo });
    await expect(service.acceptRequest("recipient-1", "request-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("forbids accepting when either party has since blocked the other (edge case 4)", async () => {
    const repo = fakeRepo({ isBlockedEitherWay: vi.fn(async () => true) });
    const service = buildService({ repo });
    await expect(service.acceptRequest("recipient-1", "request-1")).rejects.toMatchObject({
      code: "BLOCKED",
    });
  });

  it("409s when the request is no longer pending (lost a race)", async () => {
    const repo = fakeRepo({ acceptRequest: vi.fn(async () => null) });
    const service = buildService({ repo });
    await expect(service.acceptRequest("recipient-1", "request-1")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("ConnectionsService.rejectRequest — BR-CONN-03 silence", () => {
  it("rejects without sending any notification", async () => {
    const repo = fakeRepo();
    const notifications = fakeNotifications();
    const service = buildService({ repo, notifications });

    await service.rejectRequest("recipient-1", "request-1");

    expect(repo.rejectRequest).toHaveBeenCalledWith("request-1", NOW);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("404s when the request doesn't exist", async () => {
    const repo = fakeRepo({ findRequestById: vi.fn(async () => null) });
    const service = buildService({ repo });
    await expect(service.rejectRequest("recipient-1", "missing")).rejects.toMatchObject({
      code: "REQUEST_NOT_FOUND",
    });
  });

  it("forbids rejecting a request addressed to someone else", async () => {
    const repo = fakeRepo({
      findRequestById: vi.fn(async () => fakeRequestRow({ recipientId: "someone-else" })),
    });
    const service = buildService({ repo });
    await expect(service.rejectRequest("recipient-1", "request-1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("409s when the request is no longer pending", async () => {
    const repo = fakeRepo({ rejectRequest: vi.fn(async () => null) });
    const service = buildService({ repo });
    await expect(service.rejectRequest("recipient-1", "request-1")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("ConnectionsService.sendRequest — edge case 1: simultaneous mutual requests auto-accept", () => {
  it("auto-accepts instead of creating a new pending row when the recipient already has a pending request to the sender", async () => {
    const reversePending = fakeRequestRow({
      id: "request-1",
      senderId: "recipient-1",
      recipientId: "sender-1",
    });
    const repo = fakeRepo({
      findPendingRequestBetween: vi.fn(async (senderId: string, recipientId: string) =>
        senderId === "recipient-1" && recipientId === "sender-1" ? reversePending : null,
      ),
    });
    const notifications = fakeNotifications();
    const service = buildService({ repo, notifications });

    const result = await service.sendRequest("sender-1", "free", input);

    expect(repo.acceptMutualRequests).toHaveBeenCalledWith(
      "request-1",
      expect.objectContaining({ senderId: "sender-1", recipientId: "recipient-1" }),
      NOW,
    );
    expect(repo.createRequest).not.toHaveBeenCalled();
    expect(result.request.status).toBe("accepted");
    // Both parties are notified — the new sender and the original (now-mutual) sender.
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });
});

describe("ConnectionsService.expirePendingRequests — BR-CONN-04", () => {
  it("delegates to the repository and returns the count", async () => {
    const repo = fakeRepo({
      expirePendingRequests: vi.fn(async () => [
        fakeRequestRow(),
        fakeRequestRow({ id: "request-2" }),
      ]),
    });
    const service = buildService({ repo });
    const count = await service.expirePendingRequests();
    expect(count).toBe(2);
  });
});
