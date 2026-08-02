import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import { AppError } from "./app-error";
import type { ErrorCode } from "./error-codes";

interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    field: string | null;
    details: unknown;
    request_id: string | null;
    retry_after: number | null;
  };
}

// Minimal shape instead of importing express's types directly — keeps this
// filter usable regardless of which HTTP adapter Nest runs on.
interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): void;
}
interface HttpRequestLike {
  requestId?: string;
}

const STATUS_TO_GENERIC_CODE: Partial<Record<number, ErrorCode>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "GONE",
  422: "VALIDATION_FAILED",
  429: "TOO_MANY_REQUESTS",
};

const STATUS_TO_GENERIC_MESSAGE: Partial<Record<number, string>> = {
  400: "The request could not be understood.",
  401: "Authentication is required.",
  403: "You don't have permission to do that.",
  404: "The requested resource could not be found.",
  409: "The request conflicts with the current state.",
  410: "This resource is no longer available.",
  422: "The request could not be validated.",
  429: "Too many requests.",
};

// PRD §17.9: identical envelope everywhere, and "never leaks a stack trace,
// SQL fragment, or ORM error text." Only AppError's own fields ever reach
// the client; anything else (a raw driver error, a framework HttpException,
// an unhandled bug) gets a generic per-status message — the real exception
// is still logged server-side, tagged with request_id, so it isn't lost.
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponseLike>();
    const request = ctx.getRequest<HttpRequestLike>();
    const requestId = request?.requestId ?? null;
    const status = this.resolveStatus(exception);

    if (!(exception instanceof AppError)) {
      console.error(`[request_id=${requestId ?? "unknown"}]`, exception);
    }

    response.status(status).json(this.buildEnvelope(exception, status, requestId));
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof AppError) return exception.httpStatus;
    if (exception instanceof HttpException) return exception.getStatus();
    return 500;
  }

  private buildEnvelope(
    exception: unknown,
    status: number,
    requestId: string | null,
  ): ErrorEnvelope {
    if (exception instanceof AppError) {
      return {
        error: {
          code: exception.code,
          message: exception.message,
          field: exception.field,
          details: exception.details,
          request_id: requestId,
          retry_after: exception.retryAfter,
        },
      };
    }

    return {
      error: {
        code: STATUS_TO_GENERIC_CODE[status] ?? "INTERNAL_ERROR",
        message: STATUS_TO_GENERIC_MESSAGE[status] ?? "An unexpected error occurred.",
        field: null,
        details: null,
        request_id: requestId,
        retry_after: null,
      },
    };
  }
}
