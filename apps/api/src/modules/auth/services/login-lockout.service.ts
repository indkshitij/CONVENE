import { Injectable, Optional } from "@nestjs/common";
import { loginLockoutKey } from "../../../infra/redis/keys";
import { RedisService } from "../../../infra/redis/redis.service";
import { type Clock, systemClock } from "../../../common/clock";

// BR-AUTH-07: "5 failed password attempts → exponential lockout (1, 2, 5,
// 15, 60 min). Lockout is per (account, IP) pair." The Nth stage (0-indexed
// from the 5th failure) gives the lockout duration for that failure.
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_STAGES_SECONDS = [60, 120, 300, 900, 3600];
const STATE_TTL_SECONDS = 24 * 60 * 60;

interface LockoutState {
  failures: number;
  lockedUntil: number | null;
}

export interface LockStatus {
  locked: boolean;
  retryAfterSeconds: number;
}

// Keyed on the raw submitted identifier (email/phone as typed), not a
// resolved user id — so a lockout check never itself discloses whether the
// identifier belongs to a real account (§10.1.7 enumeration defence).
@Injectable()
export class LoginLockoutService {
  constructor(
    private readonly redis: RedisService,
    // See otp.service.ts's constructor comment: Clock is an interface, so
    // @Optional() is required for Nest DI to fall through to the default.
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  async check(identifier: string, ip: string): Promise<LockStatus> {
    const state = await this.readState(identifier, ip);
    const now = this.clock.now().getTime();
    if (state.lockedUntil !== null && state.lockedUntil > now) {
      return { locked: true, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) };
    }
    return { locked: false, retryAfterSeconds: 0 };
  }

  async recordFailure(identifier: string, ip: string): Promise<LockStatus> {
    const state = await this.readState(identifier, ip);
    const failures = state.failures + 1;
    let lockedUntil: number | null = state.lockedUntil;

    if (failures >= LOCKOUT_THRESHOLD) {
      const stageIndex = Math.min(failures - LOCKOUT_THRESHOLD, LOCKOUT_STAGES_SECONDS.length - 1);
      const stageSeconds = LOCKOUT_STAGES_SECONDS[stageIndex] as number;
      lockedUntil = this.clock.now().getTime() + stageSeconds * 1000;
    }

    await this.writeState(identifier, ip, { failures, lockedUntil });
    if (lockedUntil === null) return { locked: false, retryAfterSeconds: 0 };
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((lockedUntil - this.clock.now().getTime()) / 1000),
    };
  }

  async reset(identifier: string, ip: string): Promise<void> {
    await this.redis.client.del(loginLockoutKey(identifier, ip));
  }

  private async readState(identifier: string, ip: string): Promise<LockoutState> {
    const raw = await this.redis.client.get(loginLockoutKey(identifier, ip));
    if (!raw) return { failures: 0, lockedUntil: null };
    try {
      const parsed = JSON.parse(raw) as LockoutState;
      return { failures: parsed.failures, lockedUntil: parsed.lockedUntil };
    } catch {
      return { failures: 0, lockedUntil: null };
    }
  }

  private async writeState(identifier: string, ip: string, state: LockoutState): Promise<void> {
    await this.redis.client.set(
      loginLockoutKey(identifier, ip),
      JSON.stringify(state),
      "EX",
      STATE_TTL_SECONDS,
    );
  }
}
