const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Configuration Expo SDK 52 compatible à la fois :
 * - avec Expo EAS Cloud Build (`EAS_BUILD_PROJECT_ID` injecté automatiquement par le worker EAS,
 *   ou `EXPO_PUBLIC_EAS_PROJECT_ID` défini dans les variables d'environnement du projet Expo),
 * - avec Codemagic (`npx expo prebuild --platform android`),
 * - et avec l'export OTA statique (`npx expo export --platform android`).
 */
module.exports = ({ config }) => {
  const candidateId = (
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    process.env.EAS_PROJECT_ID ||
    process.env.EAS_BUILD_PROJECT_ID ||
    config?.extra?.eas?.projectId ||
    ""
  ).trim();

  const validEasProjectId =
    UUID_RE.test(candidateId) &&
    candidateId !== "00000000-0000-0000-0000-000000000000"
      ? candidateId
      : null;

  const resolvedApiBaseUrl = (
    process.env.EXPO_PUBLIC_API_URL ||
    config?.extra?.apiBaseUrl ||
    "https://be-plateform.vercel.app"
  ).replace(/\/$/, "");

  const resolvedUpdatesUrl =
    process.env.EXPO_PUBLIC_UPDATES_URL ||
    config?.updates?.url ||
    `${resolvedApiBaseUrl}/api/expo`;

  const resolvedUpdatesChannel =
    process.env.EXPO_PUBLIC_UPDATES_CHANNEL ||
    config?.updates?.requestHeaders?.["expo-channel-name"] ||
    "production";

  const nextExtra = {
    ...(config.extra || {}),
    apiBaseUrl: resolvedApiBaseUrl,
    partykitHost:
      process.env.EXPO_PUBLIC_PARTYKIT_HOST ||
      config?.extra?.partykitHost ||
      "pulse-bet.matiasanauld.workers.dev",
  };

  if (validEasProjectId) {
    nextExtra.eas = {
      ...(config?.extra?.eas || {}),
      projectId: validEasProjectId,
    };
  }

  return {
    ...config,
    owner: config.owner || "andyizyfleur",
    slug: config.slug || "pulsebets-android",
    platforms: ["android"],
    jsEngine: "hermes",
    runtimeVersion: config.runtimeVersion || "pulse-sdk52-v1",
    updates: {
      enabled: true,
      checkAutomatically: "ALWAYS",
      fallbackToCacheTimeout: 0,
      ...(config.updates || {}),
      url: resolvedUpdatesUrl,
      requestHeaders: {
        ...(config?.updates?.requestHeaders || {}),
        "expo-channel-name": resolvedUpdatesChannel,
      },
    },
    extra: nextExtra,
  };
};
