import { search as searchValidation } from "@convene/validation";
import { Controller, Get, Query, Req } from "@nestjs/common";
import type { AuthContext } from "../../common/auth/auth-context";
import { anyAuthenticatedUser } from "../../common/auth/policies";
import { Policy } from "../../common/auth/policy.guard";
import { BadRequestAppError, UnauthorizedAppError } from "../../common/errors/app-error";
import { SearchService, type SearchUsersResult } from "./search.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

function splitCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// PRD §10.9.2: `GET /search/users`. Query params are parsed manually
// (this codebase's established convention for GET filters — see
// discovery.controller.ts's own per-field @Query() decorators — rather
// than forcing packages/validation's searchUsersSchema, which is shaped
// for a programmatic object, onto raw query strings).
@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get("users")
  @Policy(anyAuthenticatedUser)
  async searchUsers(
    @Req() request: RequestLike,
    @Query("q") q?: string,
    @Query("intents") intents?: string,
    @Query("industry") industry?: string,
    @Query("skills") skillsParam?: string,
    @Query("skills_op") skillsOp?: string,
    @Query("min_exp") minExp?: string,
    @Query("max_exp") maxExp?: string,
    @Query("availability") availability?: string,
    @Query("verified_only") verifiedOnly?: string,
  ): Promise<SearchUsersResult> {
    const { id: viewerId, plan } = requireAuthContext(request);

    const parsedQuery = searchValidation.searchQuerySchema.safeParse(q ?? "");
    if (!parsedQuery.success) {
      throw new BadRequestAppError("QUERY_TOO_SHORT", searchValidation.SEARCH_QUERY_ERROR, {
        field: "q",
      });
    }

    const appliedPremiumFilters: string[] = [];
    const skillsList = splitCsv(skillsParam);
    if (skillsList && skillsList.length > 0) appliedPremiumFilters.push("skills");
    if (skillsOp) appliedPremiumFilters.push("skills_op");
    if (minExp !== undefined) appliedPremiumFilters.push("min_exp");
    if (maxExp !== undefined) appliedPremiumFilters.push("max_exp");
    if (verifiedOnly !== undefined) appliedPremiumFilters.push("verified_only");

    return this.searchService.searchUsers(
      viewerId,
      plan,
      {
        q: parsedQuery.data,
        intents: splitCsv(intents),
        industry: industry ? Number(industry) : undefined,
        skills: skillsList,
        skillsOp: skillsOp === "or" ? "or" : skillsOp === "and" ? "and" : undefined,
        minExp: minExp !== undefined ? Number(minExp) : undefined,
        maxExp: maxExp !== undefined ? Number(maxExp) : undefined,
        availability,
        verifiedOnly: verifiedOnly === "true",
      },
      appliedPremiumFilters,
    );
  }
}
