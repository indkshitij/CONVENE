import { Module } from "@nestjs/common";
import { AvailabilityExpiryWorker } from "../../workers/availability-expiry.worker";
import { ScheduleGeneratorWorker } from "../../workers/schedule-generator.worker";
import { IntentsModule } from "../intents/intents.module";
import { MatchingModule } from "../matching/matching.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { AvailabilityExpiryService } from "./availability-expiry.service";
import { AvailabilityKeyspaceListenerService } from "./availability-keyspace-listener.service";
import { AvailabilityController } from "./availability.controller";
import { AvailabilityService } from "./availability.service";
import { PresenceBroadcastListener } from "./presence-broadcast.listener";
import { AvailabilityRepository } from "./repositories/availability.repository";
import { SchedulesRepository } from "./repositories/schedules.repository";
import { ScheduleGeneratorService } from "./schedule-generator.service";
import { SchedulesController } from "./schedules.controller";
import { SchedulesService } from "./schedules.service";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P10.1: session CRUD (endpoints 18/19/20). Needs IntentsModule (session-
// scoped intents, BR-AVAIL-04) and MatchingModule (CandidateRepository,
// for match_preview's honest candidate counts).
// P10.2: belt-and-braces expiry — AvailabilityExpiryService is the shared
// idempotent core; AvailabilityExpiryWorker (the 30s Postgres sweeper,
// "braces") and AvailabilityKeyspaceListenerService (the Redis TTL
// keyspace notification, "belt") are two independent triggers into it.
// P10.3: recurring schedules (endpoint 22) — SchedulesService/Controller
// own the CRUD; ScheduleGeneratorWorker (60s tick) materialises due
// occurrences into real sessions via AvailabilityRepository, honouring
// BR-AVAIL-10's dormant-user gate.
// P11.2: PresenceBroadcastListener is the first real consumer of
// availability.changed — fans coarse start/end presence out to
// rt:presence:{geohash5} via RealtimeModule's publisher.
@Module({
  imports: [IntentsModule, MatchingModule, RealtimeModule],
  controllers: [AvailabilityController, SchedulesController],
  providers: [
    AvailabilityRepository,
    AvailabilityService,
    AvailabilityExpiryService,
    AvailabilityExpiryWorker,
    AvailabilityKeyspaceListenerService,
    SchedulesRepository,
    SchedulesService,
    ScheduleGeneratorService,
    ScheduleGeneratorWorker,
    PresenceBroadcastListener,
  ],
  exports: [
    AvailabilityRepository,
    AvailabilityService,
    AvailabilityExpiryService,
    SchedulesRepository,
    SchedulesService,
  ],
})
export class AvailabilityModule {}
