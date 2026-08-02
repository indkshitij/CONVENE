import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { AlwaysOnSampler, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { FilteringSpanExporter } from "./filtering-span-exporter";

const BASELINE_SAMPLE_RATIO = 0.05;

let sdk: NodeSDK | undefined;

// PRD §21.4: "OpenTelemetry → Tempo, end-to-end spans across API → DB →
// Redis → worker → gateway, correlated by request_id; 100% sampling on
// errors, 5% baseline." Must run before NestFactory.create() in main.ts —
// the HTTP/Postgres/Redis auto-instrumentations patch modules at require
// time, so they have to be registered before Nest (or anything else) has
// already imported http/pg/ioredis.
export function initTelemetry(): void {
  if (sdk) return;

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const rawExporter = otlpEndpoint
    ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
    : new ConsoleSpanExporter();

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "convene-api" }),
    // Record every span at the head so FilteringSpanExporter can see each
    // span's final status before deciding whether to actually export it —
    // see that file's comment for why head sampling alone can't implement
    // "100% on errors."
    sampler: new AlwaysOnSampler(),
    traceExporter: new FilteringSpanExporter(rawExporter, {
      baselineSampleRatio: BASELINE_SAMPLE_RATIO,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  const shutdown = (): void => {
    void sdk?.shutdown();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
