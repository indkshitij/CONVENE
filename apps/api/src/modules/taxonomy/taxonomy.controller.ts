import { Controller, Get, Param, Query } from "@nestjs/common";
import { NotFoundAppError } from "../../common/errors/app-error";
import { Policy } from "../../common/auth/policy.guard";
import { publicReferenceData } from "../../common/auth/policies";
import { type TaxonomyKind, TaxonomyService } from "./taxonomy.service";

const VALID_KINDS: readonly TaxonomyKind[] = [
  "skills",
  "industries",
  "cities",
  "languages",
  "interests",
];

function isTaxonomyKind(value: string): value is TaxonomyKind {
  return (VALID_KINDS as readonly string[]).includes(value);
}

// PRD §10.1.7 endpoint 62: "GET /taxonomies/{skills|industries|cities|
// languages|interests} — reference data (cached)." ETag/304 and the
// in-process-LRU-then-Redis caching are handled by the global
// EtagInterceptor and TaxonomyService's use of CacheService respectively
// — this controller only routes and shapes the response.
@Controller("taxonomies")
export class TaxonomyController {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  @Get(":kind")
  @Policy(publicReferenceData)
  async getTaxonomy(
    @Param("kind") kind: string,
    @Query("q") query?: string,
  ): Promise<Record<string, unknown[]>> {
    if (!isTaxonomyKind(kind)) {
      throw new NotFoundAppError("NOT_FOUND", `Unknown taxonomy "${kind}".`);
    }

    switch (kind) {
      case "skills":
        return { skills: await this.taxonomyService.getSkills(query) };
      case "industries":
        return { industries: await this.taxonomyService.getIndustries() };
      case "cities":
        return { cities: await this.taxonomyService.getCities(query) };
      case "languages":
        return { languages: await this.taxonomyService.getLanguages() };
      case "interests":
        return { interests: await this.taxonomyService.getInterests() };
    }
  }
}
