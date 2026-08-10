import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { uuidv7 } from "../utils/uuidv7";

interface RequestWithId {
  requestId?: string;
  auditIp?: string;
  auditUserAgent?: string | null;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
  setHeader(name: string, value: string): void;
}

// PRD §17.3 step 3: "generate/propagate X-Request-Id, start OpenTelemetry
// span." Tracing itself is P3.3's scope — this interceptor owns the id,
// which error.filter.ts reads back off the request to include in every
// error envelope.
//
// P18.3 addition: also normalises IP/User-Agent onto the request as
// `auditIp`/`auditUserAgent`, the same two ad hoc `x-forwarded-for`
// resolutions that already existed separately in auth.controller.ts and
// rate-limit.guard.ts, centralised here so AuditLogService (and any
// future caller) has one place to read them from instead of a third
// copy of the same fallback logic.
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    const response = context.switchToHttp().getResponse<ResponseLike>();

    const incoming = request.headers["x-request-id"];
    const requestId = typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv7();
    request.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);

    const forwarded = request.headers["x-forwarded-for"];
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    request.auditIp = request.ip ?? forwardedIp ?? "unknown-ip";

    const userAgent = request.headers["user-agent"];
    request.auditUserAgent = Array.isArray(userAgent)
      ? (userAgent[0] ?? null)
      : (userAgent ?? null);

    return next.handle();
  }
}
