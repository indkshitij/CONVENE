import { createPublicKey } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { ENV } from "./config/config.module";
import type { Env } from "./config/env.schema";
import { RedisService } from "./infra/redis/redis.service";
import { wsTicketUsedKey } from "./infra/redis/keys";

// Must match apps/api/src/modules/realtime/realtime-ticket.service.ts's
// signing side exactly.
const ISSUER = "https://api.convene.app";
const AUDIENCE = "https://api.convene.app";
const JWKS_CACHE_TTL_MS = 5 * 60_000;

interface Jwk {
  kty: string;
  n: string;
  e: string;
  kid: string;
  use: string;
  alg: string;
  [key: string]: unknown;
}

export class InvalidTicketError extends Error {}

export interface VerifiedTicket {
  userId: string;
  role: string;
}

// PRD §17.5: "the client connects with the ticket, never with the access
// token in a query string." §17.4: "Single-use JWT." Verification is
// entirely stateless-signature + one Redis SETNX for the single-use
// guarantee — no DB, no session lookup, consistent with §17.5's "the
// gateway holds no authoritative state."
@Injectable()
export class TicketService {
  private jwksCache = new Map<string, string>();
  private jwksCachedAt = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  async verifyTicket(ticket: string): Promise<VerifiedTicket> {
    const decoded = jwt.decode(ticket, { complete: true });
    if (!decoded || typeof decoded === "string") {
      throw new InvalidTicketError("malformed ticket");
    }

    const kid = decoded.header.kid;
    const publicKeyPem = await this.getVerificationKey(kid);
    if (!publicKeyPem) {
      throw new InvalidTicketError("no verification key matches this ticket's kid");
    }

    let payload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(ticket, publicKeyPem, {
        algorithms: ["RS256"],
        audience: AUDIENCE,
        issuer: ISSUER,
      });
      if (typeof verified === "string") throw new Error("unexpected string payload");
      payload = verified;
    } catch (error) {
      throw new InvalidTicketError(error instanceof Error ? error.message : "verification failed");
    }

    if ((payload as { typ?: string }).typ !== "ws_ticket") {
      throw new InvalidTicketError("not a ws ticket");
    }
    if (!payload.sub) {
      throw new InvalidTicketError("ticket missing sub");
    }
    if (!payload.jti) {
      throw new InvalidTicketError("ticket missing jti");
    }

    await this.consumeSingleUse(payload.jti, payload.exp);

    return { userId: payload.sub, role: (payload as { role?: string }).role ?? "user" };
  }

  // A JWT's own exp already stops it verifying after 60s; this SETNX is
  // what actually enforces "single-use" (nothing about RS256 verification
  // alone prevents replaying the same valid ticket twice within its TTL).
  private async consumeSingleUse(jti: string, exp: number | undefined): Promise<void> {
    const ttlSeconds = Math.max(
      1,
      (exp ?? Math.floor(Date.now() / 1000) + 60) - Math.floor(Date.now() / 1000),
    );
    const result = await this.redis.client.set(wsTicketUsedKey(jti), "1", "EX", ttlSeconds, "NX");
    if (result !== "OK") {
      throw new InvalidTicketError("ticket already used");
    }
  }

  private async getVerificationKey(kid: string | undefined): Promise<string | null> {
    if (!kid) return null;
    if (Date.now() - this.jwksCachedAt > JWKS_CACHE_TTL_MS) {
      this.jwksCache.clear();
    }
    const cached = this.jwksCache.get(kid);
    if (cached) return cached;

    await this.refreshJwks();
    return this.jwksCache.get(kid) ?? null;
  }

  private async refreshJwks(): Promise<void> {
    const response = await fetch(`${this.env.API_BASE_URL}/.well-known/jwks.json`);
    if (!response.ok) return;
    const body = (await response.json()) as { keys: Jwk[] };

    this.jwksCache.clear();
    for (const jwk of body.keys) {
      this.jwksCache.set(jwk.kid, jwkToPem(jwk));
    }
    this.jwksCachedAt = Date.now();
  }
}

function jwkToPem(jwk: Jwk): string {
  return createPublicKey({ key: jwk, format: "jwk" }).export({
    type: "spki",
    format: "pem",
  }) as string;
}
