import { isAbsolute, join } from "node:path";
import { Module } from "@nestjs/common";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";
import { MediaGcWorker } from "../../workers/media-gc.worker";
import { MediaProcessingWorker } from "../../workers/media-processing.worker";
import { MessagingModule } from "../messaging/messaging.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { LocalStorageController } from "./local-storage.controller";
import { MediaController } from "./media.controller";
import { MediaRepository } from "./repositories/media.repository";
import { MediaProcessingProducer } from "./services/media-processing.producer";
import { MediaProcessingService } from "./services/media-processing.service";
import { MediaService } from "./services/media.service";
import { LocalFilesystemStorageProvider, STORAGE_PROVIDER } from "./services/storage-provider";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P16.1: upload-intent/commit (endpoint 53), signed serving URLs
// (endpoint 54), and the processing pipeline (magic-byte verification,
// EXIF stripping, derivatives, AV scan, perceptual hashing) plus the
// 24h GC sweep for uncommitted uploads. Imports MessagingModule for
// MessagesRepository.loadParticipantIds (the signed-URL "participant
// check" for message-attachment media). STORAGE_PROVIDER binds to
// LocalFilesystemStorageProvider — see storage-provider.ts's own
// comment for the "local now, S3 later, same interface" precedent.
@Module({
  imports: [MessagingModule, RealtimeModule],
  controllers: [MediaController, LocalStorageController],
  providers: [
    MediaRepository,
    MediaService,
    MediaProcessingProducer,
    MediaProcessingService,
    MediaProcessingWorker,
    MediaGcWorker,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (env: Env) => {
        const rootDir = isAbsolute(env.MEDIA_STORAGE_ROOT)
          ? env.MEDIA_STORAGE_ROOT
          : join(process.cwd(), env.MEDIA_STORAGE_ROOT);
        return new LocalFilesystemStorageProvider(
          rootDir,
          env.MEDIA_SIGNING_SECRET,
          `http://localhost:${env.PORT}`,
        );
      },
      inject: [ENV],
    },
  ],
  exports: [MediaRepository, MediaService],
})
export class MediaModule {}
