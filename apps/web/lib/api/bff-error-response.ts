import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { ApiError } from "./client";

// Shared by every app/api/auth/* BFF route so the §17.9 error envelope
// shape is built in exactly one place, not re-typed at each route.
export function validationErrorResponse(zodError: ZodError): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid request.",
        field: null,
        details: zodError.flatten(),
        request_id: null,
        retry_after: null,
      },
    },
    { status: 422 },
  );
}

export function apiErrorResponse(err: ApiError): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: err.code,
        message: err.message,
        field: err.field,
        details: err.details,
        request_id: err.requestId,
        retry_after: err.retryAfter,
      },
    },
    { status: err.status },
  );
}
