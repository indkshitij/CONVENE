import { describe, expect, it, vi } from "vitest";
import { ConversationSummaryService } from "./conversation-summary.service";
import type { AiGatewayService } from "../gateway.service";
import type { MessagesRepository } from "../../messaging/repositories/messages.repository";
import type { AuthContext } from "../../../common/auth/auth-context";

const authContext: AuthContext = {
  id: "u1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function manyMessages(
  count: number,
  overrides: Partial<{
    body: string | null;
    deletedScope: string | null;
    moderationState: string;
  }> = {},
) {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index}`,
    senderId: index % 2 === 0 ? "u1" : "other",
    body: overrides.body === undefined ? `message number ${index}` : overrides.body,
    deletedScope: overrides.deletedScope ?? null,
    moderationState: overrides.moderationState ?? "clean",
  }));
}

describe("ConversationSummaryService — §12.7 privacy rules", () => {
  it("refuses a non-participant", async () => {
    const messagesRepository = {
      findConversationById: vi.fn(async () => ({ id: "conv-1" })),
      loadParticipantIds: vi.fn(async () => ["other-1", "other-2"]),
    } as unknown as MessagesRepository;
    const gateway = { invoke: vi.fn() } as unknown as AiGatewayService;
    const service = new ConversationSummaryService(messagesRepository, gateway);

    await expect(service.generate(authContext, "conv-1")).rejects.toMatchObject({
      code: "NOT_CONVERSATION_MEMBER",
    });
    expect(gateway.invoke).not.toHaveBeenCalled();
  });

  it("returns too_few_messages under the 15-message floor, without ever calling the model", async () => {
    const messagesRepository = {
      findConversationById: vi.fn(async () => ({ id: "conv-1" })),
      loadParticipantIds: vi.fn(async () => ["u1", "other"]),
      listBeforeSequence: vi.fn(async () => manyMessages(10)),
    } as unknown as MessagesRepository;
    const gateway = { invoke: vi.fn() } as unknown as AiGatewayService;
    const service = new ConversationSummaryService(messagesRepository, gateway);

    const result = await service.generate(authContext, "conv-1");
    expect(result).toEqual({ status: "too_few_messages" });
    expect(gateway.invoke).not.toHaveBeenCalled();
  });

  it("excludes retracted and deleted messages from what the model ever sees", async () => {
    const messages = [
      ...manyMessages(15),
      {
        id: "retracted-1",
        senderId: "other",
        body: null,
        deletedScope: null,
        moderationState: "retracted",
      },
      {
        id: "deleted-1",
        senderId: "u1",
        body: "should be hidden too",
        deletedScope: "everyone",
        moderationState: "clean",
      },
    ];
    const messagesRepository = {
      findConversationById: vi.fn(async () => ({ id: "conv-1" })),
      loadParticipantIds: vi.fn(async () => ["u1", "other"]),
      listBeforeSequence: vi.fn(async () => messages),
    } as unknown as MessagesRepository;
    const gateway = {
      invoke: vi.fn(async () => ({
        status: "ok",
        cached: false,
        data: {
          bullets: ["a", "b", "c"],
          decisions: [],
          open_questions: [],
          suggested_follow_up: { time_proposal: null, note: "x" },
        },
      })),
    } as unknown as AiGatewayService;
    const service = new ConversationSummaryService(messagesRepository, gateway);

    await service.generate(authContext, "conv-1");

    const call = (gateway.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      untrustedUserContent: string[];
      groundingFacts: { message_count: number };
    };
    expect(call.untrustedUserContent).not.toContain(
      expect.stringContaining("should be hidden too"),
    );
    expect(call.groundingFacts.message_count).toBe(15);
  });

  it("the cache/storage key includes the generator's own id — private per generator, not shared between both participants", async () => {
    const messagesRepository = {
      findConversationById: vi.fn(async () => ({ id: "conv-1" })),
      loadParticipantIds: vi.fn(async () => ["u1", "other"]),
      listBeforeSequence: vi.fn(async () => manyMessages(15)),
    } as unknown as MessagesRepository;
    const gateway = {
      invoke: vi.fn(async () => ({
        status: "ok",
        cached: false,
        data: {
          bullets: ["a", "b", "c"],
          decisions: [],
          open_questions: [],
          suggested_follow_up: { time_proposal: null, note: "x" },
        },
      })),
    } as unknown as AiGatewayService;
    const service = new ConversationSummaryService(messagesRepository, gateway);

    await service.generate(authContext, "conv-1");

    const call = (gateway.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      groundingFacts: { generator_user_id: string };
    };
    expect(call.groundingFacts.generator_user_id).toBe("u1");
  });
});
