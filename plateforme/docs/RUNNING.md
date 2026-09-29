# Seeing the system

Two ways: on this machine in about a minute, or on a server the school can reach.

---

## 1. On this machine

```bash
pnpm install && pnpm db:dev && pnpm seed && pnpm dev
```

`pnpm db:dev` starts an embedded Postgres — no Docker, no service to install. It
is idempotent: if one is already listening on 5432 it attaches to it.

Then open **http://nour.localhost:3000**.

⚠ **The subdomain is not decoration.** The branch is resolved from the host name,
so `localhost:3000` is the platform console and `nour.localhost:3000` is École
Nour. `*.localhost` resolves to 127.0.0.1 in every current browser with no
`hosts` file editing.

### The three branches

| URL | School |
|---|---|
| http://nour.localhost:3000 | École Nour |
| http://rissala.localhost:3000 | École Rissala |
| http://salam.localhost:3000 | École Salam |
| http://admin.localhost:3000 | Platform console (no branch) |

Open two branches side by side and compare any list. They share names, and they
share nothing else — that is Row-Level Security, not a `WHERE` clause someone
remembered to write.

### Who to sign in as

Every seeded account uses the password **`dev12345`**. The role decides what you
see, so sign in as more than one.

| Sign in as | Sees |
|---|---|
| `admin@nour.test` | Everything — the whole navigation |
| `comptable@nour.test` | Finance, payroll, reports, the till, expulsions |
| `secretaire@nour.test` | Students, enrolment, marks — **no money at all** |
| `prof0@nour.test` | Only "Ma semaine": their own classes and week |
| `absence@nour.test` | Only the register |

The navigation is permission-aware, so what disappears between logins is the
point. The accountant has no Notes tab; the teacher has no Finance.

### Worth looking at specifically

- **Finance → a family** — the debt is itemised per month, never a bare total,
  because a parent will ask why.
- **Paie** — pay someone with a loan outstanding and watch the deduction, then
  cancel it: the original entry is untouched and a reversing entry appears
  beside it.
- **Notes → a class → Imprimer les bulletins** — then Ctrl+P. It is laid out for
  A4, one child per sheet.
- **Accès résultats** — the ratchet that withholds exam results from families in
  debt, term by term.
- **Comptes → Créer un compte** — the form changes shape with the role, and the
  temporary password is shown exactly once.
- Any page, then Ctrl+P. The interface disappears and a document remains.

### The parent app

```bash
cd apps/mobile && flutter run -d chrome
```

Sign in with the **phone number** `30000000` / `dev12345` — the app asks for
no school: that account is a parent in all three branches and sees every
child, each labelled with its school (ADR-0061). `40000002` / `dev12345`
(`parent2@nour.test`) is a parent in one. Only a Mauritanian number is accepted (8 digits starting 2, 3 or 4,
`+222` optional); an e-mail such as `parent.multi0@test` is refused at the
keyboard. French and Arabic, right-to-left included.

---

## 2. On a server

Nothing here needs Docker, Redis, or a managed queue. It is Node, Postgres, and
a directory of files.

### What it needs

| | |
|---|---|
| Node | 20 or newer |
| Postgres | 16 |
| Disk | the database, plus `UPLOAD_DIR` for attachments |
| RAM | 1 GB is comfortable at this size |

### Environment

```bash
DATABASE_URL=postgres://app_user:...@localhost:5432/elourwa   # the API: RLS applies
DATABASE_ADMIN_URL=postgres://postgres:...@localhost:5432/elourwa   # migrations only
JWT_PRIVATE_KEY=...        # ES256. Generate once and keep it: changing it signs everyone out
JWT_PUBLIC_KEY=...
UPLOAD_DIR=/var/lib/elourwa/uploads
SMTP_HOST=...              # without this, mail queues and never leaves
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=no-reply@votre-domaine.mr
```

⚠ `DATABASE_URL` must be `app_user`, never the owner. The owner is not subject to
Row-Level Security, so running the API as it silently removes every tenant
boundary in the system. Nothing would look wrong.

### Build and start

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm db:migrate
```

Then run `apps/api` (`pnpm --filter @elourwa/api start`, i.e. `node --import
tsx dist/main.js` — the workspace packages ship TypeScript sources, so plain
`node dist/main.js` cannot resolve them) and `apps/web` (`next start`) under
whatever supervisor you use — systemd, PM2, a container.

**Free demo hosting, ready-made:** `deploy/oracle/` — one script turns an
Oracle Cloud *Always Free* VM into the running demo with automatic HTTPS on
`*.<ip>.sslip.io` names (no domain needed). See `deploy/oracle/README.md`.

### DNS

The branch comes from the host name, so each school needs its own:

```
nour.votre-domaine.mr      -> the web app
rissala.votre-domaine.mr   -> the web app
admin.votre-domaine.mr     -> the web app (platform console)
```

A wildcard `*.votre-domaine.mr` works and means a new branch needs no DNS change
— it is live the moment the row exists.

### Where to put it

For a school in Nouakchott, the thing that decides this is **latency**, not
price. A VPS in Europe is 40–80 ms away; one in North America is 120 ms+, and
every page here is server-rendered, so that lands on every click.

| | |
|---|---|
| **A European VPS** (Hetzner, Scaleway, OVH — Paris or Frankfurt) | €5–10/month, closest common option, straightforward |
| **A Moroccan or Tunisian host** | Closer still; check they offer Node 20 and Postgres 16, not just PHP |
| **Shared PHP hosting** | ❌ Will not work. This is not PHP, and it needs a persistent Node process |

### Before the school uses it

1. **`SMTP_HOST` must be set.** Without it, password resets queue in
   `outbound_mail` and never leave. Nothing is lost and nothing is delivered —
   check `/health` and the queue before believing mail works.
2. **Schedule `scripts/backup.sh`.** It archives the database *and* the upload
   directory. A `pg_dump` alone restores a school whose every attachment is a
   broken link (ADR-0016).
3. **Test a restore.** `AttachmentsService.integrity()` answers "did every file
   come back" directly; a backup nobody has restored is a hypothesis.
4. **Keep `JWT_PRIVATE_KEY` somewhere it survives a redeploy.** Regenerating it
   signs out every parent at once.
5. **`outbound_mail` contains live password-reset links.** Do not ship it to log
   aggregation, and purge sent rows on a schedule.

---

## 3. Publier — les magasins et le serveur

```bash
tools/packager.sh web          # dist/serveur-<version>.tar.gz — API + site + pages légales
tools/packager.sh flutter-web  # dist/parent-web-<version>.tar.gz — l'espace parents, version web
tools/packager.sh android      # dist/parent-<version>.aab — demande le SDK Android et key.properties
tools/packager.sh apk          # dist/parent-<version>.apk — le même, installable à la main (démos, tests internes)
tools/packager.sh ios          # sur un Mac seulement ; imprime la marche à suivre ailleurs
```

Le script **refuse** plutôt que de deviner : pas de clé de signature, pas de
SDK, un serveur de développement encore sur :3000 — il s'arrête et dit quoi.
Sans `API_URL`, il construit mais **le dit en rouge** : le paquet démarre sur
`localhost`, et le serveur se saisit dans l'application (« Serveur · modifier »
sous le formulaire de connexion, HTTPS seulement) — acceptable pour un test
interne, pas pour une publication. Sans les variables `FIREBASE_*`,
l'application se construit et interroge le serveur au lieu de recevoir ; il le
dit aussi.

```bash
tools/android-sdk.sh           # une fois : JDK 17 + SDK, ~500 Mo, sans Android Studio
tools/packager.sh cle          # une fois : la clé de téléversement, jamais commitée
```

⚠ **Deux pièges du poste Windows**, tous deux dans les scripts :
`JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Java\tmp` (sans lui Gradle meurt
sur « Unable to establish loopback connection » quand `%TEMP%` est en forme
courte 8.3), et ne jamais lancer `packager.sh web` pendant que `next dev` tourne
(même `.next/`).

### Ce qui ne se fait pas sur ce poste

- **iOS** : un projet iOS ne se construit que sur macOS avec Xcode. Le projet
  est prêt (`ios/`, identifiant `mr.elourwa.parent`, `PrivacyInfo.xcprivacy`,
  entitlements push) ; l'archive se fait sur un Mac.
- **Android** : se fait ici. Le SDK est installé par `tools/android-sdk.sh`
  (`C:\Android\sdk`, JDK dans `C:\Java`), la clé par `tools/packager.sh cle`, et
  `tools/packager.sh android` produit le `.aab` — signé, vérifié par
  `bundletool validate`, `mr.elourwa.parent`, targetSdk 35.

### Avant la première soumission — voir `docs/legal/declarations-magasins.md`

1. Les `[À COMPLÉTER]` des deux politiques (`apps/web/content/legal/`), et la
   relecture juridique.
2. Le domaine du site : la politique doit être lisible à
   `https://<site>/legal/confidentialite` sans compte.
3. Le projet Firebase : `FCM_SERVICE_ACCOUNT` sur le serveur, les quatre
   `FIREBASE_*` à la construction, la clé APNs (.p8) pour iOS.
4. La clé de signature Android, créée une fois, sauvegardée hors du poste.
5. Sur le serveur, après `pnpm db:migrate` : **changer le mot de passe de
   `app_user` et `app_reporter`** (`0001` les crée avec « devpassword ») et
   poser `DATABASE_URL`, `JWT_*`, `ALLOWED_ORIGIN_SUFFIX`, `SMTP_*`.

## If something does not start

| Symptom | Cause |
|---|---|
| Login works, then every page is blank | A `next build` ran while `next dev` was serving. Kill it, `rm -rf apps/web/.next`, restart. Issue 4a. |
| Empty lists everywhere, no error | The tenant context is wrong — not the policy. Check the host name resolves to a branch. |
| `pnpm dev` fails on "cannot find binary path" | Turbo cannot see `pnpm`. Ensure it is on `PATH`, not only reachable through corepack. |
| Tests refuse to run against your database | Deliberate. The suite resets the schema, and it will not do that to a database not named `*_test`. It destroyed the dev database once. |


---

## 4. Une école sous sa propre enseigne, sans console — El Mourad

Le même code sert une installation à **une** école, sous un autre nom, sans
console de plateforme (ADR-0069). Tout est dans l'environnement :

```bash
BRAND_NAME="El Mourad"  BRAND_NAME_AR="المراد"        # chaque libellé visible
SINGLE_SCHOOL_SLUG=elmourad                           # tout hôte = cette école, /platform → 404
```

- **Héberger** : `deploy/elmourad/` — `install.sh` (Docker, Postgres 16,
  API, site, Caddy, HTTPS), une base **neuve** (rôles, l'école, un compte de
  direction ; jamais `pnpm seed`), `README.md` pour la suite ;
  `docs/HOSTING.md` pour choisir le serveur (~5 €/mois).
- **Livrer** : `BRAND=elmourad tools/packager.sh zip` → `dist/elmourad-<v>.zip` ;
  `BRAND=elmourad API_URL=https://api.<domaine> tools/packager.sh apk` →
  `dist/elmourad-parent-<v>.apk`.
- **Voir sur ce poste**, à côté de la pile El Ourwa : `scripts/dev-elmourad.sh api`
  (`:3011`) et `scripts/dev-elmourad.sh web` (`:3010`, http://localhost:3010),
  après `pnpm --filter @elourwa/db bootstrap-school -- --slug elmourad
  --name "El Mourad" --name-ar "المراد" --prefix ELM --admin-email
  direction@elmourad.test --admin-name "Direction El Mourad"` sur la base de
  développement. `.claude/launch.json` porte `api-elmourad` et `web-elmourad`.
