# Pilote Hyperdrive : résultats publics

Le Worker `pulse-bet` se connecte à la configuration Hyperdrive de production
via le binding `HYPERDRIVE`. Le bloc `previews` ne fournit aucun binding
Hyperdrive : une preview répond 503 au lieu de se connecter à Neon production.
La configuration utilise l'URL directe Neon saisie dans Cloudflare ; aucun
secret PostgreSQL n'est stocké dans le dépôt ou exposé au navigateur.

`GET /public/hyperdrive/results` est une route pilote indépendante : au plus
20 matchs terminés, champs publics seulement, aucune donnée de joueur ni cote.
Elle ne modifie pas les endpoints actuels, ne remplace pas le calendrier ou
l'historique actuel, et n'est pas encore utilisée par les clients web/mobile.
Le Worker met en cache les réponses réussies pendant 30 secondes via Cache API ;
les erreurs ne sont pas mises en cache et renvoient 503 sans détail. Hyperdrive
est configuré sans cache de requêtes : l'économie éventuelle vient ici du cache
public du Worker. Les corrections de résultats peuvent apparaître avec 30 s de
retard sur cette route. Aucune opération financière ne passe par Hyperdrive.

Vérifier la route, la connexion, les métriques Hyperdrive et le trafic sortant
Neon avant/après sur une période comparable ; ne pas déduire les économies du
seul fonctionnement de cette route. Une fois la mesure satisfaisante, étudier
la migration progressive d'une vraie route publique avec conservation du
contrat de réponse et retour arrière ; garder auth, soldes, paris, paiements et
cotes temps réel sur leur parcours actuel. Le plan Workers Free limite les
requêtes Hyperdrive : surveiller le quota quotidien et prévoir le repli avant
de transférer du trafic applicatif. Les previews doivent rester isolées de la
base de production. Le retour arrière consiste à ne plus appeler la route et,
si nécessaire, retirer son binding lors d'un déploiement suivant.
