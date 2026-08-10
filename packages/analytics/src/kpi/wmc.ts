// PRD §21.1: "WMC (North Star) — Unique 1:1 conversations reaching ≥6
// messages from *both* parties within 24 h of first contact, per week."
// A pure function over message fixtures, deliberately with no DB/HTTP
// dependency — apps/api's own reporting job (real Postgres data) and
// this package's tests (fixture data) both call the exact same
// function, so "the North Star metric is computed to the letter of its
// definition" is true by construction, not by two implementations
// staying in sync by hand.
export interface WmcMessageInput {
  conversationId: string;
  senderId: string | null;
  createdAt: Date;
}

const WMC_MESSAGE_THRESHOLD = 6;
const WMC_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WmcConversationResult {
  conversationId: string;
  qualifies: boolean;
  firstContactAt: Date;
  // Count *within the 24h window*, not the conversation's lifetime
  // total — a party could send 20 messages over a week and still not
  // qualify if fewer than 6 landed inside the first 24h.
  countsWithinWindow: Record<string, number>;
}

// System messages (senderId === null) never count toward either
// party's total — they're not "from a party" at all, and § 21.1's
// "from both parties" is explicitly about the two human participants.
function isHumanMessage(
  message: WmcMessageInput,
): message is WmcMessageInput & { senderId: string } {
  return message.senderId !== null;
}

// Evaluates ONE conversation's messages (all of them, any timeframe —
// this function does its own windowing) against the WMC definition.
export function evaluateConversationForWmc(
  messages: WmcMessageInput[],
): WmcConversationResult | null {
  const humanMessages = messages
    .filter(isHumanMessage)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = humanMessages[0];
  if (!first) return null;

  const conversationId = first.conversationId;
  const windowEnd = new Date(first.createdAt.getTime() + WMC_WINDOW_MS);
  const withinWindow = humanMessages.filter((m) => m.createdAt.getTime() <= windowEnd.getTime());

  const countsWithinWindow: Record<string, number> = {};
  for (const message of withinWindow) {
    countsWithinWindow[message.senderId] = (countsWithinWindow[message.senderId] ?? 0) + 1;
  }

  const senders = Object.keys(countsWithinWindow);
  // §21.1 is explicit that this is a *1:1* conversation metric — a
  // conversation with only one participant ever messaging (senders.length
  // === 1) or more than two (a group thread, if one ever exists) can
  // never qualify, definitionally, not as a threshold miss.
  const qualifies =
    senders.length === 2 &&
    senders.every((sender) => (countsWithinWindow[sender] ?? 0) >= WMC_MESSAGE_THRESHOLD);

  return { conversationId, qualifies, firstContactAt: first.createdAt, countsWithinWindow };
}

// Groups a flat message fixture list by conversation, evaluates each,
// and buckets qualifying conversations by the calendar week (UTC,
// Monday-starting) their first contact fell in — "per week" in §21.1's
// definition.
export function computeWeeklyMwc(messages: WmcMessageInput[]): Map<string, number> {
  const byConversation = new Map<string, WmcMessageInput[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }

  const weekly = new Map<string, number>();
  for (const conversationMessages of byConversation.values()) {
    const result = evaluateConversationForWmc(conversationMessages);
    if (!result?.qualifies) continue;
    const weekKey = isoWeekStart(result.firstContactAt);
    weekly.set(weekKey, (weekly.get(weekKey) ?? 0) + 1);
  }
  return weekly;
}

// UTC Monday-starting week key (YYYY-MM-DD of that week's Monday) — no
// timezone-of-user consideration, matching every other weekly bucket in
// this codebase (e.g. AI quota's UTC-calendar-month convention).
export function isoWeekStart(date: Date): string {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay(); // 0=Sunday..6=Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  utcDate.setUTCDate(utcDate.getUTCDate() + diffToMonday);
  return utcDate.toISOString().slice(0, 10);
}
