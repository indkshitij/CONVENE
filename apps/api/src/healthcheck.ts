// Docker HEALTHCHECK target (PRD §21.6). This phase (P3.1) registers no
// routes yet — any HTTP response, even a 404, proves the process is alive
// and its server is accepting connections, which is everything this phase's
// healthcheck needs to prove. The real /health endpoint lands in P3.3.
import http from "node:http";

const port = process.env.PORT ? Number(process.env.PORT) : 8080;

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
