import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JwksService, LocalFileKeyProvider } from "../auth/services/jwks.service";
import { RealtimeTicketService, WS_TICKET_TTL_SECONDS } from "./realtime-ticket.service";

describe("RealtimeTicketService", () => {
  let dir: string;
  let jwks: JwksService;
  let ticketService: RealtimeTicketService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "convene-realtime-ticket-test-"));
    const provider = new LocalFileKeyProvider(join(dir, "keys.json"));
    jwks = new JwksService(provider);
    ticketService = new RealtimeTicketService(jwks);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("issues a 60s-TTL RS256 ticket carrying sub/typ/conn_scope/role", async () => {
    const { ticket, expires_in } = await ticketService.issueTicket("user-1", "user");
    expect(expires_in).toBe(WS_TICKET_TTL_SECONDS);

    const decoded = jwt.decode(ticket, { complete: true });
    expect(decoded).not.toBeNull();
    const payload = decoded?.payload as jwt.JwtPayload;
    expect(payload.sub).toBe("user-1");
    expect((payload as { typ?: string }).typ).toBe("ws_ticket");
    expect((payload as { conn_scope?: string }).conn_scope).toBe("user");
    expect((payload as { role?: string }).role).toBe("user");
    expect(payload.exp! - payload.iat!).toBe(WS_TICKET_TTL_SECONDS);
  });

  it("carries the caller's own role, e.g. moderator", async () => {
    const { ticket } = await ticketService.issueTicket("mod-1", "moderator");
    const payload = jwt.decode(ticket) as jwt.JwtPayload;
    expect((payload as { role?: string }).role).toBe("moderator");
  });

  it("signs with a key published on the same JWKS the API serves", async () => {
    const { ticket } = await ticketService.issueTicket("user-1", "user");
    const decoded = jwt.decode(ticket, { complete: true });
    const kid = decoded?.header.kid;

    const { keys } = await jwks.getJwks();
    expect(keys.some((key) => key.kid === kid)).toBe(true);
  });

  it("gives each ticket a distinct jti (so single-use enforcement can key off it)", async () => {
    const a = await ticketService.issueTicket("user-1", "user");
    const b = await ticketService.issueTicket("user-1", "user");
    const jtiA = (jwt.decode(a.ticket) as jwt.JwtPayload).jti;
    const jtiB = (jwt.decode(b.ticket) as jwt.JwtPayload).jti;
    expect(jtiA).not.toBe(jtiB);
  });
});
