# Mesure du transfert Neon et cache public

Les réponses publiques matchs, détail actif, résultats et catalogue de prédictions
utilisent le CDN Vercel avec respectivement 10, 10, 15 et 15 secondes de fraîcheur.
Une revalidation en arrière-plan et les purges par tag existantes restent actives.
Le refresh explicite `?refresh=1` et les URL à cache-buster ne sont pas stockés.
Les réponses authentifiées restent privées. Les validations de paris continuent de
se faire côté serveur ; le cache d'affichage ne constitue pas une cote garantie.

## Mesure réelle

Avant déploiement, relever dans Neon Billing le transfert public et l'horodatage,
puis à nouveau après 24 h. Après déploiement, répéter sur une période représentative
comparable (visiteurs, direct, tâches planifiées et exports). Comparer les Go/jour,
et si possible normaliser par nombre de visites et de requêtes. Les exports et la
réplication consomment aussi du transfert ; noter leur fréquence. Vérifier les
métriques CDN Vercel (hits/misses, région et route) et les erreurs API, latences,
retards d'affichage et recotations. Les caches sont répartis par région et peuvent
être purgés ; ils ne garantissent pas une seule lecture globale pour 1 000 clients.
La consommation réelle n'est pas observable depuis le dépôt.

## Test reproductible

`npx tsx scripts/test-public-cache.ts` vérifie les en-têtes publics/privés,
ETag et rafraîchissement. La simulation (6 000 requêtes en une minute, un seul
cache, sans purge ni refresh) prédit 60 appels origine à TTL 1 s contre 6 à TTL
10 s. Ce modèle ne mesure ni le trafic réel ni les octets Neon, et une réponse
origine peut entraîner plusieurs requêtes SQL.

## Limites et suites

La pagination complète des historiques financiers doit préserver les anciennes APK,
les détails et les filtres ; le endpoint paris limite encore les historiques réglés.
L'archivage nécessite un plan de restauration et des tests des anciens paris avant
migration. Les clients récents négocient des deltas WebSocket ; les anciennes APK conservent
les snapshots complets. Le cron
actuel n'est pas une source live unique garantie ; le polling de repli reste en
place. Ces travaux, ainsi que les mesures de production et la région effective
Vercel/Neon, ne sont pas couverts par cette optimisation initiale.

## Stockage client actuel

Le mobile purge l'ancien snapshot live et le profil incluant le solde. Seuls les
résultats terminés récents sont persistés en AsyncStorage (aperçu de 24 h, à
revalider). Les sélections du coupon restent persistées sans leur cote ; après
restauration, le placement est bloqué tant que les cotes ne sont pas récupérées.
Le jeton reste dans SecureStore. Sur le web, seul l'identifiant indicatif est gardé,
pas le solde ; le service worker n'intercepte que des images publiques locales.

SQLite, MMKV, expo-image, IndexedDB, la synchronisation incrémentale avec tombstones
et la pagination/archivage des données privées ne sont pas encore implémentés.
Les anciennes APK ne contiennent pas nécessairement ces modules natifs : leur ajout
exige un nouveau binaire ou une compatibilité optionnelle prouvée. Un `updated_at`
seul ne suffit pas : mises à jour atomiques et suppressions doivent aussi être
propagées, et les corrections de règlements ne peuvent pas être supposées immuables.


## Temps réel

Le Worker envoie une copie initiale puis des matchs entiers modifiés, avec un
numéro de séquence et une liste ordonnée des identifiants. Un client qui détecte
un trou demande une copie complète et garde le repli HTTP. Les anciennes APK et
les anciens Workers continuent à échanger des snapshots. Le Worker reçoit encore
le snapshot complet de `/api/realtime/tick` ; cette optimisation réduit surtout le
trafic Worker → clients et ne mesure ni ne garantit une baisse des octets Neon.

## Pagination des paris (API opt-in)

`GET /api/bets?filter=finished&pageSize=20` renvoie au maximum 20 paris et
`nextCursor` pour la page suivante. Ce curseur comprend la date de règlement,
la date de placement, le type et l'identifiant, avec les microsecondes PostgreSQL.
Il est validé et la recherche reste systématiquement limitée au joueur authentifié.
Sans `pageSize`, l'ancien comportement est inchangé pour les anciennes APK.
Les interfaces web et mobile utilisent ce contrat et demandent les pages
suivantes au défilement. Les recherches et filtres chargent les pages restantes
pour rester exacts ; les compteurs globaux sont masqués tant que la liste est
incomplète. Ce mode filtré peut donc transférer tout l'historique. La migration `migrations/bet-history-indexes.sql` doit être
exécutée séparément hors transaction et contrôlée avant usage à grande échelle.
Les changements de statut et corrections concomitantes peuvent modifier l'ordre ;
un rafraîchissement doit réinitialiser les pages.

La recherche des clés est limitée séparément dans chaque table avant la fusion.
Les matchs associés aux jambes déjà réglées d'un combiné sont chargés avec une
projection scalaire, sans `events`, `markets` ni autres JSON volumineux. Les jambes
encore en cours conservent le chargement complet nécessaire au cash-out et à la
résolution. Le test API PGlite vérifie la projection sur un combiné réglé ; il ne
remplace pas une mesure sur Neon ni les tests financiers de bout en bout.

## Rafraîchissement des écrans Mes paris

Les écrans web et mobile séparent désormais les requêtes des paris actifs et
réglés : les actifs conservent leur cadence live, les réglés sont revalidés au
retour au premier plan, après événement utilisateur, rafraîchissement manuel ou
disparition d'un pari actif. Les listes
sont fusionnées en mémoire et les données financières ne sont pas persistées.
Cette séparation évite de transférer les paris réglés à chaque polling live,
et les écrans récents chargent les historiques par pages de 20. Les anciennes
APK gardent le contrat historique limité à 60 éléments par type.

## Diagnostic ponctuel des colonnes du cache de matchs

`NEON_TRANSFER_PROFILE=sample-v1` active uniquement sur Vercel Production une
sonde en lecture seule pendant le prébuild. Elle agrège, sans noms ni identifiants,
la taille PostgreSQL de cinq colonnes JSON pour au plus 120 matchs actifs et
32 terminés, selon les mêmes limites et ordre que l'hydratation. La sonde est
inactive par défaut et échoue fermement si elle est activée hors Production.
Ces tailles sont des tailles de stockage PostgreSQL (possiblement compressées),
**pas** des octets transférés sur le réseau ni un relevé de facturation Neon.
Elles servent à cibler les futures projections ; elles ne justifient pas de
supprimer une colonne ou de changer les données exposées sans tests de parité.
Retirer la variable après utilisation. Test : `npm run test:neon-transfer-profile`.
