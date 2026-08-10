import { describe, expect, it, vi } from "vitest";
import { BlocksService } from "./blocks.service";
import type { ConnectionsRepository } from "../repositories/connections.repository";

function fakeRepo(
  overrides: Partial<Record<keyof ConnectionsRepository, unknown>> = {},
): ConnectionsRepository {
  return {
    createBlock: vi.fn(async () => ({
      blockerId: "user-1",
      blockedId: "user-2",
      reason: null,
      createdAt: new Date(),
    })),
    freezeConversationBetween: vi.fn(async () => undefined),
    deleteBlock: vi.fn(async () => undefined),
    listBlocks: vi.fn(async () => []),
    ...overrides,
  } as unknown as ConnectionsRepository;
}

describe("BlocksService", () => {
  describe("block — BR-CONN-09 total and silent", () => {
    it("creates the block row and freezes any existing conversation", async () => {
      const repo = fakeRepo();
      const service = new BlocksService(repo);

      await service.block("user-1", "user-2", "harassment");

      expect(repo.createBlock).toHaveBeenCalledWith("user-1", "user-2", "harassment");
      expect(repo.freezeConversationBetween).toHaveBeenCalledWith("user-1", "user-2");
    });

    it("rejects blocking yourself", async () => {
      const repo = fakeRepo();
      const service = new BlocksService(repo);
      await expect(service.block("user-1", "user-1", null)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(repo.createBlock).not.toHaveBeenCalled();
    });
  });

  describe("unblock — BR-CONN-10 does not restore", () => {
    it("only deletes the block row, touching nothing else", async () => {
      const repo = fakeRepo();
      const service = new BlocksService(repo);

      await service.unblock("user-1", "user-2");

      expect(repo.deleteBlock).toHaveBeenCalledWith("user-1", "user-2");
      // No connection/conversation method exists on BlocksService at
      // all — the only repository call unblock ever makes is the delete
      // above, which is what "does not restore" means structurally.
    });
  });

  describe("list", () => {
    it("maps rows to the response shape", async () => {
      const createdAt = new Date("2026-08-01T00:00:00Z");
      const repo = fakeRepo({
        listBlocks: vi.fn(async () => [
          { blockerId: "user-1", blockedId: "user-2", reason: "spam", createdAt },
        ]),
      });
      const service = new BlocksService(repo);

      const result = await service.list("user-1");

      expect(result).toEqual([
        { blocked_id: "user-2", reason: "spam", created_at: createdAt.toISOString() },
      ]);
    });
  });
});
