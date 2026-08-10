import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import { NotificationsRepository } from "../modules/notifications/repositories/notifications.repository";

export const NOTIFICATION_EXPIRY_QUEUE = "notification-expiry-sweep";
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // Hourly, same cadence as the other sweep-style workers.
const SWEEP_JOB_ID = "sweep";
const NOTIFICATION_TTL_DAYS = 60; // BR-NOTIF-08.
const DELETE_BATCH_LIMIT = 1000;

// BR-NOTIF-08: "expire from the centre after 60 days." Same
// producer/worker-free "single Worker owns its own repeat schedule" shape
// as media-gc.worker.ts — this file is only BullMQ scheduling;
// NotificationsRepository.deleteOlderThan() owns the actual sweep query.
@Injectable()
export class NotificationExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly repo: NotificationsRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(NOTIFICATION_EXPIRY_QUEUE, {
      connection: this.connectionService.client,
    });
    await this.queue.add(
      NOTIFICATION_EXPIRY_QUEUE,
      {},
      {
        repeat: { every: SWEEP_INTERVAL_MS },
        jobId: SWEEP_JOB_ID,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );

    this.worker = new Worker(
      NOTIFICATION_EXPIRY_QUEUE,
      async () => {
        const cutoff = new Date(Date.now() - NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);
        let deleted = await this.repo.deleteOlderThan(cutoff, DELETE_BATCH_LIMIT);
        // deleteOlderThan has no batching primitive (plain DELETE...RETURNING,
        // see its own comment) — it always deletes everything past the
        // cutoff in one statement, so a single call already clears the
        // backlog; the loop guard below is just defensive against a future
        // batched implementation without needing this file to change.
        while (deleted >= DELETE_BATCH_LIMIT) {
          deleted = await this.repo.deleteOlderThan(cutoff, DELETE_BATCH_LIMIT);
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
