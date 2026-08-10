import { Inject, Injectable, Optional } from "@nestjs/common";
import { userChannel } from "../../../infra/redis/channels";
import { RealtimePublisherService } from "../../realtime/realtime-publisher.service";
import { MediaRepository } from "../repositories/media.repository";
import { NoOpAvScanner, type AvScanner } from "./av-scanner";
import {
  computeAverageHash,
  generateAvatarDerivatives,
  generateImageDerivatives,
  readDimensions,
  stripExif,
} from "./image-processing";
import { looksLikeSvg, magicBytesMatchDeclaredMime } from "./magic-bytes";
import { STORAGE_PROVIDER, type StorageProvider } from "./storage-provider";

const IMAGE_KINDS = new Set(["avatar", "message_image"]);

// §17.7's worker-side pipeline (the sequence diagram's `W->>W: ...` steps).
// Ordering matters and mirrors the diagram exactly: magic-byte
// verification and the SVG refusal happen before AV scanning, which
// happens before EXIF stripping/derivatives — an upload that fails an
// earlier step never reaches a later one, so a mismatched-MIME or
// infected file never gets so much as touched by sharp.
@Injectable()
export class MediaProcessingService {
  constructor(
    private readonly repo: MediaRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Optional() private readonly realtimePublisher?: RealtimePublisherService,
    @Optional() private readonly avScanner: AvScanner = new NoOpAvScanner(),
  ) {}

  async process(mediaId: string): Promise<void> {
    const row = await this.repo.findById(mediaId);
    if (!row || !row.committedAt) return; // GC'd, deleted, or never committed — nothing to process.

    const original = await this.storage.getObject(row.storageKey);

    if (looksLikeSvg(original)) {
      await this.reject(row.id);
      return;
    }
    if (!magicBytesMatchDeclaredMime(original, row.mimeType)) {
      await this.reject(row.id);
      return;
    }

    const scanResult = await this.avScanner.scan(original);
    if (scanResult === "infected") {
      await this.repo.updateProcessingResult(row.id, {
        moderationState: "quarantined",
        avScanState: "infected",
      });
      await this.publishReady(row.ownerId, row.id, "quarantined");
      return;
    }

    if (IMAGE_KINDS.has(row.kind)) {
      // Every derivative — and the perceptual hash — is computed from
      // this stripped buffer, never the original. The original stays in
      // storage only under its own (never-served, participant-gated)
      // key; nothing derived from it downstream carries EXIF/GPS.
      const stripped = await stripExif(original);
      const derivativeBuffers =
        row.kind === "avatar"
          ? await generateAvatarDerivatives(stripped)
          : await generateImageDerivatives(stripped);

      // A sibling key (suffix), not a child path under storageKey — the
      // original is itself stored *as a file* at storageKey, so nesting
      // "storageKey/derivatives/..." underneath it would ask the
      // filesystem to mkdir a directory where a file already exists
      // (verified against a real local filesystem before writing this).
      const derivativeKeys: Record<string, string> = {};
      for (const [name, buffer] of Object.entries(derivativeBuffers)) {
        const key = `${row.storageKey}__derivative__${name}`;
        await this.storage.putObject(key, buffer);
        derivativeKeys[name] = key;
      }

      const dimensions = await readDimensions(stripped);
      const perceptualHash = row.kind === "avatar" ? await computeAverageHash(stripped) : null;

      await this.repo.updateProcessingResult(row.id, {
        moderationState: "clean",
        avScanState: "clean",
        derivatives: derivativeKeys,
        perceptualHash,
        width: dimensions.width,
        height: dimensions.height,
      });
    } else {
      // voice/message_file/resume/export: no image pipeline applies.
      // Voice's real opus+waveform+transcription steps need an audio
      // encoder and an STT provider — neither exists in this codebase
      // yet (documented gap, same posture as the AV scanner and P15's
      // moderation classifier/push-sender stubs).
      await this.repo.updateProcessingResult(row.id, {
        moderationState: "clean",
        avScanState: "clean",
        derivatives: {},
      });
    }

    await this.publishReady(row.ownerId, row.id, "clean");
  }

  private async reject(mediaId: string): Promise<void> {
    await this.repo.updateProcessingResult(mediaId, {
      moderationState: "rejected",
      avScanState: "skipped",
    });
  }

  private async publishReady(ownerId: string, mediaId: string, state: string): Promise<void> {
    await this.realtimePublisher?.publish(userChannel(ownerId), "media.ready", {
      media_id: mediaId,
      state,
    });
  }
}
