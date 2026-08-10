import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { RealtimeController } from "./realtime.controller";
import type { RealtimeTicketService } from "./realtime-ticket.service";

const authContext: AuthContext = {
  id: "user-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

describe("RealtimeController — POST /realtime/ticket", () => {
  it("issues a ticket scoped to the caller's own id", async () => {
    const issueTicket = vi.fn().mockResolvedValue({ ticket: "signed.jwt.here", expires_in: 60 });
    const controller = new RealtimeController({ issueTicket } as unknown as RealtimeTicketService);

    const result = await controller.issueTicket({ authContext });

    expect(issueTicket).toHaveBeenCalledWith("user-1", "user");
    expect(result).toEqual({ ticket: "signed.jwt.here", expires_in: 60 });
  });

  it("rejects when no auth context is present", async () => {
    const controller = new RealtimeController({} as unknown as RealtimeTicketService);
    await expect(controller.issueTicket({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
