import { checkIntentFloor, intentScore } from "@convene/matching";
import { Injectable, Optional } from "@nestjs/common";
import {
  BadRequestAppError,
  ConflictAppError,
  ForbiddenAppError,
  NotFoundAppError,
  TooManyRequestsAppError,
} from "../../../common/errors/app-error";
import { type Clock, systemClock } from "../../../common/clock";
import type { intents as intentsValidation } from "@convene/validation";
import { InboundFiltersService } from "../../intents/inbound-filters.service";
import { MatchingDataRepository } from "../../matching/repositories/matching-data.repository";
import { NotificationsService } from "../../notifications/notifications.service";
import { ConnectionQuotaService, type ConnectionPlan } from "./connection-quota.service";
import {
  ConnectionsRepository,
  type RequestDirection,
  type RequestSort,
} from "../repositories/connections.repository";
import type { ConnectionRequest } from "@convene/db";

export interface ListRequestsParams {
  direction: RequestDirection;
  status?: ConnectionRequest["status"] | undefined;
  sort: RequestSort;
  cursor?: string | undefined;
  limit?: number;
}

export interface ListRequestsResult {
  requests: ConnectionRequest[];
  nextCursor: string | null;
  throttle: { enabled: boolean; dailyCap: number; queuedCount: number } | null;
}

const DEFAULT_PAGE_SIZE = 20;

interface RequestCursor {
  score: number;
  id: string;
}

function encodeRequestCursor(cursor: RequestCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeRequestCursor(token: string): RequestCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as RequestCursor).score === "number" &&
      typeof (parsed as RequestCursor).id === "string"
    ) {
      return parsed as RequestCursor;
    }
    return null;
  } catch {
    return null;
  }
}

export interface SendConnectionRequestInput {
  recipientId: string;
  intentId: string;
  note: string | null;
  source: string | null;
  matchScore: number | null;
}

export interface SendConnectionRequestResult {
  status: 201 | 202;
  request: { id: string; status: ConnectionRequest["status"]; expires_at: string };
  quota: { used: number; limit: number; resets_at: string };
  queued_position: number | null;
}

export interface AcceptRequestResult {
  connection: { id: string; connected_at: string };
  conversation: { id: string; first_message_id: string | null };
}

// Seniority/reputation thresholds that auto-default a recipient's inbound
// cap to 10/day (BR-CONN-07) — "protects scarce senior supply" per the
// P14.1 prompt, defaults ON not off.
const SENIOR_EXPERIENCE_YEARS_THRESHOLD = 8;
const HIGH_REPUTATION_THRESHOLD = 80;
const AUTO_INBOUND_DAILY_CAP = 10;

// BR-CONN-12 cooldowns, in days (24h/7d/7d/30d).
const COOLDOWN_DAYS: Record<"rejected" | "expired" | "cancelled" | "removed", number> = {
  rejected: 30,
  expired: 7,
  cancelled: 1,
  removed: 7,
};

const DEFAULT_TIMEZONE = "UTC";

// P14.1: BR-CONN-01…15's send/list/withdraw surface (endpoints 32, 34,
// and DELETE .../requests/:id per §10.6.6). P14.2 adds accept/reject —
// the atomic multi-table transaction and the state machine's dignity/
// safety rules (§10.6.2, BR-CONN-03/08/09/10).
@Injectable()
export class ConnectionsService {
  constructor(
    private readonly repo: ConnectionsRepository,
    private readonly quota: ConnectionQuotaService,
    private readonly matchingData: MatchingDataRepository,
    private readonly inboundFilters: InboundFiltersService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  // Idempotency-Key replay is handled generically by the global
  // IdempotencyInterceptor (apps/api/src/common/interceptors) — this
  // method doesn't need to know about the header at all; a retried POST
  // with the same key never reaches here a second time.
  async sendRequest(
    senderId: string,
    senderPlan: string,
    input: SendConnectionRequestInput,
  ): Promise<SendConnectionRequestResult> {
    const now = this.clock.now();
    const plan = normalisePlan(senderPlan);

    if (input.recipientId === senderId) {
      throw new BadRequestAppError("BAD_REQUEST", "This person isn't available to connect");
    }

    const recipientStatus = await this.repo.findRecipientStatus(input.recipientId);
    if (!recipientStatus || recipientStatus !== "active") {
      throw new NotFoundAppError("NOT_FOUND", "This person isn't available to connect");
    }

    if (await this.repo.isBlockedEitherWay(senderId, input.recipientId)) {
      throw new ForbiddenAppError("BLOCKED", "This person isn't available to connect");
    }

    const intent = await this.repo.findOwnedActiveIntent(senderId, input.intentId);
    if (!intent) {
      throw new NotFoundAppError("INTENT_NOT_FOUND", "Select an active intent");
    }

    if (await this.repo.findActiveConnectionBetween(senderId, input.recipientId)) {
      throw new ConflictAppError("ALREADY_CONNECTED", "You're already connected with this person");
    }
    if (await this.repo.findPendingRequestBetween(senderId, input.recipientId)) {
      throw new ConflictAppError(
        "REQUEST_ALREADY_PENDING",
        "You already have a pending request with this person",
      );
    }
    await this.assertNoCooldown(senderId, input.recipientId, now);

    await this.assertIntentFloor(senderId, input.recipientId);
    await this.assertInboundFilterAllows(senderId, input.recipientId, intent.type);

    // Edge case 1 (§10.6.10): "A and B send requests to each other
    // simultaneously ... auto-accepted." If the recipient already has a
    // pending request to *this* sender (the reverse direction), this
    // send is completed as an instant mutual accept instead of creating
    // a new pending row — skipping the quota/velocity/inbound-throttle
    // checks below entirely, since nothing is queued or rate-limited
    // about a request that's accepted the instant it's created.
    const reversePending = await this.repo.findPendingRequestBetween(input.recipientId, senderId);
    if (reversePending) {
      return this.completeMutualAccept(reversePending, senderId, senderPlan, input, now);
    }

    await this.assertNotSoftBlocked(senderId);
    await this.assertNoteNotSpam(senderId, input.note, now);
    await this.assertVelocityAllowed(senderId, plan, now);
    const timezone = (await this.repo.loadTimezone(senderId)) ?? DEFAULT_TIMEZONE;
    const dailyQuota = await this.assertDailyQuotaAllowed(senderId, plan, timezone, now);

    const { isQueued, queuedPosition } = await this.resolveInboundThrottle(input.recipientId, now);

    const created = await this.repo.createRequest({
      senderId,
      recipientId: input.recipientId,
      intentId: input.intentId,
      note: input.note,
      matchScore: input.matchScore,
      matchReasons: null,
      source: input.source,
      isQueued,
    });

    return {
      status: isQueued ? 202 : 201,
      request: {
        id: created.id,
        status: created.status,
        expires_at: created.expiresAt.toISOString(),
      },
      quota: {
        used: dailyQuota.used,
        limit: dailyQuota.limit,
        resets_at: dailyQuota.resetsAt.toISOString(),
      },
      queued_position: queuedPosition,
    };
  }

  private async completeMutualAccept(
    reversePending: ConnectionRequest,
    senderId: string,
    senderPlan: string,
    input: SendConnectionRequestInput,
    now: Date,
  ): Promise<SendConnectionRequestResult> {
    const result = await this.repo.acceptMutualRequests(
      reversePending.id,
      {
        senderId,
        recipientId: input.recipientId,
        intentId: input.intentId,
        note: input.note,
        matchScore: input.matchScore,
        matchReasons: null,
        source: input.source,
        isQueued: false,
      },
      now,
    );
    if (!result) {
      // Lost the race (the reverse request was responded to a moment
      // ago) — fall through to a normal pending send instead of erroring
      // the caller for something that resolved itself.
      return this.sendRequest(senderId, senderPlan, input);
    }

    await Promise.all([
      this.notifications.notify({
        userId: result.newRequest.senderId,
        category: "request_accepted",
        title: "You connected!",
        data: { connectionId: result.connection.id },
      }),
      this.notifications.notify({
        userId: result.existingRequest.senderId,
        category: "request_accepted",
        title: "You connected!",
        data: { connectionId: result.connection.id },
      }),
    ]);

    return {
      status: 201,
      request: {
        id: result.newRequest.id,
        status: result.newRequest.status,
        expires_at: result.newRequest.expiresAt.toISOString(),
      },
      quota: { used: 0, limit: 0, resets_at: now.toISOString() },
      queued_position: null,
    };
  }

  async acceptRequest(recipientId: string, requestId: string): Promise<AcceptRequestResult> {
    const existing = await this.repo.findRequestById(requestId);
    if (!existing)
      throw new NotFoundAppError("REQUEST_NOT_FOUND", "This request could not be found.");
    if (existing.recipientId !== recipientId) {
      throw new ForbiddenAppError("FORBIDDEN", "You don't have permission to do that.");
    }
    if (await this.repo.isBlockedEitherWay(existing.senderId, existing.recipientId)) {
      // Edge case 4 (§10.6.10): blocked-before-response requests are
      // never explicitly cancelled (see BlocksService's own comment) —
      // they simply become un-acceptable, and expire naturally like any
      // other pending request, leaking no signal to the sender.
      throw new ForbiddenAppError("BLOCKED", "This person isn't available to connect");
    }

    const now = this.clock.now();
    const result = await this.repo.acceptRequest(requestId, now);
    if (!result) {
      throw new ConflictAppError("CONFLICT", "This request is no longer pending.");
    }

    // BR-CONN-08: "the sender receives a 'request accepted' notification."
    // Dispatched after the transaction commits (side effects never happen
    // inside the DB transaction — same pattern auth.service.ts's register
    // flow uses), so a notification failure can never roll back the
    // connection itself.
    await this.notifications.notify({
      userId: existing.senderId,
      category: "request_accepted",
      title: "Your connection request was accepted",
      data: { connectionId: result.connection.id, conversationId: result.conversationId },
    });

    return {
      connection: {
        id: result.connection.id,
        connected_at: result.connection.connectedAt.toISOString(),
      },
      conversation: { id: result.conversationId, first_message_id: result.firstMessageId },
    };
  }

  // BR-CONN-03: deliberately silent — no notification of any kind to the
  // sender. The sender's own GET /connections/requests view keeps
  // showing this request as "pending" until it naturally expires 14
  // days later; nothing here writes anything the sender-facing read path
  // would render differently in the meantime.
  async rejectRequest(recipientId: string, requestId: string): Promise<void> {
    const existing = await this.repo.findRequestById(requestId);
    if (!existing)
      throw new NotFoundAppError("REQUEST_NOT_FOUND", "This request could not be found.");
    if (existing.recipientId !== recipientId) {
      throw new ForbiddenAppError("FORBIDDEN", "You don't have permission to do that.");
    }
    const rejected = await this.repo.rejectRequest(requestId, this.clock.now());
    if (!rejected) throw new ConflictAppError("CONFLICT", "This request is no longer pending.");
  }

  // BR-CONN-04: "requests expire after 14 days. Expiry is silent to both
  // parties (a single digest line for the sender)." The digest-email
  // half is Phase 17 (Notifications) territory — no digest mechanism
  // exists yet to hook into, so this only performs the silent status
  // flip; flagged as a scope gap, not silently dropped. Called by
  // ConnectionRequestExpiryWorker on a periodic tick.
  async expirePendingRequests(): Promise<number> {
    const expired = await this.repo.expirePendingRequests(this.clock.now());
    return expired.length;
  }

  private async assertNoCooldown(senderId: string, recipientId: string, now: Date): Promise<void> {
    const removedAt = await this.repo.findMostRecentRemoval(senderId, recipientId);
    if (removedAt) {
      this.assertPastCooldown(removedAt, COOLDOWN_DAYS.removed, now);
    }

    const terminal = await this.repo.findMostRecentTerminalRequest(senderId, recipientId);
    if (!terminal || !terminal.respondedAt) return;

    if (terminal.status === "rejected") {
      const rejectionCount = await this.repo.countRejectedRequests(senderId, recipientId);
      // BR-CONN-12: "only one retry ever" — a sender who has already been
      // rejected once before (this is their 2nd+ attempt since a
      // rejection) may never re-request this recipient again.
      if (rejectionCount >= 2) {
        throw new ConflictAppError(
          "COOLDOWN_ACTIVE",
          "You cannot request to connect with this person again",
        );
      }
      this.assertPastCooldown(terminal.respondedAt, COOLDOWN_DAYS.rejected, now);
    } else if (terminal.status === "expired") {
      this.assertPastCooldown(terminal.respondedAt, COOLDOWN_DAYS.expired, now);
    } else if (terminal.status === "cancelled") {
      this.assertPastCooldown(terminal.respondedAt, COOLDOWN_DAYS.cancelled, now);
    }
  }

  private assertPastCooldown(since: Date, cooldownDays: number, now: Date): void {
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    const retryAfterMs = since.getTime() + cooldownMs - now.getTime();
    if (retryAfterMs > 0) {
      throw new ConflictAppError(
        "COOLDOWN_ACTIVE",
        "You already have a pending request with this person",
        {
          retryAfter: Math.ceil(retryAfterMs / 1000),
        },
      );
    }
  }

  // BR-CONN-02: "the shared constant from P8.2" — re-verified at send
  // time using the same packages/matching pure functions the discovery
  // feed itself uses, independent of whether this request originated
  // from a feed candidate that already passed gates.
  private async assertIntentFloor(senderId: string, recipientId: string): Promise<void> {
    const refs = await this.matchingData.loadIntentRefsForUsers([senderId, recipientId], new Map());
    const senderIntents = refs.get(senderId) ?? [];
    const recipientIntents = refs.get(recipientId) ?? [];
    const score = intentScore(senderIntents, recipientIntents);
    if (checkIntentFloor(score)) {
      throw new ForbiddenAppError(
        "INTENT_MISMATCH",
        "Your intents don't overlap with theirs right now",
      );
    }
  }

  private async assertInboundFilterAllows(
    senderId: string,
    recipientId: string,
    intentType: intentsValidation.IntentType,
  ): Promise<void> {
    const fields = await this.matchingData.loadProfileScoringFields([senderId]);
    const senderFields = fields.get(senderId);
    const result = await this.inboundFilters.checkInbound(recipientId, {
      intentType,
      yearsExperience: senderFields?.yearsExperience ?? 0,
      industryId: senderFields?.industryId ?? null,
      verificationLevel: verificationLevelToNumber(senderFields?.verificationLevel),
    });
    if (!result.allowed) {
      throw new ForbiddenAppError("INTENT_FILTERED", result.message);
    }
  }

  private async assertNotSoftBlocked(senderId: string): Promise<void> {
    if (await this.quota.isSoftBlocked(senderId)) {
      throw new TooManyRequestsAppError(
        "VELOCITY_LIMIT",
        "You've sent too many requests recently — try again later",
        {
          retryAfter: 60 * 60,
        },
      );
    }
  }

  private async assertNoteNotSpam(senderId: string, note: string | null, now: Date): Promise<void> {
    const isDuplicate = await this.quota.recordNoteAndCheckDuplicate(senderId, note, now);
    if (isDuplicate) {
      throw new TooManyRequestsAppError(
        "VELOCITY_LIMIT",
        "You've sent too many similar requests recently — try again later",
        {
          retryAfter: 60 * 60,
        },
      );
    }
  }

  private async assertVelocityAllowed(
    senderId: string,
    plan: ConnectionPlan,
    now: Date,
  ): Promise<void> {
    const allowed = await this.quota.checkVelocity(senderId, plan, now);
    if (!allowed) {
      throw new TooManyRequestsAppError(
        "VELOCITY_LIMIT",
        "You're sending requests too quickly — slow down",
        { retryAfter: 60 },
      );
    }
  }

  private async assertDailyQuotaAllowed(
    senderId: string,
    plan: ConnectionPlan,
    timezone: string,
    now: Date,
  ) {
    const result = await this.quota.checkDailyQuota(senderId, plan, timezone, now);
    if (!result.allowed) {
      throw new TooManyRequestsAppError(
        "DAILY_LIMIT_REACHED",
        "You've reached today's request limit",
        {
          retryAfter: Math.ceil((result.resetsAt.getTime() - now.getTime()) / 1000),
          details: {
            quota: {
              used: result.used,
              limit: result.limit,
              resets_at: result.resetsAt.toISOString(),
            },
          },
        },
      );
    }
    return result;
  }

  // BR-CONN-07: auto-defaults to 10/day for >=8yrs experience or >=80
  // reputation, unless the recipient has set an explicit override via
  // inbound_intent_filters.max_inbound_per_day. NULL override + not
  // qualifying senior/high-rep = unlimited (the PRD's own default).
  private async resolveInboundThrottle(
    recipientId: string,
    now: Date,
  ): Promise<{ isQueued: boolean; queuedPosition: number | null }> {
    const override = await this.repo.loadInboundThrottleDailyCap(recipientId);
    let effectiveCap: number | null = override;

    if (effectiveCap === null) {
      const [fields, reputation] = await Promise.all([
        this.matchingData.loadProfileScoringFields([recipientId]),
        this.matchingData.loadReputationScores([recipientId]),
      ]);
      const yearsExperience = fields.get(recipientId)?.yearsExperience ?? 0;
      const reputationScore = reputation.get(recipientId) ?? 50;
      const qualifiesAsSenior =
        yearsExperience >= SENIOR_EXPERIENCE_YEARS_THRESHOLD ||
        reputationScore >= HIGH_REPUTATION_THRESHOLD;
      effectiveCap = qualifiesAsSenior ? AUTO_INBOUND_DAILY_CAP : null;
    }

    if (effectiveCap === null) {
      return { isQueued: false, queuedPosition: null };
    }

    const localMidnight = new Date(now);
    localMidnight.setUTCHours(0, 0, 0, 0);
    const receivedToday = await this.repo.countInboundToday(recipientId, localMidnight);
    if (receivedToday < effectiveCap) {
      return { isQueued: false, queuedPosition: null };
    }

    const queuedAhead = await this.repo.countQueuedForRecipient(recipientId);
    return { isQueued: true, queuedPosition: queuedAhead + 1 };
  }

  async listRequests(userId: string, params: ListRequestsParams): Promise<ListRequestsResult> {
    const limit = params.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = params.cursor ? decodeRequestCursor(params.cursor) : null;

    const rows = await this.repo.listRequests({
      userId,
      direction: params.direction,
      status: params.status,
      sort: params.sort,
      cursor,
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? params.sort === "score_desc"
          ? encodeRequestCursor({ score: last.matchScore ?? 0, id: last.id })
          : encodeRequestCursor({ score: last.createdAt.getTime(), id: last.id })
        : null;

    let throttle: ListRequestsResult["throttle"] = null;
    if (params.direction === "received") {
      const dailyCap = await this.repo.loadInboundThrottleDailyCap(userId);
      const queuedCount = await this.repo.countQueuedForRecipient(userId);
      throttle = { enabled: dailyCap !== null, dailyCap: dailyCap ?? 0, queuedCount };
    }

    return { requests: page, nextCursor, throttle };
  }

  async withdrawRequest(senderId: string, requestId: string): Promise<void> {
    const existing = await this.repo.findRequestById(requestId);
    if (!existing)
      throw new NotFoundAppError("REQUEST_NOT_FOUND", "This request could not be found.");
    if (existing.senderId !== senderId) {
      throw new ForbiddenAppError("FORBIDDEN", "You don't have permission to do that.");
    }
    const withdrawn = await this.repo.withdrawRequest(requestId, this.clock.now());
    if (!withdrawn) throw new ConflictAppError("CONFLICT", "This request is no longer pending.");
  }
}

function normalisePlan(plan: string): ConnectionPlan {
  return plan === "premium" || plan === "pro" ? plan : "free";
}

function verificationLevelToNumber(level: string | undefined): number {
  if (!level) return 0;
  const match = /^L(\d)$/.exec(level);
  return match ? Number(match[1]) : 0;
}
