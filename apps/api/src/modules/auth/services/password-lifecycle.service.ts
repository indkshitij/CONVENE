import { users } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  ConflictAppError,
  GoneAppError,
  UnauthorizedAppError,
  ValidationAppError,
} from "../../../common/errors/app-error";
import { type Clock, systemClock } from "../../../common/clock";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import { EmailService } from "../../notifications/email.service";
import { PasswordService } from "./password.service";
import { RefreshService } from "./refresh.service";
import { VerificationService } from "./verification.service";

// PRD §10.1.7 endpoint 8: forgot/reset/change. BR-AUTH-11: "Password reset
// invalidates all refresh tokens across all devices." Enumeration defence
// (P5.2's own rule, applied here per the P5.2 prompt's explicit note that
// "registration, login and password reset" all need it): forgotPassword()
// resolves identically whether or not the email matches an account.
@Injectable()
export class PasswordLifecycleService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly passwordService: PasswordService,
    private readonly verificationService: VerificationService,
    private readonly emailService: EmailService,
    private readonly refreshService: RefreshService,
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  async forgotPassword(email: string): Promise<void> {
    const [user] = await this.postgres.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user) return;

    const { token } = await this.verificationService.createPasswordResetToken(user.id);
    await this.emailService.sendPasswordResetEmail(email, this.buildResetUrl(token));
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (await this.passwordService.isBreached(newPassword)) {
      throw new ValidationAppError(
        "PASSWORD_BREACHED",
        "This password has appeared in a data breach.",
        {
          field: "password",
        },
      );
    }

    const result = await this.verificationService.consumePasswordResetToken(token);
    if (!result.ok) {
      if (result.reason === "TOKEN_USED") {
        throw new ConflictAppError("TOKEN_USED", "This password reset link has already been used.");
      }
      throw new GoneAppError("TOKEN_EXPIRED", "This password reset link has expired.");
    }

    const passwordHash = await this.passwordService.hash(newPassword);
    const [user] = await this.postgres.db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, result.userId))
      .returning();

    // BR-AUTH-11, verbatim: refresh tokens (sessions), not access tokens —
    // those remain valid only up to their own 15-minute expiry regardless.
    await this.refreshService.logoutAll(result.userId);

    if (user?.email) {
      await this.emailService.sendSecurityAlertEmail(user.email, "your password was reset");
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const [user] = await this.postgres.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (
      !user?.passwordHash ||
      !(await this.passwordService.verify(user.passwordHash, currentPassword))
    ) {
      throw new UnauthorizedAppError("INVALID_CREDENTIALS", "Your current password is incorrect.");
    }

    if (await this.passwordService.isBreached(newPassword)) {
      throw new ValidationAppError(
        "PASSWORD_BREACHED",
        "This password has appeared in a data breach.",
        {
          field: "password",
        },
      );
    }

    const passwordHash = await this.passwordService.hash(newPassword);
    await this.postgres.db.update(users).set({ passwordHash }).where(eq(users.id, userId));

    // "Full session revocation on change" — literal reading, no carve-out
    // for the session that made the request; the caller re-authenticates
    // with the new password like every other device.
    await this.refreshService.logoutAll(userId);

    if (user.email) {
      await this.emailService.sendSecurityAlertEmail(user.email, "your password was changed");
    }
  }

  private buildResetUrl(token: string): string {
    return `https://convene.app/reset-password?token=${token}`;
  }
}
