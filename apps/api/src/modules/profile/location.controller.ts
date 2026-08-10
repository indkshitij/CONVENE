import { Body, Controller, Put, Req } from "@nestjs/common";
import { location as locationValidation } from "@convene/validation";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import type { AuthContext } from "../../common/auth/auth-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  type LocationPrivacyInput,
  type LocationUpdateResponse,
  LocationService,
  type ManualLocationInput,
  type PreciseLocationInput,
} from "./location.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §10.5.7 endpoint 26. Response never echoes exact coordinates
// (LocationUpdateResponse has no such field at all — see
// no-coordinates-in-dtos.test.ts's repo-wide scan and
// location.controller.no-coordinates.test.ts's targeted assertion).
@Controller("location")
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Put()
  @Policy(selfScoped)
  async updatePreciseLocation(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(locationValidation.preciseLocationSchema))
    body: PreciseLocationInput,
  ): Promise<LocationUpdateResponse> {
    const { id: userId } = requireAuthContext(request);
    return this.locationService.updatePreciseLocation(userId, body);
  }

  @Put("manual")
  @Policy(selfScoped)
  async updateManualLocation(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(locationValidation.manualLocationSchema)) body: ManualLocationInput,
  ): Promise<LocationUpdateResponse> {
    const { id: userId } = requireAuthContext(request);
    return this.locationService.updateManualLocation(userId, body);
  }

  @Put("privacy")
  @Policy(selfScoped)
  async updatePrivacy(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(locationValidation.updateLocationPrivacySchema))
    body: LocationPrivacyInput,
  ): Promise<{ location_privacy: string }> {
    const { id: userId } = requireAuthContext(request);
    return this.locationService.updatePrivacy(userId, body);
  }
}
