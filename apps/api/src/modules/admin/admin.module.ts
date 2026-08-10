import { Module } from "@nestjs/common";
import { MatchingModule } from "../matching/matching.module";
import { AdminMatchingController } from "./admin-matching.controller";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P3.1 registered the empty skeleton; P12.3 gives it its first real
// responsibility ("config, weight editor" per this module's own README) —
// the matching-weights remote-config editor and the §11.11 fairness audit
// report, both admin-only. Everything else the README lists (queue views)
// is a later phase's job.
@Module({
  imports: [MatchingModule],
  controllers: [AdminMatchingController],
})
export class AdminModule {}
