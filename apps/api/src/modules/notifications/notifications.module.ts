import { Module } from "@nestjs/common";
import { NotificationExpiryWorker } from "../../workers/notification-expiry.worker";
import { DevicesController } from "./devices.controller";
import { ConsoleEmailTransport, EMAIL_TRANSPORT, EmailService } from "./email.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsRepository } from "./repositories/notifications.repository";
import { PushSender } from "./services/push-sender";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P17.1: full catalogue-aware dispatch (preferences, quiet hours, collapse,
// frequency caps, push+email fallback). PostgresService/RedisService are
// @Global() (see infra/postgres, infra/redis) and don't need listing here.
// EmailService/EMAIL_TRANSPORT are defined in this module's own
// email.service.ts (no separate EmailModule exists), same pattern
// AuthModule already uses for its own copy of this wiring.
@Module({
  controllers: [NotificationsController, DevicesController],
  providers: [
    NotificationsService,
    NotificationsRepository,
    PushSender,
    { provide: EMAIL_TRANSPORT, useClass: ConsoleEmailTransport },
    EmailService,
    NotificationExpiryWorker,
  ],
  exports: [NotificationsService, EmailService],
})
export class NotificationsModule {}
