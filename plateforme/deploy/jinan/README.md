# Jinan — installer le site sur son VPS

Un site pour UNE école : **Heavenly Private Educational Institution (Jinan)**,
465 E Nord, Tevragh Zeina, Nouakchott. Postgres, l'API, le site et Caddy (HTTPS
automatique) tournent dans Docker ; `install.sh` fait tout, et se relance sans
danger (c'est aussi la mise à jour). La facturation est celle de Jinan : modes
d'étude 8h – 14h / 8h – 17h, frais d'inscription par élève, services optionnels
(ADR-0073, `docs/specs/jinan-facturation.md`).

⚠ **Son propre serveur.** Jinan ne s'installe PAS sur le VPS d'El Mourad
(187.7.18.252) : les deux piles Docker prendraient les mêmes ports 80/443 et le
même réseau, et deux écoles partageraient un compte root. Les scripts de mise à
jour refusent ce serveur.

## 0. Avant (une fois)

- **Un VPS** Ubuntu 24.04, 2 Go de RAM au minimum (la base, l'API et le site,
  et la reconstruction du site à chaque mise à jour). Recommandé :
  **Namecheap « Pulsar »** (2 vCPU, 2 Go, 40 Go SSD, au mois, emplacement
  européen si proposé), domaine acheté dans le même compte ; Hostinger KVM 1
  convient aussi.
- **Un domaine** (ex. `jinan-ecole.com`), et chez son registraire trois
  enregistrements **A** vers l'IP du VPS : `@`, `www`, `api`. **Aucun AAAA**
  (install.sh, section 3).
- **Donner l'IP et le domaine au dépôt, une fois** (sur le PC, Git Bash, à la
  racine) — tout le reste les lit ensuite :

      bash deploy/jinan/configurer-production.sh <ip-du-vps> <domaine> namecheap-eu

  Il refuse le serveur d'El Mourad, écrit `deploy/jinan/production.env`
  (serveur et domaine des scripts), `API_URL` / `WEB_URL` dans
  `deploy/brands/jinan.env` (l'application Android), l'hébergeur que nomme la
  politique de confidentialité (`namecheap-eu`, `namecheap-us`,
  `hostinger-eu`), et vérifie le DNS. Commitez les deux fichiers, puis
  `BRAND=jinan bash tools/packager.sh zip`.
- Notifications instantanées (facultatif) : dans la console Firebase du projet
  `el-mourad`, ajouter l'application Android `mr.jinan.parent`, puis
  Paramètres du projet → Comptes de service → Générer une nouvelle clé privée →
  `fcm-service-account.json`. **Fait le 04/10/2026** : l'application est
  déclarée (ses valeurs sont dans `deploy/brands/jinan.env`, compilées depuis
  la version 0.8.1+21) et la clé est sur le serveur (`/health` dit
  `"push":"firebase"`). Détail : `docs/FIREBASE.md`.

## 1. Installer en UNE ligne, sur le serveur — le plus simple

Connecté au VPS en root (`ssh root@209.74.66.223`, ou la console de Namecheap) :

    curl -fsSL -o /root/installer-jinan.sh https://raw.githubusercontent.com/25038-ux/ourwa/refs/heads/claude/jinan-web-completion-6wv8c0/plateforme/deploy/jinan/installer-serveur.sh && bash /root/installer-jinan.sh

Rien à envoyer depuis le PC : le serveur télécharge le code de GitHub, le pose
dans `/opt/jinan`, lance `install.sh` et affiche le mot de passe provisoire.
Relancer est sans danger (déjà installé : sauvegarde, `.env` gardé).

## 1 bis. Installer depuis le PC (PowerShell)

`installer-jinan.ps1` (ici, ou envoyé à côté du zip) trouve seul
`jinan-<version>.zip` (à côté de lui, dans Téléchargements ou sur le Bureau,
même renommé par le navigateur), lit l'IP et le domaine DANS le zip, envoie
tout au serveur et lance l'installation ; le mot de passe root du VPS est
demandé deux fois, et le mot de passe provisoire de la direction s'affiche à
la fin.

    powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\installer-jinan.ps1"

(`-DryRun` : tout vérifier sans contacter le serveur.) Il refuse un serveur où
Jinan est déjà installé (mise à jour : `mettre-a-jour.ps1`) et celui d'El
Mourad. Firebase se pose ensuite (§2, ligne `secrets/`, puis relancer
`install.sh`).

⚠ Tapée à la main, `scp jinan-<version>.zip …` ne marche que dans le dossier
qui contient le zip ; ailleurs : « No such file or directory », rien n'arrive
sur le serveur, et toutes les commandes du §2 échouent ensuite (constaté le
29/09/2026).

## 1 ter. À la main : envoyer les fichiers (depuis le PC, PowerShell)

    cd $HOME\Downloads            # le dossier qui contient le zip
    scp jinan-<version>.zip fcm-service-account.json root@<ip-du-vps>:/root/
    ssh root@<ip-du-vps>

## 2. Installer (sur le VPS)

    apt-get update && apt-get install -y unzip
    unzip -q /root/jinan-<version>.zip -d /opt && mv /opt/jinan-<version> /opt/jinan
    install -d -m 700 /opt/jinan/deploy/jinan/secrets
    mv /root/fcm-service-account.json /opt/jinan/deploy/jinan/secrets/   # si Firebase
    cd /opt/jinan/deploy/jinan
    ACME_EMAIL=infoheavenly24@gmail.com \
      ADMIN_EMAIL=infoheavenly24@gmail.com ADMIN_PASSWORD='<mot-de-passe-provisoire>' bash install.sh

Le domaine vient de `production.env` (§0) ; sans lui, ajoutez
`PUBLIC_DOMAIN=<domaine>` devant la commande.

10 à 20 minutes la première fois. Le mot de passe s'écrit entre apostrophes
droites. `ACME_EMAIL` reçoit les messages de Let's Encrypt au sujet des
certificats HTTPS. L'école est créée avec le préfixe de reçus `JIN` et la
facturation « services ».

## 3. Vérifier, puis régler les frais

- `https://api.<domaine>/health` → `"status":"ok"`
- `https://<domaine>` → connexion avec `ADMIN_EMAIL` / le mot de passe provisoire ;
  le site exige un nouveau mot de passe à la première connexion. Supprimez
  ensuite `/root/jinan-installation.txt`.
- Pages publiques (Play Store) : `/legal/confidentialite`, `/legal/conditions`,
  `/legal/suppression`.

Ensuite, sur le site, dans cet ordre : **Années scolaires** → créer l'année et
l'activer → **Gestion de scolarité** → niveaux, classes, matières → **Frais**
(barre latérale) → pour chaque niveau les tarifs 8h – 14h et 8h – 17h et les
frais d'inscription, puis les prix de la cantine (3 formules), de la piscine, du
docteur et de la photocopie → **Finance** → moyens de paiement → **Comptes du
personnel**. Une inscription est refusée tant que le tarif de son niveau et de
son mode n'est pas défini.

## Mettre à jour

**Depuis le PC Windows, en PowerShell, sans git** (le zip suffit) — le serveur et
le domaine sont **obligatoires** :

    powershell -ExecutionPolicy Bypass -File .\mettre-a-jour.ps1

(sans `-Server` ni `-Domain`, il lit `production.env` ; les donner les remplace :
`-Server root@<ip-du-vps> -Domain <domaine>`)

Il prend le plus récent `jinan-*.zip` (`dist\`, son propre dossier ou
Téléchargements) ou celui de `-Zip C:\…\jinan-<version>.zip`, demande
confirmation, envoie le zip par `scp`, puis par `ssh` : sauvegarde, code
remplacé sans toucher à `.env` ni à `secrets/`, `install.sh`, et prouve à la fin
que le site en ligne est la nouvelle construction. `-Key` : la clé SSH privée ;
`-DryRun` : vérifier sans rien envoyer.

**Depuis le PC, en une commande** (Git Bash, à la racine du dépôt, tout commité) :

    bash deploy/jinan/mettre-a-jour.sh          # lit production.env
    SERVEUR=root@<ip-du-vps> DOMAINE=<domaine> bash deploy/jinan/mettre-a-jour.sh

`.env` (mots de passe, clés) et `secrets/` restent ; la base aussi. Jamais
`docker compose down -v` : `-v` efface la base.

## Sauvegardes

Chaque nuit à 02:30 : `/root/sauvegardes-jinan/jinan-AAAAMMJJ-HHMMSS.tar`
(base + pièces jointes, 14 jours gardés ; journal `/var/log/jinan-sauvegarde.log`).
À la main : `./sauvegarde.sh`. **Copiez-les aussi hors du serveur** (`scp` vers
le PC, ou `RCLONE_DEST=` dans `.env` avec rclone). La restauration est décrite en
tête de `sauvegarde.sh`.

## Changer le nom de l'école

Le nom affiché par le site (barre latérale, page de connexion, reçus,
bulletins) : `SCHOOL_NAME` (et `SCHOOL_NAME_AR`) dans
`deploy/brands/jinan.env` — aujourd'hui « Heavenly Private Educational
Institution ». Commitez, puis mettez à jour le serveur : `install.sh` le remet
dans `.env` et l'applique à l'école en base (`bootstrap-school --sync-name`).
Sur le serveur, sans nouvelle version : `SCHOOL_NAME='…' bash install.sh`.

## Changer les mentions des pages légales

Nom officiel, téléphone, adresse, courriel : clés `LEGAL_*` de `.env` (valeurs
par défaut dans `deploy/brands/jinan.env`), puis :

    docker compose up -d web

## Dépannage

    docker compose ps                       # tout doit être « running » / « healthy »
    docker compose logs --tail=80 api       # l'API (Firebase, base, courrier)
    docker compose logs --tail=80 caddy     # les certificats HTTPS
    docker compose restart caddy            # après une correction du DNS

## L'application Android (sur le PC de construction, Git Bash)

Voir `docs/store/jinan/PLAY-CONSOLE.md`. La clé de signature existe déjà
(`apps/mobile/android/jinan-upload.jks` + `key-jinan.properties`, copie dans
`C:\Eduplateforme\jinan_deployement`). Une fois `configurer-production.sh`
passé (§0 : il écrit `API_URL` et `WEB_URL` dans `deploy/brands/jinan.env`) :
`BRAND=jinan bash tools/packager.sh android` (le `.aab` du Play Store, vérifié)
et `BRAND=jinan bash tools/packager.sh apk`. Un `.aab` « -non-signe » construit
ailleurs se signe avec `BRAND=jinan bash tools/signer-aab.sh <fichier>`.

## L'application iPhone (sur un Mac)

`BRAND=jinan bash tools/packager.sh ios-projet` (n'importe quel poste) →
`dist/jinan-ios-<version>.zip` : le projet Flutter aux couleurs de Jinan
(identifiant `mr.jinan.parent`, nom « Jinan », icône, adresse du serveur).
Sur le Mac (Xcode, CocoaPods, Flutter, compte Apple Developer) : décompresser,
ouvrir `ios/Runner.xcworkspace` une fois pour choisir l'équipe (Signing &
Capabilities), puis `bash construire-ios.sh` → `build/ios/ipa/*.ipa`, à envoyer
avec Transporter. Sur un Mac qui a le dépôt : `BRAND=jinan bash tools/packager.sh ios`.
