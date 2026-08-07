import { users } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { authContextKey } from "../../infra/redis/keys";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { RedisService } from "../../infra/redis/redis.service";

export type Role = "user" | "recruiter" | "admin" | "moderator" | "support";
export type UserStatus =
  "pending_verification" | "active" | "restricted" | "shadow_limited" | "suspended" | "deleted";

// PRD §17.4: "Auth context cached in Redis for 60s (id, role, plan,
// status, token version)." `tokenVersion` is carried alongside the rest so
// a request can compare it against the access token's own `tv` claim
// without a second round trip — see JwtAuthGuard.
export interface AuthContext {
  id: string;
  role: Role;
  plan: string;
  status: UserStatus;
  tokenVersion: number;
  /** §17.4 status gate: shadow_limited users may act, but their writes
   * must become no-ops to other users — handlers check this flag rather
   * than re-deriving it from status. */
  shadowLimited: boolean;
}

const AUTH_CONTEXT_TTL_SECONDS = 60;

@Injectable()
export class AuthContextService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly redis: RedisService,
  ) {}

  async get(userId: string): Promise<AuthContext | null> {
    const cached = await this.readCache(userId);
    if (cached) return cached;

    const [user] = await this.postgres.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return null;

    // No subscription row is created at registration (P5.2) — "free" is
    // the only plan a user can have until the billing module (out of this
    // phase's scope) creates one; not a literal PRD transcription.
    const context: AuthContext = {
      id: user.id,
      role: user.role as Role,
      plan: "free",
      status: user.status as UserStatus,
      tokenVersion: user.tokenVersion,
      shadowLimited: user.status === "shadow_limited",
    };

    await this.writeCache(userId, context);
    return context;
  }

  /** Called after any action that changes a user's own auth-relevant
   * state (token_version bump, suspension, etc.) so the next request
   * doesn't read a stale cached context for up to 60s. */
  async invalidate(userId: string): Promise<void> {
    await this.redis.client.del(authContextKey(userId));
  }

  private async readCache(userId: string): Promise<AuthContext | null> {
    const raw = await this.redis.client.get(authContextKey(userId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthContext;
    } catch {
      return null;
    }
  }

  private async writeCache(userId: string, context: AuthContext): Promise<void> {
    await this.redis.client.set(
      authContextKey(userId),
      JSON.stringify(context),
      "EX",
      AUTH_CONTEXT_TTL_SECONDS,
    );
  }
}
