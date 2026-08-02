import { defineConfig } from "eslint/config";
import base from "@convene/config/eslint-base";
import { moduleBoundaryConfig } from "./src/config/module-boundary.eslint.mjs";

export default defineConfig([...base, moduleBoundaryConfig]);
