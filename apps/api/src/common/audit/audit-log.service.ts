import type { AuditLog } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import type { AuditRequestContext } from "./audit-request-context";
import {
  AuditLogRepository,
  type ListAuditLogFilters,
  type RecordAuditLogInput,
} from "./audit-log.repository";

export interface AnomalySignal {
  actorId: string;
  kind: "high_read_volume" | "out_of_hours_access";
  detail: string;
}

// No FCM/APNs/email provider exists anywhere for this yet — same
// "hook exists, real delivery deferred" posture as every other stub
// sender in this codebase (PushSender, EmailService's transport). A real
// implementation swaps in behind this interface; today it just logs.
export interface AnomalyAlertSender {
  send(signal: AnomalySignal): Promise<void>;
}

@Injectable()
export class ConsoleAnomalyAlertSender implements AnomalyAlertSender {
  async send(signal: AnomalySignal): Promise<void> {
    console.warn(`[audit-anomaly] actor=${signal.actorId} kind=${signal.kind} ${signal.detail}`);
  }
}

// §20.8: no exact thresholds are given anywhere in the PRD for "unusual
// admin read volume" or "out-of-hours access" — these are documented
// assumptions, not transcriptions, tunable later without touching the
// call sites that trigger a check.
const HIGH_READ_VOLUME_THRESHOLD = 20;
const HIGH_READ_VOLUME_WINDOW_MINUTES = 60;
const BUSINESS_HOURS_START_UTC = 6;
const BUSINESS_HOURS_END_UTC = 22;

// P18.3 (§20.8): the service every other module should call instead of
// AuditLogRepository directly (P18.1's callers keep working unchanged —
// this wraps, not replaces, that repository). Adds two things the
// prompt names explicitly that a bare insert-only repository can't:
// "access to the audit log is itself logged" (list() below) and anomaly
// detection on admin read behaviour.
@Injectable()
export class AuditLogService {
  constructor(
    private readonly repo: AuditLogRepository,
    @Optional() private readonly alertSender: AnomalyAlertSender = new ConsoleAnomalyAlertSender(),
  ) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    await this.repo.record(input);
  }

  // §20.8: "access to the audit log is itself logged." Every read of the
  // log through this method writes its own audit_log.accessed row before
  // (deliberately before, not after — a query that itself errors should
  // still leave a trace that the attempt was made) returning results,
  // then runs the anomaly check against the actor's own recent reads.
  async list(
    actorId: string,
    context: AuditRequestContext,
    filters: ListAuditLogFilters,
    limit: number,
  ): Promise<AuditLog[]> {
    await this.repo.record({
      actorId,
      actorType: "admin",
      action: "audit_log.accessed",
      entityType: "audit_log",
      entityId: null,
      after: { filters },
      ip: context.ip,
      userAgent: context.userAgent,
      requestId: context.requestId,
    });

    await this.checkAnomalies(actorId);

    return this.repo.list(filters, limit);
  }

  private async checkAnomalies(actorId: string): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - HIGH_READ_VOLUME_WINDOW_MINUTES * 60 * 1000);
    const recentReads = await this.repo.countRecentReadsByActor(actorId, windowStart);

    if (recentReads > HIGH_READ_VOLUME_THRESHOLD) {
      await this.flagAnomaly({
        actorId,
        kind: "high_read_volume",
        detail: `${recentReads} audit log reads in the last ${HIGH_READ_VOLUME_WINDOW_MINUTES} minutes`,
      });
    }

    const utcHour = now.getUTCHours();
    if (utcHour < BUSINESS_HOURS_START_UTC || utcHour >= BUSINESS_HOURS_END_UTC) {
      await this.flagAnomaly({
        actorId,
        kind: "out_of_hours_access",
        detail: `accessed at ${utcHour}:00 UTC, outside ${BUSINESS_HOURS_START_UTC}:00-${BUSINESS_HOURS_END_UTC}:00`,
      });
    }
  }

  private async flagAnomaly(signal: AnomalySignal): Promise<void> {
    await this.repo.record({
      actorId: signal.actorId,
      actorType: "system",
      action: "audit_log.anomaly_detected",
      entityType: "audit_log",
      entityId: null,
      reason: signal.detail,
      after: { kind: signal.kind },
    });
    await this.alertSender.send(signal);
  }
}
