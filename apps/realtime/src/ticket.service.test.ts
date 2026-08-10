import { generateKeyPairSync, createPublicKey } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./config/env.schema";
import { InvalidTicketError, TicketService } from "./ticket.service";
import type { RedisService } from "./infra/redis/redis.service";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const KID = "test-kid-1";
const ISSUER = "https://api.convene.app";
const AUDIENCE = "https://api.convene.app";

function jwk() {
  const exported = createPublicKey(publicKey).export({ format: "jwk" }) as { n: string; e: string };
  return { kty: "RSA", n: exported.n, e: exported.e, kid: KID, use: "sig", alg: "RS256" };
}

function signTicket(
  overrides: Partial<{
    typ: string;
    sub: string;
    expiresIn: number;
    kid: string;
    role: string;
  }> = {},
): string {
  return jwt.sign(
    { typ: overrides.typ ?? "ws_ticket", conn_scope: "user", role: overrides.role ?? "user" },
    privateKey,
    {
      algorithm: "RS256",
      subject: overrides.sub ?? "user-1",
      expiresIn: overrides.expiresIn ?? 60,
      jwtid: `jti-${Math.random().toString(36).slice(2)}`,
      audience: AUDIENCE,
      issuer: ISSUER,
      keyid: overrides.kid ?? KID,
    },
  );
}

function fakeRedis(): RedisService {
  const used = new Set<string>();
  return {
    client: {
      set: vi.fn(async (key: string, _value: string, _ex: string, _ttl: number, _nx: string) => {
        if (used.has(key)) return null;
        used.add(key);
        return "OK";
      }),
    },
  } as unknown as RedisService;
}

const env: Env = {
  NODE_ENV: "test",
  PORT: 8081,
  REDIS_URL: "redis://localhost:6379",
  API_BASE_URL: "https://api.test.internal",
  LOG_LEVEL: "info",
};

describe("TicketService", () => {
  let redis: RedisService;
  let ticketService: TicketService;

  beforeEach(() => {
    redis = fakeRedis();
    ticketService = new TicketService(env, redis);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk()] }) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verifies a freshly issued ws ticket and returns the subject as userId", async () => {
    const result = await ticketService.verifyTicket(signTicket({ sub: "user-42" }));
    expect(result).toEqual({ userId: "user-42", role: "user" });
  });

  it("carries the role claim through, e.g. moderator", async () => {
    const result = await ticketService.verifyTicket(
      signTicket({ sub: "mod-1", role: "moderator" }),
    );
    expect(result).toEqual({ userId: "mod-1", role: "moderator" });
  });

  it("rejects a reused ticket — single-use is enforced", async () => {
    const ticket = signTicket();
    await ticketService.verifyTicket(ticket);
    await expect(ticketService.verifyTicket(ticket)).rejects.toThrow(InvalidTicketError);
  });

  it("rejects a token whose typ isn't ws_ticket (e.g. a real access token)", async () => {
    await expect(ticketService.verifyTicket(signTicket({ typ: "access" }))).rejects.toThrow(
      /not a ws ticket/,
    );
  });

  it("rejects a ticket signed with an unknown kid", async () => {
    await expect(ticketService.verifyTicket(signTicket({ kid: "unknown-kid" }))).rejects.toThrow(
      /no verification key/,
    );
  });

  it("rejects a malformed ticket", async () => {
    await expect(ticketService.verifyTicket("not-a-jwt")).rejects.toThrow(InvalidTicketError);
  });

  it("rejects an expired ticket", async () => {
    const ticket = signTicket({ expiresIn: -10 });
    await expect(ticketService.verifyTicket(ticket)).rejects.toThrow(InvalidTicketError);
  });

  it("fetches JWKS from API_BASE_URL's well-known endpoint", async () => {
    await ticketService.verifyTicket(signTicket());
    expect(fetch).toHaveBeenCalledWith("https://api.test.internal/.well-known/jwks.json");
  });
});
