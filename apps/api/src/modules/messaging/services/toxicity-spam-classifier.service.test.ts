import { describe, expect, it, vi } from "vitest";
import {
  spamActionForScore,
  ToxicitySpamClassifierService,
} from "./toxicity-spam-classifier.service";
import type { AiGatewayService } from "../../ai-gateway/gateway.service";

// §12.8's exact score-band table.
describe("spamActionForScore", () => {
  it.each([
    [0.1, "deliver"],
    [0.34, "deliver"],
    [0.36, "deliver_and_flag"],
    [0.65, "deliver_and_flag"],
    [0.66, "deliver_and_throttle"],
    [0.85, "deliver_and_throttle"],
    [0.86, "hold"],
    [1, "hold"],
  ] as const)("score %f -> %s", (score, expected) => {
    expect(spamActionForScore(score)).toBe(expected);
  });
});

function cleanClassification() {
  return {
    harassment: 0,
    hate: 0,
    sexual_content: 0,
    threats: 0,
    self_harm_risk_to_self: 0,
    severe_profanity: 0,
    spam_probability: 0,
  };
}

describe("ToxicitySpamClassifierService.classify", () => {
  it("fails closed (held_for_review) when the safety classifier is unavailable — never silently 'clean'", async () => {
    const gateway = {
      invoke: vi.fn(async () => ({ status: "unavailable" })),
    } as unknown as AiGatewayService;
    const service = new ToxicitySpamClassifierService(gateway);

    const result = await service.classify("u1", "free", "some message");

    expect(result.toxicity).toEqual({ kind: "held_for_review" });
    expect(result.spamAction).toBe("hold");
  });

  it("a self-harm signal takes precedence over any other label that also fired", async () => {
    const gateway = {
      invoke: vi.fn(async () => ({
        status: "ok",
        cached: false,
        data: { ...cleanClassification(), self_harm_risk_to_self: 0.9, harassment: 0.95 },
      })),
    } as unknown as AiGatewayService;
    const service = new ToxicitySpamClassifierService(gateway);

    const result = await service.classify("u1", "free", "message");
    expect(result.toxicity).toEqual({ kind: "self_harm_support" });
  });

  it("a clean message with no elevated labels is delivered untouched", async () => {
    const gateway = {
      invoke: vi.fn(async () => ({ status: "ok", cached: false, data: cleanClassification() })),
    } as unknown as AiGatewayService;
    const service = new ToxicitySpamClassifierService(gateway);

    const result = await service.classify("u1", "free", "a normal professional message");
    expect(result.toxicity).toEqual({ kind: "clean" });
    expect(result.spamAction).toBe("deliver");
  });

  it("harassment/hate/threats use a lower severe threshold than plain profanity (more sensitive in a professional context)", async () => {
    const gateway = {
      invoke: vi.fn(async () => ({
        status: "ok",
        cached: false,
        data: { ...cleanClassification(), harassment: 0.8 },
      })),
    } as unknown as AiGatewayService;
    const service = new ToxicitySpamClassifierService(gateway);

    const result = await service.classify("u1", "free", "message");
    expect(result.toxicity).toEqual({ kind: "severe", label: "harassment" });
  });
});
