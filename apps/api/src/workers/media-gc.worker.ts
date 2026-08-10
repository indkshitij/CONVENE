import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import { MediaService } from "../modules/media/services/media.service";

export const MEDIA_GC_QUEUE = "media-gc-sweep";
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // Hourly is plenty against a 24h threshold.
const SWEEP_JOB_ID = "sweep";

// §17.7: "uncommitted media rows are garbage-collected after 24h." Same
// shape as connection-request-expiry.worker.ts/availability-expiry.worker.ts
// — this file is only BullMQ scheduling; MediaService.gcUncommitted() owns
// the actual sweep query and deletion.
@Injectable()
export class MediaGcWorker implements OnModuleInit, OnModuleDestroy {
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly mediaService: MediaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(MEDIA_GC_QUEUE, { connection: this.connectionService.client });
    await this.queue.add(
      MEDIA_GC_QUEUE,
      {},
      {
        repeat: { every: SWEEP_INTERVAL_MS },
        jobId: SWEEP_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.worker = new Worker(
      MEDIA_GC_QUEUE,
      async () => {
        await this.mediaService.gcUncommitted();
      },
      { connection: this.connectionService.client },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
