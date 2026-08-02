import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import {
  httpRequestDurationSeconds,
  httpRequestErrorsTotal,
  httpRequestsTotal,
} from "../../infra/telemetry/metrics";

interface RequestLike {
  method: string;
  route?: { path?: string };
  url?: string;
}
interface ResponseLike {
  statusCode: number;
  once(event: "finish", listener: () => void): void;
}

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const response = context.switchToHttp().getResponse<ResponseLike>();
    const method = request.method;
    const route = request.route?.path ?? request.url ?? "unknown";
    const start = process.hrtime.bigint();

    // The response "finish" event fires once the response is actually sent
    // to the client on every path — success, thrown AppError, or an
    // unhandled exception reaching ErrorFilter — so this reads the true
    // final status code regardless of where in the pipeline it was set.
    // Reading it via rxjs's tap(next/error) instead would race ErrorFilter,
    // which runs after interceptors and is what actually sets the status
    // code for a thrown error.
    response.once("finish", () => {
      const statusCode = String(response.statusCode);
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      const labels = { method, route, status_code: statusCode };

      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSeconds);
      if (response.statusCode >= 500) {
        httpRequestErrorsTotal.inc(labels);
      }
    });

    return next.handle();
  }
}
