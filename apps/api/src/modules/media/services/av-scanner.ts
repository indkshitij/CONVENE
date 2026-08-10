import { Injectable } from "@nestjs/common";

export type AvScanResult = "clean" | "infected";

export interface AvScanner {
  scan(buffer: Buffer): Promise<AvScanResult>;
}

// §17.7: "AV scan" is named as a pipeline step but the PRD gives no
// specific provider (ClamAV is the obvious open-source choice, but
// nothing is installed or configured in this repo). This stub always
// reports "clean" — a real scanner swaps in behind the same interface
// without touching media-processing.service.ts, same "hook exists, real
// integration deferred" posture as P15's ModerationFastPathService and
// PushSender.
@Injectable()
export class NoOpAvScanner implements AvScanner {
  async scan(buffer: Buffer): Promise<AvScanResult> {
    void buffer;
    return "clean";
  }
}
