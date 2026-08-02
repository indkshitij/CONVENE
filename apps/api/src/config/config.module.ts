import { Global, Module } from "@nestjs/common";
import { validateEnv, type Env } from "./env.schema";

export const ENV = "ENV";

// @Global + a factory provider means validateEnv() runs during Nest's
// module-graph construction in NestFactory.create(), which happens before
// app.listen() — a thrown validation error aborts boot, never reaches
// "listening" (PRD §21.5).
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => validateEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
