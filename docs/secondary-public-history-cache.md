# Cache secondaire des résultats publics

Bet2 reste l'unique référence transactionnelle. Cette fonction optionnelle ne stocke que la réponse publique de résultats terminés (au plus 240 matchs), pour 10 secondes. Elle n'archive rien et ne copie ni comptes, ni paris, ni soldes. Une erreur, absence de table ou expiration provoque un repli vers le chemin existant ; l'actualisation manuelle contourne la lecture du cache. Des corrections peuvent mettre jusqu'à 10 secondes à apparaître, en plus des caches existants. Ce cache ne sert jamais au règlement des paris.

Activation à ne réaliser qu'après avoir identifié la destination Bet1 dans la console Neon et vérifié que les métriques et permissions correspondent :
1. Exécuter `migrations/secondary-public-history-cache.sql` **uniquement sur Bet1**. Créer idéalement un rôle qui ne peut lire/écrire que cette table. Ne pas exécuter sur Bet2.
2. Dans Vercel, définir `SECONDARY_HISTORY_URL` comme variable sensible Production contenant l'URL PostgreSQL de Bet1, puis `SECONDARY_HISTORY_CACHE_ENABLED=true`. Ne jamais publier l'URL. Redéployer et contrôler les parcours publics et la disponibilité du repli.
3. Relever avant/après les compteurs de transfert des deux projets sur des périodes et charges comparables. Le remplissage du cache consomme aussi du trafic sur Bet2 ; une économie n'est pas garantie. Désactiver le drapeau et redéployer si besoin.

Le contrôle d'endpoints différents ne prouve pas que deux branches appartiennent à deux projets différents. Le cache est désactivé par défaut. La variable secondaire ne doit pas se terminer par `DATABASE_URL`/`POSTGRES_URL` : ces suffixes sont détectés par le routeur de la base centrale.

Tests : `node --import tsx scripts/test-secondary-history-cache.cjs`, `node --import tsx scripts/test-secondary-history-route.cjs`, `node --import tsx scripts/test-hyperdrive-history-api.cjs`.
