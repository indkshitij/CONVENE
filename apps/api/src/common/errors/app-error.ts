import type { ErrorCode } from "./error-codes";

export interface AppErrorOptions {
  field?: string | null;
  details?: unknown;
  retryAfter?: number | null;
}

// PRD §17.9 envelope: { code, message, field, details, request_id, retry_after }.
// request_id isn't carried here — it's assigned per-request by error.filter.ts,
// not intrinsic to the error itself.
export abstract class AppError extends Error {
  abstract readonly httpStatus: number;
  readonly code: ErrorCode;
  readonly field: string | null;
  readonly details: unknown;
  readonly retryAfter: number | null;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.code = code;
    this.field = options.field ?? null;
    this.details = options.details ?? null;
    this.retryAfter = options.retryAfter ?? null;
  }
}

export class BadRequestAppError extends AppError {
  readonly httpStatus = 400;
}

export class UnauthorizedAppError extends AppError {
  readonly httpStatus = 401;
}

export class ForbiddenAppError extends AppError {
  readonly httpStatus = 403;
}

export class NotFoundAppError extends AppError {
  readonly httpStatus = 404;
}

export class ConflictAppError extends AppError {
  readonly httpStatus = 409;
}

export class GoneAppError extends AppError {
  readonly httpStatus = 410;
}

export class ValidationAppError extends AppError {
  readonly httpStatus = 422;
}

export class TooManyRequestsAppError extends AppError {
  readonly httpStatus = 429;
}

export class InternalAppError extends AppError {
  readonly httpStatus = 500;
}
