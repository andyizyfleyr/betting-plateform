# PULSE — Application Android (React Native Expo)

Application mobile **exclusivement Android** (`platforms: ["android"]`) reproduisant à l'identique les composants, couleurs, mises en page et parcours de la version mobile Web tout en consommant les APIs Next.js.

## Démarrage rapide (Android)

```bash
cd mobile
npm install
npx expo start --android
```

Par défaut, l'application consomme `https://be-plateform.vercel.app`. Pour cibler une autre URL d'API Next.js :

```bash
EXPO_PUBLIC_API_URL=https://be-plateform.vercel.app npx expo start --android
```

## Build APK Natif Android Production (Expo EAS / Codemagic)

```bash
cd mobile
# APK natif Production signé (Hermes AOT, ARM compressé ~24 Mo) :
npx eas-cli build --platform android --profile production

# APK interne Preview :
npx eas-cli build --platform android --profile preview
```

## Optimisations intégrées (Client Android & APIs Next.js)

- **Authentification hybride sécurisée** : cookie `HttpOnly` conservé sur Web + jeton `Authorization: Bearer <jwt>` stocké dans Android Keystore (`expo-secure-store`) avec miroir RAM `0 ms`.
- **Flux allégé `GET /api/matches/slim` (~88 % d'octets en moins)** : mutualisé au CDN Edge Vercel (`s-maxage=5, stale-while-revalidate=8`), Singleflight serveur, et chargement à la demande des marchés détaillés via `GET /api/matches/[id]`.
- **Démarrage à froid en 1 requête (`GET /api/mobile/bootstrap`)** : agrège `{ user, pendingCount, myPredictionBets, providers }` en un seul aller-retour HTTPS.
- **Validation conditionnelle `ETag` + `If-None-Match` (`304 Not Modified`)** et **Client Singleflight** sur toutes les lectures.
- **Cache Stale-While-Revalidate `0 ms` (RAM + `AsyncStorage`)** + **assets Hero & Mini-jeux embarqués localement**.
- **Planificateur `AppState` & Mode économie 3G** : mise en pause automatique de 100 % du polling en arrière-plan, reprise instantanée au premier plan et pagination infinie 10 par 10 (`FlatList` virtualisée).

### Notifications push Android

Les notifications système exigent un **nouvel APK** contenant `expo-notifications` et une configuration Firebase Cloud Messaging (FCM v1). Les anciennes APK compatibles OTA continuent de fonctionner sans le module natif et affichent une indication d'installation si l'utilisateur tente d'activer les push.

Configurer dans le fournisseur de build (EAS ou Codemagic), sans placer de secrets dans Git :

1. Le projet Expo/EAS associé à l'application et `EXPO_PUBLIC_EAS_PROJECT_ID` (identifiant public du projet).
2. Un projet Firebase pour le paquet Android `app.pulsebets.android`. Pour Codemagic, créer le groupe `firebase_credentials` et y enregistrer le contenu complet de `google-services.json` dans la variable sécurisée `FIREBASE_GOOGLE_SERVICES_JSON`. Le script prépare le fichier ignoré par Git et transmet son chemin à Expo. Pour EAS, fournir le fichier par variable de type fichier et définir `GOOGLE_SERVICES_JSON` sur son chemin.
3. La clé de service FCM v1 dans les identifiants push du projet EAS, via le gestionnaire de credentials Expo. Ne pas copier cette clé dans le dépôt.
4. Construire et installer l'APK 1.2.6 ou ultérieur, autoriser les notifications, puis tester la réception sur un appareil physique. Un build sans fichier Firebase ou sans identifiant EAS ne permet pas les push.
5. Un déclencheur régulier de `/api/cron/tick` est nécessaire lorsque personne n'ouvre l'application ; la fréquence du déclencheur détermine le délai des alertes hors ligne. Les événements actifs déclenchent aussi une tentative en arrière-plan. Les reçus Expo indiquent l'acceptation par Expo, pas une garantie de livraison sur le téléphone.

La biométrie utilise le Keystore via `expo-secure-store` : seul le jeton de session est protégé, jamais le mot de passe. En cas d'annulation, de changement de biométrie ou d'expiration de session, une reconnexion par mot de passe reste possible. La déconnexion invalide la session biométrique.
