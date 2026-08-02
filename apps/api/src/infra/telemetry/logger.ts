// PRD §21.4: "Structured JSON → Loki ... 90-day retention, PII-redacted at
// the logger, always carrying request_id and user_id." This is the single
// list of field names considered sensitive — expand it here, not at each
// call site, so redaction can't be forgotten by a future caller.
const REDACTED_FIELD_NAMES = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "authorization",
  "otp",
  "secret",
  "apikey",
  "api_key",
  "ssn",
  "creditcard",
  "credit_card",
]);

const REDACTED_VALUE = "[REDACTED]";

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = REDACTED_FIELD_NAMES.has(key.toLowerCase()) ? REDACTED_VALUE : redact(val);
    }
    return result;
  }
  return value;
}

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogContext {
  requestId?: string | null;
  userId?: string | null;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

function write(level: LogLevel, minLevel: LogLevel, message: string, context: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const { requestId = null, userId = null, ...rest } = context;
  // request_id/user_id always present (even as null) — PRD §21.4's
  // explicit requirement, not left to whether a call site remembered to
  // pass them.
  const entry = {
    level,
    message,
    request_id: requestId,
    user_id: userId,
    timestamp: new Date().toISOString(),
    ...(redact(rest) as Record<string, unknown>),
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createLogger(minLevel: LogLevel = "info"): Logger {
  return {
    debug: (message, context = {}) => write("debug", minLevel, message, context),
    info: (message, context = {}) => write("info", minLevel, message, context),
    warn: (message, context = {}) => write("warn", minLevel, message, context),
    error: (message, context = {}) => write("error", minLevel, message, context),
  };
}
