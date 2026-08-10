import { Injectable } from "@nestjs/common";
import { BadRequestAppError } from "../../../common/errors/app-error";
import { ConnectionsRepository } from "../repositories/connections.repository";

export interface BlockedUser {
  blocked_id: string;
  reason: string | null;
  created_at: string;
}

// BR-CONN-09/10 (P14.2), §10.6.6 endpoint 36. Blocking is intentionally
// silent throughout this service — no notification is ever sent to the
// blocked party (see is-not-blocked.policy.ts's own comment: a blocked
// relationship hides both parties from each other "regardless of any
// other permission"). Nothing here changes `connection_requests.status`
// on block either — see acceptRequest/rejectRequest's own comments for
// why a pending request between a now-blocked pair is left exactly as
// it was (edge case 4, §10.6.10): it simply becomes un-actionable via
// the block check both accept and reject already perform, and expires
// naturally like any other pending request, leaking no signal.
@Injectable()
export class BlocksService {
  constructor(private readonly repo: ConnectionsRepository) {}

  async block(blockerId: string, blockedId: string, reason: string | null): Promise<void> {
    if (blockedId === blockerId) {
      throw new BadRequestAppError("BAD_REQUEST", "You can't block yourself");
    }
    await this.repo.createBlock(blockerId, blockedId, reason);
    await this.repo.freezeConversationBetween(blockerId, blockedId);
  }

  // BR-CONN-10: unblocking only ever deletes the block row — never
  // touches `connections`, so the relationship returns to "none" rather
  // than being restored.
  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.repo.deleteBlock(blockerId, blockedId);
  }

  async list(blockerId: string): Promise<BlockedUser[]> {
    const rows = await this.repo.listBlocks(blockerId);
    return rows.map((row) => ({
      blocked_id: row.blockedId,
      reason: row.reason,
      created_at: row.createdAt.toISOString(),
    }));
  }
}
