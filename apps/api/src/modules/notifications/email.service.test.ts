import { describe, expect, it, vi } from "vitest";
import { EmailService, type EmailTransport } from "./email.service";

function fakeTransport(): EmailTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

describe("EmailService", () => {
  it("sends a verification email with the given URL embedded", async () => {
    const transport = fakeTransport();
    const service = new EmailService(transport);

    await service.sendVerificationEmail(
      "ananya@example.com",
      "https://convene.app/verify?token=abc",
    );

    expect(transport.send).toHaveBeenCalledTimes(1);
    const message = transport.send.mock.calls[0]![0];
    expect(message.to).toBe("ananya@example.com");
    expect(message.text).toContain("https://convene.app/verify?token=abc");
    expect(message.html).toContain("https://convene.app/verify?token=abc");
  });

  it("sends a security alert email describing the event", async () => {
    const transport = fakeTransport();
    const service = new EmailService(transport);

    await service.sendSecurityAlertEmail("ananya@example.com", "refresh token reuse detected");

    expect(transport.send).toHaveBeenCalledTimes(1);
    const message = transport.send.mock.calls[0]![0];
    expect(message.to).toBe("ananya@example.com");
    expect(message.text).toContain("refresh token reuse detected");
  });
});
