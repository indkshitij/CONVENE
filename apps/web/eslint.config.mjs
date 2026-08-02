import { defineConfig, globalIgnores } from "eslint/config";
import nextConfig from "@convene/config/eslint-next";

export default defineConfig([
  ...nextConfig,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
