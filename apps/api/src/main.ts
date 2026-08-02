import "reflect-metadata";
import { initTelemetry } from "./infra/telemetry/otel";
import type { Env } from "./config/env.schema";

// Must run before anything that requires http/pg/ioredis is imported — the
// OTel auto-instrumentations patch those modules at require time (PRD
// §21.4). Static ES imports are all resolved before any top-level
// statement runs, so @nestjs/core / AppModule / ENV are imported
// dynamically inside bootstrap() below, *after* this call, rather than
// hoisted to the top of the file the normal way.
initTelemetry();

const SHUTDOWN_DRAIN_MS = 15_000;

async function bootstrap() {
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("./app.module");
  const { ENV } = await import("./config/config.module");

  // Config validation happens during module construction inside
  // NestFactory.create(), i.e. strictly before app.listen() — a malformed
  // or missing required variable throws here and the process never
  // reaches "listening" (PRD §21.5).
  const app = await NestFactory.create(AppModule);

  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
  console.log(`Convene API listening on port ${env.PORT} (${env.NODE_ENV})`);

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, draining for up to ${SHUTDOWN_DRAIN_MS}ms...`);

    const forceExit = setTimeout(() => {
      console.error(
        `Graceful shutdown did not complete within ${SHUTDOWN_DRAIN_MS}ms, forcing exit.`,
      );
      process.exit(1);
    }, SHUTDOWN_DRAIN_MS);
    forceExit.unref();

    app
      .close()
      .then(() => {
        clearTimeout(forceExit);
        process.exit(0);
      })
      .catch((error: unknown) => {
        clearTimeout(forceExit);
        console.error("Error during shutdown", error);
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start Convene API", error);
  process.exit(1);
});
