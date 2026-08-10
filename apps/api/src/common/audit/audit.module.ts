import { Global, Module } from "@nestjs/common";
import { AuditLogRepository } from "./audit-log.repository";
import { AuditLogService } from "./audit-log.service";

// §20.8: audit logging is cross-cutting infrastructure (every domain
// module writes to it — trust-safety, matching's weight editor, auth,
// account deletion), not "trust-safety business logic" that owns it
// exclusively. @Global for the same reason as PostgresModule/RedisModule
// — every module that needs AuditLogRepository/AuditLogService gets it
// without adding this to its own `imports`, and (more importantly for
// this specific module) without risking a circular import between
// AuthModule and TrustSafetyModule if this lived inside the latter.
@Global()
@Module({
  providers: [AuditLogRepository, AuditLogService],
  exports: [AuditLogRepository, AuditLogService],
})
export class AuditModule {}
