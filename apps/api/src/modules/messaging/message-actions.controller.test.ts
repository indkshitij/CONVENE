import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { MessageActionsController, MessageSearchController } from "./message-actions.controller";
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
    editMessage: vi.fn(async () => fakeMessage({ body: "edited" })),
    deleteMessage: vi.fn(async () => undefined),
    setReaction: vi.fn(async () => undefined),
    removeReaction: vi.fn(async () => undefined),
    forwardMessage: vi.fn(async () => [fakeMessage({ id: "message-2" })]),
    searchMessages: vi.fn(async () => [fakeMessage()]),
    ...overrides,
  } as unknown as MessagesService;
}

describe("MessageActionsController", () => {
  it("PATCH edits and returns the card", async () => {
    const service = fakeMessagesService();
    const controller = new MessageActionsController(service);
    const result = await controller.edit({ authContext }, "message-1", { body: "edited" });
    expect(service.editMessage).toHaveBeenCalledWith("message-1", "user-1", "edited");
    expect(result.body).toBe("edited");
  });

  it("DELETE requires a valid scope", async () => {
    const controller = new MessageActionsController(fakeMessagesService());
    await expect(controller.remove({ authContext }, "message-1", "invalid")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("DELETE delegates with a valid scope", async () => {
    const service = fakeMessagesService();
    const controller = new MessageActionsController(service);
    await controller.remove({ authContext }, "message-1", "everyone");
    expect(service.deleteMessage).toHaveBeenCalledWith("message-1", "user-1", "everyone");
  });

  it("POST reactions delegates to setReaction", async () => {
    const service = fakeMessagesService();
    const controller = new MessageActionsController(service);
    await controller.react({ authContext }, "message-1", { emoji: "👍" });
    expect(service.setReaction).toHaveBeenCalledWith("message-1", "user-1", "👍");
  });

  it("DELETE reactions delegates to removeReaction", async () => {
    const service = fakeMessagesService();
    const controller = new MessageActionsController(service);
    await controller.unreact({ authContext }, "message-1");
    expect(service.removeReaction).toHaveBeenCalledWith("message-1", "user-1");
  });

  it("POST forward delegates and returns cards", async () => {
    const service = fakeMessagesService();
    const controller = new MessageActionsController(service);
    const result = await controller.forward({ authContext }, "message-1", {
      conversation_ids: ["conversation-2"],
    });
    expect(service.forwardMessage).toHaveBeenCalledWith("message-1", "user-1", ["conversation-2"]);
    expect(result.messages).toHaveLength(1);
  });
});

describe("MessageSearchController", () => {
  it("delegates to searchMessages", async () => {
    const service = fakeMessagesService();
    const controller = new MessageSearchController(service);
    const result = await controller.search({ authContext }, "payments", "conversation-1", "10");
    expect(service.searchMessages).toHaveBeenCalledWith("user-1", "payments", "conversation-1", 10);
    expect(result.messages).toHaveLength(1);
  });

  it("requires a non-empty q", async () => {
    const controller = new MessageSearchController(fakeMessagesService());
    await expect(controller.search({ authContext }, "")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(controller.search({ authContext }, undefined)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
