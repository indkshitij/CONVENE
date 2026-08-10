import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { useUiStore } from "@/stores/ui";
import { defaultOnError, shouldRetry } from "./query-provider";

function fakeApiError(status: number): ApiError {
  return new ApiError(status, {
    error: {
      code: "SOME_CODE",
      message: "It broke",
      field: null,
      details: null,
      request_id: null,
      retry_after: null,
    },
  });
}

describe("shouldRetry", () => {
  // Explicit acceptance criterion: "Assert a 422 is not retried."
  it("does not retry a 422", () => {
    expect(shouldRetry(0, fakeApiError(422))).toBe(false);
  });

  it("does not retry any 4xx", () => {
    expect(shouldRetry(0, fakeApiError(400))).toBe(false);
    expect(shouldRetry(0, fakeApiError(404))).toBe(false);
    expect(shouldRetry(0, fakeApiError(429))).toBe(false);
  });

  it("retries a 5xx once, then stops", () => {
    expect(shouldRetry(0, fakeApiError(500))).toBe(true);
    expect(shouldRetry(1, fakeApiError(500))).toBe(false);
  });

  it("retries a non-ApiError (network failure) once, then stops", () => {
    expect(shouldRetry(0, new Error("network down"))).toBe(true);
    expect(shouldRetry(1, new Error("network down"))).toBe(false);
  });
});

describe("defaultOnError", () => {
  beforeEach(() => {
    useUiStore.setState({ toasts: [] });
  });

  it("pushes a toast with the ApiError's own message", () => {
    defaultOnError(fakeApiError(422), undefined);
    expect(useUiStore.getState().toasts).toHaveLength(1);
    expect(useUiStore.getState().toasts[0]?.message).toBe("It broke");
    expect(useUiStore.getState().toasts[0]?.variant).toBe("error");
  });

  it("falls back to a generic message for a non-ApiError", () => {
    defaultOnError(new Error("boom"), undefined);
    expect(useUiStore.getState().toasts[0]?.message).toMatch(/something went wrong/i);
  });

  it("suppresses the toast when meta.suppressErrorToast is set", () => {
    defaultOnError(fakeApiError(422), { suppressErrorToast: true });
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });
});
