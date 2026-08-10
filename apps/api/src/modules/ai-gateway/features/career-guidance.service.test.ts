import { describe, expect, it, vi } from "vitest";
import {
  CareerGuidanceService,
  validateCareerGuidanceHardRules,
  type CareerGuidanceOutput,
} from "./career-guidance.service";
import type { AiGatewayService } from "../gateway.service";
import type { ProfileService } from "../../profile/profile.service";
import type { AuthContext } from "../../../common/auth/auth-context";

const authContext: AuthContext = {
  id: "u1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function buildService(gatewayOutput?: CareerGuidanceOutput) {
  const profileService = {
    getMyProfile: vi.fn(async () => ({
      industry: { id: 1, label: "Technology" },
      job_title: "Engineer",
      years_experience: "5",
      skills: [],
      intents: [],
    })),
  } as unknown as ProfileService;
  const gateway = {
    invoke: vi.fn(async () =>
      gatewayOutput
        ? { status: "ok", data: gatewayOutput, cached: false }
        : { status: "unavailable" },
    ),
  } as unknown as AiGatewayService;
  return { service: new CareerGuidanceService(profileService, gateway), gateway };
}

describe("CareerGuidanceService — §12.11 guardrails, enforced before the model is ever called", () => {
  it.each([
    ["should I sue my employer for a legal dispute", "legal"],
    ["how do I get visa sponsorship for a work permit", "immigration"],
    ["what tax bracket will I be in after this raise", "tax"],
    ["can you diagnos me based on these symptoms", "medical"],
    ["which stocks should I invest my savings in", "investment"],
  ])("refuses %s without ever invoking the model", async (question, expectedTopic) => {
    const { service, gateway } = buildService();
    const result = await service.ask(authContext, question);
    expect(result).toMatchObject({ status: "refused", topic: expectedTopic });
    expect(gateway.invoke).not.toHaveBeenCalled();
  });

  it("routes a distress signal to support resources without generating career content", async () => {
    const { service, gateway } = buildService();
    const result = await service.ask(authContext, "I don't see the point anymore, I want to die");
    expect(result.status).toBe("distress_support");
    expect(gateway.invoke).not.toHaveBeenCalled();
  });

  it("answers an ordinary career question, grounded in the real profile", async () => {
    const { service } = buildService({
      answer: "Consider adding a systems-design skill next.",
      grounded_in: ["skills", "years_experience"],
    });
    const result = await service.ask(
      authContext,
      "what skill should I learn next to move into ML infra?",
    );
    expect(result.status).toBe("ok");
  });

  it("rejects a response that cites a fact key outside the real grounding set — enforced server-side, not merely prompted", async () => {
    const { service } = buildService({
      answer: "You should move to a different industry entirely.",
      grounded_in: ["skills", "a_fact_the_model_invented"],
    });
    const result = await service.ask(authContext, "what skill should I learn next?");
    expect(result).toEqual({ status: "unavailable" });
  });
});

describe("validateCareerGuidanceHardRules", () => {
  it("accepts an answer grounded only in real facts", () => {
    expect(
      validateCareerGuidanceHardRules(
        { answer: "x", grounded_in: ["skills"] },
        new Set(["skills"]),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects an answer citing an ungrounded fact", () => {
    expect(
      validateCareerGuidanceHardRules(
        { answer: "x", grounded_in: ["skills", "made_up"] },
        new Set(["skills"]),
      ),
    ).toEqual({ ok: false, reason: "UNGROUNDED_FACT" });
  });
});
