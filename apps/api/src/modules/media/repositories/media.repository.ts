import { media, type Media } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, eq, lt, sql } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export interface CreateMediaInput {
  ownerId: string;
  kind: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

@Injectable()
export class MediaRepository {
  constructor(private readonly postgres: PostgresService) {}

  async create(input: CreateMediaInput): Promise<Media> {
    const [created] = await this.postgres.db.insert(media).values(input).returning();
    if (!created) throw new Error("MediaRepository: insert returned no row");
    return created;
  }

  async findById(id: string): Promise<Media | null> {
    const [row] = await this.postgres.db.select().from(media).where(eq(media.id, id)).limit(1);
    return row ?? null;
  }

  // Guarded by `committed_at IS NULL` so a duplicate commit call is a
  // no-op (returns null) rather than re-enqueuing processing.
  async markCommitted(id: string, now: Date, conversationId: string | null): Promise<Media | null> {
    const [updated] = await this.postgres.db
      .update(media)
      .set({ committedAt: now, conversationId })
      .where(and(eq(media.id, id), sql`${media.committedAt} IS NULL`))
      .returning();
    return updated ?? null;
  }

  async updateProcessingResult(
    id: string,
    patch: {
      moderationState: string;
      avScanState: string;
      derivatives?: Record<string, unknown>;
      perceptualHash?: string | null;
      width?: number | null;
      height?: number | null;
      durationMs?: number | null;
    },
  ): Promise<void> {
    await this.postgres.db.update(media).set(patch).where(eq(media.id, id));
  }

  // §17.7: "uncommitted media rows are garbage-collected after 24h."
  // idx_media_gc (partial index on created_at WHERE committed_at IS NULL)
  // exists specifically for this query.
  async findUncommittedOlderThan(cutoff: Date, limit: number): Promise<Media[]> {
    return this.postgres.db
      .select()
      .from(media)
      .where(and(sql`${media.committedAt} IS NULL`, lt(media.createdAt, cutoff)))
      .limit(limit);
  }

  async deleteById(id: string): Promise<void> {
    await this.postgres.db.delete(media).where(eq(media.id, id));
  }
}
