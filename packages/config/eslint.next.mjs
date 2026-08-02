import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { moduleBoundaryConfig } from "./eslint.base.mjs";

const nextConfig = [
  {
    ignores: ["**/dist/**", "**/.next/**", "**/.turbo/**", "**/node_modules/**", "**/coverage/**"],
  },
  ...nextVitals,
  ...nextTs,
  moduleBoundaryConfig,
];

export default nextConfig;
