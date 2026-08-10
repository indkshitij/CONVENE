// P18.3: the one place a controller reads "the current request's
// ip/user-agent/request-id" for an audit log call — mirrors every other
// controller's `requireAuthContext(request)` helper (explicit param
// passing, no ambient magic), reading the fields RequestContextInterceptor
// already normalised onto the request.
export interface AuditRequestContext {
  ip: string;
  userAgent: string | null;
  requestId: string | null;
}

interface RequestLike {
  auditIp?: string;
  auditUserAgent?: string | null;
  requestId?: string;
}

export function auditContextFrom(request: RequestLike): AuditRequestContext {
  return {
    ip: request.auditIp ?? "unknown-ip",
    userAgent: request.auditUserAgent ?? null,
    requestId: request.requestId ?? null,
  };
}
