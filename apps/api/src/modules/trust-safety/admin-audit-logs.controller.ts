import type { AuditLog } from "@convene/db";
import { Controller, Get, Query, Req } from "@nestjs/common";
import type { AuthContext } from "../../common/auth/auth-context";
import { auditContextFrom } from "../../common/audit/audit-request-context";
import { adminOnly } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { Roles } from "../../common/auth/roles.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { AuditLogService } from "../../common/audit/audit-log.service";

interface RequestLike {
  authContext?: AuthContext;
  auditIp?: string;
  auditUserAgent?: string | null;
  requestId?: string;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

interface AuditLogCard {
  id: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
}

function toCard(row: AuditLog): AuditLogCard {
  return {
    id: String(row.id),
    actor_id: row.actorId,
    actor_type: row.actorType,
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId,
    reason: row.reason,
    before: row.before,
    after: row.after,
    ip: row.ip,
    user_agent: row.userAgent,
    request_id: row.requestId,
    created_at: row.createdAt.toISOString(),
  };
}

// PRD §20.8 / §14.20 endpoint 66: GET /admin/audit-logs. Filterable by
// entity, actor, or request_id — the request_id filter is what makes
// "a single request can be reconstructed end-to-end from the audit log"
// (this phase's own acceptance line) a real, queryable thing rather than
// a claim.
@Controller("admin/audit-logs")
export class AdminAuditLogsController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @Roles("admin", "moderator")
  @Policy(adminOnly)
  async list(
    @Req() request: RequestLike,
    @Query("actor_id") actorId?: string,
    @Query("entity_type") entityType?: string,
    @Query("entity_id") entityId?: string,
    @Query("request_id") requestId?: string,
    @Query("limit") limit?: string,
  ): Promise<{ entries: AuditLogCard[] }> {
    const { id: adminId } = requireAuthContext(request);
    const rows = await this.auditLogService.list(
      adminId,
      auditContextFrom(request),
      { actorId, entityType, entityId, requestId },
      Math.min(limit ? Number(limit) : DEFAULT_LIMIT, MAX_LIMIT),
    );
    return { entries: rows.map(toCard) };
  }
}
