import { connections as connectionsValidation } from "@convene/validation";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { BlocksService, type BlockedUser } from "./services/blocks.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

type CreateBlockBody = z.infer<typeof connectionsValidation.createBlockSchema>;

// PRD §17.9 endpoint 36: "POST/DELETE /blocks · /blocks/{userId} | Block, unblock."
@Controller("blocks")
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Post()
  @HttpCode(201)
  @Policy(anyAuthenticatedUser)
  async block(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(connectionsValidation.createBlockSchema)) body: CreateBlockBody,
  ): Promise<{ blocked_id: string }> {
    const { id: blockerId } = requireAuthContext(request);
    await this.blocksService.block(blockerId, body.user_id, body.reason ?? null);
    return { blocked_id: body.user_id };
  }

  @Delete(":userId")
  @HttpCode(204)
  @Policy(anyAuthenticatedUser)
  async unblock(@Req() request: RequestLike, @Param("userId") userId: string): Promise<void> {
    const { id: blockerId } = requireAuthContext(request);
    await this.blocksService.unblock(blockerId, userId);
  }

  @Get()
  @Policy(anyAuthenticatedUser)
  async list(@Req() request: RequestLike): Promise<{ blocks: BlockedUser[] }> {
    const { id: blockerId } = requireAuthContext(request);
    return { blocks: await this.blocksService.list(blockerId) };
  }
}
