import { Inject, Injectable } from "@nestjs/common";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_TRANSPORT = "EMAIL_TRANSPORT";

// Dev/test default — logs instead of sending. Real delivery (SMTP via the
// Mailpit container in docker-compose, or a managed provider in
// production) is a separate EmailTransport implementation swapped in by
// whichever module wires this one up; not invented here since it isn't
// part of this prompt's scope.
@Injectable()
export class ConsoleEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<void> {
    console.log(`[email] to=${message.to} subject=${JSON.stringify(message.subject)}`);
  }
}

// PRD P5.2: "modules/notifications/email.service.ts (transactional
// only)." Only the transactional sends this phase and P5.3 actually need
// — account verification and security alerts — not a general campaign/
// marketing-email system.
@Injectable()
export class EmailService {
  constructor(@Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport) {}

  sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
    return this.transport.send({
      to,
      subject: "Verify your Convene account",
      text: `Verify your email address: ${verificationUrl}`,
      html: `<p>Verify your email address: <a href="${verificationUrl}">${verificationUrl}</a></p>`,
    });
  }

  // PRD §10.1.7 endpoint 8 (password/forgot).
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    return this.transport.send({
      to,
      subject: "Reset your Convene password",
      text: `Reset your password: ${resetUrl}`,
      html: `<p>Reset your password: <a href="${resetUrl}">${resetUrl}</a></p>`,
    });
  }

  // PRD §10.1.9 / BR-AUTH-06: "a security notification email is sent" on
  // refresh-token reuse detection (and other security-sensitive events —
  // new-device login, password change, per §20.2).
  sendSecurityAlertEmail(to: string, event: string): Promise<void> {
    return this.transport.send({
      to,
      subject: "Security alert for your Convene account",
      text: `We detected: ${event}. If this wasn't you, please secure your account immediately.`,
    });
  }

  // PRD §10.2.5 L3 (work email verification, P7.3). Sent to the corporate
  // address supplied at POST /verification/work-email, not the account's
  // own email — that address may not match users.email at all.
  sendWorkEmailVerificationCode(to: string, code: string): Promise<void> {
    return this.transport.send({
      to,
      subject: "Verify your work email for Convene",
      text: `Your work email verification code is: ${code}`,
      html: `<p>Your work email verification code is: <strong>${code}</strong></p>`,
    });
  }
}
