const {
  AndroidConfig,
  withAndroidStyles,
  withGradleProperties,
} = require("expo/config-plugins");

/**
 * Plugin Expo SDK 52 de durcissement pour le build APK Android Production (EAS Build & Codemagic) :
 * - Alloue 4 Go de heap JVM + 1 Go Metaspace à Gradle/Kotlin/D8 pour éviter tout OOM en release.
 * - Active la compilation parallèle Gradle (`org.gradle.parallel=true`).
 * - Cible uniquement les architectures mobiles ARM physiques (`armeabi-v7a,arm64-v8a`) au lieu d'inclure x86/x86_64.
 * - Compresse les bibliothèques natives `.so` (`expo.useLegacyPackaging=true`) afin de réduire le poids de l'APK final (~24 Mo au lieu de ~58 Mo).
 * - Garantit l'activation explicite du moteur bytecode AOT Hermes (`hermesEnabled=true`).
 * - Splash unique (Option 1) : force `windowSplashScreenAnimatedIcon` à `@android:color/transparent`
 *   sur fond `#090D16` dans `Theme.App.SplashScreen` (Android 12+) afin qu'aucune icône OS réduite ne
 *   s'affiche avant `<PulseSplashScreen />` (un seul splash plein écran haute définition).
 */
function withPulseSingleSplash(config) {
  return withAndroidStyles(config, (modConfig) => {
    const { assignStylesValue } = AndroidConfig.Styles;
    const splashParent = {
      name: "Theme.App.SplashScreen",
      parent: "Theme.SplashScreen",
    };

    let xml = modConfig.modResults;
    xml = assignStylesValue(xml, {
      add: true,
      parent: splashParent,
      name: "windowSplashScreenBackground",
      value: "@color/splashscreen_background",
    });
    xml = assignStylesValue(xml, {
      add: true,
      parent: splashParent,
      name: "windowSplashScreenAnimatedIcon",
      value: "@android:color/transparent",
    });
    xml = assignStylesValue(xml, {
      add: false,
      parent: splashParent,
      name: "windowSplashScreenIconBackgroundColor",
      value: "",
    });

    modConfig.modResults = xml;
    return modConfig;
  });
}

function withPulseAndroidRelease(config) {
  let nextConfig = withGradleProperties(config, (modConfig) => {
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

  nextConfig = withPulseSingleSplash(nextConfig);
  return nextConfig;
}

module.exports = withPulseAndroidRelease;
