import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import { ConnectionsService } from "../modules/connections/services/connections.service";

export const CONNECTION_REQUEST_EXPIRY_QUEUE = "connection-request-expiry-sweep";
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // BR-CONN-04's 14-day window tolerates an hourly tick fine.
const SWEEP_JOB_ID = "sweep"; // fixed id — re-registering the repeat on every boot doesn't duplicate it.

// PRD §10.6.9's "Request expiry" Gherkin scenario. Same division as
// availability-expiry.worker.ts: this file is only the BullMQ scheduling/
// lifecycle wiring; the actual expiry logic (and its silence — see
// ConnectionsService.expirePendingRequests's own comment) lives in the
// service.
@Injectable()
export class ConnectionRequestExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly connectionsService: ConnectionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(CONNECTION_REQUEST_EXPIRY_QUEUE, {
      connection: this.connectionService.client,
    });
    await this.queue.add(
      CONNECTION_REQUEST_EXPIRY_QUEUE,
      {},
      {
        repeat: { every: SWEEP_INTERVAL_MS },
        jobId: SWEEP_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.worker = new Worker(
      CONNECTION_REQUEST_EXPIRY_QUEUE,
      async () => {
        await this.connectionsService.expirePendingRequests();
      },
      { connection: this.connectionService.client },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
