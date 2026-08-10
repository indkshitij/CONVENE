import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import { ReputationService } from "../modules/trust-safety/services/reputation.service";

export const REPUTATION_RECOMPUTE_QUEUE = "reputation-recompute-sweep";
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // §10.10.1: "recomputed nightly."
const SWEEP_JOB_ID = "sweep";

// §10.10.1: "recomputed nightly and on significant events." This worker
// covers only the nightly half — same repeat-schedule shape as every
// other sweep worker in this codebase (media-gc, notification-expiry).
// It walks every user in id-order pages via ReputationService.recomputeBatch,
// scheduling itself the next page as a one-off job rather than doing the
// whole table in a single tick, so one nightly run never holds a Redis
// connection or a DB transaction open for the full sweep's duration.
@Injectable()
export class ReputationRecomputeWorker implements OnModuleInit, OnModuleDestroy {
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly reputationService: ReputationService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(REPUTATION_RECOMPUTE_QUEUE, {
      connection: this.connectionService.client,
    });
    await this.queue.add(
      REPUTATION_RECOMPUTE_QUEUE,
      { afterId: null },
      {
        repeat: { every: SWEEP_INTERVAL_MS },
        jobId: SWEEP_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.worker = new Worker(
      REPUTATION_RECOMPUTE_QUEUE,
      async (job) => {
        const afterId = (job.data as { afterId: string | null }).afterId;
        const { lastId, count } = await this.reputationService.recomputeBatch(afterId);
        if (count > 0 && lastId) {
          // More users may remain in this page boundary — chain an
          // immediate follow-up job rather than waiting for tomorrow's
          // repeat tick. Not a repeat job itself (no jobId collision
          // with SWEEP_JOB_ID), so it doesn't fight the nightly schedule.
          await this.queue?.add(REPUTATION_RECOMPUTE_QUEUE, { afterId: lastId });
        }
      },
      { connection: this.connectionService.client },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
