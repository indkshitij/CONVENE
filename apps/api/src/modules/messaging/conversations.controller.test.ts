import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { ConversationsController } from "./conversations.controller";
import type { ConversationsService } from "./services/conversations.service";
import type { ConversationListRow } from "./repositories/conversations.repository";

const authContext: AuthContext = {
  id: "user-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function fakeRow(overrides: Partial<ConversationListRow> = {}): ConversationListRow {
  return {
    conversationId: "conversation-1",
    state: "active",
    unreadCount: 2,
    lastReadSeq: 3,
    isPinned: false,
    isArchived: false,
    mutedUntil: null,
    otherUserId: "user-2",
    otherFullName: "Bob B",
    intentType: "need_mentor",
    lastMessageBody: "hello",
    lastMessageSenderId: "user-2",
    lastMessageCreatedAt: new Date("2026-08-08T10:00:00Z"),
    lastMessageType: "text",
    ...overrides,
  };
}

function fakeService(
  overrides: Partial<Record<keyof ConversationsService, unknown>> = {},
): ConversationsService {
  return {
    listConversations: vi.fn(async () => [fakeRow()]),
    markRead: vi.fn(async () => ({ unreadCount: 0, lastReadSeq: 10 })),
    updateSettings: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ConversationsService;
}

describe("ConversationsController", () => {
  describe("GET /conversations", () => {
    it("lists and maps to cards", async () => {
      const service = fakeService();
      const controller = new ConversationsController(service);
      const result = await controller.list({ authContext }, "pinned", "20");
      expect(service.listConversations).toHaveBeenCalledWith("user-1", "pinned", 20);
      expect(result.conversations[0]).toMatchObject({
        id: "conversation-1",
        participant: { user_id: "user-2", full_name: "Bob B" },
        connection: { intent: "need_mentor" },
        unread_count: 2,
      });
    });

    it("defaults to filter=all for an invalid filter value", async () => {
      const service = fakeService();
      const controller = new ConversationsController(service);
      await controller.list({ authContext }, "not-a-filter");
      expect(service.listConversations).toHaveBeenCalledWith("user-1", "all", undefined);
    });
  });

  describe("POST /conversations/:id/read", () => {
    it("delegates to markRead", async () => {
      const service = fakeService();
      const controller = new ConversationsController(service);
      const result = await controller.markRead({ authContext }, "conversation-1", {
        up_to_sequence: 10,
      });
      expect(service.markRead).toHaveBeenCalledWith("conversation-1", "user-1", 10);
      expect(result).toEqual({ unread_count: 0, last_read_seq: 10 });
    });
  });

  describe("PATCH /conversations/:id", () => {
    it("delegates to updateSettings, mapping only the fields present", async () => {
      const service = fakeService();
      const controller = new ConversationsController(service);
      await controller.updateSettings({ authContext }, "conversation-1", { is_pinned: true });
      expect(service.updateSettings).toHaveBeenCalledWith("conversation-1", "user-1", {
        isPinned: true,
      });
    });

    it("maps muted_until to a Date, and null to null", async () => {
      const service = fakeService();
      const controller = new ConversationsController(service);
      await controller.updateSettings({ authContext }, "conversation-1", { muted_until: null });
      expect(service.updateSettings).toHaveBeenCalledWith("conversation-1", "user-1", {
        mutedUntil: null,
      });
    });
  });
});
