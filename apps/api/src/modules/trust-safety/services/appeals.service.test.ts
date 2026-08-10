import type { Appeal, ModerationAction } from "@convene/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogRepository } from "../../../common/audit/audit-log.repository";
import { AppealsRepository } from "../repositories/appeals.repository";
import { ModerationActionsRepository } from "../repositories/moderation-actions.repository";
import { AppealsService } from "./appeals.service";

function fakeModerationAction(overrides: Partial<ModerationAction> = {}): ModerationAction {
  return {
    id: "action-1",
    targetUserId: "user-1",
    reportId: null,
    adminId: "admin-1",
    action: "suspend",
    policyClause: "POLICY-1",
    rationale: "reason",
    status: "active",
    expiresAt: null,
    reversedBy: null,
    reversedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as ModerationAction;
}

function fakeAppeal(overrides: Partial<Appeal> = {}): Appeal {
  return {
    id: "appeal-1",
    moderationActionId: "action-1",
    userId: "user-1",
    reason: "This wasn't me.",
    status: "pending",
    reviewerAdminId: null,
    decisionRationale: null,
    decidedAt: null,
    slaDueAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeAppealsRepo(
  overrides: Partial<Record<keyof AppealsRepository, unknown>> = {},
): AppealsRepository {
  return {
    create: vi.fn(async () => fakeAppeal()),
    findById: vi.fn(async () => fakeAppeal()),
    decide: vi.fn(async (id: string, decision: "upheld" | "overturned") =>
      fakeAppeal({ status: decision }),
    ),
    ...overrides,
  } as unknown as AppealsRepository;
}

function fakeModerationActionsRepo(
  overrides: Partial<Record<keyof ModerationActionsRepository, unknown>> = {},
): ModerationActionsRepository {
  return {
    findById: vi.fn(async () => fakeModerationAction()),
    reverse: vi.fn(async () => fakeModerationAction({ status: "reversed" })),
    setUserStatus: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ModerationActionsRepository;
}

function fakeAuditLog(): AuditLogRepository {
  return { record: vi.fn(async () => undefined) } as unknown as AuditLogRepository;
}

describe("AppealsService", () => {
  it("404s filing an appeal against another user's moderation action", async () => {
    const appealsRepo = fakeAppealsRepo();
    const moderationRepo = fakeModerationActionsRepo({
      findById: vi.fn(async () => fakeModerationAction({ targetUserId: "someone-else" })),
    });
    const service = new AppealsService(appealsRepo, moderationRepo, fakeAuditLog());

    await expect(service.create("user-1", "action-1", "reason")).rejects.toMatchObject({
      code: "MODERATION_ACTION_NOT_FOUND",
    });
  });

  it("files an appeal with a 72h SLA", async () => {
    const appealsRepo = fakeAppealsRepo();
    const moderationRepo = fakeModerationActionsRepo();
    const service = new AppealsService(appealsRepo, moderationRepo, fakeAuditLog());

    await service.create("user-1", "action-1", "This wasn't me.");
    expect(appealsRepo.create).toHaveBeenCalledOnce();
    const call = (appealsRepo.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      slaDueAt: Date;
    };
    const slaMs = call.slaDueAt.getTime() - Date.now();
    expect(slaMs).toBeGreaterThan(71 * 60 * 60 * 1000);
    expect(slaMs).toBeLessThan(73 * 60 * 60 * 1000);
  });

  // Explicit acceptance criterion: "Assert an appeal cannot be reviewed
  // by the acting admin."
  it("rejects review by the admin who took the original action", async () => {
    const appealsRepo = fakeAppealsRepo();
    const moderationRepo = fakeModerationActionsRepo({
      findById: vi.fn(async () => fakeModerationAction({ adminId: "admin-1" })),
    });
    const service = new AppealsService(appealsRepo, moderationRepo, fakeAuditLog());

    await expect(
      service.review("admin-1", "appeal-1", "overturned", "I changed my mind"),
    ).rejects.toMatchObject({ code: "APPEAL_REVIEWER_CONFLICT" });
    expect(appealsRepo.decide).not.toHaveBeenCalled();
  });

  it("allows a different admin to review and overturns the original action", async () => {
    const appealsRepo = fakeAppealsRepo();
    const moderationRepo = fakeModerationActionsRepo({
      findById: vi.fn(async () => fakeModerationAction({ adminId: "admin-1" })),
    });
    const service = new AppealsService(appealsRepo, moderationRepo, fakeAuditLog());

    const result = await service.review(
      "admin-2",
      "appeal-1",
      "overturned",
      "Evidence didn't support the action.",
    );
    expect(result.status).toBe("overturned");
    expect(moderationRepo.reverse).toHaveBeenCalledWith("action-1", "admin-2", expect.any(Date));
    expect(moderationRepo.setUserStatus).toHaveBeenCalledWith("user-1", "active");
  });

  it("upholds without reversing the moderation action", async () => {
    const appealsRepo = fakeAppealsRepo();
    const moderationRepo = fakeModerationActionsRepo({
      findById: vi.fn(async () => fakeModerationAction({ adminId: "admin-1" })),
    });
    const service = new AppealsService(appealsRepo, moderationRepo, fakeAuditLog());

    const result = await service.review("admin-2", "appeal-1", "upheld", "Action was correct.");
    expect(result.status).toBe("upheld");
    expect(moderationRepo.reverse).not.toHaveBeenCalled();
  });

  it("rejects reviewing an already-decided appeal", async () => {
    const appealsRepo = fakeAppealsRepo({
      findById: vi.fn(async () => fakeAppeal({ status: "upheld" })),
    });
    const moderationRepo = fakeModerationActionsRepo();
    const service = new AppealsService(appealsRepo, moderationRepo, fakeAuditLog());

    await expect(
      service.review("admin-2", "appeal-1", "overturned", "reason"),
    ).rejects.toMatchObject({ code: "ACTION_NOT_PENDING_APPROVAL" });
  });
});
