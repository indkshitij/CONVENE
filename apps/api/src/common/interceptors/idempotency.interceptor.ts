import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { type Observable, of } from "rxjs";
import { tap } from "rxjs/operators";
import { idempotencyKey as buildIdempotencyKey } from "../../infra/redis/keys";

export interface StoredIdempotentResponse {
  statusCode: number;
  body: unknown;
  expiresAt: number;
}

// PRD §17.9: "on Idempotency-Key, replay a stored response from Redis for
// 24h." This abstract store lets the interceptor's replay logic be tested
// against InMemoryIdempotencyStore in isolation; RedisIdempotencyStore
// (infra/redis/redis-idempotency-store.ts) is the production binding,
// wired in common.module.ts.
export abstract class IdempotencyStore {
  abstract get(
    key: string,
  ): StoredIdempotentResponse | undefined | Promise<StoredIdempotentResponse | undefined>;
  abstract set(key: string, value: StoredIdempotentResponse): void | Promise<void>;
}

@Injectable()
export class InMemoryIdempotencyStore extends IdempotencyStore {
  private readonly entries = new Map<string, StoredIdempotentResponse>();

  get(key: string): StoredIdempotentResponse | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: StoredIdempotentResponse): void {
    this.entries.set(key, value);
  }
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

interface RequestLike {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  route?: { path?: string };
  url?: string;
}
interface ResponseLike {
  statusCode: number;
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: IdempotencyStore) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const idempotencyKey = request.headers["idempotency-key"];

    if (request.method !== "POST" || typeof idempotencyKey !== "string") {
      return next.handle();
    }

    // keys.ts is the single place any Redis key string is constructed
    // (P3.3) — even though InMemoryIdempotencyStore doesn't touch Redis
    // directly, using the same builder keeps cache-key shape identical
    // across both store implementations.
    const cacheKey = buildIdempotencyKey(
      request.route?.path ?? request.url ?? "unknown",
      idempotencyKey,
    );
    const cached = await this.store.get(cacheKey);

    if (cached) {
      // Only set the status code here — returning the Observable below lets
      // Nest's own pipeline serialise and send the body exactly once.
      // Calling response.json() ourselves *and* returning of(body) sends
      // the response twice ("headers already sent").
      const response = context.switchToHttp().getResponse<ResponseLike>();
      response.status(cached.statusCode);
      return of(cached.body);
    }

    return next.handle().pipe(
      tap((body: unknown) => {
        const response = context.switchToHttp().getResponse<ResponseLike>();
        void this.store.set(cacheKey, {
          statusCode: response.statusCode || 200,
          body,
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        });
      }),
    );
  }
}
