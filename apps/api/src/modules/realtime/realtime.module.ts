import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeController } from "./realtime.controller";
import { RealtimePublisherService } from "./realtime-publisher.service";
import { RealtimeTicketService } from "./realtime-ticket.service";

// PRD §17.2/§17.5. Owns ticket issuance (endpoint 61) and the publish-side
// of fan-out (RealtimePublisherService, called by other modules after
// their own DB commits) — the gateway itself (subscribe-side fan-out,
// presence, backpressure) runs in the separate apps/realtime deployable.
@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [RealtimeTicketService, RealtimePublisherService],
  exports: [RealtimePublisherService],
})
export class RealtimeModule {}
