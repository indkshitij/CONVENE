import { Module } from "@nestjs/common";
import { ConnectionsModule } from "../connections/connections.module";
import { EntitlementsController } from "./entitlements.controller";
import { EntitlementsService } from "./entitlements.service";

// PRD §17.2 — see README.md in this directory for owned tables and
// events. P24.2: a real GET /entitlements (plan/limits/usage, honestly
// always "free" — see entitlements.service.ts's own comment), built
// against the real enforcement points elsewhere in this codebase. No
// subscribe/upgrade/cancel/webhook flow exists yet — that's a payment-
// provider integration out of this phase's "minimal real backend" scope
// (flagged, not fabricated); apps/web's Premium screen renders "Start
// trial" as an honestly non-functional action until that lands.
@Module({
  imports: [ConnectionsModule],
  controllers: [EntitlementsController],
  providers: [EntitlementsService],
})
export class BillingModule {}
