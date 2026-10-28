const {
  AndroidConfig,
  withGradleProperties,
} = require("expo/config-plugins");

/**
 * Plugin Expo SDK 52 de durcissement pour le build APK Android Production (EAS Build & Codemagic) :
 * - Alloue 4 Go de heap JVM + 1 Go Metaspace à Gradle/Kotlin/D8 pour éviter tout OOM en release.
 * - Active la compilation parallèle Gradle (`org.gradle.parallel=true`).
 * - Cible uniquement les architectures mobiles ARM physiques (`armeabi-v7a,arm64-v8a`) au lieu d'inclure x86/x86_64.
 * - Compresse les bibliothèques natives `.so` (`expo.useLegacyPackaging=true`) afin de réduire le poids de l'APK final (~24 Mo au lieu de ~58 Mo).
 * - Garantit l'activation explicite du moteur bytecode AOT Hermes (`hermesEnabled=true`).
 */
function withPulseAndroidRelease(config) {
  return withGradleProperties(config, (modConfig) => {
    const props = modConfig.modResults;
    const { updateAndroidBuildProperty } = AndroidConfig.BuildProperties;

    updateAndroidBuildProperty(
      props,
      "org.gradle.jvmargs",
      "-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8"
    );
    updateAndroidBuildProperty(props, "org.gradle.parallel", "true");
    updateAndroidBuildProperty(
      props,
      "reactNativeArchitectures",
      "armeabi-v7a,arm64-v8a"
    );
    updateAndroidBuildProperty(props, "expo.useLegacyPackaging", "true");
    updateAndroidBuildProperty(props, "hermesEnabled", "true");

    modConfig.modResults = props;
    return modConfig;
  });
}

module.exports = withPulseAndroidRelease;
