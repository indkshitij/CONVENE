import { industries, profileEmbeddings, profiles, skills, userSkills, users } from "@convene/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { NotFoundAppError } from "../../common/errors/app-error";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { composeEmbeddingText, hashSourceText } from "./embedding-text";
import { EMBEDDING_MODEL, EMBEDDING_PROVIDER, type EmbeddingProvider } from "./embedding-provider";

export interface RefreshEmbeddingResult {
  /** True when the composed text's hash matched the stored row — provider.embed() was never called (BR-PROF-09 cost control). */
  skipped: boolean;
}

// PRD P7.4 / BR-PROF-09. The DB-touching half of embedding maintenance —
// embedding-text.ts (composeEmbeddingText/hashSourceText) and
// embedding-vector.ts (the default provider's vector math) are the pure,
// independently-testable halves.
@Injectable()
export class EmbeddingService {
  constructor(
    private readonly postgres: PostgresService,
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
  ) {}

  async refreshEmbedding(userId: string): Promise<RefreshEmbeddingResult> {
    const text = await this.composeTextForUser(userId);
    const sourceHash = hashSourceText(text);

    const [existing] = await this.postgres.db
      .select({ sourceHash: profileEmbeddings.sourceHash })
      .from(profileEmbeddings)
      .where(eq(profileEmbeddings.userId, userId))
      .limit(1);

    // The whole cost-control mechanism (BR-PROF-09): an unrelated profile
    // edit (that doesn't touch headline/about/job title/skills/industry)
    // recomposes to the same text, hashes the same, and never reaches
    // provider.embed() at all.
    if (existing && existing.sourceHash === sourceHash) {
      return { skipped: true };
    }

    const embedding = await this.provider.embed(text);

    await this.postgres.db
      .insert(profileEmbeddings)
      .values({ userId, embedding, sourceHash, model: EMBEDDING_MODEL })
      .onConflictDoUpdate({
        target: profileEmbeddings.userId,
        set: { embedding, sourceHash, model: EMBEDDING_MODEL, updatedAt: new Date() },
      });

    return { skipped: false };
  }

  private async composeTextForUser(userId: string): Promise<string> {
    const [row] = await this.postgres.db
      .select({ profile: profiles, user: users })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");
    const { profile } = row;

    const [industryRow, skillRows] = await Promise.all([
      profile.industryId
        ? this.postgres.db
            .select({ name: industries.name })
            .from(industries)
            .where(eq(industries.id, profile.industryId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      this.postgres.db
        .select({ name: skills.name })
        .from(userSkills)
        .innerJoin(skills, eq(skills.id, userSkills.skillId))
        .where(eq(userSkills.userId, userId)),
    ]);

    return composeEmbeddingText({
      headline: profile.headline,
      about: profile.about,
      jobTitle: profile.jobTitle,
      industry: industryRow?.name ?? null,
      skills: skillRows.map((s) => s.name),
    });
  }
}
