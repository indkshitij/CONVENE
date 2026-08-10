import { Module } from "@nestjs/common";
import { CacheService } from "../../common/cache/cache.service";
import { ComplementarityService } from "./complementarity.service";
import { InboundFiltersController } from "./inbound-filters.controller";
import { InboundFiltersService } from "./inbound-filters.service";
import { IntentsController } from "./intents.controller";
import { IntentsService } from "./intents.service";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P8.1: taxonomy (endpoint 23) + intent CRUD (endpoint 24). P8.2: inbound
// filters (endpoint 25) + the complementarity service (its own
// in-process-LRU CacheService instance, same pattern taxonomy.module.ts
// uses — not shared globally, each module that needs one owns its own).
@Module({
  controllers: [IntentsController, InboundFiltersController],
  providers: [IntentsService, CacheService, ComplementarityService, InboundFiltersService],
  exports: [IntentsService, ComplementarityService, InboundFiltersService],
})
export class IntentsModule {}
