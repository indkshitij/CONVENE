import { describe, expect, it, vi } from "vitest";
import { FakeProfileDetectionService } from "./fake-profile-detection.service";
import type { ReportsService } from "./reports.service";
import type { FakeProfileSignals } from "./fake-profile-risk";

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

describe("FakeProfileDetectionService", () => {
  it("a clean profile files no report", async () => {
    const reportsService = {
      create: vi.fn(async () => ({}) as never),
    } as unknown as ReportsService;
    const service = new FakeProfileDetectionService(reportsService);

    await service.evaluate("user-1", cleanSignals());

    expect(reportsService.create).not.toHaveBeenCalled();
  });

  it("an actionable risk score files a real report for human review — never auto-suspends directly", async () => {
    const reportsService = {
      create: vi.fn(async () => ({}) as never),
    } as unknown as ReportsService;
    const service = new FakeProfileDetectionService(reportsService);

    const result = await service.evaluate("user-1", {
      ...cleanSignals(),
      avatarMatchesKnownDuplicate: true,
      experienceTimelineImpossible: true,
      disposableEmail: true,
    });

    expect(result.action).toBe("soft_verification_challenge");
    expect(reportsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reporterId: null,
        targetUserId: "user-1",
        category: "impersonation",
      }),
    );
  });

  it("the filed report's evidence never includes the account's name or any demographic field — only the numeric score and technical factor list", async () => {
    const reportsService = {
      create: vi.fn(async () => ({}) as never),
    } as unknown as ReportsService;
    const service = new FakeProfileDetectionService(reportsService);

    await service.evaluate("user-1", {
      ...cleanSignals(),
      avatarMatchesKnownDuplicate: true,
      experienceTimelineImpossible: true,
      disposableEmail: true,
    });

    const call = (reportsService.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      evidence: Record<string, unknown>;
    };
    expect(Object.keys(call.evidence)).toEqual(["score", "action", "factors"]);
  });
});
