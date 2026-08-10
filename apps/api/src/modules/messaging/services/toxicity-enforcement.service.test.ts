import { describe, expect, it, vi } from "vitest";
import { ToxicityEnforcementService } from "./toxicity-enforcement.service";
import type { ModerationDeepScanService } from "./moderation-deep-scan.service";
import type { NotificationsService } from "../../notifications/notifications.service";
import type { ClassificationResult } from "./toxicity-spam-classifier.service";

const context = { messageId: "msg-1", conversationId: "conv-1", senderId: "sender-1" };

function buildService() {
  const deepScan = {
    retract: vi.fn(async () => undefined),
  } as unknown as ModerationDeepScanService;
  const notifications = { notify: vi.fn(async () => undefined) } as unknown as NotificationsService;
  return {
    service: new ToxicityEnforcementService(deepScan, notifications),
    deepScan,
    notifications,
  };
}

// §12.10's own acceptance line: "assert a self-harm phrase produces the
// support path and no enforcement action."
describe("ToxicityEnforcementService — self-harm never triggers enforcement", () => {
  it("a self_harm_support classification never retracts the message", async () => {
    const { service, deepScan } = buildService();
    const result: ClassificationResult = {
      toxicity: { kind: "self_harm_support" },
      spamAction: "deliver",
      spamScore: 0.1,
    };

    await service.apply(result, context);

    expect(deepScan.retract).not.toHaveBeenCalled();
  });

  it("a self_harm_support classification sends a support notification, not a violation notice", async () => {
    const { service, notifications } = buildService();
    const result: ClassificationResult = {
      toxicity: { kind: "self_harm_support" },
      spamAction: "deliver",
      spamScore: 0.1,
    };

    await service.apply(result, context);

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const call = (notifications.notify as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      data: { kind: string };
      title: string;
    };
    expect(call.data.kind).toBe("self_harm_support");
    expect(call.title.toLowerCase()).not.toContain("violat");
    expect(call.title.toLowerCase()).not.toContain("suspend");
  });

  it("self-harm is never treated the same as a violating/severe classification even though both can retract for other kinds", async () => {
    const { service, deepScan } = buildService();

    await service.apply(
      {
        toxicity: { kind: "violating", label: "harassment" },
        spamAction: "deliver",
        spamScore: 0.1,
      },
      context,
    );
    expect(deepScan.retract).toHaveBeenCalledTimes(1);

    deepScan.retract = vi.fn(async () => undefined);
    await service.apply(
      { toxicity: { kind: "self_harm_support" }, spamAction: "deliver", spamScore: 0.1 },
      context,
    );
    expect(deepScan.retract).not.toHaveBeenCalled();
  });

  it("clean and borderline classifications take no action at all", async () => {
    const { service, deepScan, notifications } = buildService();

    await service.apply(
      { toxicity: { kind: "clean" }, spamAction: "deliver", spamScore: 0 },
      context,
    );
    await service.apply(
      {
        toxicity: { kind: "borderline", label: "harassment" },
        spamAction: "deliver",
        spamScore: 0,
      },
      context,
    );

    expect(deepScan.retract).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("a severe classification retracts the message", async () => {
    const { service, deepScan } = buildService();
    await service.apply(
      { toxicity: { kind: "severe", label: "threats" }, spamAction: "deliver", spamScore: 0 },
      context,
    );
    expect(deepScan.retract).toHaveBeenCalledWith("msg-1", "toxicity:threats");
  });

  it("a held_for_review classification (classifier unavailable) fails closed by retracting, per §12.1", async () => {
    const { service, deepScan } = buildService();
    await service.apply(
      { toxicity: { kind: "held_for_review" }, spamAction: "hold", spamScore: null },
      context,
    );
    expect(deepScan.retract).toHaveBeenCalledWith("msg-1", "toxicity:classifier_unavailable");
  });
});
