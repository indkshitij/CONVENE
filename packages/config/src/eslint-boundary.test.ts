import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import baseConfig from "../eslint.base.mjs";

async function lint(code: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    baseConfig,
  });
  const [result] = await eslint.lintText(code, { filePath: "fixture.ts" });
  return result?.messages ?? [];
}

describe("module boundary eslint rule (PRD §17.1)", () => {
  it("flags a relative import that reaches from one app into another", async () => {
    const messages = await lint(
      'import { PACKAGE_NAME } from "../../../apps/web/src/index";\nexport {};\n',
    );
    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it("flags a bare-specifier import of an app package", async () => {
    const messages = await lint('import { PACKAGE_NAME } from "@convene/api";\nexport {};\n');
    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it("allows a legal package-to-package import", async () => {
    const messages = await lint('import { PACKAGE_NAME } from "@convene/tokens";\nexport {};\n');
    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(false);
  });
});
