import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { BullmqConnectionService } from "../../infra/queue/bullmq-connection.service";

export const EMBEDDING_REFRESH_QUEUE = "embedding-refresh";

// BR-PROF-09: "debounced 60 s." A 60-second delayed job, keyed by userId
// (jobId = userId) so each user has at most one pending refresh at a
// time.
export const EMBEDDING_REFRESH_DEBOUNCE_MS = 60_000;

export interface EmbeddingRefreshJobData {
  userId: string;
}

@Injectable()
export class EmbeddingRefreshProducer implements OnModuleDestroy {
  private readonly queue: Queue<EmbeddingRefreshJobData>;

  constructor(connectionService: BullmqConnectionService) {
    this.queue = new Queue<EmbeddingRefreshJobData>(EMBEDDING_REFRESH_QUEUE, {
      connection: connectionService.client,
    });
  }

  // Re-editing before the 60s delay elapses resets the timer rather than
  // enqueuing a second job: BullMQ's Queue.add silently no-ops (returns
  // the existing job unchanged, doesn't reset its delay) when a job with
  // the same jobId already exists, so a still-delayed job must be removed
  // first to actually reset the timer. A job that's already moved past
  // "delayed" (active/completed) is left as-is and add() will no-op
  // against it — it'll read fresh profile state whenever it (or the next
  // edit's job) runs regardless of exactly when it was enqueued.
  async enqueueRefresh(userId: string): Promise<void> {
    const existing = await this.queue.getJob(userId);
    if (existing && (await existing.getState()) === "delayed") {
      await existing.remove();
    }

    await this.queue.add(
      EMBEDDING_REFRESH_QUEUE,
      { userId },
      {
        jobId: userId,
        delay: EMBEDDING_REFRESH_DEBOUNCE_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
