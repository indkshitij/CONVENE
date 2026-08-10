import { Module } from "@nestjs/common";
import { ReputationRecomputeWorker } from "../../workers/reputation-recompute.worker";
import { ConnectionsModule } from "../connections/connections.module";
import { MessagingModule } from "../messaging/messaging.module";
import { ProfileModule } from "../profile/profile.module";
import { AdminAppealsController } from "./admin-appeals.controller";
import { AdminAuditLogsController } from "./admin-audit-logs.controller";
import { AdminModerationActionsController } from "./admin-moderation-actions.controller";
import { AdminReportsController } from "./admin-reports.controller";
import { AppealsController } from "./appeals.controller";
import { ReportsController } from "./reports.controller";
import { AppealsRepository } from "./repositories/appeals.repository";
import { ModerationActionsRepository } from "./repositories/moderation-actions.repository";
import { ReportsRepository } from "./repositories/reports.repository";
import { ReputationDataRepository } from "./repositories/reputation-data.repository";
import { ReputationScoresRepository } from "./repositories/reputation-scores.repository";
import { AppealsService } from "./services/appeals.service";
import { FakeProfileDetectionService } from "./services/fake-profile-detection.service";
import { ModerationActionsService } from "./services/moderation-actions.service";
import { ReportsService } from "./services/reports.service";
import { ReputationService } from "./services/reputation.service";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P18.1: reports with §10.10.2's 8-category SLA table and their
// documented auto-actions, the §10.10.3 enforcement ladder (policy
// clause + rationale mandatory, two-admin ban approval), and appeals
// routed to a different reviewer than the acting admin. P18.2: the
// reputation engine. P18.3: AuditLogRepository/AuditLogService moved out
// to common/audit/ (a @Global AuditModule, see its own comment) since
// audit logging is cross-cutting infrastructure other modules
// (matching's weight editor, auth) need too, not trust-safety-exclusive
// — no need to list them here anymore. Imports ConnectionsModule only
// for its exported ConnectionsRepository (freezeConversationBetween,
// already built for P14.2's block flow and reused here for the
// child-safety/threats-violence auto-freeze). P26.1: imports
// MessagingModule (MessagesRepository) and ProfileModule (ProfileService)
// for AdminReportsController's audited content-view endpoint — neither
// module imports this one back, so this stays one-directional.
@Module({
  imports: [ConnectionsModule, MessagingModule, ProfileModule],
  controllers: [
    ReportsController,
    AppealsController,
    AdminReportsController,
    AdminModerationActionsController,
    AdminAppealsController,
    AdminAuditLogsController,
  ],
  providers: [
    ReportsRepository,
    ModerationActionsRepository,
    AppealsRepository,
    ReputationDataRepository,
    ReputationScoresRepository,
    ReportsService,
    ModerationActionsService,
    AppealsService,
    ReputationService,
    ReputationRecomputeWorker,
    FakeProfileDetectionService,
  ],
  exports: [
    ReportsService,
    ModerationActionsService,
    AppealsService,
    ReputationService,
    ReportsRepository,
    ModerationActionsRepository,
    FakeProfileDetectionService,
  ],
})
export class TrustSafetyModule {}
