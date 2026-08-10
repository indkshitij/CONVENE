import { Injectable } from "@nestjs/common";
import type { PushJobData } from "./push-notification.producer";

// The actual FCM/APNs integration (device token lookup, provider SDKs,
// delivery-result handling) is Phase 17 (Notifications) territory — §10.8
// names `new_message` as a "Push, In-app / Critical" category, but no
// push provider or `devices` query path has been wired up by any phase
// yet. This stub is what BR-MSG-06's *scheduling and cancellation*
// behaviour (this phase's actual scope) sends to once a delay elapses
// uncancelled; swap the body for a real provider call without touching
// the producer/worker/cancellation logic around it.
@Injectable()
export class PushSender {
  async send(data: PushJobData): Promise<void> {
    void data;
  }
}
