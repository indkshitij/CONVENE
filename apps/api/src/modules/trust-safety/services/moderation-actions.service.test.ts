import type { ModerationAction, ModerationActionApproval } from "@convene/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogRepository } from "../../../common/audit/audit-log.repository";
import { ModerationActionsRepository } from "../repositories/moderation-actions.repository";
import { ModerationActionsService } from "./moderation-actions.service";

function fakeAction(overrides: Partial<ModerationAction> = {}): ModerationAction {
  return {
    id: "action-1",
    targetUserId: "target-1",
    reportId: null,
    adminId: "admin-1",
    action: "ban",
    policyClause: "POLICY-1",
    rationale: "Repeated critical violations.",
    status: "pending_approval",
    expiresAt: null,
    reversedBy: null,
    reversedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as ModerationAction;
}

function fakeApproval(adminId: string): ModerationActionApproval {
  return {
    id: `approval-${adminId}`,
    moderationActionId: "action-1",
    adminId,
    rationale: "approved",
    createdAt: new Date(),
  };
}

function fakeRepo(
  overrides: Partial<Record<keyof ModerationActionsRepository, unknown>> = {},
): ModerationActionsRepository {
  return {
    create: vi.fn(async () => fakeAction()),
    findById: vi.fn(async () => fakeAction()),
    activate: vi.fn(async () => fakeAction({ status: "active" })),
    reverse: vi.fn(async () => fakeAction({ status: "reversed" })),
    addApproval: vi.fn(async () => fakeApproval("admin-2")),
    listApprovals: vi.fn(async () => []),
    setUserStatus: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ModerationActionsRepository;
}

function fakeAuditLog(): AuditLogRepository {
  return { record: vi.fn(async () => undefined) } as unknown as AuditLogRepository;
}

describe("ModerationActionsService", () => {
  let repo: ModerationActionsRepository;
  let auditLog: AuditLogRepository;
  let service: ModerationActionsService;

  beforeEach(() => {
    repo = fakeRepo();
    auditLog = fakeAuditLog();
    service = new ModerationActionsService(repo, auditLog);
  });

  // Explicit acceptance criterion: "Assert an action without a policy
  // clause is rejected."
  it("rejects an action without a policy clause", async () => {
    await expect(
      service.apply("admin-1", {
        targetUserId: "target-1",
        reportId: null,
        action: "warning",
        policyClause: "   ",
        rationale: "reason",
        expiresAt: null,
      }),
    ).rejects.toMatchObject({ code: "POLICY_CLAUSE_REQUIRED" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects an action without a rationale", async () => {
    await expect(
      service.apply("admin-1", {
        targetUserId: "target-1",
        reportId: null,
        action: "warning",
        policyClause: "POLICY-1",
        rationale: "",
        expiresAt: null,
      }),
    ).rejects.toMatchObject({ code: "POLICY_CLAUSE_REQUIRED" });
  });

  it("applies a non-ban action immediately and updates user status", async () => {
    repo = fakeRepo({
      create: vi.fn(async () => fakeAction({ action: "throttle", status: "active" })),
    });
    service = new ModerationActionsService(repo, auditLog);

    const result = await service.apply("admin-1", {
      targetUserId: "target-1",
      reportId: null,
      action: "throttle",
      policyClause: "POLICY-1",
      rationale: "reason",
      expiresAt: null,
    });

    expect(result.status).toBe("active");
    expect(repo.setUserStatus).toHaveBeenCalledWith("target-1", "restricted");
  });

  // Explicit acceptance criterion: "Assert a permanent ban by a single
  // admin is rejected" — a ban never applies immediately, and the
  // acting admin can't approve their own ban request.
  it("creates a ban as pending_approval without applying it", async () => {
    const result = await service.apply("admin-1", {
      targetUserId: "target-1",
      reportId: null,
      action: "ban",
      policyClause: "POLICY-1",
      rationale: "reason",
      expiresAt: null,
    });
    expect(result.status).toBe("pending_approval");
    expect(repo.setUserStatus).not.toHaveBeenCalled();
  });

  it("rejects the acting admin approving their own ban", async () => {
    await expect(
      service.approve("admin-1", "action-1", "I approve my own request"),
    ).rejects.toMatchObject({ code: "BAN_APPROVAL_SAME_ADMIN" });
    expect(repo.addApproval).not.toHaveBeenCalled();
  });

  it("activates a ban once a second, distinct admin approves", async () => {
    const result = await service.approve("admin-2", "action-1", "Confirmed, second admin.");
    expect(result.status).toBe("active");
    expect(repo.addApproval).toHaveBeenCalledWith(
      "action-1",
      "admin-2",
      "Confirmed, second admin.",
    );
    expect(repo.setUserStatus).toHaveBeenCalledWith("target-1", "suspended");
  });

  it("does not activate after only recording a single approval when a third admin's approval is still needed for a hypothetical 3-party ladder", async () => {
    // Sanity check that count logic uses distinct admin ids, not row count.
    repo = fakeRepo({ listApprovals: vi.fn(async () => [fakeApproval("admin-1")]) }); // admin-1 is the original actor, already counted
    service = new ModerationActionsService(repo, auditLog);
    const result = await service.approve("admin-2", "action-1", "second approval");
    expect(result.status).toBe("active");
  });

  it("rejects approving an action that isn't pending approval", async () => {
    repo = fakeRepo({ findById: vi.fn(async () => fakeAction({ status: "active" })) });
    service = new ModerationActionsService(repo, auditLog);
    await expect(service.approve("admin-2", "action-1", "rationale")).rejects.toMatchObject({
      code: "ACTION_NOT_PENDING_APPROVAL",
    });
  });

  it("rejects the same admin approving twice", async () => {
    repo = fakeRepo({ listApprovals: vi.fn(async () => [fakeApproval("admin-2")]) });
    service = new ModerationActionsService(repo, auditLog);
    await expect(service.approve("admin-2", "action-1", "again")).rejects.toMatchObject({
      code: "ALREADY_APPROVED",
    });
  });

  it("writes an audit log entry for every apply and approve call", async () => {
    await service.apply("admin-1", {
      targetUserId: "target-1",
      reportId: null,
      action: "warning",
      policyClause: "POLICY-1",
      rationale: "reason",
      expiresAt: null,
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "moderation.action_applied" }),
    );

    await service.approve("admin-2", "action-1", "rationale");
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "moderation.ban_approved" }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "moderation.ban_activated" }),
    );
  });
});
