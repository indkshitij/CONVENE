import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { computeEtag } from "../serialization/etag";

interface ResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
}

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}

// PRD §17.3 step 13 / §17.9: "ETag where cacheable." Computes a content
// hash of the serialised response body, sets it as the ETag header, and
// short-circuits with an empty 304 when the client's If-None-Match already
// matches (P6.1: "Assert a cached response returns 304 on a matching
// ETag"). Request-side If-Match conflict checking (§10.2.9's optimistic-
// concurrency PATCH flow) needs a real, versioned entity to compare
// against — wired per-route once those exist, not here.
@Injectable()
export class EtagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<ResponseLike>();
    const request = context.switchToHttp().getRequest<RequestLike>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (body === undefined || body === null) return body;

        const etag = computeEtag(body);
        response.setHeader("ETag", etag);

        const ifNoneMatch = request.headers["if-none-match"];
        const clientEtag = Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch;
        if (clientEtag === etag) {
          // Nest's Express adapter sends an empty body when the handler's
          // return value is null/undefined — the correct wire shape for a
          // 304, which must never carry a body.
          response.status(304);
          return undefined;
        }

        return body;
      }),
    );
  }
}
