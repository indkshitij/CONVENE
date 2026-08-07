import {
  cities,
  industries,
  interests,
  languages,
  skills,
  type City,
  type Industry,
  type Interest,
  type Language,
  type Skill,
} from "@convene/db";
import { Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { CacheService } from "../../common/cache/cache.service";
import { taxonomyKey } from "../../infra/redis/keys";
import { PostgresService } from "../../infra/postgres/postgres.service";

// PRD §17.6: "Redis: ... 5 min" — the P6.1 prompt's own cache spec for
// taxonomy reads. Reference data changes rarely (an admin approval, a new
// city), so 5 minutes of staleness is an acceptable trade for near-zero DB
// load on repeat requests (this phase's acceptance criterion).
const TAXONOMY_CACHE_TTL_SECONDS = 5 * 60;
const SEARCH_RESULT_LIMIT = 20;

export type TaxonomyKind = "skills" | "industries" | "cities" | "languages" | "interests";

// PRD §10.1.7 endpoint 62 + BR-PROF-02 ("skills normalised against a
// canonical taxonomy ... alias resolution ... unmatched free-text skills
// accepted, embedded, and queued for taxonomy review"). Skill
// creation/resolution is request-only: a new skill starts unapproved and
// must never be surfaced to matching until an admin approves it — that's
// what getApprovedSkillsForMatching() enforces structurally, rather than
// leaving it to every future matching-code caller to remember a filter.
@Injectable()
export class TaxonomyService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly cache: CacheService,
  ) {}

  async getSkills(query?: string): Promise<Skill[]> {
    return this.cache.getOrSet(
      taxonomyKey("skills", query ?? ""),
      TAXONOMY_CACHE_TTL_SECONDS,
      async () => {
        if (!query) {
          return this.postgres.db
            .select()
            .from(skills)
            .orderBy(sql`${skills.usageCount} DESC`);
        }
        const pattern = `%${query}%`;
        return this.postgres.db
          .select()
          .from(skills)
          .where(
            sql`${skills.name} ILIKE ${pattern} OR EXISTS (
            SELECT 1 FROM unnest(${skills.aliases}) AS alias WHERE alias ILIKE ${pattern}
          )`,
          )
          .orderBy(sql`${skills.usageCount} DESC`)
          .limit(SEARCH_RESULT_LIMIT);
      },
    );
  }

  // PRD §20.3-style structural enforcement: the only skill list the
  // matching engine (packages/matching) is ever allowed to read from.
  async getApprovedSkillsForMatching(): Promise<Skill[]> {
    return this.postgres.db.select().from(skills).where(eq(skills.isApproved, true));
  }

  // BR-PROF-02: normalises a free-text skill against the canonical
  // taxonomy (exact name or alias match, case-insensitive); an unmatched
  // name is accepted as a brand-new *unapproved* request rather than
  // rejected, with usage_count tracked for the approval queue. Repeated
  // requests for the same not-yet-approved name accumulate usage_count
  // rather than creating duplicate rows.
  async resolveOrCreateSkill(name: string): Promise<Skill> {
    const normalized = name.trim();
    const [existing] = await this.postgres.db
      .select()
      .from(skills)
      .where(
        sql`lower(${skills.name}) = lower(${normalized}) OR EXISTS (
        SELECT 1 FROM unnest(${skills.aliases}) AS alias WHERE lower(alias) = lower(${normalized})
      )`,
      )
      .limit(1);

    if (existing) {
      const [updated] = await this.postgres.db
        .update(skills)
        .set({ usageCount: sql`${skills.usageCount} + 1` })
        .where(eq(skills.id, existing.id))
        .returning();
      await this.cache.invalidate(taxonomyKey("skills", ""));
      return updated ?? existing;
    }

    const slug = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const [created] = await this.postgres.db
      .insert(skills)
      .values({ name: normalized, slug, isApproved: false, usageCount: 1 })
      .returning();
    if (!created) throw new Error("TaxonomyService: skill insert returned no row");

    await this.cache.invalidate(taxonomyKey("skills", ""));
    return created;
  }

  // Interests have no alias/approval workflow the way skills do (§10.2.2
  // gives interests no equivalent of BR-PROF-02) — a free-text interest is
  // simply reused if it already exists (case-insensitive) or created
  // immediately usable, no review queue.
  async resolveOrCreateInterest(name: string): Promise<Interest> {
    const normalized = name.trim();
    const [existing] = await this.postgres.db
      .select()
      .from(interests)
      .where(sql`lower(${interests.name}) = lower(${normalized})`)
      .limit(1);
    if (existing) return existing;

    const slug = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const [created] = await this.postgres.db
      .insert(interests)
      .values({ name: normalized, slug })
      .returning();
    if (!created) throw new Error("TaxonomyService: interest insert returned no row");

    await this.cache.invalidate(taxonomyKey("interests", ""));
    return created;
  }

  async getIndustries(): Promise<Industry[]> {
    return this.cache.getOrSet(taxonomyKey("industries", ""), TAXONOMY_CACHE_TTL_SECONDS, () =>
      this.postgres.db.select().from(industries).orderBy(asc(industries.name)),
    );
  }

  async getCities(query?: string): Promise<City[]> {
    return this.cache.getOrSet(
      taxonomyKey("cities", query ?? ""),
      TAXONOMY_CACHE_TTL_SECONDS,
      async () => {
        if (!query) {
          return this.postgres.db
            .select()
            .from(cities)
            .orderBy(sql`${cities.population} DESC NULLS LAST`)
            .limit(SEARCH_RESULT_LIMIT);
        }
        const pattern = `%${query}%`;
        // idx_cities_name is a GIN gin_trgm_ops index — it accelerates both
        // this ILIKE pattern match and the similarity() ordering below.
        return this.postgres.db
          .select()
          .from(cities)
          .where(sql`${cities.name} ILIKE ${pattern}`)
          .orderBy(sql`similarity(${cities.name}, ${query}) DESC`)
          .limit(SEARCH_RESULT_LIMIT);
      },
    );
  }

  async getLanguages(): Promise<Language[]> {
    return this.cache.getOrSet(taxonomyKey("languages", ""), TAXONOMY_CACHE_TTL_SECONDS, () =>
      this.postgres.db.select().from(languages).orderBy(asc(languages.name)),
    );
  }

  async getInterests(): Promise<Interest[]> {
    return this.cache.getOrSet(taxonomyKey("interests", ""), TAXONOMY_CACHE_TTL_SECONDS, () =>
      this.postgres.db.select().from(interests).orderBy(asc(interests.name)),
    );
  }
}
