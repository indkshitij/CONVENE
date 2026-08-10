import { Module } from "@nestjs/common";
import { IntentsModule } from "../intents/intents.module";
import { MatchingModule } from "../matching/matching.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ConnectionRequestExpiryWorker } from "../../workers/connection-request-expiry.worker";
import { BlocksController } from "./blocks.controller";
import { ConnectionsController } from "./connections.controller";
import { ConnectionsRepository } from "./repositories/connections.repository";
import { BlocksService } from "./services/blocks.service";
import { ConnectionQuotaService } from "./services/connection-quota.service";
import { ConnectionsService } from "./services/connections.service";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P14.1: send/list/withdraw (endpoints 32, 34, and the withdraw half of
// 33's §10.6.6 contract). Imports MatchingModule for MatchingDataRepository
// (intent-floor re-check, senior/high-rep inbound-throttle default) and
// IntentsModule for InboundFiltersService (BR-CONN-02's inbound-filter
// re-check) — both already export what this module needs, so nothing is
// reimplemented. P14.2: accept/reject (the atomic transaction) and blocks
// (endpoint 36) — imports NotificationsModule for the minimal notify()
// primitive BR-CONN-08's "request accepted" notification needs.
@Module({
  imports: [MatchingModule, IntentsModule, NotificationsModule],
  controllers: [ConnectionsController, BlocksController],
  providers: [
    ConnectionsRepository,
    ConnectionQuotaService,
    ConnectionsService,
    BlocksService,
    ConnectionRequestExpiryWorker,
  ],
  exports: [ConnectionsRepository, ConnectionsService, BlocksService, ConnectionQuotaService],
})
export class ConnectionsModule {}
