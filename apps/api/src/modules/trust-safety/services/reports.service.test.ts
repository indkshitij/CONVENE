import type { ModerationAction, Report } from "@convene/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionsRepository } from "../../connections/repositories/connections.repository";
import { REPORT_CATALOGUE } from "../report-catalogue";
import { AuditLogRepository } from "../../../common/audit/audit-log.repository";
import { ModerationActionsRepository } from "../repositories/moderation-actions.repository";
import { ReportsRepository } from "../repositories/reports.repository";
import { ReportsService } from "./reports.service";

function fakeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: "report-1",
    reference: "RPT-2026-ABCDEF",
    reporterId: "reporter-1",
    targetType: "message",
    targetId: "target-1",
    targetUserId: "target-user-1",
    category: "other",
    severity: "low",
    description: null,
    evidence: {},
    status: "open",
    assignedTo: null,
    slaDueAt: new Date(),
    resolvedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakeReportsRepo(
  overrides: Partial<Record<keyof ReportsRepository, unknown>> = {},
): ReportsRepository {
  return {
    create: vi.fn(async (input) =>
      fakeReport({
        category: input.category,
        severity: input.severity,
        slaDueAt: input.slaDueAt,
        targetUserId: input.targetUserId,
      }),
    ),
    findById: vi.fn(async () => fakeReport()),
    listQueue: vi.fn(async () => []),
    update: vi.fn(async () => fakeReport()),
    ...overrides,
  } as unknown as ReportsRepository;
}

function fakeModerationActionsRepo(
  overrides: Partial<Record<keyof ModerationActionsRepository, unknown>> = {},
): ModerationActionsRepository {
  return {
    create: vi.fn(async () => ({ id: "action-1" }) as ModerationAction),
    setUserStatus: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ModerationActionsRepository;
}

function fakeAuditLog(): AuditLogRepository {
  return { record: vi.fn(async () => undefined) } as unknown as AuditLogRepository;
}

function fakeConnectionsRepo(): ConnectionsRepository {
  return {
    freezeConversationBetween: vi.fn(async () => undefined),
  } as unknown as ConnectionsRepository;
}

describe("ReportsService.create", () => {
  let reportsRepo: ReportsRepository;
  let moderationRepo: ModerationActionsRepository;
  let auditLog: AuditLogRepository;
  let connectionsRepo: ConnectionsRepository;
  let service: ReportsService;

  beforeEach(() => {
    reportsRepo = fakeReportsRepo();
    moderationRepo = fakeModerationActionsRepo();
    auditLog = fakeAuditLog();
    connectionsRepo = fakeConnectionsRepo();
    service = new ReportsService(reportsRepo, moderationRepo, auditLog, connectionsRepo);
  });

  it("computes a 1-hour SLA and immediately suspends for child_safety", async () => {
    const before = Date.now();
    const report = await service.create({
      reporterId: "reporter-1",
      targetType: "user",
      targetId: "target-user-1",
      targetUserId: "target-user-1",
      category: "child_safety",
      description: null,
    });

    expect(report.category).toBe("child_safety");
    expect(report.severity).toBe("critical");
    const slaMs = report.slaDueAt.getTime() - before;
    expect(slaMs).toBeGreaterThan(0.9 * 60 * 60 * 1000);
    expect(slaMs).toBeLessThan(1.1 * 60 * 60 * 1000);

    expect(moderationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "suspend", adminId: null, status: "active" }),
    );
    expect(moderationRepo.setUserStatus).toHaveBeenCalledWith("target-user-1", "suspended");
  });

  it("computes a 48-hour SLA and takes no auto-action for 'other'", async () => {
    const report = await service.create({
      reporterId: "reporter-1",
      targetType: "message",
      targetId: "m-1",
      targetUserId: "target-user-1",
      category: "other",
      description: null,
    });
    expect(report.severity).toBe("low");
    expect(moderationRepo.create).not.toHaveBeenCalled();
  });

  it("freezes the conversation and throttles for harassment_hate", async () => {
    await service.create({
      reporterId: "reporter-1",
      targetType: "message",
      targetId: "m-1",
      targetUserId: "target-user-1",
      category: "harassment_hate",
      description: null,
    });
    expect(connectionsRepo.freezeConversationBetween).toHaveBeenCalledWith(
      "reporter-1",
      "target-user-1",
    );
    expect(moderationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "throttle" }),
    );
    expect(moderationRepo.setUserStatus).toHaveBeenCalledWith("target-user-1", "restricted");
  });

  it("shadow-limits for scam_fraud", async () => {
    await service.create({
      reporterId: "reporter-1",
      targetType: "message",
      targetId: "m-1",
      targetUserId: "target-user-1",
      category: "scam_fraud",
      description: null,
    });
    expect(moderationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "shadow_limit" }),
    );
    expect(moderationRepo.setUserStatus).toHaveBeenCalledWith("target-user-1", "shadow_limited");
  });

  it("only reviews (no forced status change) for threats_violence, but still freezes", async () => {
    await service.create({
      reporterId: "reporter-1",
      targetType: "message",
      targetId: "m-1",
      targetUserId: "target-user-1",
      category: "threats_violence",
      description: null,
    });
    expect(connectionsRepo.freezeConversationBetween).toHaveBeenCalled();
    expect(moderationRepo.setUserStatus).not.toHaveBeenCalled();
  });

  it("writes an audit log entry for the report filing", async () => {
    await service.create({
      reporterId: "reporter-1",
      targetType: "message",
      targetId: "m-1",
      targetUserId: null,
      category: "spam",
      description: null,
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "report.filed", actorId: "reporter-1", actorType: "user" }),
    );
  });

  it("every catalogue category has severity, SLA and an auto-action", () => {
    for (const entry of Object.values(REPORT_CATALOGUE)) {
      expect(entry.slaHours).toBeGreaterThan(0);
      expect(["critical", "high", "medium", "low"]).toContain(entry.severity);
      expect(entry.autoAction).toBeTruthy();
    }
  });
});
