import { Module } from "@nestjs/common";
import { CacheService } from "../../common/cache/cache.service";
import { TaxonomyController } from "./taxonomy.controller";
import { TaxonomyService } from "./taxonomy.service";

// PRD §17.2 lists 13 domain modules with no explicit owner for shared
// reference data (skills, industries, cities, languages, interests) — the
// P6.1 prompt names this module directly ("modules/taxonomy/*"), so it's
// added as a 14th, cross-cutting module rather than folded into Profile
// (which owns the *user's* skills/interests/languages, not the taxonomies
// themselves).
@Module({
  controllers: [TaxonomyController],
  providers: [CacheService, TaxonomyService],
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
