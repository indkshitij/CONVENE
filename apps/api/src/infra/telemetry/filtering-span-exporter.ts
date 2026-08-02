import { SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

export interface FilteringSpanExporterOptions {
  baselineSampleRatio: number;
  random?: () => number;
}

// PRD §21.4: "100% sampling on errors, 5% baseline." A head sampler decides
// before a span's outcome is known, so it can never implement "100% on
// errors" — a request that will fail can't be flagged for sampling in
// advance. Instead, otel.ts records every span (AlwaysOnSampler) and this
// exporter makes the real export decision once each span's final status is
// known. This is a single-process approximation of tail sampling; a
// multi-service deployment would use the Collector's tail-sampling
// processor instead, correlating across services by trace id.
export class FilteringSpanExporter implements SpanExporter {
  private readonly baselineSampleRatio: number;
  private readonly random: () => number;

  constructor(
    private readonly delegate: SpanExporter,
    options: FilteringSpanExporterOptions,
  ) {
    this.baselineSampleRatio = options.baselineSampleRatio;
    this.random = options.random ?? Math.random;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const kept = spans.filter((span) => this.shouldExport(span));
    if (kept.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.delegate.export(kept, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }

  private shouldExport(span: ReadableSpan): boolean {
    if (span.status.code === SpanStatusCode.ERROR) return true;
    return this.random() < this.baselineSampleRatio;
  }
}
