import { describe, expect, it, vi } from "vitest";
import { ModerationDeepScanService } from "./moderation-deep-scan.service";
import type { MessagesRepository } from "../repositories/messages.repository";
import type { RealtimePublisherService } from "../../realtime/realtime-publisher.service";
import type { NotificationsService } from "../../notifications/notifications.service";
import type { Message } from "@convene/db";

function fakeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    conversationId: "conversation-1",
    senderId: "user-1",
    clientMsgId: "client-msg-1",
    sequence: 5,
    type: "text",
    body: "some violating content",
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
    findMessageById: vi.fn(async () => fakeMessage()),
    retractMessage: vi.fn(async () =>
      fakeMessage({
        body: null,
        deletedAt: new Date(),
        deletedScope: "everyone",
        moderationState: "retracted",
      }),
    ),
    createModerationCase: vi.fn(async () => ({ id: "report-1" })),
    ...overrides,
  } as unknown as MessagesRepository;
}

function fakePublisher(
  overrides: Partial<Record<keyof RealtimePublisherService, unknown>> = {},
): RealtimePublisherService {
  return { publish: vi.fn(async () => 1), ...overrides } as unknown as RealtimePublisherService;
}

function fakeNotifications(
  overrides: Partial<Record<keyof NotificationsService, unknown>> = {},
): NotificationsService {
  return { notify: vi.fn(async () => undefined), ...overrides } as unknown as NotificationsService;
}

describe("ModerationDeepScanService.retract — async moderation retraction", () => {
  it("tombstones the message, publishes message.deleted (removes it from both clients), notifies the sender, and creates a moderation case", async () => {
    const repo = fakeRepo();
    const publisher = fakePublisher();
    const notifications = fakeNotifications();
    const service = new ModerationDeepScanService(repo, publisher, notifications);

    await service.retract("message-1", "toxicity score above threshold");

    expect(repo.retractMessage).toHaveBeenCalledWith("message-1", expect.any(Date));
    expect(publisher.publish).toHaveBeenCalledWith("rt:conv:conversation-1", "message.deleted", {
      message_id: "message-1",
      scope: "everyone",
      reason: "moderation",
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", category: "moderation_action" }),
    );
    expect(repo.createModerationCase).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: "user-1", targetMessageId: "message-1" }),
    );
  });

  it("404s when the message doesn't exist", async () => {
    const repo = fakeRepo({ findMessageById: vi.fn(async () => null) });
    const service = new ModerationDeepScanService(repo, fakePublisher());
    await expect(service.retract("missing", "reason")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is a no-op (no publish, no notify) when the message was already deleted/retracted", async () => {
    const repo = fakeRepo({ retractMessage: vi.fn(async () => null) });
    const publisher = fakePublisher();
    const notifications = fakeNotifications();
    const service = new ModerationDeepScanService(repo, publisher, notifications);

    await service.retract("message-1", "reason");

    expect(publisher.publish).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("works without a NotificationsService injected (optional dependency)", async () => {
    const repo = fakeRepo();
    const service = new ModerationDeepScanService(repo, fakePublisher());
    await expect(service.retract("message-1", "reason")).resolves.toBeUndefined();
  });
});
