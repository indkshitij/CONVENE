import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import {
  MEDIA_PROCESSING_QUEUE,
  type MediaProcessingJobData,
} from "../modules/media/services/media-processing.producer";
import { MediaProcessingService } from "../modules/media/services/media-processing.service";

// §17.7's sequence diagram: this is the "media-pipeline worker" lane.
// Only BullMQ wiring lives here — media-processing.service.ts owns the
// actual pipeline steps. `attempts: 3` with exponential backoff is
// configured on the producer side (media-processing.producer.ts); a
// transient failure (e.g. storage hiccup) gets retried automatically.
@Injectable()
export class MediaProcessingWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<MediaProcessingJobData> | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly processingService: MediaProcessingService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<MediaProcessingJobData>(
      MEDIA_PROCESSING_QUEUE,
      async (job) => {
        await this.processingService.process(job.data.mediaId);
      },
      { connection: this.connectionService.client },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
