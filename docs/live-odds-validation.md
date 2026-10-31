# Validation des cotes live réelles

La date de réception du flux et le chrono ne prouvent pas la date de publication d'une cote. L'ancrage 1X2 ne prend en compte que les signaux munis d'une date de mise à jour fournie par la source, datant de 4 minutes maximum, et associés au score courant. Sans date exploitable, le modèle interne sert de repli : ce n'est pas une cote bookmaker vérifiée. Une date indiquée par un fournisseur ne garantit pas à elle seule que ses données sont correctes.

Les marchés dépendant de la mi-temps et du premier but sont fermés si les faits nécessaires ne sont pas connus ; les paris déjà placés et les données ne sont pas supprimés. Un score de mi-temps officiel doit être entier, non négatif et compatible avec le score courant. À 0–0, le score de mi-temps est nécessairement 0–0.

## Comparaison hors ligne

`node scripts/compare-live-odds.cjs chemin/echantillons.json` lit un tableau de paires `ours` et `reference`. Chaque instantané doit contenir `timestamp` (ISO), `match`, `period`, `score`, `minute` (entier), `market`, `line` (nombre, chaîne ou null), `partition: true` et `odds` (objet issue → cote décimale). Les issues doivent être exhaustives, mutuellement exclusives, sans remboursement ni handicaps asiatiques. Ne pas appliquer cette normalisation à la double chance, aux lignes avec push, ni aux marchés partiels.

Les identifiants, période, score, marché, ligne et clés des issues doivent être identiques ; les captures doivent être séparées de 30 secondes au plus et d'une minute de jeu au plus. Les paires non comparables sont comptées dans `skipped`. Le résultat montre les sommes des inverses des cotes et les écarts de probabilités normalisées en points de pourcentage : ce n'est ni une mesure de précision prédictive, ni une preuve de rentabilité. Conserver les données collectées privées et respecter les droits et conditions d'utilisation du fournisseur.

Une calibration requiert des archives horodatées fiables, des résultats vérifiés, des jeux d'entraînement et de validation temporellement séparés, ainsi qu'une revue des limites, de la latence, de l'affichage, des mises et du Cash Out. Aucune équivalence avec un autre bookmaker n'est garantie.
