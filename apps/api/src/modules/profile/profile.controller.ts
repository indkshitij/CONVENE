import { Body, Controller, Get, Headers, Param, Patch, Req } from "@nestjs/common";
import { profile as profileValidation } from "@convene/validation";
import { BadRequestAppError, UnauthorizedAppError } from "../../common/errors/app-error";
import { Policy } from "../../common/auth/policy.guard";
import { anyAuthenticatedUser, selfScoped } from "../../common/auth/policies";
import type { AuthContext } from "../../common/auth/auth-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { type ProfileResponse, type ProfileUpdateInput, ProfileService } from "./profile.service";
import type { CompletionResult } from "./completion";
import { CompletionService } from "./completion.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §10.2.9 endpoints 12/13/14. ETag is set globally by EtagInterceptor
// (P6.1) from the serialised GET response body; PATCH validates the
// client's If-Match against a freshly recomputed copy of that same
// representation (ProfileService.updateMyProfile), not a stored version
// column.
@Controller("profiles")
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly completionService: CompletionService,
  ) {}

  @Get("me")
  @Policy(selfScoped)
  async getMyProfile(@Req() request: RequestLike): Promise<ProfileResponse> {
    const { id: userId } = requireAuthContext(request);
    return this.profileService.getMyProfile(userId);
  }

  // PRD §10.2.9 endpoint 17 / §10.2.4. Declared before the `:userId`
  // route below so "me" isn't captured as a user id — same ordering
  // precaution getMyProfile above already relies on.
  @Get("me/completion")
  @Policy(selfScoped)
  async getMyCompletion(@Req() request: RequestLike): Promise<CompletionResult> {
    const { id: userId } = requireAuthContext(request);
    return this.completionService.getCompletion(userId);
  }

  // PRD §13 F11 trigger 4 — see ProfileService.getMyViewers's own comment
  // for the free-vs-Premium split.
  @Get("me/viewers")
  @Policy(selfScoped)
  async getMyViewers(@Req() request: RequestLike): Promise<{
    count: number;
    viewers: { user_id: string; full_name: string; viewed_at: string }[];
  }> {
    const { id: userId, plan } = requireAuthContext(request);
    return this.profileService.getMyViewers(userId, plan !== "free");
  }

  // See any-authenticated-user.policy.ts: visibility/block/private
  // enforcement is inherently I/O-bound and happens inside
  // ProfileService.getProfileForViewer(), not in this pure-function policy.
  @Get(":userId")
  @Policy(anyAuthenticatedUser)
  async getProfile(
    @Req() request: RequestLike,
    @Param("userId") userId: string,
  ): Promise<ProfileResponse> {
    const { id: viewerId } = requireAuthContext(request);
    return this.profileService.getProfileForViewer(viewerId, userId);
  }

  @Patch("me")
  @Policy(selfScoped)
  async updateMyProfile(
    @Req() request: RequestLike,
    @Headers("if-match") ifMatch: string | undefined,
    @Body(new ZodValidationPipe(profileValidation.profileUpdateSchema)) updates: ProfileUpdateInput,
  ): Promise<ProfileResponse> {
    const { id: userId } = requireAuthContext(request);
    if (!ifMatch) {
      throw new BadRequestAppError(
        "BAD_REQUEST",
        "An If-Match header is required to update a profile.",
      );
    }
    return this.profileService.updateMyProfile(userId, ifMatch, updates);
  }
}
