import { Body, Controller, Put, Req } from "@nestjs/common";
import { location as locationValidation } from "@convene/validation";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import type { AuthContext } from "../../common/auth/auth-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  type LocationPreferencesInput,
  type LocationPreferencesResponse,
  LocationService,
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

// PRD §10.5.7 endpoint 27: `PUT /preferences/location` — a distinct
// top-level path from `/location`'s own three routes, per the literal
// contract (not nested under it).
@Controller("preferences/location")
export class LocationPreferencesController {
  constructor(private readonly locationService: LocationService) {}

  @Put()
  @Policy(selfScoped)
  async updatePreferences(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(locationValidation.locationPreferencesSchema))
    body: LocationPreferencesInput,
  ): Promise<LocationPreferencesResponse> {
    const { id: userId, plan } = requireAuthContext(request);
    return this.locationService.updatePreferences(userId, plan, body);
  }
}
