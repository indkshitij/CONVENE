import { describe, expect, it } from "vitest";
import { isConversationParticipant } from "./is-conversation-participant.policy";

describe("isConversationParticipant", () => {
  it("is true when the user is one of the participants", () => {
    expect(isConversationParticipant(["user-1", "user-2"], "user-2")).toBe(true);
  });

  it("is false when the user is not a participant", () => {
    expect(isConversationParticipant(["user-1", "user-2"], "user-3")).toBe(false);
  });

  it("is false for an empty participant list", () => {
    expect(isConversationParticipant([], "user-1")).toBe(false);
  });
});
