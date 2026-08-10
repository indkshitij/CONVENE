import type { Message, Report } from "@convene/db";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { AuditLogRepository } from "../../common/audit/audit-log.repository";
import { AdminReportsController } from "./admin-reports.controller";
import type { MessagesRepository } from "../messaging/repositories/messages.repository";
import type { ProfileService } from "../profile/profile.service";
import type { ReportsRepository } from "./repositories/reports.repository";

const authContext: AuthContext = {
  id: "admin-1",
  role: "admin",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function fakeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: "report-1",
    reference: "RPT-2026-ABCDEF",
    reporterId: "reporter-1",
    targetType: "message",
    targetId: "message-1",
    targetUserId: "target-user-1",
    category: "harassment_hate",
    severity: "high",
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

function fakeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-1",
    conversationId: "conv-1",
    senderId: "sender-1",
    clientMsgId: "client-1",
    sequence: 1,
    type: "text",
    body: "hello",
    replyToId: null,
    attachments: [],
    metadata: {},
    editedAt: null,
    editCount: 0,
    deletedAt: null,
    deletedScope: null,
    moderationState: "clean",
    searchVector: null,
    createdAt: new Date(),
    ...overrides,
  } as Message;
}

describe("AdminReportsController.content() — §20.8 audited content view", () => {
  it("writes an audit row before returning the reported message", async () => {
    const reportsRepo = {
      findById: vi.fn(async () => fakeReport()),
    } as unknown as ReportsRepository;
    const messagesRepo = {
      findMessageById: vi.fn(async () => fakeMessage()),
    } as unknown as MessagesRepository;
    const profileService = {} as unknown as ProfileService;
    const auditLog = { record: vi.fn(async () => undefined) } as unknown as AuditLogRepository;
    const controller = new AdminReportsController(
      reportsRepo,
      messagesRepo,
      profileService,
      auditLog,
    );

    const order: string[] = [];
    (auditLog.record as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("audit");
    });
    (messagesRepo.findMessageById as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("content");
      return fakeMessage();
    });

    const result = await controller.content({ authContext }, "report-1");

    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "admin-1",
        actorType: "admin",
        action: "report.content_viewed",
        entityType: "report",
        entityId: "report-1",
      }),
    );
    expect(result).toMatchObject({ target_type: "message", status: "ok" });
    expect(order[0]).toBe("audit");
  });

  it("still writes the audit row even when the report has no content type this endpoint knows how to show", async () => {
    const reportsRepo = {
      findById: vi.fn(async () => fakeReport({ targetType: "device_fingerprint" })),
    } as unknown as ReportsRepository;
    const messagesRepo = { findMessageById: vi.fn() } as unknown as MessagesRepository;
    const profileService = {} as unknown as ProfileService;
    const auditLog = { record: vi.fn(async () => undefined) } as unknown as AuditLogRepository;
    const controller = new AdminReportsController(
      reportsRepo,
      messagesRepo,
      profileService,
      auditLog,
    );

    const result = await controller.content({ authContext }, "report-1");

    expect(auditLog.record).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      target_type: "device_fingerprint",
      status: "unsupported_target_type",
    });
  });

  it("404s (no audit row, nothing to view) when the report itself doesn't exist", async () => {
    const reportsRepo = { findById: vi.fn(async () => null) } as unknown as ReportsRepository;
    const messagesRepo = {} as unknown as MessagesRepository;
    const profileService = {} as unknown as ProfileService;
    const auditLog = { record: vi.fn(async () => undefined) } as unknown as AuditLogRepository;
    const controller = new AdminReportsController(
      reportsRepo,
      messagesRepo,
      profileService,
      auditLog,
    );

    await expect(controller.content({ authContext }, "missing")).rejects.toMatchObject({
      code: "REPORT_NOT_FOUND",
    });
    expect(auditLog.record).not.toHaveBeenCalled();
  });
});
