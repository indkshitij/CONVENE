import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createPooledClient, pingDatabase, type Database } from "@convene/db";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env.schema";

@Injectable()
export class PostgresService implements OnModuleDestroy {
  readonly db: Database;

  constructor(@Inject(ENV) env: Env) {
    this.db = createPooledClient(env.DATABASE_URL);
  }

  /** Used by /health/ready. Never throws. */
  ping(): Promise<boolean> {
    return pingDatabase(this.db);
  }

  async onModuleDestroy(): Promise<void> {
    // postgres.js exposes the underlying client via a callable `$client`
    // (see drizzle-orm/postgres-js) — end() closes every pooled connection
    // so the process can shut down cleanly.
    await this.db.$client.end();
  }
}
