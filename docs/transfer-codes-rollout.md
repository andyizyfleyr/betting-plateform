# Codes de transfert — déploiement

Les écrans web et Android utilisent `/api/transfer-codes`. Le service est fermé par défaut : l'environnement serveur doit définir `TRANSFER_CODES_ENABLED=true` et `TRANSFER_CODE_SECRET`, clé dédiée de 32 octets aléatoires encodée en 64 caractères hexadécimaux. Ne pas utiliser le secret JWT ni versionner cette clé. La conserver durablement : la changer sans migration des empreintes rendrait les codes existants inutilisables.

La migration est exécutée automatiquement à la première requête authentifiée lorsque le service est activé, avec verrou transactionnel PostgreSQL et marqueur dédié ; `migrations/transfer-codes.sql` documente le même schéma pour les déploiements manuels. Ne jamais supprimer les tables pour revenir en arrière après création de codes : elles contiennent les réservations et leur audit.

Le code n'est pas conservé en clair et ne peut pas être affiché une seconde fois. Si la réponse de création est perdue, l'utilisateur peut retrouver la réservation et l'annuler dans l'historique. Un même essai de création ou de dépôt peut être repris avec la même clé d'idempotence, sans nouveau débit ni nouveau crédit. La limite minimum/maximum reprend les paramètres de limites administrables et leur conversion par devise.

Tests :
- `node --import tsx scripts/test-transfer-code.cjs` : génération, HMAC et Luhn ;
- `node --import tsx scripts/test-transfer-engine.cjs` et `node --import tsx scripts/test-transfer-api.cjs` : parcours sur PGlite isolé ;
- `node --import tsx scripts/test-transfer-postgres.cjs` : concurrence sur serveur PostgreSQL local isolé, via le socket `/home/user/pgtemp` port 55432 ; le script crée puis supprime uniquement son propre schéma aléatoire. Ce test ne se connecte jamais à la base de production.

L'export OTA reste compatible avec les APK qui ne contiennent pas le module caméra : elles reçoivent un message invitant à coller le code. Le scan natif nécessite un nouvel APK intégrant `expo-camera` et la permission caméra ; l'OTA seule ne peut pas ajouter ce module. Le scan web dépend du support `BarcodeDetector` du navigateur et propose sinon la saisie ou le collage.
