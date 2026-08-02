import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

// PRD §21.4: "/metrics (Prometheus, RED metrics per route)." One shared
// registry so every metric defined anywhere in the app ends up on the same
// /metrics response (health.controller.ts serves it).
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const LABEL_NAMES = ["method", "route", "status_code"] as const;

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests (RED: Rate).",
  labelNames: LABEL_NAMES,
  registers: [metricsRegistry],
});

export const httpRequestErrorsTotal = new Counter({
  name: "http_request_errors_total",
  help: "Total HTTP requests that resulted in a 5xx response (RED: Errors).",
  labelNames: LABEL_NAMES,
  registers: [metricsRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds (RED: Duration).",
  labelNames: LABEL_NAMES,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});
