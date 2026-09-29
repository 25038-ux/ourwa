# Héberger la démonstration gratuitement — Oracle Cloud « Always Free »

Une machine virtuelle gratuite, sans limite de durée, assez grande pour tout
faire tourner (Postgres, l'API, le site, HTTPS) : c'est l'offre *Always Free*
d'Oracle Cloud. Aucun domaine à acheter : les noms `*.<ip>.sslip.io` pointent
vers l'adresse de la machine, et Caddy leur obtient des certificats Let's
Encrypt. Une fois en ligne, l'application Android construite avec `API_URL`
s'installe sur n'importe quel téléphone et lit les données de la démonstration
(trois écoles, six cents élèves, des parents dans plusieurs écoles).

⚠ Ce que ce n'est pas : un serveur pour l'école réelle. Pas de sauvegarde
programmée, pas de courrier, pas de domaine à elle ; une VM gratuite peut être
récupérée par Oracle si elle reste inactive longtemps (garder un compte
« Pay As You Go » avec 0 $ de dépense évite cela — voir l'étape 1).

## 1. Le compte et la machine (une fois, ~15 minutes)

1. <https://www.oracle.com/cloud/free/> → *Start for free*. Une carte
   bancaire est demandée pour vérifier l'identité ; elle n'est pas débitée tant
   qu'on reste dans *Always Free*. Choisir une **région d'Europe** (Paris,
   Marseille, Francfort, Madrid) : 40–80 ms de Nouakchott, contre 120 ms+ en
   Amérique — le site est rendu côté serveur, chaque clic le sent. ⚠ La région
   ne se change plus ensuite.
2. Console → *Compute* → *Instances* → **Create instance** :
   - *Image* : **Ubuntu 24.04** (ou 22.04) — bouton *Change image*.
   - *Shape* : *Ampere* **VM.Standard.A1.Flex**, **2 OCPU / 12 GB** (le gratuit
     va jusqu'à 4 OCPU / 24 GB au total ; 2/12 suffit et laisse de la marge).
     Si la région dit *Out of capacity*, réessayer à une autre heure, ou prendre
     **VM.Standard.E2.1.Micro** (AMD, 1 GB — ça tourne, plus lentement).
   - *Networking* : laisser créer le VCN et le sous-réseau, **adresse IPv4
     publique : oui**.
   - *SSH keys* : coller votre clé publique (ou télécharger celle générée).
   - **Create**. Noter l'**adresse IP publique** (ex. `141.148.1.2`).
3. Ouvrir 80 et 443 dans le réseau virtuel — *Networking* → *Virtual cloud
   networks* → le VCN → *Security Lists* → *Default Security List* → **Add
   Ingress Rules** : Source `0.0.0.0/0`, IP Protocol `TCP`, Destination Port
   Range `80,443`. (Le pare-feu **de la machine** est ouvert par le script.)

## 2. Installer (une commande)

Depuis votre poste (Git Bash, PowerShell, Terminal) :

```bash
ssh ubuntu@141.148.1.2
```

Puis, sur la machine :

```bash
sudo apt-get install -y git
git clone https://github.com/<vous>/<dépôt>.git elourwa   # ou copiez le dossier (scp)
cd elourwa/deploy/oracle
sudo bash install.sh
```

Le script installe Docker, tire au sort les mots de passe et les clés de
signature dans `.env`, construit l'image (≈ 10 minutes la première fois sur
2 OCPU), migre la base, sème la démonstration, et lance tout. À la fin il
affiche les adresses :

```
Site des écoles     https://nour.141-148-1-2.sslip.io/    admin@nour.test / dev12345
Console             https://admin.141-148-1-2.sslip.io/   admin@platform.test / dev12345
API (application)   https://api.141-148-1-2.sslip.io/health
```

Les certificats arrivent dans la minute qui suit (Caddy les demande à la
première visite de chaque nom). Si la première page affiche une erreur de
certificat, attendre trente secondes et recharger.

Le dépôt n'est pas public ? Copier le dossier depuis le poste au lieu de
`git clone` : `scp -r "C:/El Ourwa app" ubuntu@141.148.1.2:elourwa` (sans
`node_modules`, `reference/`, `dist/` — ils sont ignorés par le Dockerfile de
toute façon mais pèsent à transférer).

## 3. L'application Android nourrie par ce serveur

Sur le poste de construction (SDK Android et `key.properties` en place) :

```bash
API_URL=https://api.141-148-1-2.sslip.io tools/packager.sh apk
```

→ `dist/parent-<version>.apk`. L'envoyer sur le téléphone (WhatsApp, câble,
lien), l'ouvrir, autoriser l'installation depuis cette source, se connecter
avec **`30000000` / `dev12345`** (un parent dans les trois écoles) — ou
`40000002` (un parent d'une seule école). Un `.apk` construit sans `API_URL`
fonctionne aussi : « Serveur · modifier » sous le formulaire de connexion
accepte `https://api.141-148-1-2.sslip.io`.

Le `.aab` du Play Store se construit de la même façon (`tools/packager.sh
android`), avec la vraie adresse de l'API le jour venu.

## 4. Vivre avec

| | |
|---|---|
| Journal | `docker compose logs -f api web caddy` |
| Mettre à jour le code | `git pull && sudo docker compose build && sudo docker compose up -d` |
| Recommencer la démonstration | `sudo docker compose down -v && sudo bash install.sh` (⚠ efface tout) |
| Ajouter une branche | son nom dans `Caddyfile` (`ecole.{$PUBLIC_DOMAIN}`), `docker compose restart caddy` |
| Un vrai domaine plus tard | `PUBLIC_DOMAIN=ecole.mr` dans `.env`, un enregistrement `A` `*.ecole.mr` → l'IP, `docker compose up -d` — rien d'autre ne change |
| Sauvegarde | `docker compose exec db pg_dump -U postgres elourwa > sauvegarde.sql` (et le volume `uploads`) |

Ce qui reste hors du gratuit : le courrier sortant (`SMTP_*` dans `.env` — un
compte Brevo ou Mailjet gratuit convient), les notifications push
(`FCM_SERVICE_ACCOUNT`, projet Firebase gratuit ; sans lui l'application
interroge le serveur périodiquement), et le domaine.

## Pourquoi pas les autres « gratuits »

- **Render, Railway, Fly, Koyeb** : le gratuit s'endort après quelques minutes
  d'inactivité (une minute de démarrage à chaque démo), expire au bout de
  30 jours, ou n'existe plus ; et leurs Postgres gérés n'accordent pas le rôle
  `BYPASSRLS` que la migration 0001 crée pour `app_reporter` (il faut un
  superutilisateur — Postgres dans Docker l'est).
- **Neon / Supabase** (base seule) : même limite sur les rôles, et l'API doit
  quand même tourner quelque part.
- **Un tunnel depuis votre PC** (`cloudflared tunnel --url http://localhost:3001`,
  gratuit, sans compte) : parfait pour montrer l'application cinq minutes, mais
  l'adresse change à chaque lancement et le PC doit rester allumé.
