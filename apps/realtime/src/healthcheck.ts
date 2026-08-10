// Docker HEALTHCHECK target — mirrors apps/api/src/healthcheck.ts. Any
// HTTP response (even a 404, since this app registers no REST routes)
// proves the process is alive and its port is accepting connections.
import http from "node:http";

const port = process.env.PORT ? Number(process.env.PORT) : 8081;

const request = http.request(
  { host: "127.0.0.1", port, path: "/", method: "GET", timeout: 3_000 },
  (response) => {
    response.resume();
    const healthy = (response.statusCode ?? 500) < 500;
    process.exit(healthy ? 0 : 1);
  },
);

request.on("error", () => process.exit(1));
request.on("timeout", () => {
  request.destroy();
  process.exit(1);
});
request.end();
