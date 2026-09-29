# Parity Contract — every El Ourwa capability and its new home

**This file is how we guarantee nothing is lost.** One row per capability, derived from
the 57 actual pages, not from memory.

**Status legend:** ☐ Not started · ◐ In progress · ☑ Built and tested

⚠ **☑ means built, exercised by tests, and behaving as El Ourwa's source
describes. Whether it has been checked against a REAL figure now varies by row.**

Six reconciliations run on El Ourwa's own data — **88 measures, no divergence** —
and every money figure the platform shows has now been checked against the real
one:

- **Grade arithmetic** — 21 789 subject averages, 2 520 term averages (ADR-0054).
- **Reference data and enrolments** — 24 measures, the five fee sums to the
  centime (ADR-0055).
- **The marks themselves** — 139 457 grades at the (student, subject, term)
  level, the 60 formulas (ADR-0056).
- **Finance** — 42 614 000.00 collected, 34 479 000.00 outstanding on the
  schedule, by year, month, day, method and origin.
- **Payroll and recorded debts** — 30 853 394.00 in salaries, 5 151 372.00 in
  loans, 10 668 700.00 in debts.
- **The debt a family is asked for** — 1 714 200.00, **identical family by
  family** across all 1 372, after `DebtService` was aligned with El Ourwa's
  current-year rule (ADR-0057).

**Still unchecked against a real figure:** the evening school, absences and the
timetable — all EMPTY in the reference database, so there is nothing to compare
yet.

A row reaches ☑ only when it works **and** its behaviour matches El Ourwa's on the same
data. Where it touches money or grades that means a reconciliation check in
`tools/reconcile/` reporting zero discrepancy — not a judgement call. See the
`parity-check` skill.

⚠ **« Aucune ligne ouverte » n'a jamais voulu dire « chaque page est la
sienne ».** Une ligne ☑ dit qu'une CAPACITÉ existe et donne le même résultat ;
elle ne dit rien de la page — ses colonnes, ses messages, ses styles en ligne,
ses dynamiques. Le propriétaire l'a découvert sur « Paiement du personnel »
(ADR-0059). La mesure page par page est **`docs/parity/AUDIT-v23.md`** : une
ligne par page de `reference/v23`, avec ce qui a été refait, ce qui a été
retiré parce qu'inventé, et ce qui reste volontairement différent (ADR-0060).
C'est ce document, pas celui-ci, qui répond à « la page ressemble-t-elle à
la sienne ? ».

**Routing:** `super_admin/*` → Web · `professeur/*` → Web (role-scoped) · `parent/*` →
Mobile. The mobile app is parents only; teachers work in the responsive web app.

---

## Dead pages — carry no capability

Five of the 57 pages are redirects or disabled stubs. They are listed so the 57 is
accounted for, and are **not** ported.

| El Ourwa page | Reality |
|---|---|
| `super_admin/ajouter_etudiants.php` | Disabled. "L'ajout d'étudiants doit passer par Inscrire ou Réinscrire." Redirects to `inscrire_etudiant.php`. |
| `super_admin/creer_groupe.php` | Redirect — folded into `gerer_niveaux.php`. |
| `super_admin/creer_matiere.php` | Redirect — folded into `gerer_niveaux.php`. |
| `super_admin/reinitialiser_mdp.php` | Redirect — folded into `modifier_profil.php`. |
| `professeur/saisir_notes.php` | **Disabled: "La saisie des notes a été déplacée vers l'espace administration."** See the flag below. |

> ### ⚠ Behavioural conflict — teachers cannot enter grades in El Ourwa v13
>
> PROJECT.md Phase 6.10 assumes they can ("responsive down to phone width so teachers can
> enter grades from a browser"). El Ourwa v13 **removed** grade entry from teachers;
> it is admin/secretary only, via `super_admin/saisir_notes.php`.
>
> Per standing rule 18, odd behaviour usually encodes a real requirement — plausibly that
> the school wants marks entered centrally from paper, under one pair of eyes.
>
> **Resolution taken:** build grade entry behind the existing `notes.saisir`
> permission, and do **not** grant it to the teacher role by default. This preserves
> El Ourwa's behaviour exactly while making the capability available the moment the
> school wants it — no code change, one grant. Flagged as Q4 in `docs/DOMAIN.md`.

---

## Phase key — PROJECT.md Part 3

| Phase | Theme |
|---|---|
| 0 | Foundation and environment |
| 1 | Identity and access |
| 2 | Academic core |
| 3 | Grades and report cards |
| 4 | Finance |
| 5 | Parent mobile app |
| 6 | Web app, full parity |
| 7 | Migration and cutover |
| 8 | Platform layer |

Phase numbers below are **PROJECT.md's**. An earlier draft of this file used its
own 1–9 numbering; that has been remapped.

---

## Foundation — no El Ourwa equivalent

New capabilities the successor requires that El Ourwa never had (it is single-school).

| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 1 | — | Tenant table convention: `school_id`, RLS enabled **and forced**, policy, composite index, scoped uniques | API | 0 || ☑ |
| 2 | — | Per-request tenant context via `set_config(..., true)` inside a transaction | API | 0 || ☑ |
| 3 | — | RLS cross-tenant isolation test wired into CI as a build gate | API | 0 || ☑ |
| 4 | — | Subdomain → school resolution (`*.localhost`, custom domain later) | Web | 0 || ☑ |
| 5 | — | Per-school branding (name, logo, colours) driven by tenant | Web | 0 || ☑ |
| 6 | — | Per-school currency, stored explicitly, never assumed | API | 0 || ☑ |
| 7 | — | Platform admin: create a school branch | Web | 0 | ☑ |
| 8 | — | Platform admin: appoint a branch administrator | Web | 0 | ☑ |
| 9 | — | Per-branch receipt sequences (`NOUR-2026-00001`) via `SELECT … FOR UPDATE` | API | 4 || ☑ |
| 10 | — | Platform admin: enter any branch without re-login (impersonation, audited) | Web | 8 | ☑ |
| 11 | — | Platform admin: combined cross-branch financial reporting (BYPASSRLS job, never in a request path) | Web | 8 | ☑ |
| 12 | — | Push notifications to parent devices — FCM v1, outbox `outbound_push`, seven event kinds, grade masked on the lock screen | Mobile | 5 | ☑ |
| 13 | — | Persistent parent login (refresh token rotation + reuse detection) | Mobile | 5 || ☑ |

## Cross-cutting — `includes/`

| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 14 | `includes/auth.php` | Staff authentication, Argon2id | API | 1 | ☑ |
| 15 | `includes/auth.php` | Session fingerprint (UA + IP /24) on the refresh token; mismatch revokes the family. Rotation on every use replaces ID regeneration | API | 1 | ☑ |
| 16 | `includes/auth.php` | Brute-force lockout per account **and** per IP | API | 1 | ☑ |
| 17 | `includes/auth.php` | Session seal from password hash — carried in the access token, re-checked on **every** request | API | 1 | ☑ |
| 18 | `includes/auth.php` | Account `active` and platform-admin flag re-read per request in `AuthGuard` | API | 1 | ☑ |
| 19 | `includes/parent_auth.php` | Guardian authentication by phone number, **separate realm** from staff | API | 1 | ☑ |
| 20 | `includes/parent_auth.php` | Phone normalisation as stable identifier (`+222 12 34 56 78` ≡ `12345678`) | API | 1 | ☑ |
| 21 | `includes/permissions.php` | User → many roles → union of permissions | API | 1 | ☑ |
| 22 | `includes/permissions.php` | 24-permission catalogue as data in `role_permissions`, never hardcoded | API | 1 | ☑ |
| 23 | `includes/permissions.php` | Permissions re-read every request, **never session-cached** — was token-cached for 15 min until 2026-09-11 | API | 1 | ☑ |
| 24 | `includes/permissions.php` | Server-side guard on every sensitive page and POST | API | 1 | ☑ |
| 25 | `includes/csrf.php` | CSRF protection — the API is Bearer-only (no ambient credential); the web app uses `SameSite=Lax` httpOnly cookies and Next.js Server Actions' origin check | API | 1 | ☑ |
| 26 | `includes/security_headers.php` | Security headers — CSP with per-request nonce, HSTS, nosniff, frame-ancestors, Referrer-Policy, Permissions-Policy, COOP/CORP, `no-store` on the API | API | 1 | ☑ |
| 27 | `includes/i18n.php` | French + Arabic, with RTL layout — the parent space (its i18n module's scope); staff pages are French-only in El Ourwa too | Web+Mobile | 6 | ☑ |
| 28 | `includes/i18n.php` | Language resolution: `?lang=` → device preference → `users.locale` (via `/auth/me`, written by `POST /auth/locale`) → `fr` | Web+Mobile | 6 | ☑ |
| 29 | `includes/pagination.php` | Pagination — **cursor-based, no OFFSET** — `grep OFFSET apps/api/src` finds none | API | 0 | ☑ |
| 30 | `includes/upload.php` | File upload handling (homework attachments) | API | 3 | ☑ |
| 31 | `includes/cache.php` | Caching layer — in-process TTL cache, tenant-prefixed, at its two call sites: parent unread count (60 s) and family debt at the exam gate (60 s) | API | 0 | ☑ |
| 32 | `journal_securite` | Security/audit log | API | 1 | ☑ |

## Academic core → Phase 2

| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 33 | `annees_scolaires.php` | Create an academic year (label, start month, end month) | Web | 2 || ☑ |
| 34 | `annees_scolaires.php` | List years with status future/active/closed | Web | 2 || ☑ |
| 35 | `annees_scolaires.php` | Close a year: archive enrolments, open the next | Web | 2 || ☑ |
| 36 | `annee_scolaire.php` | Select which months of the year are billable | Web | 2 | ☑ |
| 37 | `includes/annee_scolaire.php` | **A closed year is read-only** — reject every write | API | 2 || ☑ |
| 38 | `includes/annee_scolaire.php` | Enrolment permitted only into an open year (no fallback to a future year) | API | 2 || ☑ |
| 39 | `includes/annee_scolaire.php` | Payable months derived from year definition, matched on exact (month, calendar-year) couples | API | 2 || ☑ |
| 40 | `includes/annee_scolaire.php` | Year selector in the header; open on the last year with real data | Web | 2 || ☑ |
| 41 | `gerer_niveaux.php` | Manage levels: name, monthly rate, cycle, order, fondamental flag, pass mark | Web | 2 || ☑ |
| 42 | `gerer_niveaux.php` | Create a class group (folded in from `creer_groupe.php`) | Web | 2 || ☑ |
| 43 | `gerer_niveaux.php` | Create a subject with coefficient and its own max score (from `creer_matiere.php`) | Web | 2 || ☑ |
| 43a | `gerer_niveaux.php` | **Drill-down** `?niveau_id=` — the level's classes, headcount history and subjects | Web | 2 || ☑ |
| 43b | `gerer_niveaux.php` | Edit the monthly rate in place (`modifier_tarif`) | Web | 2 || ☑ |
| 43c | `gerer_niveaux.php` | Edit the pass mark in place (`modifier_seuil`) — always out of 20 | Web | 2 || ☑ |
| 43d | `gerer_niveaux.php` | Toggle « fondamental » (`basculer_fondamental`) | Web | 2 || ☑ |
| 43e | `gerer_niveaux.php` | Edit a subject's scale (`modifier_note_sur`), fondamental levels only | Web | 2 || ☑ |
| 43f | `gerer_niveaux.php` | Delete an empty level / an unused class — **refused otherwise**, ADR-0022 | Web | 2 || ☑ |
| 43g | `gerer_niveaux.php` | Cycle intertitles, and the two count columns that decide what is offered | Web | 2 || ☑ |
| 43h | `gerer_niveaux.php` | « Statistiques — évolution des effectifs », N vs N-1 — computed, ADR-0023 | Web | 2 || ☑ |
| 44 | `gestion_groupes.php` | Hierarchical Level → Groups → Students browser | Web | 2 || ☑ |
| 45 | `gestion_groupes.php` | Move a student between class groups | Web | 2 | ☑ |
| 46 | `gestion_groupes.php` | Class group capacity and headcount | Web | 2 | ☑ |
| 47 | `gerer_professeurs.php` | Manage teachers: identity, status (permanent/interim), contact | Web | 2 | ☑ |
| 47a | `gerer_professeurs.php` | `mettre_a_jour_tarif` — the contract clears the other side | Web | 2 | ☑ |
| 47b | `gerer_professeurs.php` | « Assignations existantes » with `modifier_heures` and the monthly cost | Web | 2 | ☑ |
| 48 | `gerer_professeurs.php` | Assign a teaching assignment (teacher × group × subject × year) | Web | 2 | ☑ |
| 49 | `inscrire_etudiant.php` | Create a new student (RIM + NNI, both unique) | Web | 2 | ☑ |
| 50 | `inscrire_etudiant.php` | Attach to an existing guardian, or create a guardian account | Web | 2 | ☑ |
| 50a | `inscrire_etudiant.php` | **« Parent existant » is the default** — the safe half of the choice | Web | 2 | ☑ |
| 50b | `inscrire_etudiant.php` | « Mot de passe initial » chosen by the office; blank generates one, ADR-0026 | Web | 2 | ☑ |
| 50c | `inscrire_etudiant.php` | Class occupancy in the option — "6ème — 6ème A (28/30)" | Web | 2 | ☑ |
| 50d | `inscrire_etudiant.php` | `majFrais()` — choosing a class fills « Frais mensuel (MRU) » from the level | Web | 2 | ☑ |
| 50e | `inscrire_etudiant.php` | « Lieu de naissance » — free text, ADR-0019 | Web | 2 | ☑ |
| 51 | `inscrire_etudiant.php` | Create the enrolment for the target year | Web | 2 || ☑ |
| 52 | `inscrire_etudiant.php` | Generate the month-by-month payment schedule | Web | 2 || ☑ |
| 53 | `includes/annee_scolaire.php` | **Rule of the 25th** — first owed month from entry date | API | 2 || ☑ |
| 54 | `includes/annee_scolaire.php` | Months before entry written as free at 0, so the till grid stays complete | API | 2 || ☑ |
| 55 | `includes/annee_scolaire.php` | Idempotent re-enrolment: restore status, fill missing months, never overwrite billed ones | API | 2 || ☑ |
| 56 | `reinscrire_etudiant.php` | Re-enrol an existing student into the new year | Web | 2 || ☑ |
| 57 | `includes/annee_scolaire.php` | **Progression rule** — a `heldBack` student may not move up a level; cycle outranks order | API | 2 || ☑ |
| 58 | `reinscrire_etudiant.php` | Direction override of the progression rule | Web | 2 || ☑ |
| 59 | `reinscriptions.php` | Bulk re-enrolment — repopulate the active year's classes | Web | 2 | ☑ |
| 59a | `reinscriptions.php` | Candidates grouped BY FAMILY, the debt stated once per household | Web | 2 | ☑ |
| 59b | `reinscriptions.php` | Blocked families sorted first — « celles qui demandent une decision » | Web | 2 | ☑ |
| 59c | `reinscriptions.php` | The debt broken down line by line, from the SAME source as the total — ADR-0035 | Web | 2 | ☑ |
| 59d | `reinscriptions.php` | `autoriser` — a stored decision with the amount frozen, not a flag — ADR-0037 | Web | 2 | ☑ |
| 59e | `reinscriptions.php` | `dette_creer` / `dette_modifier` / `dette_annuler` — the créance fold | Web | 2 | ☑ |
| 59f | `reinscriptions.php` | `remise` — « la remise réduit réellement la dette », unlike an authorisation | Web | 2 | ☑ |
| 59g | `reinscriptions.php` | A blocked or already-enrolled pupil's checkbox is greyed, as its `disabled` does | Web | 2 | ☑ |
| 59h | `reinscriptions.php` | Reserved to direction and secretariat — the accountant is not on this screen — ADR-0038 | Web | 2 | ☑ |
| 60 | `expelled.php` | List expelled people (blocked by NNI + RIM, surviving record deletion) | Web | 2 | ☑ |
| 61 | `expelled.php` | Unblock an expelled person | Web | 2 | ☑ |
| 62 | `inscrire_etudiant.php` | Record an end-of-year outcome (pending/passed/heldBack/expelled) | Web | 2 || ☑ |
| 63 | `scolarite.php` | Schooling hub navigation | Web | 2 | ☑ |
| 64 | `tableau_bord.php` | Direction dashboard — enrolment and headcount tiles | Web | 2 || ☑ |

## Collecting money → Phase 4

| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 65 | `gestion_caisse.php` | Guardian list, searchable by name **or** phone | Web | 4 || ☑ |
| 66 | `gestion_caisse.php` | Per-child month grid showing paid / owed / free / exempt | Web | 4 | ☑ |
| 67 | `gestion_caisse.php` | Record a tuition payment for a month | Web | 4 || ☑ |
| 68 | `includes/paiements.php` | Split one payment across N payment methods (tender lines) | Web | 4 || ☑ |
| 69 | `gestion_caisse.php` | Manage payment methods (administration only, not accountants) | Web | 4 || ☑ |
| 70 | `includes/finance.php` | Print a receipt — the shared document used by every transaction type | Web | 4 | ☑ |
| 71 | `gestion_caisse.php` | Grant a full or monthly exemption | Web | 4 | ☑ |
| 72 | `includes/finance.php` | **Automatic exemption** for months before effective entry, scoped to that year only | API | 4 | ☑ |
| 73 | `gestion_caisse.php` | Set the annual fee scale per year (`configurer_frais_annuels`) | Web | 4 | ☑ |
| 73a | `gestion_caisse.php` | Waive an annual fee for one family and one year, and take the waiver back | Web | 4 | ☑ |
| 73b | `gestion_caisse.php` | Its four badges: Exempté · ✓ Payé · Partiel · Non payé — and « Non défini » for a fee nobody set | Web | 4 | ☑ |
| 73c | `gestion_caisse.php` | « Paiements des frais annuels » with receipt numbers, and the annual-fee receipt document | Web | 4 | ☑ |
| 74 | `includes/annee_scolaire.php` | Three-level fee resolution: per-enrolment → per-year config → global default | API | 4 || ☑ |
| 75 | `includes/annee_scolaire.php` | Annual family fees (inscription, photocopy) due once per family per year | API | 4 || ☑ |
| 75a | `gestion_caisse.php` | The correspondent's **name and telephone** at the head of the till screen | Web | 4 | ☑ |
| 75b | `gestion_caisse.php` | Year selector, with « — aucun inscrit » and « • en cours » | Web | 4 | ☑ |
| 75c | `gestion_caisse.php` | « Historique des remises » — who granted it, when, why, and whether revoked | Web | 4 | ☑ |
| 75d | `gestion_caisse.php` | `annuler_remise` — a second recorded act; the debt is restored | Web | 4 | ☑ |
| 74a | `cours_du_soir.php` | `appliquer_reduction_cs` — a reduction on one month of one evening enrolment | Web | 4 | ☑ |
| 74b | `cours_du_soir.php` | `retirer_reduction_cs` — and the month returns to the full rate | Web | 4 | ☑ |
| 74c | `cours_du_soir.php` | The till is offered the REDUCED figure, and refused more — ADR-0034 | Web | 4 | ☑ |
| 74d | `cours_du_soir.php` | `annuler_paiement_prof_cs` — a reversing entry, never a delete — ADR-0033 | Web | 4 | ☑ |
| 74e | `cours_du_soir.php` | `assigner_prof` / `retirer_prof`, and « Professeurs assignés » | Web | 4 | ☑ |
| 74f | `cours_du_soir.php` | « Emploi du temps (Grille des créneaux) » — 7 jours × 7 créneaux — ADR-0039 | Web | 4 | ☑ |
| 74g | `cours_du_soir.php` | `placer_creneau` — la matière doit être l'une de celles du groupe | Web | 4 | ☑ |
| 74h | `cours_du_soir.php` | `effacer_creneau`, derrière son « Effacer ce créneau ? » | Web | 4 | ☑ |
| 74i | `cours_du_soir.php` | Le professeur unique d'une matière est présélectionné dans la modale | Web | 4 | ☑ |
| 76 | `encaissement_inscription.php` | Enrolment collection modal: first month + annual fees in one window | Web | 4 | ☑ |
| 77 | `encaissement_inscription.php` | Split one total across claims — annual fees first, remainder to the month | API | 4 | ☑ |
| 78 | `includes/paiements.php` | **Debt engine** — elapsed unsettled months + unsettled invoice remainders, never both for one month | API | 4 || ☑ |
| 79 | `includes/paiements.php` | Debt excludes negotiated rates, discounts, free months, exempt months | API | 4 || ☑ |
| 80 | `includes/paiements.php` | Debt start-year floor, and "last year with real enrolment" guard | API | 4 | ☑ |
| 81 | `includes/paiements.php` | Future months are never owed | API | 4 || ☑ |
| 82 | `dette.php` | Debt management screen, per family | Web | 4 | ☑ |
| 83 | `dette.php` | Grant a write-off (partial or total), revocable and retained when revoked | Web | 4 | ☑ |
| 84 | `impayes.php` | List guardians who owe money | Web | 4 || ☑ |
| 85 | `reinscrire_etudiant.php` | Debt check blocking re-enrolment | Web | 4 | ☑ |
| 86 | `reinscrire_etudiant.php` | Authorise re-enrolment despite debt (recorded, with reason) | Web | 4 | ☑ |
| 87 | `depenses.php` | Record an expense | Web | 4 | ☑ |
| 88 | `includes/finance.php` | Monthly discount on a month's fee | Web | 4 | ☑ |
| 89 | `includes/paiements.php` | **Till consistency check** — tender lines must sum to the payment; measure the gap | API | 4 || ☑ |
| 90 | `caisse_jours` | Daily cash summary (in / out / closed) | Web | 4 | ☑ |
| 91 | `finance.php` | Finance hub navigation | Web | 4 | ☑ |
| 92 | `tableau_bord.php` | Direction dashboard — financial tiles | Web | 4 || ☑ |
| 93 | `gestion_caisse.php` | Notify guardians of an unpaid month | Web | 4 | ☑ |

## Grades, report cards, attendance → Phases 3 and 6

| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 94 | `saisir_notes.php` | Enter grades by Level → Group → Subject, per term | Web | 3 | ☑ |
| 95 | `saisir_notes.php` | Coursework marks (numbered) and exam mark per subject | Web | 3 | ☑ |
| 96 | `gerer_niveaux.php` | Configure the report-card formula per level and term | Web | 3 | ☑ |
| 97 | `includes/bulletin.php` | **Regime A** — weighted mean `(coursework×2 + exam×3)/5`, configurable | API | 3 || ☑ |
| 98 | `includes/bulletin.php` | Rescale subjects not marked out of 20 before averaging | API | 3 || ☑ |
| 99 | `includes/bulletin.php` | **Regime B (fondamental)** — `(coursework + exam)/2`, summed as a total out of the sum of scales | API | 3 || ☑ |
| 100 | `includes/bulletin.php` | Arabic total in the fondamental total field — **nothing to port**: `total_ar` is NULL on all 5 792 rows, unread anywhere in the source, every row inherited from the previous software | API | 3 | ☑ |
| 101 | `includes/bulletin.php` | Class ranking per term | API | 3 || ☑ |
| 102 | `includes/bulletin.php` | Performance bands (Très Bien … Insuffisant) | API | 3 || ☑ |
| 103 | `includes/bulletin.php` | Group-level computation, materialised once — never per-student recomputation | API | 3 | ☑ |
| 104 | `notes_etudiants.php` | View a report card, bilingual FR + AR | Web | 3 | ☑ |
| 105 | `bulletins_classe.php` | Print every report card for a class as one document | Web | 3 | ☑ |
| 106 | `gerer_absence.php` | Record attendance: Level → Group → students, present/absent/late | Web | 3 | ☑ |
| 107 | `gerer_absence.php` | Mark an absence excused | Web | 3 | ☑ |
| 108 | `emploi_du_temps.php` | Build the weekly timetable (day × slot → teaching assignment) | Web | 6 | ☑ |
| 108a | `emploi_du_temps.php` | Its three steps: level → group → grid, with its own title and « 6ème — 6ème A » | Web | 6 | ☑ |
| 108b | `emploi_du_temps.php` | « Matières du groupe et quotas hebdomadaires » — ⌊heures ÷ 2⌋, visible before the click | Web | 6 | ☑ |
| 108c | `emploi_du_temps.php` | **✓ Valider et publier** — one notification per household; an empty grid is refused | Web | 6 | ☑ |
| 109 | `envoyer_exercice.php` | Administration sends homework to any group, with attachments and a due date | Web | 6 | ☑ |
| 110 | `professeur/tableau_bord.php` | Teacher dashboard — `prof/page.tsx`, `classesForTeacher()`, `teacher-roster.spec.ts` (vérifié 2026-09-11) | Web | 6 | ☑ |
| 111 | `professeur/mes_classes.php` | Teacher's own classes, grouped by level | Web | 6 | ☑ |
| 112 | `professeur/emploi.php` | Teacher's own timetable | Web | 6 | ☑ |
| 113 | `professeur/envoyer_exercice.php` | Teacher sends homework to one of their own groups | Web | 6 | ☑ |
| 114 | `professeur/remarques.php` | Teacher leaves a remark on a student, with severity | Web | 6 | ☑ |
| 115 | `professeur/*` | Role-scoped teacher view — own classes and subjects only; `rosterForTeacher()` refuses another teacher's group, `teacher-roster.spec.ts` (vérifié 2026-09-11) | Web | 6 | ☑ |

## Parent mobile app → Phase 5

| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 116 | `parent/tableau_bord.php` | Parent dashboard across all their children | Mobile | 5 | ☑ |
| 117 | `parent/enfant.php` | Detailed child profile | Mobile | 5 || ☑ |
| 118 | `parent/bulletin.php` | View and download the official report card — **the same document the school prints** | Mobile | 5 || ☑ |
| 119 | `parent/resultats.php` | Results and grades by term | Mobile | 5 || ☑ |
| 120 | `parent/absences.php` | Child's absences | Mobile | 5 | ☑ |
| 121 | `parent/remarques.php` | Remarks about the child | Mobile | 5 | ☑ |
| 122 | `parent/exercices.php` | Homework list with attachments — `exercices_tab.dart` renders `attachments`, `attachments.spec.ts` (vérifié 2026-09-11) | Mobile | 5 | ☑ |
| 123 | `parent/messages.php` | Messages from the school, with a read stamp | Mobile | 5 | ☑ |
| 124 | `parent/changer_mdp.php` | Change password; forced change on first login | Mobile | 5 | ☑ |
| 125 | `api/parent/notifications.php` | Notification feed — the bell, its count, mark one / mark all | Mobile | 5 | ☑ |
| 125a | `api/parent/notifications.php` | **`grade` notifications withheld from a family in debt**, count under the same filter — ADR-0025 | API | 5 | ☑ |
| 125b | `api/parent/notifications.php` | Scoped to the year; a NULL year is invisible to parents | API | 5 | ☑ |
| 126 | `includes/parent_auth.php` | Notifications stored as translation key + parameters, rendered in the parent's language | API | 5 | ☑ |
| 127 | `parent/*` | **One app for every branch.** A guardian logs in with one number, no school chosen; children in two branches come from two schools, each read under its own RLS and labelled (ADR-0061 §1) | Mobile | 5 | ☑ |
| 127a | `parent/*` | **Mauritanian phone number, strictly**, as the app's identifier — at login, admission and identifier change (ADR-0061 §2) | API · Mobile | 5 | ☑ |
| 128 | `parent/*` | Arabic RTL layout throughout | Mobile | 5 || ☑ |

## Payroll, reporting, accounts → Phases 1, 4 and 6

| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 129 | `ajouter_staff.php` | Add and manage staff — `accounts/forms.tsx`, `accounts.spec.ts`; `staff.role_title/salary/hired_on` (vérifié 2026-09-11) | Web | 4 | ☑ |
| 130 | `paiement_staff.php` | Pay a salary to staff or a teacher for a month | Web | 4 | ☑ |
| 131 | `paiement_staff.php` | Teacher pay by hourly rate × hours, or fixed | Web | 4 | ☑ |
| 132 | `paiement_staff.php` | Grant a staff loan | Web | 4 | ☑ |
| 133 | `includes/finance.php` | Loan instalments recovered by salary deduction | API | 4 | ☑ |
| 134 | `includes/finance.php` | Apply an advance repayment across outstanding instalments | API | 4 | ☑ |
| 135 | `administrateurs.php` | Fund holders: monthly withdrawal limit | Web | 4 | ☑ |
| 136 | `administrateurs.php` | Record a withdrawal against the limit, with a receipt | Web | 4 | ☑ |
| 137 | `administrateurs.php` | Withdrawal reports per fund holder and period | Web | 4 | ☑ |
| 138 | `rapport_financier.php` | Monthly financial report | Web | 6 | ☑ |
| 139 | `revenue_live.php` | Live revenue view — `finance/revenue/page.tsx` (453 lines, its three tile styles), `byPaymentMethod`/`dailyCollections` in `tender.spec.ts` (vérifié 2026-09-11) | Web | 6 | ☑ |
| 140 | `statistiques.php` | Distribution by sex by level and group — `statistiques/page.tsx`, `ReportsService.statistics()` (vérifié 2026-09-11) | Web | 6 | ☑ |
| 141 | `recherche.php` | Global search across students and teachers | Web | 6 | ☑ |
| 141a | `recherche.php` | Pupil profile: nine fields, mark sheet, expulsion | Web | 6 | ☑ |
| 141b | `recherche.php` | Teacher profile: six fields, teachings by level | Web | 6 | ☑ |
| 142 | `historique.php` | Login history, staff and parents | Web | 6 | ☑ |
| 143 | `demandes.php` | Accountant raises an internal request (type, amount, description) | Web | 6 | ☑ |
| 144 | `demandes.php` | Direction approves or refuses, with a comment | Web | 6 | ☑ |
| 145 | `messagerie.php` | Send a message to parents (individually or in bulk) | Web | 6 | ☑ |
| 146 | `creer_utilisateur.php` | Create a staff user account and assign roles | Web | 1 | ☑ |
| 147 | `comptes_staffs.php` | Manage staff accounts: accountants, secretaries, absence collectors | Web | 1 | ☑ |
| 148 | `comptes_profs.php` | Manage teacher accounts; reset password | Web | 1 | ☑ |
| 149 | `comptes_parents.php` | Manage guardian accounts; view identifier; reset password | Web | 1 | ☑ |
| 150 | `modifier_profil.php` | Edit own profile and change own password | Web | 1 | ☑ |
| 151 | `administrateurs.php` | Manage roles and their permission grants | Web | 1 | ☑ |

## Evening classes → Phase 6.9

A separate business sharing a login: its own groups, tariffs, teachers and payroll, and it
enrols external people who are not students of the school.

| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 152 | `cours_du_soir.php` | Create an evening group with a monthly tariff | Web | 6 | ☑ |
| 153 | `cours_du_soir.php` | Choose which months an evening group runs | Web | 6 | ☑ |
| 154 | `cours_du_soir.php` | Enrol an existing student in an evening group | Web | 6 | ☑ |
| 155 | `cours_du_soir.php` | Enrol an **external** person (name, phone, sex) not in the student body | Web | 6 | ☑ |
| 156 | `cours_du_soir.php` | Register an external teacher | Web | 6 | ☑ |
| 157 | `cours_du_soir.php` | Evening teaching assignment: hourly rate × hours, or fixed salary | Web | 6 | ☑ |
| 158 | `cours_du_soir.php` | Evening timetable (day × slot) | Web | 6 | ☑ |
| 159 | `cours_du_soir.php` | Collect an evening-class payment for a month, with receipt | Web | 6 | ☑ |
| 160 | `cours_du_soir.php` | Pay an evening teacher for a month | Web | 6 | ☑ |
| 161 | `includes/finance.php` | Evening-class discounts — own table, not a `contexte` column on `discounts`, so a day-school debt query can never subtract one | API | 6 | ☑ |
| 167 | `cours_du_soir.php` | Cancel an evening teacher's payment — a reversing entry, not a `DELETE`; the tender returns by the means it left | API | 6 | ☑ |

## Platform layer → Phase 8

| # | El Ourwa page | Feature | Target | Phase | Status |
|---|---|---|---|---|---|
| 162 | — | Platform admin dashboard across all branches | Web | 8 | ☑ |
| 163 | — | Combined financial reporting across branches | Web | 8 | ☑ |
| 164 | — | Enter a branch without re-login, fully audited | Web | 8 | ☑ |
| 165 | — | Per-branch configuration: currency, branding, domain | Web | 8 | ☑ |
| 166 | — | Suspend or archive a branch | Web | 8 | ☑ |
| 167 | — | **Cumulative dashboard across branches** — today's takings and spending, the month, the year, per-source detail, twelve-month report; Decimal sum only under one currency (ADR-0061 §4) | Web | 8 | ☑ |
| 168 | — | **Platform admins create platform admins** with the same privileges; provisional password, forced change, deactivation (never self, never the last) (ADR-0061 §3) | Web | 8 | ☑ |

### Sweep of 2026-09-06 — the three spaces the first sweep never opened

The first parity pass covered the 57 administration pages. It touched neither
the teacher space, nor the parent space, nor the printed documents. Each row
below is a capability that **existed in El Ourwa and did not exist here**, or
existed in a form that answered a different question.

| # | El Ourwa | Capability | Where | Phase | Done |
|---|---|---|---|---|---|
| 167 | `professeur/tableau_bord.php` | A teacher sees their own hourly rate and monthly pay | Web | 6 | ☑ |
| 168 | `professeur/tableau_bord.php` | « Détail de mon salaire mensuel » — one line per teaching | Web | 6 | ☑ |
| 169 | `professeur/mes_classes.php` | One row per GROUP, subjects concatenated, effectif / capacité | Web | 6 | ☑ |
| 170 | `professeur/mes_classes.php` | « Voir les étudiants » — the class roster, guarded server-side | Web | 6 | ☑ |
| 171 | `professeur/emploi.php` | Its empty state, and the footer saying the timetable is the administration's | Web | 6 | ☑ |
| 172 | `professeur/envoyer_exercice.php` | Attachments: drop zone, 5 files, 5 MB, size shown before sending | Web | 6 | ☑ |
| 173 | `professeur/envoyer_exercice.php` | « Exercice envoyé. N parent(s) notifié(s) » — the count is the point | Web | 6 | ☑ |
| 174 | `professeur/remarques.php` | Its « — Choisir — »: no pupil pre-selected on a remark a family will read | Web | 6 | ☑ |
| 175 | `parent/enfant.php` | Its tabs scoped to ONE child, not the whole family | Mobile | 5 | ☑ |
| 176 | `parent/enfant.php` | Its header figures: total absences and average, with their red thresholds | Mobile | 5 | ☑ |
| 177 | `parent/enfant.php` | Its « Matricule » — the child's rank in class | Mobile | 5 | ☑ |
| 178 | `parent/enfant.php` | Absences bounded by the year, and counting `absent` **and** `retard` | API | 5 | ☑ |
| 179 | `parent/exercices.php` | Attachments reach the family: image thumbnails, PDF cards | Mobile | 5 | ☑ |
| 180 | `includes/bulletin_vue.php` | The official State header: republic, motto, ministry, in both languages | Web | 3 | ☑ |
| 181 | `includes/bulletin_vue.php` | Its six bilingual information rows, including matricule and guardian | Web | 3 | ☑ |
| 182 | `includes/bulletin_vue.php` | Term recap, annual average, appreciation, threshold, admission verdict | Web | 3 | ☑ |
| 183 | `includes/bulletin_admission.php` | « Non évalué » for an unmarked pupil — never « Ajourné » | API | 3 | ☑ |
| 184 | `includes/bulletin_admission.php` | The one-hundredth tolerance, and the gendered bilingual verdict | API | 3 | ☑ |
| 185 | `includes/bulletin_vue.php` | Signature and observation areas, and the unsigned-document warning | Web | 3 | ☑ |
| 186 | `bulletins_classe.php` | One sheet per child (`bulletin-lot`), from the SAME component | Web | 3 | ☑ |
| 187 | `dette.php` | « Nouvelle dette » stays withdrawn — the school lends only to its staff | Web | 4 | ☑ |
| 188 | `dette.php` | The loan form on the debts page, with its explanatory paragraph | Web | 4 | ☑ |
| 189 | `dette.php` | Instalment months spanning several years, past months struck through | Web | 4 | ☑ |
| 190 | `gestion_caisse.php` | Its two per-child buttons: « Frais » and « Exemption du frais » | Web | 4 | ☑ |

| 191 | `gestion_groupes.php` | Retirer un élève de sa classe — sans détruire ses paiements | Web | 2 | ☑ |
| 192 | `gestion_groupes.php` | La liste de la classe, dépliée sous le groupe (le lien était mort) | Web | 2 | ☑ |
| 193 | `gerer_professeurs.php` | Supprimer un professeur — refusé par le schéma si des notes en dépendent | Web | 2 | ☑ |
| 194 | `cours_du_soir.php` | Sa colonne « Mois payés » — l'année entière en pastilles | Web | 4 | ☑ |
| 195 | `cours_du_soir.php` | Ses DEUX formulaires d'inscription, et la recherche d'étudiant | Web | 4 | ☑ |
| 196 | `dette.php` | `rembourser` — les lignes de moyens écrites en caisse (source `dette`), « dépasse le reste dû », numéro `REMB-Ymd-…`, profil `?dette_id=` (trois cartes, historique avec `resume_moyens`), reçu `?print_recu_remb=` (ADR-0061 §5) | Web · API | 4 | ☑ |

⚠ **What this sweep says about the last one.** Three of these defects were not
oversights but **judgements I made against an explicit instruction to
replicate** — a consolidated panel, a relocated form, a redesigned document.
Each was defensible; none was asked for. See ADR-0048.

---

## Ce qu'on ne porte PAS, et pourquoi

A row here is a capability El Ourwa has that this system deliberately does not.
Each is a decision with an ADR, not an omission.

| El Ourwa | Why not | ADR |
|---|---|---|
| `supprimer_etudiant` (`gestion_groupes.php`) | Deletes the child's notes AND their paiements. A child who leaves is an exclusion or a status change; deleting the row deletes the money. | 0028 |
| `supprimer_niveau`'s cascade | Deletes notes, paiements, étudiants, enseignements, groupes, matières. Refused unless empty — which is the only case its own button offers. | 0022 |
| `supprimer_groupe`'s cascade (both schools) | Same. Refused once anybody has been enrolled. | 0022 · 0028 |
| `effectifs_annuels` | Snapshotted on every page load: the render path mutates data, and "last year" is whatever the table caught. Computed from enrolments instead. | 0023 |
| « Mois non facturés » | **Not missing.** El Ourwa retired it itself — `total_non_facture => 0.0` with the note "tout est desormais dans la dette". The block never renders in v16. | — |

---

## Totals

| PROJECT.md phase | Rows |
|---|---:|
| 0 — Foundation and environment | 10 |
| 1 — Identity and access | 20 |
| 2 — Academic core | 35 |
| 3 — Grades and report cards | 22 |
| 4 — Finance | 45 |
| 5 — Parent mobile app | 20 |
| 6 — Web app, full parity | 36 |
| 8 — Platform layer | 7 |
| **Total** | **195** |

⚠ **AUDIT DU 2026-09-07 : 45 lignes étaient marquées ☐ alors qu'elles sont
bâties**, et la 46ᵉ — suspendre une branche — a été bâtie dans la foulée parce
que l'audit a montré que la console en affichait déjà l'état. Chaque ☐ a été vérifiée contre le code, pas contre le souvenir : la
route, le composant ou le test qui la porte est cité dans le commit d'audit.

Un registre qui annonce « pas commencé » sur des fonctions livrées est **pire
qu'aucun registre** : il noie les quelques lignes qui ne sont vraiment pas
faites, et personne ne sait plus lesquelles regarder avant une bascule.

**Ce qui reste réellement à faire**, après l'audit :

⚠ La couche plateforme, elle, était la plus mal décrite : huit de ses lignes
(créer une branche, y nommer un administrateur, y entrer sans se reconnecter,
le rapport financier consolidé, la configuration par branche) sont bâties et
testées. Seule la suspension ne l'est pas.

| # | Quoi | Pourquoi ce n'est pas fait |
|---|---|---|
| 12 | Notifications push vers les téléphones | **Fait le 2026-09-11.** FCM v1 depuis une file `outbound_push` ; sept événements ; la note masquée sur l'écran verrouillé. |
| 12b | Notifications : chaque maillon se lit, test poussé par le serveur | **Fait le 2026-09-23.** Profil → Notifications ; `POST /parent/devices/status`, `POST /parent/devices/test` ; réveil de la file à l'écriture. ADR-0071. |
| 12c | Plusieurs numéros de téléphone par famille | **Fait le 2026-09-23** (0041, `user_phones`) — n'existe pas chez El Ourwa. Comptes → Parents → Numéros ; dossier de la famille ; connexion par n'importe lequel. ADR-0071. |
| 12d | Bulletin en PDF déposé dans Téléchargements | **Fait le 2026-09-23.** Composé sur le téléphone (`bulletin_pdf.dart`), MediaStore. ADR-0071. |
| 12e | Menu du site sur téléphone (tiroir) | **Fait le 2026-09-23.** `#sidebar-toggle` et le tiroir de `app.js` portés (`tiroir-navigation.tsx`). ADR-0072. |
| 12f | Mise à jour du serveur en une commande | **Fait le 2026-09-23.** `deploy/elmourad/mettre-a-jour.sh`. ADR-0072. |
| 12g | Facturation « services » (Jinan) : modes d'étude, frais d'inscription par élève, services optionnels | **Fait le 2026-09-29** — n'existe pas chez El Ourwa. Base et API (0042) ; site : page Frais, inscription, réinscription (modale, recherche, lot), fenêtre d'encaissement, fiche du correspondant (bloc Services, sous-lignes de mois, Reçu, ✕, exempter, arrêter, ajouter, changer de mode), reçu groupé, note des impayés. `e2e/jinan-facturation.spec.ts`. ADR-0073 et son addendum (décisions D1–D6 confirmées le 29/09). |
| 12j | La secrétaire lit les moyens de paiement (encaisser à l'inscription) | **Fait le 2026-09-29**, décision du propriétaire. ADR-0076. |
| 12h | Absences des professeurs et des agents, d'après leur emploi du temps | **Fait le 2026-09-29** — n'existe pas chez El Ourwa. 0043 (`staff_work_hours`, `personnel_absences`) ; `/personnel/absences` : journée, synthèse du mois, horaires des agents. Aucune retenue sur la paie (confirmé). ADR-0074. |
| 12i | IP et domaine de production de Jinan en un seul endroit | **Fait le 2026-09-29.** `deploy/jinan/configurer-production.sh`, `production.env`. ADR-0075. **En attente de l'IP et du domaine réels.** |
| 27, 28 | Interface web en arabe, avec RTL | L'application **parent** est bilingue (fr/ar, RTL) ; l'interface **web** du personnel est en français seul. El Ourwa a les deux. |
| 31 | Couche de cache | Phase 0, jamais commencée. Rien ne la réclame pour l'instant. |
| 100 | Le total arabe du fondamental | **Tranché le 2026-09-11 : rien à porter.** `total_ar` vide sur 5 792 lignes, jamais lu. |

Phase 7 (migration and cutover) carries no parity rows: it ports no El Ourwa
capability, it moves the data.

57 El Ourwa pages accounted for: 52 carrying capability, 5 dead stubs.

⚠ **The row count moved because the sweep of 2026-09-02 split rows that had been
written too coarsely.** "Manage levels" was one row and is nine actions; the
annual-fee block was one row and is four. A row that names a screen rather than
an action cannot be checked, and three of the four annual-fee actions turned out
to have **no endpoint at all** while the row read ☑ beside them. When adding a
row, name the thing a person does — `modifier_seuil`, `annuler_remise` — not the
page it is on.
