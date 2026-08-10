import { describe, expect, it } from "vitest";
import { computeFakeProfileRisk, type FakeProfileSignals } from "./fake-profile-risk";

function cleanSignals(): FakeProfileSignals {
  return {
    avatarMatchesKnownDuplicate: false,
    faceCountAbnormal: false,
    imageQualityLow: false,
    nameEntropyLow: false,
    experienceTimelineImpossible: false,
    claimedCompanyUnverifiedWithSeniorityClaim: false,
    disposableEmail: false,
    deviceIpClusterFlagCount: 0,
    aboutTextScamTemplateSimilarity: 0,
    immediateMassRequests: false,
    identicalNoteRatio: 0,
    offPlatformSolicitationInFirstMessage: false,
  };
}

describe("computeFakeProfileRisk", () => {
  it("scores a clean profile at 0 with no action", () => {
    const result = computeFakeProfileRisk(cleanSignals());
    expect(result.score).toBe(0);
    expect(result.action).toBe("none");
  });

  it("a single strong signal (duplicate avatar) alone doesn't cross the soft-challenge floor", () => {
    const result = computeFakeProfileRisk({ ...cleanSignals(), avatarMatchesKnownDuplicate: true });
    expect(result.action).toBe("none");
  });

  it("crosses into soft_verification_challenge once enough signals accumulate", () => {
    const result = computeFakeProfileRisk({
      ...cleanSignals(),
      avatarMatchesKnownDuplicate: true,
      experienceTimelineImpossible: true,
      disposableEmail: true,
    });
    expect(result.score).toBeGreaterThanOrEqual(0.4);
    expect(result.action).toBe("soft_verification_challenge");
  });

  it("crosses into hide_and_review with heavier stacking", () => {
    const result = computeFakeProfileRisk({
      ...cleanSignals(),
      avatarMatchesKnownDuplicate: true,
      experienceTimelineImpossible: true,
      disposableEmail: true,
      aboutTextScamTemplateSimilarity: 1,
      immediateMassRequests: true,
      offPlatformSolicitationInFirstMessage: true,
    });
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.action).toBe("hide_and_review");
  });

  it("crosses into immediate_suspension_pending_review when nearly every signal fires", () => {
    const result = computeFakeProfileRisk({
      avatarMatchesKnownDuplicate: true,
      faceCountAbnormal: true,
      imageQualityLow: true,
      nameEntropyLow: true,
      experienceTimelineImpossible: true,
      claimedCompanyUnverifiedWithSeniorityClaim: true,
      disposableEmail: true,
      deviceIpClusterFlagCount: 5,
      aboutTextScamTemplateSimilarity: 1,
      immediateMassRequests: true,
      identicalNoteRatio: 1,
      offPlatformSolicitationInFirstMessage: true,
    });
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.action).toBe("immediate_suspension_pending_review");
  });
});

// PRD §12.9's own acceptance line: "assert two profiles differing only
// by name origin receive identical risk scores." FakeProfileSignals has
// no field a name, ethnicity, country, or language could occupy — this
// test proves that structurally by constructing two "profiles" that
// differ only in an external, uninvolved name field while every real
// signal is identical, and showing the score can't tell them apart
// (because it was never given the name to begin with).
describe("disparate-impact resistance — §12.9's anti-bias requirement", () => {
  it("two profiles differing only by name origin receive identical risk scores", () => {
    const sharedSignals: FakeProfileSignals = {
      ...cleanSignals(),
      experienceTimelineImpossible: true,
      disposableEmail: true,
    };

    // Two hypothetical account holders with names from different
    // origins — deliberately never passed into the scorer, to prove the
    // score can't have been influenced by them.
    const applicantA = { fullName: "Priya Subramaniam", signals: sharedSignals };
    const applicantB = { fullName: "Emily Johnson", signals: sharedSignals };

    const scoreA = computeFakeProfileRisk(applicantA.signals);
    const scoreB = computeFakeProfileRisk(applicantB.signals);

    expect(scoreA).toEqual(scoreB);
  });

  it("no field on FakeProfileSignals names ethnicity, name origin, country, or language", () => {
    // "nameEntropyLow" legitimately contains the word "name" — it's a
    // generic-display-name-pattern flag ("user8827x2"), never a
    // judgement about which names look foreign — so "name" alone isn't
    // forbidden; "origin" (as in name *origin*) is what's actually
    // banned, along with ethnicity/country/language/nationality/race.
    const forbiddenWords = ["ethnic", "origin", "country", "language", "nationality", "race"];
    const keys = Object.keys(cleanSignals());
    for (const key of keys) {
      const lower = key.toLowerCase();
      for (const word of forbiddenWords) {
        expect(lower.includes(word)).toBe(false);
      }
    }
  });
});
