import { Injectable, type PipeTransform } from "@nestjs/common";
import { z } from "zod";
import { ValidationAppError } from "../errors/app-error";

// PRD §17.9: "ZodValidationPipe rejects unknown fields (strict())." Applied
// per-route via @UsePipes(new ZodValidationPipe(someSchema)).
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodTypeAny) {}

  transform(value: unknown): unknown {
    const schema = this.schema instanceof z.ZodObject ? this.schema.strict() : this.schema;
    const result = schema.safeParse(value);

    if (!result.success) {
      const firstIssue = result.error.issues[0];
      throw new ValidationAppError("VALIDATION_FAILED", "The request could not be validated.", {
        field: firstIssue ? firstIssue.path.join(".") : null,
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}
