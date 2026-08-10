import { describe, expect, it, vi } from "vitest";
import {
  validateProfileOptimisationHardRules,
  ProfileOptimisationService,
  type ProfileOptimisationOutput,
} from "./profile-optimisation.service";
import type { AiGatewayService } from "../gateway.service";
import type { ProfileService } from "../../profile/profile.service";
import type { CompletionService } from "../../profile/completion.service";
import type { AuthContext } from "../../../common/auth/auth-context";

const authContext: AuthContext = {
  id: "u1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function validOutput(
  overrides: Partial<ProfileOptimisationOutput> = {},
): ProfileOptimisationOutput {
  return {
    overall_score: 62,
    headline: {
      current: "Software Engineer",
      issue: "Generic",
      suggestions: ["Backend engineer building payment rails"],
      why: "Specific",
      grounded_in: ["headline"],
    },
    about: {
      issues: ["Thin"],
      rewrite: "16 years building NLP systems.",
      kept_from_original: ["your framing"],
      grounded_in: ["about"],
    },
    skills: { add: ["Idempotency"], remove: ["MS Office"], reason: "Not used" },
    intents: { suggestion: "Add Learning", projected_match_increase: "+34%" },
    priority_actions: [{ action: "Rewrite headline", impact: "high", effort: "low" }],
    ...overrides,
  };
}

describe("validateProfileOptimisationHardRules", () => {
  const groundingKeys = new Set(["headline", "about", "skills"]);
  const currentSkills = new Set(["ms office", "python"]);

  it("accepts a fully-grounded response that only proposes removing skills the user actually has", () => {
    expect(
      validateProfileOptimisationHardRules(validOutput(), groundingKeys, currentSkills),
    ).toEqual({ ok: true });
  });

  it("rejects a headline rewrite that cites a fact key not in the real grounding set", () => {
    const output = validOutput({
      headline: { ...validOutput().headline, grounded_in: ["headline", "made_up_fact"] },
    });
    expect(validateProfileOptimisationHardRules(output, groundingKeys, currentSkills)).toEqual({
      ok: false,
      reason: "UNGROUNDED_FACT",
    });
  });

  it("rejects proposing to remove a skill the user never actually listed — a sign of a hallucinated skills list", () => {
    const output = validOutput({
      skills: { add: [], remove: ["Quantum Computing"], reason: "unused" },
    });
    expect(validateProfileOptimisationHardRules(output, groundingKeys, currentSkills)).toEqual({
      ok: false,
      reason: "FABRICATED_SKILL_REMOVAL",
    });
  });
});

describe("ProfileOptimisationService — hard rules enforced server-side", () => {
  function buildService(gatewayOutput: unknown) {
    const profileService = {
      getMyProfile: vi.fn(async () => ({
        headline: "Software Engineer",
        about: "I build things.",
        skills: [{ name: "MS Office", proficiency: null, years: null }],
        experience: [{ title: "Engineer" }],
        industry: { id: 1, label: "Technology" },
        intents: [{ type: "coffee_chat" }],
      })),
    } as unknown as ProfileService;
    const completionService = {
      getCompletion: vi.fn(async () => ({ score: 62, missing: [] })),
    } as unknown as CompletionService;
    const gateway = {
      invoke: vi.fn(async () => ({ status: "ok", data: gatewayOutput, cached: false })),
    } as unknown as AiGatewayService;
    return new ProfileOptimisationService(profileService, completionService, gateway);
  }

  it("passes through a well-formed, fully-grounded model response", async () => {
    const service = buildService(validOutput());
    const result = await service.generate(authContext);
    expect(result.status).toBe("ok");
    expect(result.data?.overall_score).toBe(62);
  });

  it("a response that fabricates a skill-removal claim never reaches the caller", async () => {
    const service = buildService(
      validOutput({ skills: { add: [], remove: ["Quantum Computing"], reason: "x" } }),
    );
    const result = await service.generate(authContext);
    expect(result).toEqual({ status: "unavailable" });
  });
});
