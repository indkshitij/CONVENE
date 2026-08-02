import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { moduleBoundaryConfig } from "../config/module-boundary.eslint.mjs";

async function lint(code: string, filePath: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    baseConfig: [moduleBoundaryConfig],
  });
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages ?? [];
}

// PRD §17.1 acceptance: "a test asserting a cross-module repository import
// fails lint."
describe("module boundary eslint rule (PRD §17.1)", () => {
  it("flags a cross-module repository import", async () => {
    const messages = await lint(
      'import { AuthRepository } from "../auth/auth.repository";\nexport {};\n',
      "src/modules/connections/connections.service.ts",
    );
    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it("allows a cross-module service import", async () => {
    const messages = await lint(
      'import { AuthService } from "../auth/auth.service";\nexport {};\n',
      "src/modules/connections/connections.service.ts",
    );
    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(false);
  });

  it("allows a module importing its own repository", async () => {
    const messages = await lint(
      'import { AuthRepository } from "./auth.repository";\nexport {};\n',
      "src/modules/auth/auth.service.ts",
    );
    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(false);
  });
});
