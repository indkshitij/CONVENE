import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

// PRD §20.2: "Argon2id (m=64 MB, t=3, p=4) with a per-user salt." argon2's
// own hash() generates a fresh random salt per call and embeds it in the
// output string — that's the "per-user salt": nothing here manages salts
// by hand, and none is ever reused across users.
// Exported so otp.service.ts can hash OTP codes with the same Argon2id
// parameters (§17.4/§20.2 also say OTPs are "Argon2id-hashed", without
// giving separate parameters) rather than duplicating this config.
export const ARGON2_OPTIONS: argon2.HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536, // KiB — 64 MB
  timeCost: 3,
  parallelism: 4,
  raw: false,
};

export type HttpFetcher = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

// Injection token for the HIBP HTTP call, so tests can supply a fake
// fetcher instead of hitting the real network — the same pattern as the
// ENV token in config.module.ts.
export const HTTP_FETCHER = "HTTP_FETCHER";

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range";

@Injectable()
export class PasswordService {
  constructor(@Inject(HTTP_FETCHER) private readonly fetcher: HttpFetcher) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  // PRD's own testing note: "assert the timing of a verify against a wrong
  // password is not trivially distinguishable." argon2.verify() always
  // runs the full Argon2id computation before its final (constant-time)
  // comparison, for both a matching and a non-matching password — no
  // early-exit branch is introduced here that would leak timing.
  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  // PRD §20.2 / §20.4: "checked against a breached-password corpus
  // (k-anonymity API, never sending the full hash)." Only the first 5
  // hex chars of the SHA-1 digest are sent to the HIBP range API; the
  // full hash (and the password itself) never leaves this process.
  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const response = await this.fetcher(`${HIBP_RANGE_URL}/${prefix}`);
      if (!response.ok) return false;

      const body = await response.text();
      return body
        .split("\n")
        .map((line) => line.split(":")[0]?.trim())
        .some((candidateSuffix) => candidateSuffix === suffix);
    } catch {
      // Fail open: a breach-corpus outage is a defence-in-depth check, not
      // the primary control — it must never block registration/reset.
      return false;
    }
  }
}
