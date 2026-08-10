import { Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { AuthContext } from "../../common/auth/auth-context";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { RealtimeTicketService, type WsTicketResponse } from "./realtime-ticket.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §17.9 endpoint 61 / §17.5.
@Controller("realtime")
export class RealtimeController {
  constructor(private readonly ticketService: RealtimeTicketService) {}

  @Post("ticket")
  @HttpCode(201)
  @Policy(selfScoped)
  async issueTicket(@Req() request: RequestLike): Promise<WsTicketResponse> {
    const { id: userId, role } = requireAuthContext(request);
    return this.ticketService.issueTicket(userId, role);
  }
}
