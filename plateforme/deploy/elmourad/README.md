# El Mourad — installer le site sur le VPS

Un site pour UNE école : **Complexe écoles privées Elmourad**, sur
**https://elmouradarafat.cloud** (VPS Hostinger KVM 1, Ubuntu 24.04, 187.7.18.252).
Postgres, l'API, le site et Caddy (HTTPS automatique) tournent dans Docker ;
`install.sh` fait tout, et se relance sans danger (c'est aussi la mise à jour).

## 0. Déjà prêt (vérifié le 23/09/2026)

- DNS chez Hostinger : `elmouradarafat.cloud`, `www` et `api` → A 187.7.18.252,
  aucun AAAA. **Ne pas ajouter d'AAAA** (voir install.sh, section 3).
- La clé Firebase du projet `el-mourad` : `fcm-service-account.json`
  (Firebase → ⚙ Paramètres du projet → Comptes de service → Générer une nouvelle clé privée).

## 1. Envoyer les fichiers (depuis le PC, PowerShell)

    scp elmourad-0.7.3+12.zip fcm-service-account.json root@187.7.18.252:/root/
    ssh root@187.7.18.252

## 2. Installer (sur le VPS)

    apt-get update && apt-get install -y unzip
    unzip -q /root/elmourad-0.7.3+12.zip -d /opt && mv /opt/elmourad-0.7.3+12 /opt/elmourad
    install -d -m 700 /opt/elmourad/deploy/elmourad/secrets
    mv /root/fcm-service-account.json /opt/elmourad/deploy/elmourad/secrets/
    cd /opt/elmourad/deploy/elmourad
    PUBLIC_DOMAIN=elmouradarafat.cloud ACME_EMAIL=25038@supnum.mr \
      ADMIN_EMAIL=admin@supnum.mr ADMIN_PASSWORD='<mot-de-passe-provisoire>' bash install.sh

10 à 20 minutes la première fois. Le mot de passe s'écrit entre apostrophes
droites (le `!` ne doit pas être lu par bash). `ACME_EMAIL` reçoit les messages
de Let's Encrypt au sujet des certificats HTTPS.

## 3. Vérifier

- https://api.elmouradarafat.cloud/health → `"status":"ok"`
- https://elmouradarafat.cloud → connexion : `admin@supnum.mr` / le mot de passe provisoire choisi.
  Le site exige un nouveau mot de passe à la première connexion.
- ⚠ `admin@supnum.mr` est une adresse FICTIVE, pour cette première connexion
  seulement : aucun courriel n'y arrivera (pas de « mot de passe oublié »). Créez
  ensuite le compte réel de la direction (Comptes du personnel), puis supprimez
  `/root/elmourad-installation.txt`.
- Pages publiques (Play Store) : `/legal/confidentialite`, `/legal/conditions`,
  `/legal/suppression`.

Ensuite, sur le site : Années scolaires → créer l'année → Gestion de scolarité →
niveaux, classes, matières → Finance → moyens de paiement → Comptes du personnel.

## Mettre à jour

**Depuis le PC Windows, en PowerShell, sans git** (le zip suffit) :

    powershell -ExecutionPolicy Bypass -File .\deploy\elmourad\mettre-a-jour.ps1

Il prend le plus récent `elmourad-*.zip` (`dist\`, son propre dossier ou
Téléchargements) ou celui de `-Zip C:\…\elmourad-<version>.zip`, demande
confirmation, envoie le zip par `scp`, puis par `ssh` : sauvegarde, code
remplacé sans toucher à `.env` ni à `secrets/`, `install.sh`. `-Key` : la clé
SSH privée ; `-DryRun` : vérifier sans rien envoyer.

**Depuis le PC, en une commande** (Git Bash, à la racine du dépôt, tout commité) :

    bash deploy/elmourad/mettre-a-jour.sh

Le script construit le zip, l'envoie, sauvegarde la base et les pièces jointes
sur le serveur, remplace le code sans toucher à `.env` ni à `secrets/`, relance
`install.sh` (images, migrations, redémarrage) puis interroge `/health`. Les
mêmes étapes à la main, sur le serveur :

    unzip -q /root/elmourad-NOUVELLE.zip -d /tmp/maj
    rsync -a --delete --exclude 'deploy/elmourad/.env' --exclude 'deploy/elmourad/secrets/' \
      /tmp/maj/elmourad-*/ /opt/elmourad/
    cd /opt/elmourad/deploy/elmourad && bash install.sh

`.env` (mots de passe, clés) et `secrets/` restent ; la base aussi. Jamais
`docker compose down -v` : `-v` efface la base.

## Sauvegardes

Chaque nuit à 02:30 : `/root/sauvegardes-elmourad/elmourad-AAAAMMJJ-HHMMSS.tar`
(base + pièces jointes, 14 jours gardés ; journal `/var/log/elmourad-sauvegarde.log`).
À la main : `./sauvegarde.sh`. **Copiez-les aussi hors du serveur** (`scp` vers
le PC, ou `RCLONE_DEST=` dans `.env` avec rclone). La restauration est décrite en
tête de `sauvegarde.sh`. Hostinger garde en plus une sauvegarde hebdomadaire du VPS.

## Changer les mentions des pages légales

Nom officiel, téléphone, adresse, courriel : clés `LEGAL_*` de `.env` (valeurs
par défaut dans `deploy/brands/elmourad.env`), puis :

    docker compose up -d web

Pour ajouter une adresse électronique de contact réelle : `LEGAL_EMAIL=contact@…`.

## Dépannage

    docker compose ps                       # tout doit être « running » / « healthy »
    docker compose logs --tail=80 api       # l'API (Firebase, base, courrier)
    docker compose logs --tail=80 caddy     # les certificats HTTPS
    docker compose restart caddy            # après une correction du DNS

## L'application Android (sur le PC de construction, Git Bash)

Voir `docs/store/elmourad/PLAY-CONSOLE.md`. En bref, une fois :
`flutter upgrade`, `tools/android-sdk.sh`, `BRAND=elmourad tools/packager.sh cle` ;
puis à chaque version : `BRAND=elmourad tools/packager.sh android` (le `.aab`
du Play Store, vérifié) et `BRAND=elmourad tools/packager.sh apk`.
