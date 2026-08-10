import { describe, expect, it, vi } from "vitest";
import { ConversationsService } from "./conversations.service";
import type { ConversationsRepository } from "../repositories/conversations.repository";
import type { PushNotificationProducer } from "./push-notification.producer";

function fakeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conversation-1",
    userId: "user-1",
    unreadCount: 2,
    lastReadSeq: 3,
    isPinned: false,
    isArchived: false,
    mutedUntil: null,
    joinedAt: new Date(),
    ...overrides,
  };
}

function fakeRepo(
  overrides: Partial<Record<keyof ConversationsRepository, unknown>> = {},
): ConversationsRepository {
  return {
    listForUser: vi.fn(async () => []),
    loadParticipant: vi.fn(async () => fakeParticipant()),
    countPinned: vi.fn(async () => 0),
    updateSettings: vi.fn(async () => undefined),
    markRead: vi.fn(async () => ({ previousLastReadSeq: 3, newLastReadSeq: 10 })),
    loadMessageIdsInSequenceRange: vi.fn(async () => ["message-4", "message-5"]),
    ...overrides,
  } as unknown as ConversationsRepository;
}

function fakePushProducer(
  overrides: Partial<Record<keyof PushNotificationProducer, unknown>> = {},
): PushNotificationProducer {
  return {
    enqueuePush: vi.fn(async () => undefined),
    cancelPush: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as PushNotificationProducer;
}

describe("ConversationsService.listConversations", () => {
  it("delegates to the repository", async () => {
    const repo = fakeRepo();
    const service = new ConversationsService(repo);
    await service.listConversations("user-1", "pinned", 20);
    expect(repo.listForUser).toHaveBeenCalledWith("user-1", "pinned", 20);
  });
});

describe("ConversationsService.markRead", () => {
  it("updates the read cursor and cancels pending pushes for newly-covered messages (BR-MSG-06)", async () => {
    const repo = fakeRepo();
    const pushProducer = fakePushProducer();
    const service = new ConversationsService(repo, pushProducer);

    const result = await service.markRead("conversation-1", "user-1", 10);

    expect(repo.markRead).toHaveBeenCalledWith("conversation-1", "user-1", 10);
    expect(repo.loadMessageIdsInSequenceRange).toHaveBeenCalledWith("conversation-1", 3, 10);
    expect(pushProducer.cancelPush).toHaveBeenCalledWith("message-4", "user-1");
    expect(pushProducer.cancelPush).toHaveBeenCalledWith("message-5", "user-1");
    expect(result.lastReadSeq).toBe(10);
  });

  it("does not touch pushes when nothing new was covered (re-reading the same or an older sequence)", async () => {
    const repo = fakeRepo({
      markRead: vi.fn(async () => ({ previousLastReadSeq: 10, newLastReadSeq: 10 })),
    });
    const pushProducer = fakePushProducer();
    const service = new ConversationsService(repo, pushProducer);

    await service.markRead("conversation-1", "user-1", 5); // stale request, GREATEST keeps it at 10

    expect(pushProducer.cancelPush).not.toHaveBeenCalled();
  });

  it("404s a non-participant", async () => {
    const repo = fakeRepo({ loadParticipant: vi.fn(async () => null) });
    const service = new ConversationsService(repo);
    await expect(service.markRead("conversation-1", "user-1", 10)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
  });
});

describe("ConversationsService.updateSettings", () => {
  it("pins a conversation when under the limit", async () => {
    const repo = fakeRepo({ countPinned: vi.fn(async () => 4) });
    const service = new ConversationsService(repo);
    await service.updateSettings("conversation-1", "user-1", { isPinned: true });
    expect(repo.updateSettings).toHaveBeenCalledWith("conversation-1", "user-1", {
      isPinned: true,
    });
  });

  it("rejects pinning a 6th conversation (max 5)", async () => {
    const repo = fakeRepo({ countPinned: vi.fn(async () => 5) });
    const service = new ConversationsService(repo);
    await expect(
      service.updateSettings("conversation-1", "user-1", { isPinned: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repo.updateSettings).not.toHaveBeenCalled();
  });

  it("unpinning never checks the limit", async () => {
    const repo = fakeRepo();
    const service = new ConversationsService(repo);
    await service.updateSettings("conversation-1", "user-1", { isPinned: false });
    expect(repo.countPinned).not.toHaveBeenCalled();
  });

  it("404s a non-participant", async () => {
    const repo = fakeRepo({ loadParticipant: vi.fn(async () => null) });
    const service = new ConversationsService(repo);
    await expect(
      service.updateSettings("conversation-1", "user-1", { isArchived: true }),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });
});
