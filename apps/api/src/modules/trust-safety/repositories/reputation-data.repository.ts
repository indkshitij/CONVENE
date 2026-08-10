import { profiles, users } from "@convene/db";
import type { ReputationComponentsInput } from "@convene/matching";
import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

interface ResponseRow extends Record<string, unknown> {
  received_count: number;
  replied_count: number;
  median_reply_minutes: number | null;
}

interface DepthRow extends Record<string, unknown> {
  conversations_started: number;
  reaching_six: number;
}

interface AcceptanceRow extends Record<string, unknown> {
  accepted: number;
  rejected: number;
}

interface ReportRow extends Record<string, unknown> {
  severity: string;
  count: number;
}

// P18.2 (§10.10.1): gathers the raw, primitive-only metrics the pure
// `computeReputation` (packages/matching/src/reputation.ts) needs — this
// is the one place in the codebase allowed to run I/O for reputation;
// the formula itself never touches a database.
@Injectable()
export class ReputationDataRepository {
  constructor(private readonly postgres: PostgresService) {}

  async gatherInputFor(userId: string): Promise<ReputationComponentsInput> {
    const [response, depth, acceptance, profile, account, reportRows, conversationCount] =
      await Promise.all([
        this.loadResponseMetrics(userId),
        this.loadDepthMetrics(userId),
        this.loadAcceptanceMetrics(userId),
        this.loadProfileMetrics(userId),
        this.loadAccountMetrics(userId),
        this.loadUpheldReportsBySeverity(userId),
        this.loadConversationCount(userId),
      ]);

    return {
      responseRate: {
        firstMessagesReceived: response.received_count,
        repliedWithin72h: response.replied_count,
      },
      responseSpeed: {
        medianFirstReplyMinutes: response.median_reply_minutes ?? 0,
        observations: response.replied_count,
      },
      conversationDepth: {
        conversationsStarted: depth.conversations_started,
        conversationsReachingSixMessages: depth.reaching_six,
      },
      acceptanceBehaviour: { accepted: acceptance.accepted, rejected: acceptance.rejected },
      profileQuality: {
        profileCompletion: profile.profileCompletion,
        verificationLevel: profile.verificationLevel,
      },
      tenureActivity: {
        accountAgeDays: account.accountAgeDays,
        daysSinceLastActive: account.daysSinceLastActive,
      },
      reportRatio: {
        conversations: conversationCount,
        upheldReportsBySeverity: severityBuckets(reportRows),
      },
      // §10.10.1's own component, no source table exists yet — see
      // reputation.ts's own comment on communityContributionsScore.
      communityContributions: { mentorshipSessionsCompleted: 0, positiveFeedbackCount: 0 },
      accountAgeDays: account.accountAgeDays,
      daysSinceLastActive: account.daysSinceLastActive,
    };
  }

  // "Response rate: share of received first-messages replied to within
  // 72h" / "Response speed: median first-reply latency." A conversation's
  // "first message received" is that conversation's very first message,
  // provided this user didn't send it (i.e. they were the recipient of
  // the opener); their "reply" is their own first message sent after
  // that, whenever it comes.
  private async loadResponseMetrics(userId: string): Promise<ResponseRow> {
    const [row] = await this.postgres.db.execute<ResponseRow>(sql`
      WITH first_msg AS (
        SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.sender_id, m.created_at
        FROM messages m
        JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = ${userId}
        ORDER BY m.conversation_id, m.sequence ASC
      ),
      received AS (
        SELECT conversation_id, created_at AS received_at FROM first_msg WHERE sender_id IS DISTINCT FROM ${userId}
      ),
      first_reply AS (
        SELECT r.conversation_id, MIN(m.created_at) AS reply_at
        FROM received r
        JOIN messages m ON m.conversation_id = r.conversation_id AND m.sender_id = ${userId} AND m.created_at > r.received_at
        GROUP BY r.conversation_id
      )
      SELECT
        count(*)::int AS received_count,
        count(*) FILTER (WHERE fr.reply_at IS NOT NULL AND fr.reply_at <= r.received_at + interval '72 hours')::int AS replied_count,
        (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fr.reply_at - r.received_at)) / 60)
          FILTER (WHERE fr.reply_at IS NOT NULL))::float AS median_reply_minutes
      FROM received r
      LEFT JOIN first_reply fr ON fr.conversation_id = r.conversation_id
    `);
    return row ?? { received_count: 0, replied_count: 0, median_reply_minutes: null };
  }

  // "Conversation depth: share of conversations reaching >=6 mutual
  // messages." Uses conversations.message_seq (the running total, P15.1)
  // rather than re-counting messages per conversation.
  private async loadDepthMetrics(userId: string): Promise<DepthRow> {
    const [row] = await this.postgres.db.execute<DepthRow>(sql`
      SELECT
        count(*)::int AS conversations_started,
        count(*) FILTER (WHERE c.message_seq >= 6)::int AS reaching_six
      FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      WHERE cp.user_id = ${userId}
    `);
    return row ?? { conversations_started: 0, reaching_six: 0 };
  }

  // "Acceptance behaviour" — counts this user's own decisions as a
  // request *recipient* (their accept/reject ratio when others reach
  // out to them), not requests they sent.
  private async loadAcceptanceMetrics(userId: string): Promise<AcceptanceRow> {
    const [row] = await this.postgres.db.execute<AcceptanceRow>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
        count(*) FILTER (WHERE status = 'rejected')::int AS rejected
      FROM connection_requests
      WHERE recipient_id = ${userId}
    `);
    return row ?? { accepted: 0, rejected: 0 };
  }

  private async loadProfileMetrics(
    userId: string,
  ): Promise<{ profileCompletion: number; verificationLevel: number }> {
    const [row] = await this.postgres.db
      .select({
        profileCompletion: profiles.profileCompletion,
        verificationLevel: profiles.verificationLevel,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return {
      profileCompletion: row?.profileCompletion ?? 0,
      verificationLevel: row?.verificationLevel ?? 0,
    };
  }

  private async loadAccountMetrics(
    userId: string,
  ): Promise<{ accountAgeDays: number; daysSinceLastActive: number }> {
    const [row] = await this.postgres.db
      .select({ createdAt: users.createdAt, lastActiveAt: users.lastActiveAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const now = Date.now();
    const createdAt = row?.createdAt ?? new Date(now);
    const accountAgeDays = Math.max(0, (now - createdAt.getTime()) / (24 * 60 * 60 * 1000));
    // Never-active (lastActiveAt is nullable, e.g. a just-registered
    // account) is treated the same as "as long ago as the account is
    // old" — there's no earlier possible activity than account creation.
    const lastActiveAt = row?.lastActiveAt ?? createdAt;
    const daysSinceLastActive = Math.max(0, (now - lastActiveAt.getTime()) / (24 * 60 * 60 * 1000));
    return { accountAgeDays, daysSinceLastActive };
  }

  // "Report ratio: upheld reports per 100 conversations." Only
  // status='upheld' rows count (P18.1's reports.status CHECK includes
  // 'upheld' as a distinct terminal state, not merely 'open'/'in_review').
  private async loadUpheldReportsBySeverity(userId: string): Promise<ReportRow[]> {
    return this.postgres.db.execute<ReportRow>(sql`
      SELECT severity, count(*)::int AS count
      FROM reports
      WHERE target_user_id = ${userId} AND status = 'upheld'
      GROUP BY severity
    `);
  }

  private async loadConversationCount(userId: string): Promise<number> {
    const [row] = await this.postgres.db.execute<{ count: number } & Record<string, unknown>>(sql`
      SELECT count(*)::int AS count FROM conversation_participants WHERE user_id = ${userId}
    `);
    return row?.count ?? 0;
  }
}

function severityBuckets(rows: ReportRow[]): {
  critical: number;
  high: number;
  medium: number;
  low: number;
} {
  const buckets = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of rows) {
    if (row.severity in buckets) buckets[row.severity as keyof typeof buckets] = row.count;
  }
  return buckets;
}
