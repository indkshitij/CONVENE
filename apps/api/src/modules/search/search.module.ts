import { Module } from "@nestjs/common";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

// PRD §17.2 — see README.md in this directory for owned tables and
// events. P24.2: a real (if intentionally simple — ILIKE, not full FTS/
// vector orchestration) GET /search/users, replacing the P3.1 skeleton.
// PostgresModule is @Global, so no explicit import is needed here — same
// convention every other data-touching module in this codebase follows.
@Module({
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
