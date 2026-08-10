import { media as mediaValidation } from "@convene/validation";
import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { RateLimit } from "../../common/rate-limit/rate-limit.decorator";
import { MediaService, type UploadIntentResult } from "./services/media.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

type CreateUploadIntentBody = z.infer<typeof mediaValidation.createUploadIntentSchema>;
type CommitUploadBody = z.infer<typeof mediaValidation.commitUploadSchema>;

interface UploadIntentResponse {
  media_id: string;
  upload_url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_at: string;
}

function toUploadIntentResponse(result: UploadIntentResult): UploadIntentResponse {
  return {
    media_id: result.mediaId,
    upload_url: result.uploadUrl,
    method: result.method,
    headers: result.headers,
    expires_at: result.expiresAt,
  };
}

// PRD §17.9 endpoints 53 (upload-intent + commit) and 54 (signed URL).
@Controller("media")
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  // §21.9's own rate-limit matrix: "Media upload: 30/h" — the 200MB/day
  // byte-volume half of that row isn't modelled by RateLimitGuard (see
  // its own policies.ts comment) and isn't implemented here either;
  // flagged as a scope gap, not silently dropped.
  @Post("upload-intent")
  @Policy(anyAuthenticatedUser)
  @RateLimit({ scope: "media-upload" })
  async createUploadIntent(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(mediaValidation.createUploadIntentSchema))
    body: CreateUploadIntentBody,
  ): Promise<UploadIntentResponse> {
    const { id: userId } = requireAuthContext(request);
    const result = await this.mediaService.createUploadIntent(userId, {
      kind: body.kind,
      mimeType: body.mime_type,
      sizeBytes: body.size_bytes,
    });
    return toUploadIntentResponse(result);
  }

  @Post(":id/commit")
  @HttpCode(202)
  @Policy(anyAuthenticatedUser)
  async commit(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(mediaValidation.commitUploadSchema)) body: CommitUploadBody,
  ): Promise<{ media_id: string; state: string }> {
    const { id: userId } = requireAuthContext(request);
    const committed = await this.mediaService.commit(id, userId, body.conversation_id ?? null);
    return { media_id: committed.id, state: "processing" };
  }

  @Get(":id/url")
  @Policy(anyAuthenticatedUser)
  async getSignedUrl(
    @Req() request: RequestLike,
    @Param("id") id: string,
  ): Promise<{ url: string; expires_at: string }> {
    const { id: userId } = requireAuthContext(request);
    const result = await this.mediaService.getSignedUrl(id, userId);
    return { url: result.url, expires_at: result.expiresAt };
  }
}
