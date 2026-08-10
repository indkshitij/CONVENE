import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { BlocksController } from "./blocks.controller";
import type { BlocksService } from "./services/blocks.service";

const authContext: AuthContext = {
  id: "user-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function fakeBlocksService(
  overrides: Partial<Record<keyof BlocksService, unknown>> = {},
): BlocksService {
  return {
    block: vi.fn(async () => undefined),
    unblock: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    ...overrides,
  } as unknown as BlocksService;
}

describe("BlocksController", () => {
  it("POST /blocks delegates to block()", async () => {
    const service = fakeBlocksService();
    const controller = new BlocksController(service);

    const result = await controller.block({ authContext }, { user_id: "user-2", reason: "spam" });

    expect(service.block).toHaveBeenCalledWith("user-1", "user-2", "spam");
    expect(result).toEqual({ blocked_id: "user-2" });
  });

  it("DELETE /blocks/:userId delegates to unblock()", async () => {
    const service = fakeBlocksService();
    const controller = new BlocksController(service);

    await controller.unblock({ authContext }, "user-2");

    expect(service.unblock).toHaveBeenCalledWith("user-1", "user-2");
  });

  it("GET /blocks delegates to list()", async () => {
    const service = fakeBlocksService({
      list: vi.fn(async () => [
        { blocked_id: "user-2", reason: null, created_at: "2026-08-01T00:00:00.000Z" },
      ]),
    });
    const controller = new BlocksController(service);

    const result = await controller.list({ authContext });

    expect(result.blocks).toHaveLength(1);
  });

  it("rejects when no auth context is present", async () => {
    const controller = new BlocksController(fakeBlocksService());
    await expect(controller.block({}, { user_id: "user-2" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
