import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { BullmqConnectionService } from "../../../infra/queue/bullmq-connection.service";

export const PUSH_NOTIFICATION_QUEUE = "message-push-delay";

// BR-MSG-06: "push notification is delayed 8s and cancelled if the
// recipient reads the message in that window."
export const PUSH_DELAY_MS = 8_000;

export interface PushJobData {
  messageId: string;
  recipientUserId: string;
  conversationId: string;
}

// BullMQ rejects custom job ids containing ":" (its own delimiter for
// internal key namespacing) — verified against a real Redis/BullMQ
// instance, not assumed.
function jobId(messageId: string, recipientUserId: string): string {
  return `${messageId}|${recipientUserId}`;
}

// Producer half of BR-MSG-06 — scheduling and cancellation only (same
// division availability-expiry.worker.ts/embedding-refresh.producer.ts
// establish: this file is BullMQ wiring, PushNotificationWorker owns
// what happens when the delay actually elapses).
@Injectable()
export class PushNotificationProducer implements OnModuleDestroy {
  private readonly queue: Queue<PushJobData>;

  constructor(connectionService: BullmqConnectionService) {
    this.queue = new Queue<PushJobData>(PUSH_NOTIFICATION_QUEUE, {
      connection: connectionService.client,
    });
  }

  async enqueuePush(data: PushJobData): Promise<void> {
    await this.queue.add(PUSH_NOTIFICATION_QUEUE, data, {
      jobId: jobId(data.messageId, data.recipientUserId),
      delay: PUSH_DELAY_MS,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  // Only removes a job still in the "delayed" state — a push that's
  // already started sending (or finished) is left alone, matching
  // BR-MSG-06's own "cancelled if read in that window," not "recalled
  // after the fact."
  async cancelPush(messageId: string, recipientUserId: string): Promise<void> {
    const job = await this.queue.getJob(jobId(messageId, recipientUserId));
    if (job && (await job.getState()) === "delayed") {
      await job.remove();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
