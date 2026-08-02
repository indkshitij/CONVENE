import { Module } from "@nestjs/common";
import { CommonModule } from "./common/common.module";
import { ConfigModule } from "./config/config.module";
import { PostgresModule } from "./infra/postgres/postgres.module";
import { RedisModule } from "./infra/redis/redis.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AiGatewayModule } from "./modules/ai-gateway/ai-gateway.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AvailabilityModule } from "./modules/availability/availability.module";
import { BillingModule } from "./modules/billing/billing.module";
import { ConnectionsModule } from "./modules/connections/connections.module";
import { HealthModule } from "./modules/health/health.module";
import { IntentsModule } from "./modules/intents/intents.module";
import { MatchingModule } from "./modules/matching/matching.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ProfileModule } from "./modules/profile/profile.module";
import { SearchModule } from "./modules/search/search.module";
import { TrustSafetyModule } from "./modules/trust-safety/trust-safety.module";

// PRD §17.2 — all 13 modules registered, currently empty (P3.1 scope is the
// skeleton + boot/config only). PostgresModule/RedisModule/HealthModule are
// P3.3's observability foundation (PRD §21.4).
@Module({
  imports: [
    ConfigModule,
    PostgresModule,
    RedisModule,
    CommonModule,
    HealthModule,
    AuthModule,
    ProfileModule,
    AvailabilityModule,
    IntentsModule,
    MatchingModule,
    ConnectionsModule,
    MessagingModule,
    NotificationsModule,
    TrustSafetyModule,
    BillingModule,
    SearchModule,
    AiGatewayModule,
    AdminModule,
  ],
})
export class AppModule {}
