import { describe, expect, it, vi } from "vitest";
import { MessagesService } from "./messages.service";
import type { MessagesRepository } from "../repositories/messages.repository";
import type { RealtimePublisherService } from "../../realtime/realtime-publisher.service";
import type { Conversation, Message } from "@convene/db";

function fakeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conversation-1",
    connectionId: "connection-1",
    type: "direct",
    state: "active",
    lastMessageAt: null,
    messageSeq: 0,
    createdAt: new Date("2026-08-08T00:00:00Z"),
    ...overrides,
  } as Conversation;
}

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

function fakeRepo(
  overrides: Partial<Record<keyof MessagesRepository, unknown>> = {},
): MessagesRepository {
  return {
    findConversationById: vi.fn(async () => fakeConversation()),
    loadParticipantIds: vi.fn(async () => ["user-1", "user-2"]),
    sendMessage: vi.fn(async () => ({ message: fakeMessage(), isReplay: false })),
    trailingConsecutiveSenderCount: vi.fn(async () => 0),
    listAfterSequence: vi.fn(async () => [fakeMessage()]),
    listBeforeSequence: vi.fn(async () => [fakeMessage()]),
    findMessageById: vi.fn(async () => fakeMessage()),
    editMessage: vi.fn(async () => fakeMessage({ body: "edited", editCount: 1 })),
    hideForUser: vi.fn(async () => undefined),
    deleteForEveryone: vi.fn(async () =>
      fakeMessage({
        body: null,
        deletedAt: new Date("2026-08-08T10:05:00Z"),
        deletedScope: "everyone",
      }),
    ),
    setReaction: vi.fn(async () => undefined),
    removeReaction: vi.fn(async () => undefined),
    forwardMessage: vi.fn(async () =>
      fakeMessage({ id: "message-2", conversationId: "conversation-2", clientMsgId: "generated" }),
    ),
    loadConversationIdsForUser: vi.fn(async () => ["conversation-1"]),
    searchMessages: vi.fn(async () => [fakeMessage()]),
    attachLinkPreview: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MessagesRepository;
}

function fakePublisher(
  overrides: Partial<Record<keyof RealtimePublisherService, unknown>> = {},
): RealtimePublisherService {
  return { publish: vi.fn(async () => 1), ...overrides } as unknown as RealtimePublisherService;
}

function fakePushProducer() {
  return { enqueuePush: vi.fn(async () => undefined), cancelPush: vi.fn(async () => undefined) };
}

const params = {
  conversationId: "conversation-1",
  senderId: "user-1",
  clientMsgId: "client-msg-1",
  body: "hello",
  replyToId: null,
  attachments: [],
};

describe("MessagesService.sendMessage", () => {
  it("sends a message and publishes to rt:conv:{id}", async () => {
    const repo = fakeRepo();
    const publisher = fakePublisher();
    const service = new MessagesService(repo, publisher);

    const result = await service.sendMessage(params);

    expect(result.message.id).toBe("message-1");
    expect(publisher.publish).toHaveBeenCalledWith(
      "rt:conv:conversation-1",
      "message.sent",
      expect.objectContaining({ id: "message-1", sequence: 1 }),
    );
  });

  it("does not re-publish an idempotent replay", async () => {
    const repo = fakeRepo({
      sendMessage: vi.fn(async () => ({ message: fakeMessage(), isReplay: true })),
    });
    const publisher = fakePublisher();
    const service = new MessagesService(repo, publisher);

    await service.sendMessage(params);

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("404s when the conversation doesn't exist", async () => {
    const repo = fakeRepo({ findConversationById: vi.fn(async () => null) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.sendMessage(params)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
  });

  it("404s when the sender isn't a participant (not 403 — identical copy either way)", async () => {
    const repo = fakeRepo({ loadParticipantIds: vi.fn(async () => ["user-2", "user-3"]) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.sendMessage(params)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
  });

  it("403s when the conversation is frozen", async () => {
    const repo = fakeRepo({
      findConversationById: vi.fn(async () => fakeConversation({ state: "frozen" })),
    });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.sendMessage(params)).rejects.toMatchObject({
      code: "CONVERSATION_FROZEN",
    });
  });

  it("never calls the repository's sendMessage when membership fails, so no crash-injected DB write is ever attempted for an unauthorized caller", async () => {
    const repo = fakeRepo({ loadParticipantIds: vi.fn(async () => []) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.sendMessage(params)).rejects.toBeDefined();
    expect(repo.sendMessage).not.toHaveBeenCalled();
  });

  it("never acknowledges when the repository throws (crash-injection at the durability boundary)", async () => {
    const repo = fakeRepo({
      sendMessage: vi.fn(async () => {
        throw new Error("simulated crash mid-transaction");
      }),
    });
    const publisher = fakePublisher();
    const service = new MessagesService(repo, publisher);

    await expect(service.sendMessage(params)).rejects.toThrow("simulated crash mid-transaction");
    // No ack was ever constructed and no publish happened for a write
    // that never durably committed.
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});

describe("MessagesService.sendMessage — BR-MSG-06 push scheduling", () => {
  it("schedules a delayed push for every participant except the sender", async () => {
    const repo = fakeRepo({
      loadParticipantIds: vi.fn(async () => ["user-1", "user-2", "user-3"]),
    });
    const pushProducer = fakePushProducer();
    const service = new MessagesService(
      repo,
      fakePublisher(),
      undefined,
      undefined,
      pushProducer as never,
    );

    await service.sendMessage(params);
    await new Promise((resolve) => setImmediate(resolve)); // let the fire-and-forget schedulePush() settle

    expect(pushProducer.enqueuePush).toHaveBeenCalledWith({
      messageId: "message-1",
      recipientUserId: "user-2",
      conversationId: "conversation-1",
    });
    expect(pushProducer.enqueuePush).toHaveBeenCalledWith({
      messageId: "message-1",
      recipientUserId: "user-3",
      conversationId: "conversation-1",
    });
    expect(pushProducer.enqueuePush).not.toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "user-1" }),
    );
  });

  it("does not schedule a push for an idempotent replay", async () => {
    const repo = fakeRepo({
      sendMessage: vi.fn(async () => ({ message: fakeMessage(), isReplay: true })),
    });
    const pushProducer = fakePushProducer();
    const service = new MessagesService(
      repo,
      fakePublisher(),
      undefined,
      undefined,
      pushProducer as never,
    );

    await service.sendMessage(params);
    await new Promise((resolve) => setImmediate(resolve));

    expect(pushProducer.enqueuePush).not.toHaveBeenCalled();
  });
});

describe("MessagesService.sendMessage — BR-MSG-04 monologue limit", () => {
  it("allows the 3rd consecutive message", async () => {
    const repo = fakeRepo({ trailingConsecutiveSenderCount: vi.fn(async () => 2) });
    const service = new MessagesService(repo, fakePublisher());
    const result = await service.sendMessage(params);
    expect(result.message.id).toBe("message-1");
  });

  it("blocks the 4th consecutive message with 429 AWAITING_REPLY", async () => {
    const repo = fakeRepo({ trailingConsecutiveSenderCount: vi.fn(async () => 3) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.sendMessage(params)).rejects.toMatchObject({ code: "AWAITING_REPLY" });
    expect(repo.sendMessage).not.toHaveBeenCalled();
  });

  it("releases the limit once a reply resets the trailing streak", async () => {
    // A reply from the other participant resets what
    // trailingConsecutiveSenderCount() sees (it stops counting at the
    // first different sender), so the repository call returning 0 here
    // stands in for "someone else replied."
    const repo = fakeRepo({ trailingConsecutiveSenderCount: vi.fn(async () => 0) });
    const service = new MessagesService(repo, fakePublisher());
    const result = await service.sendMessage(params);
    expect(result.message.id).toBe("message-1");
  });
});

describe("MessagesService.sendMessage — BR-MSG-13 first-message quality nudge", () => {
  it("flags a short first message as a soft nudge, without blocking the send", async () => {
    const repo = fakeRepo({
      sendMessage: vi.fn(async () => ({
        message: fakeMessage({ sequence: 1, body: "hi" }),
        isReplay: false,
      })),
    });
    const service = new MessagesService(repo, fakePublisher());
    const result = await service.sendMessage({ ...params, body: "hi" });
    expect(result.qualityNudge).toBe(true);
  });

  it("flags a low-effort greeting pattern even if long enough", async () => {
    const repo = fakeRepo({
      sendMessage: vi.fn(async () => ({
        message: fakeMessage({ sequence: 1, body: "hello!!" }),
        isReplay: false,
      })),
    });
    const service = new MessagesService(repo, fakePublisher());
    const result = await service.sendMessage({ ...params, body: "hello!!" });
    expect(result.qualityNudge).toBe(true);
  });

  it("does not flag a substantive first message", async () => {
    const body = "Saw your work on payments infra, would love to connect and chat.";
    const repo = fakeRepo({
      sendMessage: vi.fn(async () => ({
        message: fakeMessage({ sequence: 1, body }),
        isReplay: false,
      })),
    });
    const service = new MessagesService(repo, fakePublisher());
    const result = await service.sendMessage({ ...params, body });
    expect(result.qualityNudge).toBe(false);
  });

  it("never flags a non-first message, however short", async () => {
    const repo = fakeRepo({
      sendMessage: vi.fn(async () => ({
        message: fakeMessage({ sequence: 5, body: "hi" }),
        isReplay: false,
      })),
    });
    const service = new MessagesService(repo, fakePublisher());
    const result = await service.sendMessage({ ...params, body: "hi" });
    expect(result.qualityNudge).toBe(false);
  });

  it("never flags an idempotent replay", async () => {
    const repo = fakeRepo({
      sendMessage: vi.fn(async () => ({
        message: fakeMessage({ sequence: 1, body: "hi" }),
        isReplay: true,
      })),
    });
    const service = new MessagesService(repo, fakePublisher());
    const result = await service.sendMessage({ ...params, body: "hi" });
    expect(result.qualityNudge).toBe(false);
  });
});

describe("MessagesService.getHistoryAfter — gap-free catch-up", () => {
  it("delegates to the repository after a membership check", async () => {
    const repo = fakeRepo();
    const service = new MessagesService(repo, fakePublisher());

    const rows = await service.getHistoryAfter("conversation-1", "user-1", 5, 20);

    expect(rows).toHaveLength(1);
    expect(repo.listAfterSequence).toHaveBeenCalledWith("conversation-1", 5, 20);
  });

  it("clamps an unreasonable limit and defaults a missing one", async () => {
    const repo = fakeRepo();
    const service = new MessagesService(repo, fakePublisher());

    await service.getHistoryAfter("conversation-1", "user-1", 5, 10_000);
    expect(repo.listAfterSequence).toHaveBeenCalledWith("conversation-1", 5, 200);

    await service.getHistoryAfter("conversation-1", "user-1", 5, undefined);
    expect(repo.listAfterSequence).toHaveBeenCalledWith("conversation-1", 5, 50);
  });

  it("404s a non-participant reading history", async () => {
    const repo = fakeRepo({ loadParticipantIds: vi.fn(async () => ["someone-else"]) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.getHistoryAfter("conversation-1", "user-1", 0)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
  });
});

describe("MessagesService.getHistoryBefore", () => {
  it("delegates to the repository", async () => {
    const repo = fakeRepo();
    const service = new MessagesService(repo, fakePublisher());
    await service.getHistoryBefore("conversation-1", "user-1", 10, 25);
    expect(repo.listBeforeSequence).toHaveBeenCalledWith("conversation-1", 10, 25);
  });
});

describe("MessagesService.editMessage", () => {
  it("edits and publishes message.updated", async () => {
    const repo = fakeRepo();
    const publisher = fakePublisher();
    const service = new MessagesService(repo, publisher);
    const result = await service.editMessage("message-1", "user-1", "edited");
    expect(result.body).toBe("edited");
    expect(publisher.publish).toHaveBeenCalledWith(
      "rt:conv:conversation-1",
      "message.updated",
      expect.objectContaining({ body: "edited" }),
    );
  });

  it("404s when the message doesn't exist", async () => {
    const repo = fakeRepo({ findMessageById: vi.fn(async () => null) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.editMessage("missing", "user-1", "x")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("forbids editing someone else's message", async () => {
    const repo = fakeRepo({
      findMessageById: vi.fn(async () => fakeMessage({ senderId: "someone-else" })),
    });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.editMessage("message-1", "user-1", "x")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("410s (gone) when the message was already deleted", async () => {
    const repo = fakeRepo({
      findMessageById: vi.fn(async () => fakeMessage({ deletedAt: new Date() })),
    });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.editMessage("message-1", "user-1", "x")).rejects.toMatchObject({
      code: "MESSAGE_DELETED",
    });
  });

  it("409s (edit window expired / max edits) when the repository guard rejects", async () => {
    const repo = fakeRepo({ editMessage: vi.fn(async () => null) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.editMessage("message-1", "user-1", "x")).rejects.toMatchObject({
      code: "EDIT_WINDOW_EXPIRED",
    });
  });
});

describe("MessagesService.deleteMessage", () => {
  it("scope=me hides for the caller without requiring ownership", async () => {
    const repo = fakeRepo({
      findMessageById: vi.fn(async () => fakeMessage({ senderId: "someone-else" })),
    });
    const service = new MessagesService(repo, fakePublisher());
    await service.deleteMessage("message-1", "user-1", "me");
    expect(repo.hideForUser).toHaveBeenCalledWith("message-1", "user-1");
  });

  it("scope=everyone requires ownership", async () => {
    const repo = fakeRepo({
      findMessageById: vi.fn(async () => fakeMessage({ senderId: "someone-else" })),
    });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.deleteMessage("message-1", "user-1", "everyone")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("scope=everyone publishes message.deleted", async () => {
    const repo = fakeRepo();
    const publisher = fakePublisher();
    const service = new MessagesService(repo, publisher);
    await service.deleteMessage("message-1", "user-1", "everyone");
    expect(publisher.publish).toHaveBeenCalledWith("rt:conv:conversation-1", "message.deleted", {
      message_id: "message-1",
      scope: "everyone",
    });
  });

  it("409s when the 1h delete-for-everyone window has passed", async () => {
    const repo = fakeRepo({ deleteForEveryone: vi.fn(async () => null) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.deleteMessage("message-1", "user-1", "everyone")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("404s when the message doesn't exist", async () => {
    const repo = fakeRepo({ findMessageById: vi.fn(async () => null) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.deleteMessage("missing", "user-1", "me")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("MessagesService reactions", () => {
  it("setReaction upserts and publishes reaction.updated", async () => {
    const repo = fakeRepo();
    const publisher = fakePublisher();
    const service = new MessagesService(repo, publisher);
    await service.setReaction("message-1", "user-1", "👍");
    expect(repo.setReaction).toHaveBeenCalledWith("message-1", expect.any(Date), "user-1", "👍");
    expect(publisher.publish).toHaveBeenCalledWith("rt:conv:conversation-1", "reaction.updated", {
      message_id: "message-1",
      emoji: "👍",
      user_id: "user-1",
      action: "set",
    });
  });

  it("removeReaction deletes and publishes reaction.updated", async () => {
    const repo = fakeRepo();
    const publisher = fakePublisher();
    const service = new MessagesService(repo, publisher);
    await service.removeReaction("message-1", "user-1");
    expect(repo.removeReaction).toHaveBeenCalledWith("message-1", "user-1");
    expect(publisher.publish).toHaveBeenCalledWith("rt:conv:conversation-1", "reaction.updated", {
      message_id: "message-1",
      user_id: "user-1",
      action: "remove",
    });
  });

  it("404s reacting to a nonexistent message", async () => {
    const repo = fakeRepo({ findMessageById: vi.fn(async () => null) });
    const service = new MessagesService(repo, fakePublisher());
    await expect(service.setReaction("missing", "user-1", "👍")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("MessagesService.forwardMessage", () => {
  it("forwards to each target conversation, attributed to the forwarder", async () => {
    const repo = fakeRepo();
    const publisher = fakePublisher();
    const service = new MessagesService(repo, publisher);
    const result = await service.forwardMessage("message-1", "user-1", ["conversation-2"]);
    expect(result).toHaveLength(1);
    expect(repo.forwardMessage).toHaveBeenCalledWith(
      "hello",
      "user-1",
      "conversation-2",
      "message-1",
      expect.any(Date),
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      "rt:conv:conversation-2",
      "message.sent",
      expect.objectContaining({ sender_id: "user-1" }),
    );
  });

  it("rejects more than 3 forward targets", async () => {
    const repo = fakeRepo();
    const service = new MessagesService(repo, fakePublisher());
    await expect(
      service.forwardMessage("message-1", "user-1", ["c1", "c2", "c3", "c4"]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repo.forwardMessage).not.toHaveBeenCalled();
  });

  it("requires the forwarder to be a participant of every target conversation", async () => {
    const repo = fakeRepo({
      loadParticipantIds: vi.fn(async (conversationId: string) =>
        conversationId === "conversation-1" ? ["user-1", "user-2"] : ["someone-else"],
      ),
    });
    const service = new MessagesService(repo, fakePublisher());
    await expect(
      service.forwardMessage("message-1", "user-1", ["conversation-2"]),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });
});

describe("MessagesService.searchMessages", () => {
  it("scopes search to the caller's own conversations", async () => {
    const repo = fakeRepo();
    const service = new MessagesService(repo, fakePublisher());
    const results = await service.searchMessages("user-1", "payments", null, 10);
    expect(results).toHaveLength(1);
    expect(repo.searchMessages).toHaveBeenCalledWith(["conversation-1"], "payments", null, 10);
  });

  it("returns no results for a conversation_id the caller isn't a member of, without querying", async () => {
    const repo = fakeRepo();
    const service = new MessagesService(repo, fakePublisher());
    const results = await service.searchMessages("user-1", "payments", "conversation-99", 10);
    expect(results).toEqual([]);
    expect(repo.searchMessages).not.toHaveBeenCalled();
  });
});
