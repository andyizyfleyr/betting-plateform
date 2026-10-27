const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes("webp")) {
  config.resolver.assetExts.push("webp");
}

module.exports = config;
