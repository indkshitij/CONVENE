import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { MessagesController } from "./messages.controller";
import type { MessagesService } from "./services/messages.service";
import type { Message } from "@convene/db";

const authContext: AuthContext = {
  id: "user-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function fakeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    senderId: "user-1",
    clientMsgId: "client-msg-1",
    sequence: 1,
    type: "text",
    body: "hello",
    replyToId: null,
    attachments: [],
    metadata: {},
    editedAt: null,
    editCount: 0,
    deletedAt: null,
    deletedScope: null,
    moderationState: "pending",
    searchVector: null,
    createdAt: new Date("2026-08-08T10:00:00Z"),
    ...overrides,
  } as Message;
}

function fakeMessagesService(
  overrides: Partial<Record<keyof MessagesService, unknown>> = {},
): MessagesService {
  return {
    sendMessage: vi.fn(async () => ({ message: fakeMessage(), qualityNudge: false })),
    getHistoryAfter: vi.fn(async () => [fakeMessage()]),
    getHistoryBefore: vi.fn(async () => [fakeMessage()]),
    ...overrides,
  } as unknown as MessagesService;
}

const body = { conversation_id: "conversation-1", client_msg_id: "client-msg-1", body: "hello" };

describe("MessagesController", () => {
  describe("POST /conversations/:conversationId/messages", () => {
    it("delegates to sendMessage and returns the card", async () => {
      const service = fakeMessagesService();
      const controller = new MessagesController(service);

      const result = await controller.send({ authContext }, "conversation-1", body);

      expect(service.sendMessage).toHaveBeenCalledWith({
        conversationId: "conversation-1",
        senderId: "user-1",
        clientMsgId: "client-msg-1",
        body: "hello",
        replyToId: null,
        attachments: [],
      });
      expect(result.id).toBe("message-1");
      expect(result.sequence).toBe(1);
      expect(result.quality_nudge).toBe(false);
    });

    it("surfaces quality_nudge from the service", async () => {
      const service = fakeMessagesService({
        sendMessage: vi.fn(async () => ({ message: fakeMessage(), qualityNudge: true })),
      });
      const controller = new MessagesController(service);
      const result = await controller.send({ authContext }, "conversation-1", body);
      expect(result.quality_nudge).toBe(true);
    });

    it("rejects when no auth context is present", async () => {
      const controller = new MessagesController(fakeMessagesService());
      await expect(controller.send({}, "conversation-1", body)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("GET /conversations/:conversationId/messages", () => {
    it("uses getHistoryAfter when after_sequence is supplied", async () => {
      const service = fakeMessagesService();
      const controller = new MessagesController(service);

      await controller.history({ authContext }, "conversation-1", "5", undefined, "20");

      expect(service.getHistoryAfter).toHaveBeenCalledWith("conversation-1", "user-1", 5, 20);
      expect(service.getHistoryBefore).not.toHaveBeenCalled();
    });

    it("uses getHistoryBefore when only before is supplied", async () => {
      const service = fakeMessagesService();
      const controller = new MessagesController(service);

      await controller.history({ authContext }, "conversation-1", undefined, "10");

      expect(service.getHistoryBefore).toHaveBeenCalledWith(
        "conversation-1",
        "user-1",
        10,
        undefined,
      );
    });

    it("defaults to the newest page when neither cursor is supplied", async () => {
      const service = fakeMessagesService();
      const controller = new MessagesController(service);

      const result = await controller.history({ authContext }, "conversation-1");

      expect(service.getHistoryBefore).toHaveBeenCalledWith(
        "conversation-1",
        "user-1",
        null,
        undefined,
      );
      expect(result.messages).toHaveLength(1);
    });
  });
});
