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
