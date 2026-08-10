import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import {
  PUSH_NOTIFICATION_QUEUE,
  type PushJobData,
} from "../modules/messaging/services/push-notification.producer";
import { PushSender } from "../modules/messaging/services/push-sender";

// BR-MSG-06. Only the wiring lives here — see push-notification.producer.ts
// for scheduling/cancellation and push-sender.ts for what "send" means
// today (a documented stub; Phase 17 owns the real provider integration).
// A job reaching this worker at all already proves it was NOT cancelled
// within the 8s window, since cancelPush() removes still-delayed jobs
// before BullMQ would ever hand them to a worker.
@Injectable()
export class PushNotificationWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<PushJobData> | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly pushSender: PushSender,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<PushJobData>(
      PUSH_NOTIFICATION_QUEUE,
      async (job) => {
        await this.pushSender.send(job.data);
      },
      { connection: this.connectionService.client },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
