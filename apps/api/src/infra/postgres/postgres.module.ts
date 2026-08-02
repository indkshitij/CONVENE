import { Global, Module } from "@nestjs/common";
import { PostgresService } from "./postgres.service";

// @Global for the same reason as RedisModule — a single pooled connection
// shared by every module that needs it (currently just /health/ready;
// feature modules will get their own repository layer per PRD §17.1
// without needing to re-import this module).
@Global()
@Module({
  providers: [PostgresService],
  exports: [PostgresService],
})
export class PostgresModule {}
