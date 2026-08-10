import { connections as connectionsValidation } from "@convene/validation";
import type { ConnectionRequest } from "@convene/db";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ConnectionsRepository } from "./repositories/connections.repository";
import {
  type AcceptRequestResult,
  type ListRequestsParams,
  type SendConnectionRequestInput,
  ConnectionsService,
} from "./services/connections.service";

interface RequestLike {
  authContext?: AuthContext;
}

interface ResponseLike {
  status(code: number): ResponseLike;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

type CreateConnectionRequestBody = z.infer<
  typeof connectionsValidation.createConnectionRequestSchema
>;

interface RequestCard {
  id: string;
  status: ConnectionRequest["status"];
  sender_id: string;
  recipient_id: string;
  intent: { id: string; type: string; detail: string | null } | null;
  note: string | null;
  match_score: number | null;
  match_reasons: string[] | null;
  is_queued: boolean;
  created_at: string;
  expires_at: string;
}

// PRD §10.6.6, endpoints 32/33/34: send, accept/reject/withdraw, list.
@Controller("connections")
export class ConnectionsController {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly repo: ConnectionsRepository,
  ) {}

  // PRD §17.9 endpoint 32: "POST /connections/requests | Send request
  // (202 if throttled)." anyAuthenticatedUser — the real authorization
  // decision (blocked, cooldown, intent ownership...) is I/O-bound and
  // enforced inside ConnectionsService, same pattern as
  // profile/README's own anyAuthenticatedUser routes.
  @Post("requests")
  @Policy(anyAuthenticatedUser)
  async sendRequest(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) response: ResponseLike,
    @Body(new ZodValidationPipe(connectionsValidation.createConnectionRequestSchema))
    body: CreateConnectionRequestBody,
  ): Promise<{
    request: { id: string; status: ConnectionRequest["status"]; expires_at: string };
    quota: unknown;
    queued_position?: number;
  }> {
    const { id: senderId, plan } = requireAuthContext(request);
    const input: SendConnectionRequestInput = {
      recipientId: body.recipient_id,
      intentId: body.intent_id,
      note: body.note ?? null,
      source: body.source ?? null,
      matchScore: body.match_score ?? null,
    };

    const result = await this.connectionsService.sendRequest(senderId, plan, input);
    response.status(result.status);
    return {
      request: result.request,
      quota: result.quota,
      ...(result.queued_position !== null ? { queued_position: result.queued_position } : {}),
    };
  }

  // PRD §17.9 endpoint 34: "GET /connections/requests | direction=received|sent."
  @Get("requests")
  @Policy(anyAuthenticatedUser)
  async listRequests(
    @Req() request: RequestLike,
    @Query("direction") direction?: string,
    @Query("status") status?: string,
    @Query("sort") sort?: string,
    @Query("cursor") cursor?: string,
  ): Promise<{
    requests: RequestCard[];
    next_cursor: string | null;
    throttle: { enabled: boolean; daily_cap: number; queued_count: number } | null;
  }> {
    const { id: userId } = requireAuthContext(request);
    const params: ListRequestsParams = {
      direction: direction === "sent" ? "sent" : "received",
      status: isRequestStatus(status) ? status : undefined,
      sort: sort === "recent" ? "recent" : "score_desc",
      cursor,
    };

    const result = await this.connectionsService.listRequests(userId, params);
    const intentIds = result.requests
      .map((row) => row.intentId)
      .filter((id): id is string => id !== null);
    const intents = await this.repo.loadIntentSummaries(intentIds);

    return {
      requests: result.requests.map((row) => this.toCard(row, intents)),
      next_cursor: result.nextCursor,
      throttle: result.throttle
        ? {
            enabled: result.throttle.enabled,
            daily_cap: result.throttle.dailyCap,
            queued_count: result.throttle.queuedCount,
          }
        : null,
    };
  }

  // §10.6.6: "DELETE /connections/requests/:id → 204 (withdraw)."
  @Delete("requests/:id")
  @HttpCode(204)
  @Policy(anyAuthenticatedUser)
  async withdrawRequest(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: senderId } = requireAuthContext(request);
    await this.connectionsService.withdrawRequest(senderId, id);
  }

  // §10.6.6: "POST /connections/requests/:id/accept → 200 { connection, conversation }."
  @Post("requests/:id/accept")
  @Policy(anyAuthenticatedUser)
  async acceptRequest(
    @Req() request: RequestLike,
    @Param("id") id: string,
  ): Promise<AcceptRequestResult> {
    const { id: recipientId } = requireAuthContext(request);
    return this.connectionsService.acceptRequest(recipientId, id);
  }

  // §10.6.6: "POST /connections/requests/:id/reject → 204 (silent to sender)."
  @Post("requests/:id/reject")
  @HttpCode(204)
  @Policy(anyAuthenticatedUser)
  async rejectRequest(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: recipientId } = requireAuthContext(request);
    await this.connectionsService.rejectRequest(recipientId, id);
  }

  private toCard(
    row: ConnectionRequest,
    intents: Map<string, { id: string; type: string; detail: string | null }>,
  ): RequestCard {
    return {
      id: row.id,
      status: row.status,
      sender_id: row.senderId,
      recipient_id: row.recipientId,
      intent: row.intentId ? (intents.get(row.intentId) ?? null) : null,
      note: row.note,
      match_score: row.matchScore,
      match_reasons: (row.matchReasons as string[] | null) ?? null,
      is_queued: row.isQueued,
      created_at: row.createdAt.toISOString(),
      expires_at: row.expiresAt.toISOString(),
    };
  }
}

function isRequestStatus(value: string | undefined): value is ConnectionRequest["status"] {
  return (
    value === "pending" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "cancelled" ||
    value === "expired"
  );
}
