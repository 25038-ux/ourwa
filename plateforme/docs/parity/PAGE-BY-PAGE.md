# Page-by-page parity audit — rendered, not read

**First pass:** 2026-09-04 · **Closed:** 2026-09-05
**Method:** both applications running, every page fetched and its rendered DOM
fingerprinted (headings, labels in order, selects, inputs, buttons, table
columns, alerts), then diffed. Conditional panels driven in a real browser.

- El Ourwa v16 — PHP 8.3 on `127.0.0.1:8080`, MySQL 8.4 `elourwa_ref`
- Ours — Next.js on `nour.localhost:3000`, API on `:3001`

⚠ **This audit replaced reading the PHP and porting from it.** Every previous
parity pass compared *source* to *source*. That is how a page can carry every
feature and still not be the same page: the words, the order, the sections and
the columns are what the office actually uses, and none of them are visible in a
list of actions. Nineteen pages differed. All nineteen are closed.

---

## Read this first: four ways this audit lied to me

Kept in full, because each one cost a wrong conclusion and each is a trap the
next person will walk into.

1. **A tool that cannot see a thing reports it absent.** My first extractor
   collected `a.btn` and `button`, so it missed every `<a class="hub-tab">` and
   reported both hub pages missing when both were present and correct.

2. **Conditional UI cannot be fetched — it must be driven.** Five findings were
   false: the hub pages; the « Nouveau parent » branch of `inscrire_etudiant`;
   the per-assignment hourly rate (only shown for an `interim`); `gerer_absence`'s
   Groupe and Créneau selects (only after a level is chosen); and « Calcul »,
   which I filed as a stray label and which is the name of a school subject.

3. **Compare like with like.** « ⚠Exclusions » against « ⚠ Exclusions » looked
   like a spacing bug and was two different extractors: identical markup, and the
   same `gap` on `.hub-tab` in the same stylesheet on both sides.

4. **An empty reference database looks like a working screen.** `elourwa_ref`
   has 0 students. A page that renders nothing renders nothing *identically*.
   Anything data-dependent was re-checked against our seeded database instead.

⚠ And the same shape bit twice in the code: **a `.catch()` that returns an empty
list turns a broken query into "nothing to show".** It hid a table name that did
not exist (`user_roles` for `user_school_roles`) on `/journal`, and a report that
threw on every single call on `/finance/administrateurs`. Both now distinguish
"empty" from "could not read".

---

## Running the two side by side

```bash
# El Ourwa — MySQL 8.4 then PHP 8.3, from the WAMP install already on this machine
/c/wamp64/bin/mysql/mysql8.4.7/bin/mysqld.exe --defaults-file=/c/wamp64/bin/mysql/mysql8.4.7/my.ini &
cd "reference/v16/src" && /c/wamp64/bin/php/php8.3.28/php.exe -S 127.0.0.1:8080 -t . &
```

`reference/v16/src/config/database.local.php` already points at `elourwa_ref` on
`127.0.0.1:3306`. Ours runs as usual on `nour.localhost:3000` / `:3001`.

⚠ **The reference copy has three user accounts and no students.** A throwaway
`parite_lab` super_admin was added to it so the pages can open at all —
`utilisateurs` + `utilisateur_roles`, nothing else touched, no existing account's
password changed. It is a local copy; the live system is untouched, as rule 22
requires. Its session expires quickly — re-login through
`espace-direction.php` with the CSRF field, not `index.php` (that is the parent
door and redirects to `parent_connexion.php`).

⚠ **A hub tab must be fetched with `?embed=1`** to see what the office sees.
`layout_header.php` returns before the page header in that mode, so a fragment
has no `<h1>` and no subtitle of its own.

⚠ **Fetch El Ourwa with a Windows-visible cookie jar.** A Python `subprocess`
gets Windows `curl.exe`, which reads `/tmp/lab.txt` as `C:\tmp\lab.txt` and
silently sends no cookie — every page then comes back as a redirect, i.e. empty,
i.e. looking like trap 4 above.

---

## Result

| | Pages |
|---|---|
| Matching | **35** — every page with an El Ourwa equivalent |
| Deliberately different, recorded | **8** (below) |
| Open, needs a migration decision | **1** — the « Année » column on the créances table |

---

## What the sweep actually found

The page-by-page diff closed the wording and layout gaps it was built for. It
also, indirectly, found seven defects that had nothing to do with wording — each
one reached by asking "what does *their* button do?" or "which screen calls this
endpoint?".

### Money and grades

| # | Defect | Where it came from |
|---|---|---|
| 1 | **The debt gate counted 1 of its 4 terms.** A family whose arrears sat entirely in `misc_debts` walked through re-enrolment owing nothing. | ADR-0035 |
| 2 | **Eight composite FKs could never fire their `ON DELETE`.** | ADR-0036 |
| 3 | **No screen could record a withdrawal.** Service, ceilings, report and permission all existed; the third category of « Paiement du personnel » did not. Money could not leave the till at all. | commit `40853e8` |
| 4 | **The withdrawal report threw on every call**, in all three periods — three parameters sent, one or two referenced, so Postgres could not type the rest. A `.catch()` printed « Aucun retrait sur cette période ». | `40853e8` |
| 5 | **Deleting an assignment erased its grades**, silently — `grades.teaching_id` cascades. The reasoning was already written two functions away, on `deleteSubject`. | ADR-0042 |
| 6 | **Its evening twin erased the salaries already paid** — `evening_teacher_payments` cascades the same way. | ADR-0042 |
| 7 | **The platform tariff was a JS `number`**, and the tiles rounded it, so « 600 × 751 » sat beside a total of 450 330. | `bc936cf` |

### Security

| # | Defect |
|---|---|
| 8 | **`POST /platform/tariff` asserted no authority at all** — the one console handler that skipped `assertPlatformAdmin`, on routes whose *only* gate is that call. Any signed-in account could change what every school is billed, and the action is audited, so it left a tidy-looking trace. |
| 9 | **`leaveBranch` likewise** — it only writes an audit row, which is exactly why it needed the guard: the school id comes from the caller, so anyone could forge an `impersonation_ended` entry against any school. |
| 10 | **`GET /admissions/guardians` returned 200 families with no search term** — names, emails, phones. Unused, duplicated by `/students/guardians/search`, and it defeated the two-character floor that route was deliberately built around. Removed. |

### Missing screens for working endpoints

Found by listing all 226 API routes and asking which ones no page calls. Eight
had no caller; three were real gaps, one was a mislabel in my own tool, four are
correctly unused.

| Route | Outcome |
|---|---|
| `POST /payroll/withdrawals` | **Screen built** — the « Administrateurs » category of Paiement du personnel. |
| `GET /search/student/:id`, `/search/teacher/:id` | **Built** — El Ourwa's two profile cards; its search led somewhere and ours led nowhere. |
| `POST /platform/tariff` | **Form built**, on the Facturation card. |
| `POST /auth/logout-all` | **Button built** — « Fermer toutes mes sessions ». El Ourwa cannot have this; its sessions are PHP sessions. Ours are named, stored, revocable tokens. |
| `GET /grades/sheet/:teachingId` | **False positive** — my sweep took the first `@Controller` in the file for every route in it. `/notes` calls it. |
| `GET /health`, `GET /attachments/integrity` | Infrastructure and a reporting job. Correct. |
| `GET /attendance/student/:id`, `GET /timetable/teacher/:id` | No El Ourwa equivalent — its profile shows marks and assignments, not attendance or a week. Left in place, unused. |

---

## Deliberately different — decided, not overlooked

| Ours | El Ourwa | Why |
|---|---|---|
| **« ⚠ Expell » blocks the identity; the record survives** | `DELETE FROM etudiants` | Its cascade takes the enrolments, payments and debt with it. The blocking is on NNI+RIM precisely so it outlives a deleted record — it never needed the deletion. **ADR-0041** |
| **No « Supprimer » on a teacher; the column is « Gérer »** | « Supprimer » | `professeurs → enseignements → notes`, cascading twice, behind « Supprimer ce professeur ? ». **ADR-0042** |
| **Password reset is `super_admin` only** | `require_staff_admin()` — super_admin *or* admin, plus no self-service anywhere | Owner's decision, 2026-09-04. Stricter than El Ourwa. `/forgot` and `/reset` deleted. |
| **The fiche shows the tariff of the *enrolment*** | `tarif_mensuel ?? frais_mensuel` — the level's first | It is the screen you open in front of the parent. A family with a discount owes 12 000 where the level says 20 000. **ADR-0040** |
| **Cursor pagination** | `OFFSET` | Standing rule 17. |
| **A `cycle` of four values** | a `fondamental` boolean | Load-bearing: `refuseProgression()` orders cycles to decide what counts as a promotion. Owner: keep ours. |
| **« Envoyés » on `/messages`, « Justifiée » on the register, « Reporter les affectations », « Mes sessions », generated temporary passwords** | absent | Each earns its place; each is listed here so it is a choice and not a drift. |
| **`/comptes` is a table** | per-person cards | Same actions, same order. A table holds 40 accounts on screen where its cards hold 4. |

---

## Open — needs a decision, not more work

**The « Année » column on the créances table** (`reinscriptions.php`, the
« Gérer les créances » fold). Its seven columns are Année · Élève · Type ·
Réclamé · Restant dû · Note · Actions. Ours has six: the year is missing, and
where it derives a *type* (« Reliquat facture n° 12 » / « Arriéré ») ours shows
the free-text `reason`.

Neither can be fixed from the UI: `misc_debts` has no year and no invoice link,
and `dettes_familles` has both. Adding them is a migration — rule 16 says stop
and ask. Deriving the year from `created_at` would be wrong in the one case that
matters: a 2024-2025 arrear recorded in September 2026 would read 2026.

The column header stays « Motif », which is honest about what our column holds.
A header saying « Type » over free text would be the lie the audit exists to
catch.

---

## Also verified, and correct as they stand

- **« Ajouter des étudiants » is disabled in El Ourwa itself.** The modal is in
  the markup; the handler answers « L'ajout direct d'étudiants est désactivé.
  Utilisez le bouton "Inscrire un étudiant" ». Not having it is better than a
  dead end that says so after fifteen names are typed.
- **`/re-enrol/bulk` opening on an empty list** is the seed's shape, not a
  defect: its origin year defaults to `target.start_year - 1`, exactly as
  `annee_cible_inscription()` and `$precedente` do. El Ourwa carries a comment
  about the bug it once had here (`nettoyer_entier(0)` returning `0`, so its `??`
  never fired and the page opened on a nonexistent year); ours never had it.
- **`gerer_absence.php` has Niveau, Groupe, Date, Créneau/Matière, « Tous
  présents », « Tous absents »** — I had filed the last four as ours. Trap 2.

---

## Closed in this pass

| What | Where |
|---|---|
| Hub title changed under the operator on **13 of 14** pages | every `finance/*` and `scolarite/*` page |
| `historique.php` — **no column matched**; it was a log of *attempts*, its page shows the day's *connections* | `/journal`, rebuilt, plus its index (migration 0023) |
| `annees_scolaires.php` had no page of its own | `/annees`, with « Rendre active » and the « Réinscriptions » link that is the real entry to the bulk screen |
| `administrateurs.php` — no way to add one, and both report sections missing | `/finance/administrateurs` |
| `gerer_professeurs.php` — six columns, two of them invented, « Salaire mensuel » missing | `/comptes/professeurs`, eight columns in its order |
| `ajouter_staff.php` was wired to the account-creation form — it creates a *file*, not a login | `/comptes/staff`, seven fields |
| `comptes_staffs.php` offered six roles; it checks four, each with its explaining sentence | `/comptes`, migration 0024 |
| ⚠ …and narrowing them alone would have stripped a super-admin's or a teacher's role on the first save | `setRoles` now preserves what the screen does not offer; a test holds it |
| `modifier_profil.php` — one of its three cards missing | `/profile`, « Modifier mon identifiant de connexion » |
| Its evening timetable grid, 7×7 | `/evening`, migration 0021 |
| Wording, in twelve places: « Créer le **N**iveau », « **Sujet** * », « Masculin »/« Féminin », « Rechercher **un** correspondant », « Titre de l'exercice * »… | throughout |
| « Paiement du personnel » — three categories, default Staff, and the title that names it | `/finance/staff` |
| The absence register's heading was the *subject* name, which reads as a section title when the subject is called « Calcul » | `/scolarite/absence` |

Four Playwright tests asserted titles the office never sees; they now assert the
shell's, with the evidence in the comment.

---

## How to re-run this

The two extractors live in the session scratchpad rather than the repo — they are
throwaway, and a checked-in scraper rots faster than the pages it checks. What is
worth keeping is the shape:

1. Log into the PHP lab through `espace-direction.php`, keeping the cookie jar at
   a **Windows** path.
2. Fetch each page with `?embed=1`; strip tags; pull `h1`–`h4`, `label`, `th`,
   `button`, `a.btn`, `a.hub-tab`, `option`, `.alert` **in document order**.
3. Do the same on our side from inside the browser (`fetch` + `DOMParser`), so
   the session cookie is the real one and the DOM is the rendered one.
4. Diff per route. Then **open the disagreements in a browser** before believing
   any of them.
