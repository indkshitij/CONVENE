import { Injectable } from "@nestjs/common";
import { ValidationAppError } from "../../../common/errors/app-error";

// BR-MSG-05: "every message passes a synchronous fast-path check
// (length, links against a blocklist, banned-pattern regex)." Length is
// already enforced by messageBodySchema (≤4000 chars) before this ever
// runs. P25.3 (Trust & Safety) fills in the two halves this class
// previously left as a documented no-op: deterministic, zero-I/O checks
// — a real classifier call belongs in ToxicitySpamClassifierService's
// async stage (§12.8's "stage 2"), not here; this stage exists
// specifically to stay trivially within the <120ms/200ms sync budget.
const CONTACT_DETAIL_PATTERNS = [
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i, // Email address.
  /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,5}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/, // Phone-shaped digit run.
  /\b(?:whatsapp|telegram|wechat)\b/i, // Off-platform-contact solicitation.
];

// A representative, not exhaustive, starter set of scam/solicitation
// phrasing — the PRD names this check's shape without giving an actual
// word list; this is a defensible starting point, not a transcription,
// same "documented, not fabricated" judgment call as every other
// no-source-list case in this codebase.
const BANNED_PATTERNS = [
  /\bwire transfer\b/i,
  /\bcrypto(?:currency)? investment\b/i,
  /\bguaranteed returns?\b/i,
  /\bclick (?:this|the) link\b/i,
  /\bact now\b/i,
];

const MAX_URLS = 3;

@Injectable()
export class ModerationFastPathService {
  assertAllowed(body: string): void {
    const urlCount = (body.match(/https?:\/\/\S+/gi) ?? []).length;
    if (urlCount > MAX_URLS) throw new ModerationRejectedError("Too many links in one message.");

    for (const pattern of CONTACT_DETAIL_PATTERNS) {
      if (pattern.test(body))
        throw new ModerationRejectedError(
          "Please don't share contact details before you're connected.",
        );
    }
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(body))
        throw new ModerationRejectedError("This message violates our content guidelines.");
    }
  }
}

// Exported so a future real implementation (or a test proving the "under
// 200ms" budget against an actual check) has a concrete error shape to
// throw without inventing a new one at the call site.
export class ModerationRejectedError extends ValidationAppError {
  constructor(message = "This message violates our content guidelines.") {
    super("MODERATION_REJECTED", message);
  }
}
