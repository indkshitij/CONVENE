import { Body, Controller, Delete, HttpCode, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { profile as profileValidation } from "@convene/validation";
import type { Certification, Education, Experience, PortfolioItem } from "@convene/db";
import { UnauthorizedAppError } from "../../common/errors/app-error";
import { Policy } from "../../common/auth/policy.guard";
import { selfScoped } from "../../common/auth/policies";
import type { AuthContext } from "../../common/auth/auth-context";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  type CertificationCreateInput,
  type CertificationUpdateInput,
  type EducationCreateInput,
  type EducationUpdateInput,
  type ExperienceMutationResult,
  type ExperienceUpdateInput,
  type InterestsReplaceInput,
  type LanguagesReplaceInput,
  type PortfolioItemCreateInput,
  type PortfolioItemUpdateInput,
  ProfileChildrenService,
  type SkillsReplaceInput,
} from "./profile-children.service";

interface RequestLike {
  authContext?: AuthContext;
}

function requireAuthContext(request: RequestLike): AuthContext {
  if (!request.authContext) {
    throw new UnauthorizedAppError("UNAUTHORIZED", "Authentication is required.");
  }
  return request.authContext;
}

// PRD §10.2.9 endpoint 15: "One consistent controller pattern with
// ownership enforced in the repository layer, not only the handler" —
// every route here is `@Policy(selfScoped)` (the caller's own profile,
// always) and every service call is scoped to `userId` from the auth
// context; ProfileChildrenService additionally re-scopes every
// UPDATE/DELETE by `WHERE ... AND user_id = :userId` at the query level.
@Controller("profiles/me")
export class ProfileChildrenController {
  constructor(private readonly profileChildrenService: ProfileChildrenService) {}

  @Put("skills")
  @HttpCode(200)
  @Policy(selfScoped)
  async replaceSkills(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(profileValidation.skillsReplaceSchema)) body: SkillsReplaceInput,
  ): Promise<{ replaced: true }> {
    const { id: userId } = requireAuthContext(request);
    await this.profileChildrenService.replaceSkills(userId, body);
    return { replaced: true };
  }

  @Put("interests")
  @HttpCode(200)
  @Policy(selfScoped)
  async replaceInterests(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(profileValidation.interestsListSchema)) body: InterestsReplaceInput,
  ): Promise<{ replaced: true }> {
    const { id: userId } = requireAuthContext(request);
    await this.profileChildrenService.replaceInterests(userId, body);
    return { replaced: true };
  }

  @Put("languages")
  @HttpCode(200)
  @Policy(selfScoped)
  async replaceLanguages(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(profileValidation.languagesListSchema)) body: LanguagesReplaceInput,
  ): Promise<{ replaced: true }> {
    const { id: userId } = requireAuthContext(request);
    await this.profileChildrenService.replaceLanguages(userId, body);
    return { replaced: true };
  }

  // Validated inside the service, not via a route-level pipe — see
  // ProfileChildrenService.createExperienceValidated's own comment for why
  // (the §10.2.7 start_date floor needs the caller's DOB).
  @Post("experience")
  @HttpCode(201)
  @Policy(selfScoped)
  async createExperience(
    @Req() request: RequestLike,
    @Body() body: unknown,
  ): Promise<ExperienceMutationResult> {
    const { id: userId } = requireAuthContext(request);
    return this.profileChildrenService.createExperienceValidated(userId, body);
  }

  @Patch("experience/:id")
  @HttpCode(200)
  @Policy(selfScoped)
  async updateExperience(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(profileValidation.experienceUpdateSchema))
    body: ExperienceUpdateInput,
  ): Promise<ExperienceMutationResult> {
    const { id: userId } = requireAuthContext(request);
    return this.profileChildrenService.updateExperience(userId, id, body);
  }

  @Delete("experience/:id")
  @HttpCode(204)
  @Policy(selfScoped)
  async deleteExperience(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.profileChildrenService.deleteExperience(userId, id);
  }

  @Post("education")
  @HttpCode(201)
  @Policy(selfScoped)
  async createEducation(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(profileValidation.educationCreateSchema))
    body: EducationCreateInput,
  ): Promise<Education> {
    const { id: userId } = requireAuthContext(request);
    return this.profileChildrenService.createEducation(userId, body);
  }

  @Patch("education/:id")
  @HttpCode(200)
  @Policy(selfScoped)
  async updateEducation(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(profileValidation.educationUpdateSchema))
    body: EducationUpdateInput,
  ): Promise<Education> {
    const { id: userId } = requireAuthContext(request);
    return this.profileChildrenService.updateEducation(userId, id, body);
  }

  @Delete("education/:id")
  @HttpCode(204)
  @Policy(selfScoped)
  async deleteEducation(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.profileChildrenService.deleteEducation(userId, id);
  }

  @Post("certifications")
  @HttpCode(201)
  @Policy(selfScoped)
  async createCertification(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(profileValidation.certificationCreateSchema))
    body: CertificationCreateInput,
  ): Promise<Certification> {
    const { id: userId } = requireAuthContext(request);
    return this.profileChildrenService.createCertification(userId, body);
  }

  @Patch("certifications/:id")
  @HttpCode(200)
  @Policy(selfScoped)
  async updateCertification(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(profileValidation.certificationUpdateSchema))
    body: CertificationUpdateInput,
  ): Promise<Certification> {
    const { id: userId } = requireAuthContext(request);
    return this.profileChildrenService.updateCertification(userId, id, body);
  }

  @Delete("certifications/:id")
  @HttpCode(204)
  @Policy(selfScoped)
  async deleteCertification(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.profileChildrenService.deleteCertification(userId, id);
  }

  @Post("portfolio")
  @HttpCode(201)
  @Policy(selfScoped)
  async createPortfolioItem(
    @Req() request: RequestLike,
    @Body(new ZodValidationPipe(profileValidation.portfolioItemCreateSchema))
    body: PortfolioItemCreateInput,
  ): Promise<PortfolioItem> {
    const { id: userId } = requireAuthContext(request);
    return this.profileChildrenService.createPortfolioItem(userId, body);
  }

  @Patch("portfolio/:id")
  @HttpCode(200)
  @Policy(selfScoped)
  async updatePortfolioItem(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(profileValidation.portfolioItemUpdateSchema))
    body: PortfolioItemUpdateInput,
  ): Promise<PortfolioItem> {
    const { id: userId } = requireAuthContext(request);
    return this.profileChildrenService.updatePortfolioItem(userId, id, body);
  }

  @Delete("portfolio/:id")
  @HttpCode(204)
  @Policy(selfScoped)
  async deletePortfolioItem(@Req() request: RequestLike, @Param("id") id: string): Promise<void> {
    const { id: userId } = requireAuthContext(request);
    await this.profileChildrenService.deletePortfolioItem(userId, id);
  }
}
