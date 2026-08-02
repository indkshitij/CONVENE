import { describe, expect, it } from "vitest";
import { type IntentRef, clamp, resolveIntentFamily, systemClock } from "./types";

function intent(type: IntentRef["type"], isPrimary = false): IntentRef {
  return { type, isPrimary };
}

describe("systemClock", () => {
  it("returns the current time", () => {
    const before = Date.now();
    const now = systemClock.now();
    const after = Date.now();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("clamp", () => {
  it("returns the value when within bounds", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it("floors at min", () => {
    expect(clamp(-1, 0, 1)).toBe(0);
  });

  it("ceils at max", () => {
    expect(clamp(2, 0, 1)).toBe(1);
  });
});

describe("resolveIntentFamily", () => {
  it("returns cofounder when both sides have need_cofounder", () => {
    expect(resolveIntentFamily([intent("need_cofounder")], [intent("need_cofounder")])).toBe(
      "cofounder",
    );
  });

  it("returns hiring when the viewer has hiring", () => {
    expect(resolveIntentFamily([intent("hiring")], [intent("coffee_chat")])).toBe("hiring");
  });

  it("returns hiring when the candidate has hiring", () => {
    expect(resolveIntentFamily([intent("coffee_chat")], [intent("hiring")])).toBe("hiring");
  });

  it("returns hiring when the viewer has looking_for_job", () => {
    expect(resolveIntentFamily([intent("looking_for_job")], [intent("coffee_chat")])).toBe(
      "hiring",
    );
  });

  it("returns hiring when the viewer has internship", () => {
    expect(resolveIntentFamily([intent("internship")], [intent("coffee_chat")])).toBe("hiring");
  });

  it("returns hiring when the viewer has freelancer", () => {
    expect(resolveIntentFamily([intent("freelancer")], [intent("coffee_chat")])).toBe("hiring");
  });

  it("returns mentorship_seeking when the viewer has need_mentor", () => {
    expect(resolveIntentFamily([intent("need_mentor")], [intent("coffee_chat")])).toBe(
      "mentorship_seeking",
    );
  });

  it("returns mentorship_offering when the viewer has need_mentee", () => {
    expect(resolveIntentFamily([intent("need_mentee")], [intent("coffee_chat")])).toBe(
      "mentorship_offering",
    );
  });

  it("returns ai_collaboration when the viewer has it", () => {
    expect(resolveIntentFamily([intent("ai_collaboration")], [intent("coffee_chat")])).toBe(
      "ai_collaboration",
    );
  });

  it("returns ai_collaboration when the candidate has it", () => {
    expect(resolveIntentFamily([intent("coffee_chat")], [intent("ai_collaboration")])).toBe(
      "ai_collaboration",
    );
  });

  it("returns learning when the viewer has it", () => {
    expect(resolveIntentFamily([intent("learning")], [intent("coffee_chat")])).toBe("learning");
  });

  it("returns learning when the candidate has it", () => {
    expect(resolveIntentFamily([intent("coffee_chat")], [intent("learning")])).toBe("learning");
  });

  it("falls back to peer when nothing else matches", () => {
    expect(resolveIntentFamily([intent("coffee_chat")], [intent("business_networking")])).toBe(
      "peer",
    );
  });
});
