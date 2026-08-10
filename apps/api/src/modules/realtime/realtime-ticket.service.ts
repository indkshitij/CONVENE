import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { uuidv7 } from "../../common/utils/uuidv7";
import { JwksService } from "../auth/services/jwks.service";

// Deliberately the same iss/aud as token.service.ts's access tokens — both
// are RS256-signed by the same KMS key, verified the same way by anything
// downstream (apps/realtime/src/ticket.service.ts fetches the same
// /.well-known/jwks.json). typ:"ws_ticket" is what tells them apart.
const ISSUER = "https://api.convene.app";
const AUDIENCE = "https://api.convene.app";

// PRD §17.4 tokens table: "WS ticket | Single-use JWT | 60 s | Never
// persisted | sub, conn_scope." §17.5: exchanged for the raw access token
// specifically so it never lands in a wss:// query string that gets
// logged.
export const WS_TICKET_TTL_SECONDS = 60;

export interface WsTicketResponse {
  ticket: string;
  expires_in: number;
}

// PRD doesn't define conn_scope's contents beyond the claim's name. A
// gateway connection is always scoped to the ticket-holder's own user id
// (recovered from `sub`) — per-channel authorization (rt:conv:{id} etc.,
// P11.2) is re-derived from the DB at subscribe time, not trusted from
// this claim, so a fixed "user" value is sufficient rather than
// enumerating channels here. Flagged as a documented interpretation, not
// a literal transcription.
const CONN_SCOPE = "user";

@Injectable()
export class RealtimeTicketService {
  constructor(private readonly jwks: JwksService) {}

  // P11.2: `role` rides along so apps/realtime can gate rt:admin:reports
  // subscription without a DB round trip per connect — same role value
  // the access token itself already carries, just copied onto this
  // short-lived ticket rather than trusted from anywhere else.
  async issueTicket(userId: string, role: string): Promise<WsTicketResponse> {
    const { kid, privateKeyPem } = await this.jwks.getSigningKey();
    const ticket = jwt.sign({ typ: "ws_ticket", conn_scope: CONN_SCOPE, role }, privateKeyPem, {
      algorithm: "RS256",
      subject: userId,
      expiresIn: WS_TICKET_TTL_SECONDS,
      jwtid: uuidv7(),
      audience: AUDIENCE,
      issuer: ISSUER,
      keyid: kid,
    });
    return { ticket, expires_in: WS_TICKET_TTL_SECONDS };
  }
}
