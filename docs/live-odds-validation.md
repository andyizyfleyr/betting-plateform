# Validation des cotes live réelles

La date de réception du flux et le chrono ne prouvent pas la date de publication d'une cote. L'ancrage 1X2 ne prend en compte que les signaux munis d'une date de mise à jour fournie par la source, datant de 4 minutes maximum, et associés au score courant. Sans date exploitable, le modèle interne sert de repli : ce n'est pas une cote bookmaker vérifiée. Une date indiquée par un fournisseur ne garantit pas à elle seule que ses données sont correctes.

Les marchés dépendant de la mi-temps et du premier but sont fermés si les faits nécessaires ne sont pas connus ; les paris déjà placés et les données ne sont pas supprimés. Un score de mi-temps officiel doit être entier, non négatif et compatible avec le score courant. À 0–0, le score de mi-temps est nécessairement 0–0.

## Comparaison hors ligne

`node scripts/compare-live-odds.cjs chemin/echantillons.json` lit un tableau de paires `ours` et `reference`. Chaque instantané doit contenir `timestamp` (ISO), `match`, `period`, `score`, `minute` (entier), `market`, `line` (nombre, chaîne ou null), `partition: true` et `odds` (objet issue → cote décimale). Les issues doivent être exhaustives, mutuellement exclusives, sans remboursement ni handicaps asiatiques. Ne pas appliquer cette normalisation à la double chance, aux lignes avec push, ni aux marchés partiels.

Les identifiants, période, score, marché, ligne et clés des issues doivent être identiques ; les captures doivent être séparées de 30 secondes au plus et d'une minute de jeu au plus. Les paires non comparables sont comptées dans `skipped`. Le résultat montre les sommes des inverses des cotes et les écarts de probabilités normalisées en points de pourcentage : ce n'est ni une mesure de précision prédictive, ni une preuve de rentabilité. Conserver les données collectées privées et respecter les droits et conditions d'utilisation du fournisseur.

Une calibration requiert des archives horodatées fiables, des résultats vérifiés, des jeux d'entraînement et de validation temporellement séparés, ainsi qu'une revue des limites, de la latence, de l'affichage, des mises et du Cash Out. Aucune équivalence avec un autre bookmaker n'est garantie.

## Observation ESPN (lecture seule)

Le workflow GitHub Actions « Observation des cotes live (manuelle) » prend jusqu'à cinq identifiants `ligue:id` séparés par des virgules, pour 1 à 60 mesures espacées de 15 à 300 secondes. Les résultats sont conservés en artefact GitHub pendant sept jours ; il n'est ni programmé en permanence ni relié à la cotation, aux paris ou à des données utilisateur. En local : `node scripts/observe-espn-live.cjs eng.1:401879248 observations.live-odds.jsonl 20 30`. Résumé : `node scripts/analyze-espn-observations.cjs observations.live-odds.jsonl`.

Chaque tour lit le score avant et après les cotes et rejette la capture si score, période ou état changent. Une identité d'équipe différente est rejetée. Les horodatages de collecte ne prouvent pas que les cotes ont été mises à jour chez le bookmaker. Le résumé des incidents ne mesure pas le délai exact d'une action : les moments intermédiaires sont inconnus. Une cote inchangée ne suffit pas à la déclarer périmée. Vérifier autorisations, limites et conditions de réutilisation avant toute exploitation.

Pour évaluer hors ligne des cotes 1X2 complètes après règlement, `node scripts/evaluate-live-calibration.cjs donnees.json 2026-10-01T00:00:00Z` accepte un tableau d'objets `match`, `capturedAt`, `resultAt`, `outcome` (`home`, `draw`, `away`), `modelOdds` et `referenceOdds` (objets numériques contenant ces trois clés). La sortie donne log-loss et Brier, avec poids égal par match et séparation temporelle, et refuse un match présent des deux côtés de la coupure. Il ne règle aucun coefficient et ne valide pas des instantanés non synchronisés ou des résultats non vérifiés. Il faut collecter séparément les paires compatibles et les scores officiels.
