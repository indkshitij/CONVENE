import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

// PRD §17.3 step 13 / §17.9: "ETag where cacheable." Computes a content
// hash of the serialised response body and sets it as the ETag header.
// Request-side If-Match conflict checking (§10.2.9's optimistic-concurrency
// PATCH flow) needs a real, versioned entity to compare against — wired
// per-route once those exist, not here.
@Injectable()
export class EtagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<ResponseLike>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (body !== undefined && body !== null) {
          const hash = createHash("sha1").update(JSON.stringify(body)).digest("hex");
          response.setHeader("ETag", `"${hash}"`);
        }
        return body;
      }),
    );
  }
}
