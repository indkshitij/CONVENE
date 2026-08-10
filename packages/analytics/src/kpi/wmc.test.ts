import { describe, expect, it } from "vitest";
import {
  computeWeeklyMwc,
  evaluateConversationForWmc,
  isoWeekStart,
  type WmcMessageInput,
} from "./wmc";

const BASE = new Date("2026-03-02T10:00:00.000Z"); // a Monday

function messagesAlternating(
  conversationId: string,
  count: number,
  startOffsetMinutes = 0,
  gapMinutes = 10,
): WmcMessageInput[] {
  return Array.from({ length: count }, (_, i) => ({
    conversationId,
    senderId: i % 2 === 0 ? "alice" : "bob",
    createdAt: new Date(BASE.getTime() + (startOffsetMinutes + i * gapMinutes) * 60_000),
  }));
}

describe("evaluateConversationForWmc", () => {
  it("qualifies: 12 alternating messages (6 each) all within the 24h window", () => {
    const result = evaluateConversationForWmc(messagesAlternating("c1", 12));
    expect(result?.qualifies).toBe(true);
    expect(result?.countsWithinWindow).toEqual({ alice: 6, bob: 6 });
  });

  // Explicit near-miss case from the prompt: "5 messages."
  it("near-miss: only 5 messages total (fewer than 6 from either party) does not qualify", () => {
    const result = evaluateConversationForWmc(messagesAlternating("c1", 5));
    expect(result?.qualifies).toBe(false);
  });

  it("near-miss: 11 messages — one party has 6, the other only 5 — does not qualify", () => {
    const result = evaluateConversationForWmc(messagesAlternating("c1", 11));
    expect(result?.countsWithinWindow).toEqual({ alice: 6, bob: 5 });
    expect(result?.qualifies).toBe(false);
  });

  // Explicit near-miss case from the prompt: "one-sided."
  it("near-miss: one-sided — 12 messages all from the same party, none from the other — does not qualify", () => {
    const messages: WmcMessageInput[] = Array.from({ length: 12 }, (_, i) => ({
      conversationId: "c1",
      senderId: "alice",
      createdAt: new Date(BASE.getTime() + i * 10 * 60_000),
    }));
    const result = evaluateConversationForWmc(messages);
    expect(result?.qualifies).toBe(false);
    expect(result?.countsWithinWindow).toEqual({ alice: 12 });
  });

  // Explicit near-miss case from the prompt: "25 hours" — the 12th
  // (qualifying) message lands just past the 24h window from first
  // contact, so it doesn't count toward either party's in-window total.
  it("near-miss: the 6th message from the second party arrives at 25 hours — outside the 24h window — does not qualify", () => {
    const onTime = messagesAlternating("c1", 10); // 5 each, all early
    const late: WmcMessageInput[] = [
      {
        conversationId: "c1",
        senderId: "alice",
        createdAt: new Date(BASE.getTime() + 25 * 60 * 60_000),
      },
      {
        conversationId: "c1",
        senderId: "bob",
        createdAt: new Date(BASE.getTime() + 25 * 60 * 60_000 + 60_000),
      },
    ];
    const result = evaluateConversationForWmc([...onTime, ...late]);
    expect(result?.countsWithinWindow).toEqual({ alice: 5, bob: 5 });
    expect(result?.qualifies).toBe(false);
  });

  it("qualifies at exactly the 24h boundary (inclusive)", () => {
    const onTime = messagesAlternating("c1", 10);
    const boundary: WmcMessageInput[] = [
      {
        conversationId: "c1",
        senderId: "alice",
        createdAt: new Date(BASE.getTime() + 24 * 60 * 60_000),
      },
      {
        conversationId: "c1",
        senderId: "bob",
        createdAt: new Date(BASE.getTime() + 24 * 60 * 60_000),
      },
    ];
    const result = evaluateConversationForWmc([...onTime, ...boundary]);
    expect(result?.qualifies).toBe(true);
  });

  it("excludes system messages (null senderId) from either party's count", () => {
    const messages = messagesAlternating("c1", 11); // alice:6 bob:5
    const system: WmcMessageInput = {
      conversationId: "c1",
      senderId: null,
      createdAt: new Date(BASE.getTime() + 5 * 60_000),
    };
    const result = evaluateConversationForWmc([...messages, system]);
    expect(result?.countsWithinWindow).toEqual({ alice: 6, bob: 5 });
    expect(result?.qualifies).toBe(false);
  });

  it("a conversation with only one ever-messaging party never qualifies regardless of volume", () => {
    const messages: WmcMessageInput[] = Array.from({ length: 20 }, (_, i) => ({
      conversationId: "c1",
      senderId: "alice",
      createdAt: new Date(BASE.getTime() + i * 60_000),
    }));
    expect(evaluateConversationForWmc(messages)?.qualifies).toBe(false);
  });

  it("returns null for an empty message list", () => {
    expect(evaluateConversationForWmc([])).toBeNull();
  });
});

describe("computeWeeklyMwc", () => {
  it("counts only qualifying conversations, bucketed by the week of first contact", () => {
    const qualifying = messagesAlternating("c1", 12);
    const nonQualifying = messagesAlternating("c2", 5);
    const weekly = computeWeeklyMwc([...qualifying, ...nonQualifying]);
    expect(weekly.get(isoWeekStart(BASE))).toBe(1);
  });

  it("aggregates multiple qualifying conversations in the same week", () => {
    const c1 = messagesAlternating("c1", 12);
    const c2 = messagesAlternating("c2", 12, 5);
    const weekly = computeWeeklyMwc([...c1, ...c2]);
    expect(weekly.get(isoWeekStart(BASE))).toBe(2);
  });

  it("buckets a conversation from a later week separately", () => {
    const laterWeek = new Date(BASE.getTime() + 10 * 24 * 60 * 60_000);
    const c1 = messagesAlternating("c1", 12);
    const c2: WmcMessageInput[] = Array.from({ length: 12 }, (_, i) => ({
      conversationId: "c2",
      senderId: i % 2 === 0 ? "carol" : "dave",
      createdAt: new Date(laterWeek.getTime() + i * 10 * 60_000),
    }));
    const weekly = computeWeeklyMwc([...c1, ...c2]);
    expect(weekly.get(isoWeekStart(BASE))).toBe(1);
    expect(weekly.get(isoWeekStart(laterWeek))).toBe(1);
  });
});

describe("isoWeekStart", () => {
  it("returns the same Monday for every day in that week", () => {
    const monday = isoWeekStart(new Date("2026-03-02T00:00:00.000Z"));
    const wednesday = isoWeekStart(new Date("2026-03-04T23:59:59.000Z"));
    const sunday = isoWeekStart(new Date("2026-03-08T12:00:00.000Z"));
    expect(monday).toBe("2026-03-02");
    expect(wednesday).toBe("2026-03-02");
    expect(sunday).toBe("2026-03-02");
  });
});
