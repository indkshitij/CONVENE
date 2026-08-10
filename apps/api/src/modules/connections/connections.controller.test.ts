import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { ConnectionsController } from "./connections.controller";
import type { ConnectionsRepository } from "./repositories/connections.repository";
import type { ConnectionsService } from "./services/connections.service";

const authContext: AuthContext = {
  id: "user-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

interface FakeResponse {
  status: ReturnType<typeof vi.fn>;
}

function fakeResponse(): FakeResponse {
  const response: FakeResponse = { status: vi.fn(() => response) };
  return response;
}

function asResponseLike(
  response: FakeResponse,
): Parameters<ConnectionsController["sendRequest"]>[1] {
  return response as unknown as Parameters<ConnectionsController["sendRequest"]>[1];
}

function fakeConnectionsService(
  overrides: Partial<Record<keyof ConnectionsService, unknown>> = {},
): ConnectionsService {
  return {
    sendRequest: vi.fn(async () => ({
      status: 201 as const,
      request: {
        id: "request-1",
        status: "pending" as const,
        expires_at: "2026-08-22T10:00:00.000Z",
      },
      quota: { used: 1, limit: 8, resets_at: "2026-08-09T00:00:00.000Z" },
      queued_position: null,
    })),
    listRequests: vi.fn(async () => ({ requests: [], nextCursor: null, throttle: null })),
    withdrawRequest: vi.fn(async () => undefined),
    acceptRequest: vi.fn(async () => ({
      connection: { id: "connection-1", connected_at: "2026-08-08T10:00:00.000Z" },
      conversation: { id: "conversation-1", first_message_id: "message-1" },
    })),
    rejectRequest: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ConnectionsService;
}

function fakeRepo(): ConnectionsRepository {
  return { loadIntentSummaries: vi.fn(async () => new Map()) } as unknown as ConnectionsRepository;
}

const body = {
  recipient_id: "recipient-1",
  intent_id: "intent-1",
  note: "hi",
  source: "discover",
  match_score: 78,
};

describe("ConnectionsController", () => {
  describe("POST /connections/requests", () => {
    it("sets a 201 status and returns the request+quota envelope", async () => {
      const service = fakeConnectionsService();
      const controller = new ConnectionsController(service, fakeRepo());
      const response = fakeResponse();

      const result = await controller.sendRequest({ authContext }, asResponseLike(response), body);

      expect(response.status).toHaveBeenCalledWith(201);
      expect(result.request.id).toBe("request-1");
      expect(result.queued_position).toBeUndefined();
      expect(service.sendRequest).toHaveBeenCalledWith("user-1", "free", {
        recipientId: "recipient-1",
        intentId: "intent-1",
        note: "hi",
        source: "discover",
        matchScore: 78,
      });
    });

    it("sets a 202 status and includes queued_position when throttled", async () => {
      const service = fakeConnectionsService({
        sendRequest: vi.fn(async () => ({
          status: 202 as const,
          request: {
            id: "request-1",
            status: "pending" as const,
            expires_at: "2026-08-22T10:00:00.000Z",
          },
          quota: { used: 1, limit: 8, resets_at: "2026-08-09T00:00:00.000Z" },
          queued_position: 5,
        })),
      });
      const controller = new ConnectionsController(service, fakeRepo());
      const response = fakeResponse();

      const result = await controller.sendRequest({ authContext }, asResponseLike(response), body);

      expect(response.status).toHaveBeenCalledWith(202);
      expect(result.queued_position).toBe(5);
    });

    it("rejects when no auth context is present", async () => {
      const controller = new ConnectionsController(fakeConnectionsService(), fakeRepo());
      await expect(
        controller.sendRequest({}, asResponseLike(fakeResponse()), body),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("GET /connections/requests", () => {
    it("defaults direction to received and sort to score_desc", async () => {
      const service = fakeConnectionsService();
      const controller = new ConnectionsController(service, fakeRepo());

      await controller.listRequests({ authContext });

      expect(service.listRequests).toHaveBeenCalledWith("user-1", {
        direction: "received",
        status: undefined,
        sort: "score_desc",
        cursor: undefined,
      });
    });

    it("passes through direction=sent, status, sort=recent, cursor", async () => {
      const service = fakeConnectionsService();
      const controller = new ConnectionsController(service, fakeRepo());

      await controller.listRequests({ authContext }, "sent", "pending", "recent", "cursor-token");

      expect(service.listRequests).toHaveBeenCalledWith("user-1", {
        direction: "sent",
        status: "pending",
        sort: "recent",
        cursor: "cursor-token",
      });
    });

    it("ignores an invalid status value rather than erroring", async () => {
      const service = fakeConnectionsService();
      const controller = new ConnectionsController(service, fakeRepo());

      await controller.listRequests({ authContext }, "received", "not-a-status");

      expect(service.listRequests).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ status: undefined }),
      );
    });
  });

  describe("DELETE /connections/requests/:id", () => {
    it("delegates to withdrawRequest", async () => {
      const service = fakeConnectionsService();
      const controller = new ConnectionsController(service, fakeRepo());

      await controller.withdrawRequest({ authContext }, "request-1");

      expect(service.withdrawRequest).toHaveBeenCalledWith("user-1", "request-1");
    });
  });

  describe("POST /connections/requests/:id/accept", () => {
    it("delegates to acceptRequest and returns connection+conversation", async () => {
      const service = fakeConnectionsService();
      const controller = new ConnectionsController(service, fakeRepo());

      const result = await controller.acceptRequest({ authContext }, "request-1");

      expect(service.acceptRequest).toHaveBeenCalledWith("user-1", "request-1");
      expect(result.connection.id).toBe("connection-1");
      expect(result.conversation.first_message_id).toBe("message-1");
    });
  });

  describe("POST /connections/requests/:id/reject", () => {
    it("delegates to rejectRequest", async () => {
      const service = fakeConnectionsService();
      const controller = new ConnectionsController(service, fakeRepo());

      await controller.rejectRequest({ authContext }, "request-1");

      expect(service.rejectRequest).toHaveBeenCalledWith("user-1", "request-1");
    });
  });
});
