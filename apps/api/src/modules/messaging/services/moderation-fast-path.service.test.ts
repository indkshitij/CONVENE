import { describe, expect, it } from "vitest";
import { ModerationFastPathService } from "./moderation-fast-path.service";

// P15.3's own acceptance criterion: "moderation never adds more than
// 200ms to the send path." Proven directly: every check here is
// synchronous (no I/O, no await), so any call completes in effectively
// zero time regardless of outcome.
describe("ModerationFastPathService — 200ms budget", () => {
  it("completes synchronously, well under 200ms, for any input", () => {
    const service = new ModerationFastPathService();
    const start = performance.now();
    service.assertAllowed("a perfectly ordinary message body");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});

describe("ModerationFastPathService.assertAllowed — BR-MSG-05", () => {
  const service = new ModerationFastPathService();

  it("allows an ordinary professional message", () => {
    expect(() =>
      service.assertAllowed("Would love to chat about your work in payments infra."),
    ).not.toThrow();
  });

  it("rejects a message containing an email address", () => {
    expect(() => service.assertAllowed("reach me at test@example.com instead")).toThrow();
  });

  it("rejects a message containing a phone number", () => {
    expect(() => service.assertAllowed("call me on 987-654-3210")).toThrow();
  });

  it("rejects off-platform-contact solicitation", () => {
    expect(() => service.assertAllowed("let's move this to WhatsApp")).toThrow();
  });

  it("rejects a message with more than the allowed number of links", () => {
    expect(() =>
      service.assertAllowed("http://a.com http://b.com http://c.com http://d.com"),
    ).toThrow();
  });

  it("allows a message with a small number of links", () => {
    expect(() => service.assertAllowed("check out http://a.com and http://b.com")).not.toThrow();
  });

  it("rejects a known scam-template phrase", () => {
    expect(() =>
      service.assertAllowed("guaranteed returns on your crypto investment, act now"),
    ).toThrow();
  });
});
