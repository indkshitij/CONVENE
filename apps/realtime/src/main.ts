import "reflect-metadata";
import type { Env } from "./config/env.schema";

const SHUTDOWN_DRAIN_MS = 15_000;

// Mirrors apps/api/src/main.ts's bootstrap/shutdown shape (dynamic imports
// after any top-level setup, drain-then-exit SIGTERM/SIGINT handling).
async function bootstrap() {
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("./app.module");
  const { ENV } = await import("./config/config.module");
  const { SocketGateway } = await import("./socket.gateway");

  const app = await NestFactory.create(AppModule);
  const env = app.get<Env>(ENV);

  // Attach the raw ws.Server to Nest's underlying HTTP server before
  // listen() so both the WS upgrade path and the healthcheck's plain HTTP
  // GET share one port.
  const gateway = app.get(SocketGateway);
  gateway.attach(app.getHttpServer());

  await app.listen(env.PORT);
  console.log(`Convene realtime gateway listening on port ${env.PORT} (${env.NODE_ENV})`);

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

bootstrap();
