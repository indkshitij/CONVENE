import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { CommonModule } from "./common/common.module";
import { ConfigModule } from "./config/config.module";
import { PostgresModule } from "./infra/postgres/postgres.module";
import { QueueModule } from "./infra/queue/queue.module";
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
import { TaxonomyModule } from "./modules/taxonomy/taxonomy.module";
import { TrustSafetyModule } from "./modules/trust-safety/trust-safety.module";

// PRD §17.2 — the 13 domain modules, plus TaxonomyModule (P6.1) as a 14th
// cross-cutting module for shared reference data §17.2's table doesn't
// assign an owner for (see taxonomy/README.md). PostgresModule/
// RedisModule/HealthModule are P3.3's observability foundation (§21.4).
@Module({
  imports: [
    ConfigModule,
    PostgresModule,
    RedisModule,
    QueueModule,
    // PRD §17.2's per-module "Publishes"/"Consumes" event tables (e.g.
    // profile.updated, intent.changed) — EventEmitter2 is the in-process
    // pub/sub these named events are implemented with, first introduced
    // here (P7.4) since no earlier phase needed cross-service domain
    // events yet.
    EventEmitterModule.forRoot(),
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
    TaxonomyModule,
  ],
})
export class AppModule {}
