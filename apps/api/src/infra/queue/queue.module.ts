import { Global, Module } from "@nestjs/common";
import { BullmqConnectionService } from "./bullmq-connection.service";

// PRD §17.2 W1/WK3 (embedding refresh) and the later phases' own workers
// (availability-expiry, match-precompute, reputation-recompute) all need
// this dedicated ioredis connection — see BullmqConnectionService's own
// comment for why it can't reuse RedisService's client. @Global so every
// module's Queue/Worker wrapper can inject it without re-importing.
@Global()
@Module({
  providers: [BullmqConnectionService],
  exports: [BullmqConnectionService],
})
export class QueueModule {}
