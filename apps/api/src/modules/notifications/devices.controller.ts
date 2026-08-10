import type { Device } from "@convene/db";
import { notifications as notificationsValidation } from "@convene/validation";
import { Body, Controller, Delete, Param, Post, Req } from "@nestjs/common";
import type { z } from "zod";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { NotificationsService } from "./notifications.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

type RegisterDeviceBody = z.infer<typeof notificationsValidation.registerDeviceSchema>;

interface DeviceCard {
  id: string;
  platform: string;
  app_version: string | null;
  registered_at: string;
}

function toCard(row: Device): DeviceCard {
  return {
    id: row.id,
    platform: row.platform,
    app_version: row.appVersion,
    registered_at: row.createdAt.toISOString(),
  };
}

// PRD §10.8.3 endpoint 47: POST/DELETE /devices — push token registration.
@Controller("devices")
export class DevicesController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @Policy(anyAuthenticatedUser)
  async register(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(notificationsValidation.registerDeviceSchema))
    body: RegisterDeviceBody,
  ): Promise<DeviceCard> {
    const { id: userId } = requireAuthContext(request);
    const device = await this.notificationsService.registerDevice(
      userId,
      body.platform,
      body.push_token,
      body.app_version ?? null,
    );
    return toCard(device);
  }

  @Delete(":id")
  @Policy(anyAuthenticatedUser)
  async remove(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.notificationsService.deleteDevice(userId, id);
  }
}
