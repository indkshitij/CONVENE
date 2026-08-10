import { Injectable } from "@nestjs/common";

export interface PushSendInput {
  pushToken: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
}

export type PushSendResult = "sent" | "invalid_token" | "failed";

// No FCM/APNs integration exists anywhere in this codebase yet — same
// "hook exists, real provider deferred" posture as messaging's own
// push-sender.ts stub (P15.3). This one always reports "sent"; a real
// provider swaps in behind the same interface, and its "invalid token"
// responses are exactly what BR-NOTIF-06's pruning
// (NotificationsRepository.pruneByToken) is wired to consume.
@Injectable()
export class PushSender {
  async send(input: PushSendInput): Promise<PushSendResult> {
    void input;
    return "sent";
  }
}
