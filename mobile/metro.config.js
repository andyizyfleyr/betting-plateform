const path = require("path");
const Resolver = require("metro-resolver");
const { getDefaultConfig } = require("@expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== "json"
);
if (!config.resolver.assetExts.includes("webp")) {
  config.resolver.assetExts.push("webp");
}
if (!config.resolver.sourceExts.includes("json")) {
  config.resolver.sourceExts.push("json");
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const cleanContext = { ...context, resolveRequest: null };
  if (typeof moduleName === "string" && moduleName.startsWith("@/")) {
    const absTarget = path.resolve(__dirname, "src", moduleName.slice(2));
    return Resolver.resolve(cleanContext, absTarget, platform);
  }
  return Resolver.resolve(cleanContext, moduleName, platform);
};

module.exports = config;
