import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import { MatchPrecomputeService } from "../modules/matching/services/match-precompute.service";

export const MATCH_PRECOMPUTE_QUEUE = "match-precompute-tick";
const TICK_JOB_ID = "tick";
// PRD §11.7: "Offline / Hourly — Precompute Worker."
export const PRECOMPUTE_TICK_MS = 60 * 60_000;

// Same BullMQ scheduling/lifecycle shape as
// workers/schedule-generator.worker.ts (P10.3) / workers/availability-
// expiry.worker.ts (P10.2) — queue wiring only, all real logic lives in
// match-precompute.service.ts.
@Injectable()
export class MatchPrecomputeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchPrecomputeWorker.name);
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly precomputeService: MatchPrecomputeService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(MATCH_PRECOMPUTE_QUEUE, { connection: this.connectionService.client });
    await this.queue.add(
      MATCH_PRECOMPUTE_QUEUE,
      {},
      {
        repeat: { every: PRECOMPUTE_TICK_MS },
        jobId: TICK_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.worker = new Worker(
      MATCH_PRECOMPUTE_QUEUE,
      async () => {
        const result = await this.precomputeService.precomputeForAllActiveUsers();
        this.logger.log(
          `Precomputed match candidates for ${result.users} users, wrote ${result.written} rows`,
        );
      },
      { connection: this.connectionService.client },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
