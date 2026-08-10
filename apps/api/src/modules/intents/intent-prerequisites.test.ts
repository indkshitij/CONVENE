import { describe, expect, it } from "vitest";
import { checkPrerequisites } from "./intent-prerequisites";

const NONE_MET: Parameters<typeof checkPrerequisites>[1] = {
  hasCompanyName: false,
  verificationLevel: 0,
  yearsExperience: 0,
};

describe("checkPrerequisites", () => {
  it("is always met for a type with no prerequisites", () => {
    expect(checkPrerequisites("coffee_chat", NONE_MET)).toEqual({ met: true, unmet: [] });
  });

  // §10.4.8's own Gherkin fixture: verification level 2, investment_discussion needs L4.
  it("matches the §10.4.8 'Prerequisites' scenario exactly: L2 verification, investment_discussion needs L4", () => {
    const result = checkPrerequisites("investment_discussion", {
      ...NONE_MET,
      verificationLevel: 2,
    });
    expect(result).toEqual({ met: false, unmet: ["verification_level_4"] });
  });

  it("hiring requires a company name on the profile", () => {
    expect(checkPrerequisites("hiring", NONE_MET)).toEqual({
      met: false,
      unmet: ["company_on_profile"],
    });
    expect(checkPrerequisites("hiring", { ...NONE_MET, hasCompanyName: true })).toEqual({
      met: true,
      unmet: [],
    });
  });

  it("need_cofounder requires at least L2 verification", () => {
    expect(checkPrerequisites("need_cofounder", { ...NONE_MET, verificationLevel: 1 })).toEqual({
      met: false,
      unmet: ["verification_level_2"],
    });
    expect(checkPrerequisites("need_cofounder", { ...NONE_MET, verificationLevel: 2 }).met).toBe(
      true,
    );
  });

  it("need_mentee (Want to Mentor) requires at least 3 years of experience", () => {
    expect(checkPrerequisites("need_mentee", { ...NONE_MET, yearsExperience: 2.9 })).toEqual({
      met: false,
      unmet: ["experience_years_3"],
    });
    expect(checkPrerequisites("need_mentee", { ...NONE_MET, yearsExperience: 3 }).met).toBe(true);
  });
});
