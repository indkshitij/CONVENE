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
  headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
  setHeader(name: string, value: string): void;
}

// PRD §17.3 step 3: "generate/propagate X-Request-Id, start OpenTelemetry
// span." Tracing itself is P3.3's scope — this interceptor owns the id,
// which error.filter.ts reads back off the request to include in every
// error envelope.
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    const response = context.switchToHttp().getResponse<ResponseLike>();

    const incoming = request.headers["x-request-id"];
    const requestId = typeof incoming === "string" && incoming.length > 0 ? incoming : uuidv7();

    request.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);

    return next.handle();
  }
}
