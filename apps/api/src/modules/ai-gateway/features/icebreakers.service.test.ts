import { describe, expect, it, vi } from "vitest";
import { aiFirstMessagesTotal } from "../../../infra/telemetry/ai-metrics";
import {
  IcebreakersService,
  icebreakersOutputSchema,
  validateIcebreakerHardRules,
  type IcebreakersOutput,
} from "./icebreakers.service";
import type { AiGatewayService } from "../gateway.service";
import type { ProfileService } from "../../profile/profile.service";
import type { AuthContext } from "../../../common/auth/auth-context";

const authContext: AuthContext = {
  id: "viewer-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function validOutput(
  overrides: Partial<IcebreakersOutput["openers"][number]> = {},
): IcebreakersOutput {
  return {
    openers: [
      {
        type: "specific_observation",
        text: "You wrote about reconciliation at scale — how do you handle idempotency?",
        grounded_in: ["candidate_recent_experience_title"],
        ...overrides,
      },
      {
        type: "shared_context",
        text: "Fellow Kafka user here — I'm hitting similar ordering issues.",
        grounded_in: ["shared_skills"],
      },
      {
        type: "direct_ask",
        text: "I'm looking for 20 minutes to sanity-check a decision — up for it?",
        grounded_in: ["viewer_primary_intent"],
      },
    ],
  };
}

describe("validateIcebreakerHardRules", () => {
  const groundingKeys = new Set([
    "candidate_recent_experience_title",
    "shared_skills",
    "viewer_primary_intent",
    "portfolio_0_title",
  ]);

  it("accepts a well-formed, fully-grounded set of three distinct-type openers", () => {
    expect(validateIcebreakerHardRules(validOutput(), groundingKeys)).toEqual({ ok: true });
  });

  it("rejects an opener that cites a fact key not present in the real grounding set", () => {
    const output = validOutput({
      grounded_in: ["candidate_recent_experience_title", "candidate_ethnicity"],
    });
    expect(validateIcebreakerHardRules(output, groundingKeys)).toEqual({
      ok: false,
      reason: "UNGROUNDED_FACT",
    });
  });

  it("rejects romantic language even if every cited fact is real", () => {
    const output = validOutput({
      text: "I think there's real chemistry between us, want to grab a coffee?",
    });
    expect(validateIcebreakerHardRules(output, groundingKeys)).toEqual({
      ok: false,
      reason: "ROMANTIC_LANGUAGE",
    });
  });

  it("rejects flattery that isn't grounded in an actual cited portfolio item", () => {
    const output = validOutput({
      text: "I'm a huge fan of your work, saw your profile.",
      grounded_in: ["candidate_recent_experience_title"],
    });
    expect(validateIcebreakerHardRules(output, groundingKeys)).toEqual({
      ok: false,
      reason: "UNGROUNDED_FLATTERY",
    });
  });

  it("allows flattery when it genuinely cites a portfolio item", () => {
    const output = validOutput({
      text: "I'm a huge fan of the payments dashboard you shipped.",
      grounded_in: ["portfolio_0_title"],
    });
    expect(validateIcebreakerHardRules(output, groundingKeys)).toEqual({ ok: true });
  });

  it("rejects two openers of the same type even if the schema's own length(3) already passed", () => {
    const output: IcebreakersOutput = {
      openers: [
        { type: "specific_observation", text: "a", grounded_in: [] },
        { type: "specific_observation", text: "b", grounded_in: [] },
        { type: "direct_ask", text: "c", grounded_in: [] },
      ],
    };
    expect(validateIcebreakerHardRules(output, groundingKeys)).toEqual({
      ok: false,
      reason: "WRONG_TYPE_SET",
    });
  });
});

describe("icebreakersOutputSchema", () => {
  it("rejects a response with fewer or more than 3 openers — no partial result", () => {
    expect(
      icebreakersOutputSchema.safeParse({
        openers: [{ type: "direct_ask", text: "x", grounded_in: [] }],
      }).success,
    ).toBe(false);
  });
});

describe("IcebreakersService — hard rules enforced server-side", () => {
  function buildService(gatewayOutput: unknown) {
    const profileService = {
      getMyProfile: vi.fn(async () => ({
        skills: [{ name: "Kafka", proficiency: null, years: null }],
        interests: [],
        intents: [{ type: "need_mentor", detail: null, expires_at: "" }],
      })),
      getProfileForViewer: vi.fn(async () => ({
        skills: [{ name: "Kafka", proficiency: null, years: null }],
        interests: [],
        intents: [{ type: "need_mentee", detail: null, expires_at: "" }],
        experience: [
          {
            company: "Xenon Labs",
            title: "Director",
            start_date: "2020-01-01",
            end_date: null,
            is_current: true,
          },
        ],
        portfolio: [],
        mutual_connections: { count: 2 },
        industry: { id: 1, label: "Technology" },
        location: { distance_bucket: "~10 km away" },
      })),
    } as unknown as ProfileService;

    const gateway = {
      invoke: vi.fn(async () => ({ status: "ok", data: gatewayOutput, cached: false })),
    } as unknown as AiGatewayService;
    return new IcebreakersService(profileService, gateway);
  }

  it("passes through a well-formed, fully-grounded model response", async () => {
    const service = buildService(validOutput());
    const result = await service.generate(authContext, "candidate-1");
    expect(result.status).toBe("ok");
    expect(result.openers).toHaveLength(3);
  });

  it("a model response citing a fact that isn't real never reaches the caller — rejected server-side, not merely discouraged by the prompt", async () => {
    const service = buildService(
      validOutput({
        grounded_in: ["candidate_recent_experience_title", "a_fact_the_model_made_up"],
      }),
    );
    const result = await service.generate(authContext, "candidate-1");
    expect(result).toEqual({ status: "unavailable" });
  });

  it("a romantic-toned model response is rejected server-side even though nothing in the prompt asked for that check to be re-verified", async () => {
    const service = buildService(validOutput({ text: "you're so attractive, want to date?" }));
    const result = await service.generate(authContext, "candidate-1");
    expect(result).toEqual({ status: "unavailable" });
  });
});

describe("IcebreakersService.recordFirstMessageSent — §12.5 guardrail metric", () => {
  it("emits the ai_first_messages_total counter labelled by whether the sender used an AI-drafted opener", async () => {
    const before = (await aiFirstMessagesTotal.get()).values;
    const service = new IcebreakersService({} as ProfileService, {} as AiGatewayService);

    service.recordFirstMessageSent(true);
    service.recordFirstMessageSent(false);
    service.recordFirstMessageSent(true);

    const after = (await aiFirstMessagesTotal.get()).values;
    const aiTrueBefore = before.find((v) => v.labels.ai_drafted === "true")?.value ?? 0;
    const aiFalseBefore = before.find((v) => v.labels.ai_drafted === "false")?.value ?? 0;
    const aiTrueAfter = after.find((v) => v.labels.ai_drafted === "true")?.value ?? 0;
    const aiFalseAfter = after.find((v) => v.labels.ai_drafted === "false")?.value ?? 0;

    expect(aiTrueAfter - aiTrueBefore).toBe(2);
    expect(aiFalseAfter - aiFalseBefore).toBe(1);
  });
});
