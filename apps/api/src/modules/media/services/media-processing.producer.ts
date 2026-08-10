import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { BullmqConnectionService } from "../../../infra/queue/bullmq-connection.service";

export const MEDIA_PROCESSING_QUEUE = "media-processing";

export interface MediaProcessingJobData {
  mediaId: string;
}

// §17.7's sequence diagram: "A->>W: enqueue process(media_id)" —
// producer half only; media-processing.worker.ts owns the actual
// pipeline. A committed media_id is a natural at-most-once key (a
// duplicate commit is already rejected by MediaService before this is
// ever called), so no debounce/jobId collapsing is needed here, unlike
// embedding-refresh's producer.
@Injectable()
export class MediaProcessingProducer implements OnModuleDestroy {
  private readonly queue: Queue<MediaProcessingJobData>;

  constructor(connectionService: BullmqConnectionService) {
    this.queue = new Queue<MediaProcessingJobData>(MEDIA_PROCESSING_QUEUE, {
      connection: connectionService.client,
    });
  }

  async enqueueProcess(data: MediaProcessingJobData): Promise<void> {
    await this.queue.add(MEDIA_PROCESSING_QUEUE, data, {
      jobId: data.mediaId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: true,
      removeOnFail: false, // Keep failed jobs visible for operator inspection — a stuck 'pending' media row is otherwise silent.
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
