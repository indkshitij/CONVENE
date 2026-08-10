import { media as mediaValidation } from "@convene/validation";
import type { Media } from "@convene/db";
import { Inject, Injectable } from "@nestjs/common";
import { isConversationParticipant } from "../../../common/auth/policies/is-conversation-participant.policy";
import {
  ConflictAppError,
  ForbiddenAppError,
  NotFoundAppError,
} from "../../../common/errors/app-error";
import { uuidv7 } from "../../../common/utils/uuidv7";
import { MessagesRepository } from "../../messaging/repositories/messages.repository";
import { MediaRepository } from "../repositories/media.repository";
import { MediaProcessingProducer } from "./media-processing.producer";
import { STORAGE_PROVIDER, type PresignedPut, type StorageProvider } from "./storage-provider";

const UPLOAD_URL_TTL_SECONDS = 15 * 60; // §17.7: "presign PUT (15 min...)."
const SERVE_URL_TTL_SECONDS = 10 * 60; // §17.7: "served only via 10-minute signed URLs."
const GC_AGE_MS = 24 * 60 * 60 * 1000; // §17.7: "uncommitted media rows are garbage-collected after 24h."
const GC_BATCH_SIZE = 200;

export interface CreateUploadIntentInput {
  kind: mediaValidation.MediaKind;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadIntentResult {
  mediaId: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

// PRD §17.7 endpoint 53: upload-intent + commit. Owns the media row's
// lifecycle up to "processing enqueued" — the pipeline itself
// (magic-byte check, EXIF strip, derivatives, AV scan, phash) is
// media-processing.service.ts, run by the worker after commit.
@Injectable()
export class MediaService {
  constructor(
    private readonly repo: MediaRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly processingProducer: MediaProcessingProducer,
    private readonly messagesRepo: MessagesRepository,
  ) {}

  async createUploadIntent(
    ownerId: string,
    input: CreateUploadIntentInput,
  ): Promise<UploadIntentResult> {
    // media.ts's own schema already validated kind/mime/size shape and
    // the mime-vs-kind allowlist at the controller boundary — this is
    // the storage-key allocation + presign step the diagram's "A->>A:
    // validate ... check quota" box covers (quota itself is the
    // "media-upload" @RateLimit policy, applied at the controller).
    const storageKey = `${input.kind}/${uuidv7()}`;
    const created = await this.repo.create({
      ownerId,
      kind: input.kind,
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    const presigned: PresignedPut = await this.storage.presignPut(
      storageKey,
      input.mimeType,
      input.sizeBytes,
      UPLOAD_URL_TTL_SECONDS,
    );

    return {
      mediaId: created.id,
      uploadUrl: presigned.url,
      method: presigned.method,
      headers: presigned.headers,
      expiresAt: presigned.expiresAt.toISOString(),
    };
  }

  async commit(mediaId: string, ownerId: string, conversationId: string | null): Promise<Media> {
    const existing = await this.repo.findById(mediaId);
    if (!existing) throw new NotFoundAppError("NOT_FOUND", "This media upload could not be found.");
    if (existing.ownerId !== ownerId)
      throw new ForbiddenAppError("FORBIDDEN", "You don't have permission to do that.");

    const committed = await this.repo.markCommitted(mediaId, new Date(), conversationId);
    if (!committed)
      throw new ConflictAppError("CONFLICT", "This media upload was already committed.");

    await this.processingProducer.enqueueProcess({ mediaId: committed.id });
    return committed;
  }

  // PRD §17.7 endpoint 54: "GET /media/:id/url | Signed URL." §17.7's own
  // hard rule: "served only via 10-minute signed URLs scoped to a
  // participant check, never public keys." A non-owner/non-participant
  // gets 404, not 403 — this phase's own explicit testing criterion
  // ("assert 404 (not 403)"), matching §17.9's "identical copy either
  // way" convention used everywhere else in this codebase for resources
  // the caller shouldn't even learn exist.
  async getSignedUrl(mediaId: string, userId: string): Promise<{ url: string; expiresAt: string }> {
    const row = await this.repo.findById(mediaId);
    if (!row || !(await this.canAccess(row, userId))) {
      throw new NotFoundAppError("NOT_FOUND", "This media could not be found.");
    }

    const url = await this.storage.presignGet(row.storageKey, row.mimeType, SERVE_URL_TTL_SECONDS);
    return { url, expiresAt: new Date(Date.now() + SERVE_URL_TTL_SECONDS * 1000).toISOString() };
  }

  private async canAccess(row: Media, userId: string): Promise<boolean> {
    if (row.ownerId === userId) return true;
    if (!row.conversationId) return false;
    const participantIds = await this.messagesRepo.loadParticipantIds(row.conversationId);
    return isConversationParticipant(participantIds, userId);
  }

  // §17.7: "uncommitted media rows are garbage-collected after 24h" —
  // also true for messaging's own orphaned-attachment edge case (§10.7.9
  // edge case 4: "attachment upload succeeds, message send fails").
  // Deletes the underlying object before the row, so a crash between the
  // two never leaves a row pointing at nothing — worst case is an
  // orphaned object with no row, cleaned up by nothing today (a known,
  // small, accepted gap: it costs storage, not correctness).
  async gcUncommitted(): Promise<number> {
    const cutoff = new Date(Date.now() - GC_AGE_MS);
    const stale = await this.repo.findUncommittedOlderThan(cutoff, GC_BATCH_SIZE);
    for (const row of stale) {
      await this.storage.deleteObject(row.storageKey).catch(() => undefined);
      await this.repo.deleteById(row.id);
    }
    return stale.length;
  }
}
