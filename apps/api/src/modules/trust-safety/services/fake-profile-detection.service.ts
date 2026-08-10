import { Injectable } from "@nestjs/common";
import {
  computeFakeProfileRisk,
  type FakeProfileRiskResult,
  type FakeProfileSignals,
} from "./fake-profile-risk";
import { ReportsService } from "./reports.service";

// §12.9: "0.4-0.7 soft verification challenge ... 0.7-0.9 hidden from
// discovery + human review within 24h ... > 0.9 immediate suspension
// pending review." Rather than an automated service directly flipping
// `users.status` (that path — ModerationActionsService.apply — is
// designed for a human admin's own action and hardcodes the audit
// trail's actorType to "admin", which an automated call has no business
// claiming), every actionable score here files a real report through
// the *same* human-reviewed pipeline every other report goes through
// (ReportsService.create, category "impersonation" — its own
// auto-action is "verification_challenge", the PRD's own 0.4-0.7
// behaviour). This keeps "immediate suspension" and "hide from
// discovery" as review-queue outcomes a human confirms, not something
// this scorer executes unilaterally — a deliberately more conservative
// reading of "pending review" than building a second, admin-less
// enforcement path would have been.
@Injectable()
export class FakeProfileDetectionService {
  constructor(private readonly reportsService: ReportsService) {}

  async evaluate(userId: string, signals: FakeProfileSignals): Promise<FakeProfileRiskResult> {
    const result = computeFakeProfileRisk(signals);

    if (result.action !== "none") {
      await this.reportsService.create({
        reporterId: null,
        targetType: "user",
        targetId: userId,
        targetUserId: userId,
        category: "impersonation",
        description: `Automated fake-profile risk score ${result.score.toFixed(2)} (${result.action}).`,
        evidence: { score: result.score, action: result.action, factors: result.factors },
      });
    }

    return result;
  }
}
