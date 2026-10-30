# R2 : médias publics et OTA

## Périmètre

Le script `scripts/r2-public.cjs` inventorie et copie uniquement les médias de
`public/images`, `public/brand`, `public/icons`, `public/expo-sdk52`, les trois
MP3 publics, l'APK, le favicon et l'image de partage. Il n'envoie ni `.env`, ni
service worker, ni données utilisateurs ; il ne supprime jamais d'objet R2.
Les fichiers OTA dont le nom contient une empreinte sont immuables et un contenu
différent sous la même clé provoque une erreur. L'export OTA conserve désormais
les anciens bundles et vérifie les collisions de noms.

Cette intégration ne déplace pas les paris, transactions, messages ou données
personnelles, ne met pas en place de bucket privé ni ne réduit à elle seule les
lectures Neon. L'archivage privé exige un index autorisé, une politique de
conservation/restauration et la modification des parcours de lecture avant
suppression éventuelle des données PostgreSQL. Ne jamais envoyer de données
privées dans le bucket public.

## Préparation Cloudflare

1. Créer un bucket R2 dédié aux fichiers publics et lui associer un domaine
   personnalisé HTTPS. Éviter le domaine de développement `r2.dev` pour la
   production. Configurer le cache Cloudflare et vérifier les en-têtes/mime.
2. Créer un jeton S3 R2 limité à ce seul bucket avec droits de lecture/écriture
   et lecture des objets (nécessaires aux vérifications). Ne pas partager la clé
   en conversation, ne pas la committer et ne pas la mettre dans `NEXT_PUBLIC_`.
3. Renseigner côté machine d'administration ou CI sécurisée `R2_ACCOUNT_ID`,
   `R2_PUBLIC_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Le script
   se sert de l'endpoint R2 calculé à partir de l'ID du compte. Ces credentials
   ne sont pas nécessaires au serveur web pour servir les médias publics.
4. Sur la machine d'administration, installer les dépendances avec
   `npm ci --include=dev` puis exécuter :

```sh
npm run r2:inventory
node scripts/r2-public.cjs --upload --only=web
node scripts/r2-public.cjs --verify --only=web
# Ajouter R2_PUBLIC_VERIFY_ORIGIN=https://<domaine-public> dans l'environnement
node scripts/r2-public.cjs --verify-public --only=web
node scripts/r2-public.cjs --upload --only=ota-current
node scripts/r2-public.cjs --verify --only=ota-current
node scripts/r2-public.cjs --verify-public --only=ota-current
```

Les commandes `--verify` téléchargent et comparent SHA-256 et Content-Type via
l'API S3 ; `--verify-public` compare également les octets et le type via le
vrai domaine public. Elles consomment du trafic et des opérations R2. Pour les
liaisons lentes, les sélections `--only=web`, `--only=ota-current` et
`--only=ota-all` permettent de fractionner. Sans sélection, tous les fichiers
sont traités. Pour copier les anciens bundles en plus :

```sh
node scripts/r2-public.cjs --upload --only=ota-all
node scripts/r2-public.cjs --verify --only=ota-all
node scripts/r2-public.cjs --verify-public --only=ota-all
```

Les anciennes URL Vercel restent servies ; copier les anciens fichiers ne doit
pas être utilisé comme prétexte pour les supprimer ou couper ces URL.

## Activation progressive et retour arrière

Après vérification publique uniquement :

- Définir `NEXT_PUBLIC_R2_PUBLIC_ORIGIN=https://<domaine-public>` dans Vercel
  puis redéployer le web. C'est une variable publique intégrée au build. Elle
  bascule les images hero et jeux, les sons, les icônes du manifeste et les
  métadonnées concernées. Les assets React Native embarqués restent disponibles.
- Définir séparément `R2_OTA_ASSETS_ORIGIN=https://<domaine-public>` pour les
  seuls bundles et assets du manifeste `/api/expo`. Avant chaque nouveau
  déploiement OTA, téléverser et vérifier les nouveaux fichiers. Le endpoint
  `/api/expo`, son runtime et les anciennes URL demeurent inchangés.
- Avant chaque changement, tester le chargement réel sur navigateur et appareil,
  y compris Expo Go et une ancienne APK. Un retour arrière consiste à vider les
  deux variables et redéployer ; les fichiers originaux restent dans `public`.

Seules les origines HTTPS sans identifiants, chemin, query ou fragment sont
acceptées. Une origine invalide revient au chemin existant. Une origine valide
mais indisponible ne déclenche pas automatiquement un retour arrière : vérifier
le bucket et les URL *avant* activation et surveiller leur disponibilité. Les
origines doivent être contrôlées par l'opérateur ; ne pas servir les assets OTA
depuis un domaine non fiable.

Le service worker demeure sur le domaine de l'application. Les logos externes
des clubs ne sont pas copiés par ce script : vérifier leurs droits d'utilisation
et leur provenance avant toute importation. Le domaine public R2 doit être séparé
de tout futur stockage privé. Surveiller coûts et quotas (stockage, requêtes et
trafic de l'éventuel proxy) ainsi que les octets sortants Neon avant et après.

## Envoi depuis GitHub Actions

Le workflow manuel `Synchroniser les médias publics R2` cible exclusivement le
bucket `pulsebet-public` du compte configuré et son URL de développement. Il
requiert deux secrets de dépôt : `R2_PUBLIC_ACCESS_KEY_ID` et
`R2_PUBLIC_SECRET_ACCESS_KEY`. Utiliser un jeton R2 limité au seul bucket
public, sans accès au bucket privé, puis enregistrer ses clés dans les secrets
GitHub. Ne jamais envoyer ces valeurs dans une conversation. Le workflow
n'effectue aucune suppression, vérifie les octets via S3 puis l'URL publique,
et ne bascule pas automatiquement la production sur `r2.dev`. Il doit exister
sur la branche par défaut pour être lancé manuellement.

## Envoi ponctuel avec les variables Vercel

Le pré-build accepte `R2_SYNC_ON_BUILD=public-v1` uniquement pour un build
Vercel de production, et seulement si le compte et le bucket correspondent au
bucket public prévu. Il téléverse les médias web et l'OTA courante puis vérifie
leurs empreintes et types via S3 et le domaine de test. Il ne lit aucun bucket
privé et ne supprime aucun objet. Une erreur interrompt le build pour éviter
une activation partielle. Après exécution contrôlée, supprimer ce drapeau pour
ne pas relancer l'opération à chaque déploiement. Il ne configure pas les URL
du site et n'active pas `r2.dev` comme origine de production. Les clés restent
des variables sensibles Vercel ; ne pas les recopier dans les logs ou le chat.

## Prototype d'archives privées : copie manuelle, aucun effacement

`scripts/r2-private-archive.cjs` est un outil d'opérateur distinct du site. Il
copie les lignes **réglées et datées** des trois tables de paris d'un utilisateur
avant une date donnée. Il ne copie ni transactions, ni messages, ni profil, ni
les données liées des matchs/questions : **ce n'est pas une sauvegarde complète**.
Il ne modifie pas Neon, ne déplace pas les lignes, ne raccorde pas la lecture de
l'historique au bucket et ne réduit donc pas le trafic Neon. Il ne s'exécute pas
automatiquement ni pendant les builds. Ne pas supprimer les données d'origine.

La copie utilise une transaction PostgreSQL en lecture seule et un chiffrement
AES-256-GCM avec nonce aléatoire. La clé d'objet est aléatoire ; l'objet est
relu, comparé puis déchiffré avant de signaler la réussite. Les données restent
sensibles, y compris dans un fichier restauré. La clé doit être dédiée,
aléatoire et conservée dans une sauvegarde sécurisée séparée : sa perte rend
les archives illisibles. Prévoir sauvegarde, rotation versionnée et politique
légale de conservation avant une utilisation durable.

Sur un environnement d'opérateur sécurisé, installer les dépendances de dev et
renseigner `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_PRIVATE_BUCKET=pulsebet`,
`R2_PRIVATE_ACCESS_KEY_ID`, `R2_PRIVATE_SECRET_ACCESS_KEY` et
`R2_ARCHIVE_ENCRYPTION_KEY` (64 caractères hexadécimaux). Utiliser un jeton
R2 distinct limité au bucket privé ; les clés du bucket public ne garantissent
pas cet accès. Ne jamais enregistrer ces secrets dans le dépôt ni les journaux.

```sh
node scripts/r2-private-archive.cjs --copy-user ID_UTILISATEUR AAAA-MM-JJ
node scripts/r2-private-archive.cjs --restore-file archives/v1/IDENTIFIANT.json.enc chemin-prive.json
node scripts/test-r2-private-archive.cjs
```

La date est exclusive. Le script refuse plus de 100 lignes par table ou 8 Mio
par copie plutôt que de tronquer silencieusement. La commande de restauration
crée un fichier privé sans écraser un fichier existant ; elle ne réinjecte pas
les données dans PostgreSQL. Stocker et supprimer ce fichier selon la politique
locale de sécurité. Une coupure réseau après l'écriture peut laisser un objet
orphelin : un message d'échec ne prouve pas son absence. Aucune suppression
automatique d'objets n'est effectuée. Les tests fournis utilisent PGlite et un
R2 simulé ; ils ne prouvent ni les permissions du bucket réel, ni la restauration
dans Neon, ni l'intégration aux écrans utilisateurs.
