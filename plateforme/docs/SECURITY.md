# Security — what is defended, what is deferred, and why

Written 2026-09-04 during a full audit of both applications. Update it with the
audit, not after it.

This is a financial system holding fee records, debts and payroll for ~1 372
families. The assets worth stealing are, in order: the families' personal data
(names, telephone numbers, children), the money (the till, payroll, write-offs),
and the grades (which are the school's collection lever — see ADR-0015).

---

## The boundaries

| Boundary | Untrusted input | Enforced by |
|---|---|---|
| HTTP → API | Every body, query and param | zod at the controller, parameterised SQL everywhere |
| HTTP → web | Forms, URLs | Server Actions; the API is never called from a browser |
| Host header | The tenant slug | `slugFromHost`, then RLS on `school_id` |
| Cookies | The session | httpOnly · secure in production · SameSite=Lax |
| Uploads | Homework attachments | 5 MB cap at the plugin, magic-byte check, served with `nosniff` + `Content-Disposition: attachment` |
| Database | — | RLS **enabled and forced** on every tenant table, `USING` **and** `WITH CHECK` |

⚠ **RLS is the boundary between SCHOOLS, not between ROLES.** It was working
perfectly on 2026-09-04 while a signed-in parent could read the entire roster of
their own school. Both boundaries are needed and they are enforced in different
places: RLS in Postgres, roles in `@RequirePermission`.

---

## Findings of 2026-09-04, and what was done

| Finding | Severity | Status |
|---|---|---|
| A parent could read every student and every family's phone number (`/students`, `/students/guardians/search`, `/students/count`) | **Critical** | Fixed — allow-lists; proved closed |
| `/teachers` returned every salary and hourly rate to anyone with a token | **High** | Fixed — guarded, and the pay fields omitted for callers without the right |
| A child's fee schedule readable by id (`/enrollments/:id/months`) | High | Fixed |
| The school's structure open to parents (`/levels`, `/groups`, `/subjects`, `/teachings`, `/hierarchy`) | Medium | Fixed |
| `change-password` was an unmetered password oracle | High | Fixed — same 5/15min buckets as signing in |
| `forgot-password` could mail-bomb a family at 300/min | Medium | Fixed — counted, and unknown addresses count too |
| The API sent no security headers at all | Medium | Fixed — `no-store`, `nosniff`, `DENY`, CSP `'none'`, HSTS in production |
| `/forgot` and `/reset` called the API from the browser; CSP blocked them | High (broken feature) | Fixed — Server Actions |
| A permission invented in a decorator closes the endpoint silently | — | Guarded by `permission-names.spec.ts` |
| `derogations.gerer` was deleted by every `pnpm seed` | High | Fixed — added to `seed-roles.ts` |

### Already sound, verified rather than assumed

- **Passwords** — Argon2id, with a bcrypt verification fallback and transparent
  re-hash. Policy: ≥ 8 characters and 3 of 4 character classes, enforced at
  every door (login, reset, admission, change).
- **Login rate limiting** — El Ourwa's own constants: 5 failures per 15 minutes
  on the **account** (`MAX_LOGIN_ATTEMPTS`), 15 per 15 minutes on the **IP**
  (`IP_MAX_ATTEMPTS`, its "protection complémentaire"), and its sentences.
  Account-only lets one machine spray a password across many accounts; IP-only
  lets a botnet grind one account; an IP limit as low as the account's locks a
  whole office behind one router out after one person's five typos.
- **Refresh tokens** — opaque, hashed at rest, rotated on every use, and reuse
  revokes the whole family.
- **Attachments** — the download checks that the caller is staff, the teacher of
  that teaching, or a guardian of a child in that class.
- **The `X-School-Slug` header override** — development only, gated on
  `NODE_ENV !== 'production'` in both places that read it.
- **CORS** — fails closed; the API refuses to boot in production without
  `ALLOWED_ORIGIN_SUFFIX`.
- **No secrets in the tree** — `.env` is ignored; a grep for assigned secrets
  over the tracked files returns nothing.

---

## Le durcissement du 2026-09-11, avant les magasins

**Le jeton disait qui vous étiez ; la base dit qui vous êtes.** `AuthGuard`
faisait confiance à tout ce que portait le jeton d'accès — rôles, permissions,
et le simple fait que le compte existât — pendant quinze minutes. El Ourwa
relit le compte à CHAQUE requête, et son commentaire dit pourquoi :
« désactiver un compte ou réinitialiser son mot de passe — les deux gestes de
réaction à un incident — ne fermaient donc pas la session en cours ». Désormais,
par requête : le compte est encore `active` ; le **sceau** — les 32 premiers
hexadécimaux du SHA-256 de l'empreinte du mot de passe, son `sceau_compte()` —
correspond encore ; les rôles et permissions viennent de la base. Un mot de
passe changé tue le jeton à la requête suivante. Six tests
(`session-hardening.spec.ts`), dont les trois refus.

**L'empreinte de session** (`empreinte_session()`) : SHA-256 du User-Agent et
des trois premiers octets de l'adresse, posée sur le jeton de rafraîchissement.
Présenté depuis un autre appareil ET un autre réseau, il révoque toute la
famille — la même réponse qu'à une réutilisation, parce qu'on ne sait pas
lequel des deux est le voleur.

**La suppression de compte** (exigée par les deux magasins) : mot de passe
requis, anonymisation — nom, numéro, adresse effacés ; nom d'utilisateur
opaque ; empreinte de mot de passe impossible ; sessions et appareils révoqués
— et les écritures scolaires et comptables conservées sous ce compte anonyme,
parce qu'une école y est tenue.

**Les notifications poussées** : le jeton FCM est une clé vers l'écran d'un
téléphone. Table locataire sous RLS ; retiré à la déconnexion ; retiré dès
que Google répond `UNREGISTERED` ; jamais journalisé. **La note d'un enfant
n'atteint jamais l'écran verrouillé** (`renduPourPousser()` la masque).

**Les sauvegardes Android** : exclues (`data_extraction_rules.xml`). Le jeton
de rafraîchissement vaut quatre-vingt-dix jours et vit dans le Keystore ; un
transfert d'appareil qui l'emporterait le ferait sortir de l'appareil qui l'a
reçu — exactement ce que l'empreinte interdit.

**Dépendances** : `fastify` 5.11.3 portait deux avis modérés, dont un
usurpation de `X-Forwarded-*` sous `trustProxy` — précisément ce que lisent
nos en-têtes de sécurité et la limite de cadence. Forcé à ≥ 5.12.1 par une
`override` pnpm (l'adaptateur Nest épinglait l'ancienne). `pnpm audit --prod` :
aucune vulnérabilité connue.

**En-têtes** : `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`
et `Permissions-Policy` rejoignent les deux côtés.

**Ce que le balayage des secrets a trouvé** : rien. Ni clé privée, ni `.env`,
ni keystore dans les fichiers suivis ; `key.properties`, `*.jks`,
`google-services.json` et `GoogleService-Info.plist` sont ignorés avant
d'exister. Le seul mot de passe en clair est celui du cluster Postgres jetable
de développement — et `0001` crée `app_user` avec « devpassword », **à changer
à la première migration en production** (le script d'emballage le rappelle).

## Dependency audit — triage of 2026-09-04

38 advisories. Triaged by **reachability**, not by severity alone.

### Fixed

| Package | Was | Now | Why it mattered |
|---|---|---|---|
| `@fastify/multipart` | 8.3.0 | ^8.3.1 | Unlimited resource consumption. **Reachable** — homework attachments arrive as multipart. |
| `drizzle-orm` | ^0.36.0 | ^0.45.2 | SQL injection via improperly escaped identifiers. Not reachable (see below), bumped anyway because nothing consumes it and the change therefore cannot break anything. |

### Not reachable — recorded, not fixed

- **`drizzle-orm` SQL injection.** ⚠ `packages/db/src/schema.ts` is imported by
  **nothing**. Every query in the application is hand-written parameterised SQL
  through `pg` (ADR-0003 makes the migrations the authority). The vulnerable
  code path is Drizzle's query builder, which never executes. The file's own
  comment says it "exists for type-safe queries"; there are none. Either give it
  a consumer or delete it — it is currently a dependency with no purpose.
- **`vitest` UI arbitrary file read.** Requires `vitest --ui`, which is never
  run here and is not in any script. Dev-only.
- **`vite` / `esbuild` / `postcss` / `sharp`.** Build-time, through Next and
  vitest. Not in a request path.

### Deferred, with reasons and a review date

| Package | Advisory | Fix requires | Assessment |
|---|---|---|---|
| `@fastify/middie`, `@nestjs/platform-fastify` | Middleware bypass (path normalisation, HEAD, trailing slash, URL encoding) | **Nest 10 → 11**, a major upgrade | ⚠ **The bypass is of MIDDLEWARE, and this API uses none.** `grep` for `configure(consumer`, `NestMiddleware` and `app.use(` returns nothing: authorisation is a `@RequirePermission` guard and tenancy is an interceptor, both of which run inside the router and after the path has been matched. A middie path-normalisation bypass therefore reaches a route whose guard still runs. Worth doing, not urgent. |
| `nodemailer` | addressparser ReDoS; `raw` bypasses `disableFileAccess` | **6 → 9**, a major upgrade | The `raw` option is never used. The ReDoS is reachable only through an address this system composes itself — recipients come from `users.email`, not from request input. |

**Review date: 2026-12-01**, or sooner if the API begins using Nest middleware,
or if any mail recipient ever becomes attacker-controlled.

⚠ **Never `pnpm audit --fix --force`.** Two of these are major upgrades that
cross declared ranges; they need reading changelogs and running the suites, not
a flag.

---

## What is deliberately NOT defended, and why

- **`audit_log` has no reader.** 91 distinct actions are recorded and no screen
  shows them. That mirrors El Ourwa, whose `journal_securite` is likewise only
  ever counted (for rate limiting) and never displayed. Recorded here so the
  absence is a decision rather than an oversight — and so that "we have an audit
  trail" is not mistaken for "we can consult it".
- **Reference data is readable by any staff role.** A teacher can list the
  school's levels and classes. That is what El Ourwa's sidebar does on every
  page, and narrowing it further would break the timetable and the mark sheet.
- **No certificate pinning in the Flutter app.** Pinning breaks the moment a
  certificate rotates, and a school in Nouakchott has nobody to ship an
  emergency build. HTTPS with the platform trust store is the right trade here.

---

## The check that keeps this honest

`apps/api/test/parent-cannot-read-school.spec.ts` asserts, for the roles as the
seed defines them, that a parent is refused on every endpoint that carries
another family's data — and that the secretary and the accountant are not. It
exists because the leak it describes was invisible to every other kind of test:
the pages rendered, the API answered 200, the types were satisfied, and the data
was wrong to be there at all.

`apps/api/test/permission-names.spec.ts` asserts that every permission named in a
`@RequirePermission` is one the catalogue actually grants. A name nobody holds
closes the endpoint to everyone, silently, and nothing in the type system catches
a string.
