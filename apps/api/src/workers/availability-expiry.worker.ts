import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import { AvailabilityExpiryService } from "../modules/availability/availability-expiry.service";

export const AVAILABILITY_EXPIRY_QUEUE = "availability-expiry-sweep";
const SWEEP_INTERVAL_MS = 30_000; // §10.3.10: "sweeper (30s tick)."
const SWEEP_JOB_ID = "sweep"; // fixed id — re-registering the repeat on every boot doesn't duplicate it.

// PRD §10.3.10's "braces" — the independent, Postgres-authoritative half
// of belt-and-braces expiry (see availability-expiry.service.ts's own
// comment for why the actual expiry logic lives there, not here; this
// file is only the BullMQ scheduling/lifecycle wiring, same division
// embedding-refresh.worker.ts (P7.4) established). The "belt" (Redis
// keyspace notification) is a fully independent mechanism — see
// availability-keyspace-listener.service.ts — so removing either one
// still leaves the other able to expire a session on its own.
@Injectable()
export class AvailabilityExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly expiryService: AvailabilityExpiryService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(AVAILABILITY_EXPIRY_QUEUE, {
      connection: this.connectionService.client,
    });
    await this.queue.add(
      AVAILABILITY_EXPIRY_QUEUE,
      {},
      {
        repeat: { every: SWEEP_INTERVAL_MS },
        jobId: SWEEP_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.worker = new Worker(
      AVAILABILITY_EXPIRY_QUEUE,
      async () => {
        await this.expiryService.sweepExpired();
        await this.expiryService.warnExpiringSoon();
        await this.expiryService.checkPresenceDrivenTransitions();
      },
      { connection: this.connectionService.client },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
