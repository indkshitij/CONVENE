import { SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";
import { FilteringSpanExporter } from "./filtering-span-exporter";

function fakeSpan(statusCode: SpanStatusCode): ReadableSpan {
  return { status: { code: statusCode } } as ReadableSpan;
}

function fakeDelegate(): SpanExporter {
  return {
    export: vi.fn((_spans, cb) => cb({ code: ExportResultCode.SUCCESS })),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

// PRD §21.4: "100% sampling on errors, 5% baseline." Since AlwaysOnSampler
// (otel.ts) records every span, this exporter is where the real sampling
// decision happens — always forward error spans, forward the rest only per
// the baseline ratio.
describe("FilteringSpanExporter", () => {
  it("always forwards a span with ERROR status regardless of the random draw", () => {
    const delegate = fakeDelegate();
    const exporter = new FilteringSpanExporter(delegate, {
      baselineSampleRatio: 0.05,
      random: () => 0.999, // would fail the 5% baseline check
    });
    const callback = vi.fn();

    exporter.export([fakeSpan(SpanStatusCode.ERROR)], callback);

    expect(delegate.export).toHaveBeenCalledTimes(1);
    expect((delegate.export as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("forwards a non-error span when the random draw is under the baseline ratio", () => {
    const delegate = fakeDelegate();
    const exporter = new FilteringSpanExporter(delegate, {
      baselineSampleRatio: 0.05,
      random: () => 0.01,
    });
    const callback = vi.fn();

    exporter.export([fakeSpan(SpanStatusCode.OK)], callback);

    expect(delegate.export).toHaveBeenCalledTimes(1);
  });

  it("drops a non-error span when the random draw is over the baseline ratio", () => {
    const delegate = fakeDelegate();
    const exporter = new FilteringSpanExporter(delegate, {
      baselineSampleRatio: 0.05,
      random: () => 0.5,
    });
    const callback = vi.fn();

    exporter.export([fakeSpan(SpanStatusCode.OK)], callback);

    expect(delegate.export).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it("filters a mixed batch, keeping only error spans and those under the baseline ratio", () => {
    const delegate = fakeDelegate();
    const exporter = new FilteringSpanExporter(delegate, {
      baselineSampleRatio: 0.05,
      random: () => 0.5, // over baseline for every non-error span
    });
    const callback = vi.fn();

    exporter.export(
      [fakeSpan(SpanStatusCode.OK), fakeSpan(SpanStatusCode.ERROR), fakeSpan(SpanStatusCode.OK)],
      callback,
    );

    const forwarded = (delegate.export as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as ReadableSpan[];
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("delegates shutdown", async () => {
    const delegate = fakeDelegate();
    const exporter = new FilteringSpanExporter(delegate, { baselineSampleRatio: 0.05 });
    await exporter.shutdown();
    expect(delegate.shutdown).toHaveBeenCalledTimes(1);
  });
});
