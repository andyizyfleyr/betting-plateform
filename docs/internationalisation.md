# Internationalisation progressive

Le catalogue `src/lib/i18n/catalog.ts` est recopié dans `mobile/src/lib/i18n/catalog.ts` pour ne pas dépendre d'un import hors du projet Metro. `node --import tsx scripts/test-i18n-catalog.cjs` impose leur égalité et teste les 39 pays. Le français est la seule langue publiée : les traductions de navigation dans les autres langues ne constituent pas encore une traduction complète.

Le pays ne doit pas verrouiller ou changer la langue : les suggestions sont indicatives et un choix explicite devra rester modifiable. Pays, devise, montants, clés de marchés, codes d'API, identifiants, noms propres et données financières ne doivent jamais être traduits ou modifiés par le système de localisation.

Avant de publier une langue : traduire et relire tous les parcours web et Android, dont connexion/inscription, 18+, CGU, cotes et marchés, coupons, paris/cash-out, erreurs API, paiements, transferts, historiques, messagerie, notifications et administration. Couvrir interpolation, pluriels, dates, nombres, accessibilité, mises en page et RTL (arabe), fallback, langues mixtes et chargement sans secrets ; conserver un vocabulaire métier cohérent et faire valider les textes financiers et juridiques. Tester écran, API, appareil et compatibilité OTA SDK52 sans import natif non disponible sur les APK existants. Une traduction automatique non relue n'est pas une validation juridique ou financière.

La langue doit être stockée séparément de la devise, sans toucher à l'authentification. Ne pas annoncer une langue ou l'activer automatiquement tant que ces critères ne sont pas validés.
