# Héberger la démonstration gratuitement — Render + Neon (sans carte bancaire)

Un seul service gratuit chez Render (API + site + un mandataire Node dans un conteneur) et
une base Postgres gratuite chez Neon. Aucune carte bancaire, aucun domaine à
acheter : les noms d'école viennent de DuckDNS (gratuit), l'application
Android parle à `https://<service>.onrender.com`.

Ce que « gratuit » coûte : le service **s'endort après 15 minutes sans
visite** et met ~1 minute à se réveiller au premier clic (Render) ; la base
s'endort après 5 minutes et se réveille en une seconde (Neon). Parfait pour
des démonstrations, pas pour l'école réelle.

## 1. Quatre comptes gratuits (connexion Google ou GitHub, 2 minutes chacun)

| | Pour | À faire |
|---|---|---|
| **GitHub** | Render lit le code ici | un dépôt **privé** vide, ex. `elourwa` |
| **Neon** <https://neon.tech> | la base | *New project* : nom `elourwa`, région **Frankfurt (eu-central-1)**, Postgres 17. Copier la **connection string** (rôle propriétaire, `…neon.tech/neondb?sslmode=require`) |
| **Render** <https://render.com> | l'API et le site | rien encore |
| **DuckDNS** <https://www.duckdns.org> | les noms d'école | *add domain* : `elourwa` (ou ce qui est libre) → **current ip : `216.24.57.1`** (l'adresse de Render). Tous les `xxx.elourwa.duckdns.org` y pointent |

## 2. Pousser le code

Sur le poste, dans le dépôt :

```bash
git remote add origin https://github.com/<vous>/elourwa.git
git push -u origin master
```

## 3. Créer le service (Render → New → Blueprint)

Choisir le dépôt ; Render lit `render.yaml` et demande quatre valeurs :

| Variable | Valeur |
|---|---|
| `DATABASE_ADMIN_URL` | la connection string de Neon (rôle propriétaire) |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | `pnpm --filter @elourwa/api keygen` sur le poste, coller les deux valeurs **sans** les guillemets extérieurs (une ligne chacune, les `\n` restent) |
| `PUBLIC_DOMAIN` | `elourwa.duckdns.org` (ce que DuckDNS vous a donné) |

`APP_USER_PASSWORD` est tiré au sort par Render. *Apply* : la première
construction prend 10–15 minutes. Au démarrage le conteneur **migre la base,
pose le mot de passe d'`app_user`, et sème la démonstration** (3 écoles,
600 élèves) si la base est vide — chaque redéploiement rejoue cela sans rien
casser.

Vérifier : `https://elourwa-demo.onrender.com/health` → `{"status":"ok","database":"up"}`.

## 4. Les noms d'école (Render → le service → Settings → Custom Domains)

Ajouter, un par un : `nour.elourwa.duckdns.org`, `rissala.elourwa.duckdns.org`,
`salam.elourwa.duckdns.org`, `admin.elourwa.duckdns.org`, `api.elourwa.duckdns.org`.
Render vérifie que le nom pointe chez lui (c'est l'`A 216.24.57.1` de DuckDNS)
et obtient un certificat pour chacun en quelques minutes.

→ **Site** : `https://nour.elourwa.duckdns.org` (`admin@nour.test` / `dev12345`)
→ **Console** : `https://admin.elourwa.duckdns.org` (`admin@platform.test` / `dev12345`)

Si un nom reste « DNS update needed » plus de dix minutes : DuckDNS n'accepte
que des enregistrements A ; FreeDNS (<https://freedns.afraid.org>) permet des
CNAME vers `elourwa-demo.onrender.com` pour chaque nom.

## 5. L'application Android

```bash
API_URL=https://elourwa-demo.onrender.com tools/packager.sh apk
```

→ `dist/parent-<version>.apk`, à copier sur le téléphone. Connexion :
**`30000000` / `dev12345`** (un parent dans les trois écoles) ou `40000002`
(une école). Si Render a donné un autre nom au service, la ligne « Serveur ·
modifier » sous le formulaire de connexion accepte la bonne adresse sans
reconstruire.

Premier écran après un sommeil : une minute d'attente, c'est le réveil du
service gratuit, pas une panne. Pour l'éviter pendant une démonstration :
<https://cron-job.org> (gratuit) qui appelle `/health` toutes les 10 minutes.

## Lire le journal du conteneur

`https://elourwa-demo.onrender.com/_journal?cle=<JOURNAL_KEY>` montre l'état
(API, site) et les 80 dernières lignes du démarrage, de l'API et du site.
Poser `JOURNAL_KEY` (Render → Environment, une valeur au hasard) : à défaut
c'est `APP_USER_PASSWORD` qui sert de clé — moins bon, puisque cette clé
finit dans les journaux d'accès. Cinq essais ratés par minute, pas plus.

## Remettre la base à neuf (données de démonstration fraîches)

Changer le contenu du fichier `deploy/render/reset-marker` (un mot quelconque,
ex. la date) et pousser : au déploiement suivant la base est remise à neuf.
Ou, sans commit : Render → le service → *Environment* → `RESET_DATABASE` =
un mot quelconque → *Save* (le service redémarre). Au démarrage,
le schéma est supprimé et recréé, la graine semée (3 écoles, 600 élèves), et
le mot est gardé dans la base : tant que la valeur ne change pas, rien n'est
touché. Pour recommencer : changer la valeur. ⚠ Irréversible.
Si la marque ne peut pas être lue au démarrage (base endormie, panne), rien
n'est remis à neuf — jamais par défaut ; et une base qui n'a jamais gardé de
marque adopte la marque courante sans être touchée.

## Pourquoi cette combinaison

- **Oracle Always Free** (`deploy/oracle/`) reste la meilleure machine gratuite
  (toujours allumée, Postgres complet) — quand le compte se laisse créer.
- **Render** : gratuit sans carte, Docker, domaines personnalisés ; sa base
  gratuite expire au bout de 30 jours, d'où **Neon** (0,5 Go, sans limite de
  durée). Neon n'accorde pas `BYPASSRLS` : la migration 0001 crée
  `app_reporter` sans l'attribut sur un serveur géré (les synthèses inter-écoles
  ne s'y font pas ; rien du chemin des requêtes n'en dépend).
- **Railway / Fly / Koyeb** : crédit d'essai qui s'épuise, carte exigée, ou une
  seule instance de 512 Mo.
