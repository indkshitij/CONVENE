import { DEFAULT_WEIGHTS } from "@convene/matching";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { AdminMatchingController } from "./admin-matching.controller";
import type { FairnessAuditService } from "../matching/services/fairness-audit.service";
import type { MatchingWeightsProvider } from "../matching/services/matching-weights-provider";

const authContext: AuthContext = {
  id: "admin-1",
  role: "admin",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

describe("AdminMatchingController", () => {
  describe("GET /admin/matching/weights", () => {
    it("returns the active weights", async () => {
      const weightsProvider = {
        getActiveWeights: vi.fn(async () => DEFAULT_WEIGHTS),
      } as unknown as MatchingWeightsProvider;
      const controller = new AdminMatchingController(weightsProvider, {} as FairnessAuditService);

      const result = await controller.getWeights();
      expect(result).toEqual(DEFAULT_WEIGHTS);
    });
  });

  describe("PUT /admin/matching/weights", () => {
    it("returns the new weights on acceptance, and strips `reason` out of the weights payload passed to the provider", async () => {
      const proposed = { ...DEFAULT_WEIGHTS, avail: 0.21, intent: 0.25 };
      const weightsProvider = {
        proposeWeights: vi.fn(async () => ({ accepted: true, weights: proposed })),
      } as unknown as MatchingWeightsProvider;
      const controller = new AdminMatchingController(weightsProvider, {} as FairnessAuditService);

      const result = await controller.updateWeights(
        { authContext },
        { ...proposed, reason: "Boosting availability." },
      );

      expect(weightsProvider.proposeWeights).toHaveBeenCalledWith(
        proposed,
        "admin-1",
        "Boosting availability.",
        { ip: "unknown-ip", userAgent: null, requestId: null },
      );
      expect(result).toEqual(proposed);
    });

    it("throws a 409 when the proposal is rejected (out-of-sum weights), and does not change the active config", async () => {
      const invalid = { ...DEFAULT_WEIGHTS, avail: 0.9, reason: "Testing." };
      const weightsProvider = {
        proposeWeights: vi.fn(async () => ({
          accepted: false,
          weights: DEFAULT_WEIGHTS,
          reason: "Weights must sum to 1.00, got 1.68",
        })),
      } as unknown as MatchingWeightsProvider;
      const controller = new AdminMatchingController(weightsProvider, {} as FairnessAuditService);

      await expect(controller.updateWeights({ authContext }, invalid)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        httpStatus: 409,
      });
    });

    it("rejects when no auth context is present", async () => {
      const controller = new AdminMatchingController(
        {} as MatchingWeightsProvider,
        {} as FairnessAuditService,
      );
      await expect(
        controller.updateWeights({}, { ...DEFAULT_WEIGHTS, reason: "Testing." }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("POST /admin/matching/weights/rollback", () => {
    it("returns the restored weights", async () => {
      const restored = { ...DEFAULT_WEIGHTS, avail: 0.3, intent: 0.16 };
      const weightsProvider = {
        rollbackWeights: vi.fn(async () => ({ accepted: true, weights: restored })),
      } as unknown as MatchingWeightsProvider;
      const controller = new AdminMatchingController(weightsProvider, {} as FairnessAuditService);

      const result = await controller.rollbackWeights(
        { authContext },
        { reason: "Reverting last night's regression." },
      );

      expect(weightsProvider.rollbackWeights).toHaveBeenCalledWith(
        "admin-1",
        "Reverting last night's regression.",
        { ip: "unknown-ip", userAgent: null, requestId: null },
      );
      expect(result).toEqual(restored);
    });

    it("rejects when no auth context is present", async () => {
      const controller = new AdminMatchingController(
        {} as MatchingWeightsProvider,
        {} as FairnessAuditService,
      );
      await expect(controller.rollbackWeights({}, { reason: "Testing." })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("GET /admin/matching/fairness-audit", () => {
    it("returns the audit report", async () => {
      const report = {
        byVerificationLevel: [],
        byCity: [],
        byExperienceBand: [],
        byReputationBand: [],
        anyFlagged: false,
      };
      const fairnessAudit = {
        runAudit: vi.fn(async () => report),
      } as unknown as FairnessAuditService;
      const controller = new AdminMatchingController({} as MatchingWeightsProvider, fairnessAudit);

      const result = await controller.fairnessAuditReport();
      expect(result).toEqual(report);
    });
  });
});
