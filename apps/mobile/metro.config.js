const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// This app consumes packages/{types,validation,matching,tokens} (P26.2's
// scaffold plan, §18.8) — those live outside this app's own directory in
// the pnpm workspace, so Metro needs both the extra watch folder and
// node_modules resolution from the workspace root, same as every other
// monorepo-aware Metro config.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: "./global.css" });
