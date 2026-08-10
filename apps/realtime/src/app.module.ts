import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ChannelFanoutService } from "./channel-fanout.service";
import { ConfigModule } from "./config/config.module";
import { RedisService } from "./infra/redis/redis.service";
import { PresenceService } from "./presence.service";
import { ReplayService } from "./replay.service";
import { SocketGateway } from "./socket.gateway";
import { TicketService } from "./ticket.service";

// PRD §17.5 — the stateless gateway: ticket verification, presence
// tracking, connection lifecycle (P11.1); channels, fan-out, reconnection
// replay, and backpressure (P11.2).
@Module({
  imports: [ConfigModule, EventEmitterModule.forRoot()],
  providers: [
    RedisService,
    TicketService,
    PresenceService,
    ChannelFanoutService,
    ReplayService,
    SocketGateway,
  ],
})
export class AppModule {}
