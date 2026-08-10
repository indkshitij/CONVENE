import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogRepository } from "./audit-log.repository";
import { AuditLogService, type AnomalyAlertSender } from "./audit-log.service";

function fakeRepo(
  overrides: Partial<Record<keyof AuditLogRepository, unknown>> = {},
): AuditLogRepository {
  return {
    record: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    countRecentReadsByActor: vi.fn(async () => 0),
    ...overrides,
  } as unknown as AuditLogRepository;
}

function fakeAlertSender(): AnomalyAlertSender {
  return { send: vi.fn(async () => undefined) };
}

const context = { ip: "203.0.113.1", userAgent: "test-agent", requestId: "req-1" };

describe("AuditLogService", () => {
  let repo: AuditLogRepository;
  let alertSender: AnomalyAlertSender;
  let service: AuditLogService;

  beforeEach(() => {
    // Fixed at a normal, in-hours UTC time so out-of-hours anomaly logic
    // doesn't fire incidentally in tests that aren't testing it.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T12:00:00.000Z"));
    repo = fakeRepo();
    alertSender = fakeAlertSender();
    service = new AuditLogService(repo, alertSender);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("record() delegates straight to the repository", async () => {
    await service.record({
      actorId: "u1",
      actorType: "user",
      action: "x",
      entityType: "y",
      entityId: null,
    });
    expect(repo.record).toHaveBeenCalledOnce();
  });

  // §20.8: "access to the audit log is itself logged."
  it("list() writes its own audit_log.accessed entry before returning results", async () => {
    await service.list("admin-1", context, { entityType: "report" }, 50);
    expect(repo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "admin-1",
        actorType: "admin",
        action: "audit_log.accessed",
        entityType: "audit_log",
        ip: context.ip,
        userAgent: context.userAgent,
        requestId: context.requestId,
      }),
    );
  });

  it("list() returns whatever the repository's filtered query returns", async () => {
    const rows = [{ id: 1 }];
    repo = fakeRepo({ list: vi.fn(async () => rows) });
    service = new AuditLogService(repo, alertSender);
    const result = await service.list("admin-1", context, {}, 50);
    expect(result).toBe(rows);
  });

  it("does not flag an anomaly for normal in-hours, low-volume reads", async () => {
    await service.list("admin-1", context, {}, 50);
    expect(alertSender.send).not.toHaveBeenCalled();
    expect(repo.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "audit_log.anomaly_detected" }),
    );
  });

  it("flags high read volume when recent reads exceed the threshold", async () => {
    repo = fakeRepo({ countRecentReadsByActor: vi.fn(async () => 21) });
    service = new AuditLogService(repo, alertSender);
    await service.list("admin-1", context, {}, 50);
    expect(alertSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "admin-1", kind: "high_read_volume" }),
    );
    expect(repo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "audit_log.anomaly_detected",
        after: { kind: "high_read_volume" },
      }),
    );
  });

  it("flags out-of-hours access", async () => {
    vi.setSystemTime(new Date("2026-01-05T03:00:00.000Z")); // 3am UTC
    await service.list("admin-1", context, {}, 50);
    expect(alertSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "admin-1", kind: "out_of_hours_access" }),
    );
  });

  it("uses a default console alert sender when none is provided", async () => {
    repo = fakeRepo({ countRecentReadsByActor: vi.fn(async () => 100) });
    const service2 = new AuditLogService(repo);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await service2.list("admin-1", context, {}, 50);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
