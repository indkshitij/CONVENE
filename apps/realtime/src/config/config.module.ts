import { Global, Module } from "@nestjs/common";
import { validateEnv, type Env } from "./env.schema";

export const ENV = "ENV";

// Mirrors apps/api/src/config/config.module.ts — a thrown validation error
// during module construction aborts boot before app.listen().
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => validateEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
