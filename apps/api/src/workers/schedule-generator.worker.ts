import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import {
  GENERATOR_TICK_MS,
  ScheduleGeneratorService,
} from "../modules/availability/schedule-generator.service";

export const SCHEDULE_GENERATOR_QUEUE = "schedule-generator-tick";
const TICK_JOB_ID = "tick";

// PRD BR-AVAIL-09/10 / P10.3. Same BullMQ scheduling/lifecycle shape as
// workers/availability-expiry.worker.ts (P10.2) — the actual generation
// logic lives in schedule-generator.service.ts, this file is only the
// queue wiring.
@Injectable()
export class ScheduleGeneratorWorker implements OnModuleInit, OnModuleDestroy {
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly generatorService: ScheduleGeneratorService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(SCHEDULE_GENERATOR_QUEUE, { connection: this.connectionService.client });
    await this.queue.add(
      SCHEDULE_GENERATOR_QUEUE,
      {},
      {
        repeat: { every: GENERATOR_TICK_MS },
        jobId: TICK_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.worker = new Worker(
      SCHEDULE_GENERATOR_QUEUE,
      async () => {
        await this.generatorService.generateDueSessions();
      },
      { connection: this.connectionService.client },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
