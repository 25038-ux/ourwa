# El Ourwa — Domain Model, As I Understand It

**Status: corrected against PROJECT.md and ARCHITECTURE.md (session 1).** Written
for task 0.1 from `reference/elourwa/` (57 pages, 27 includes) and the 77-table
schema. Source of truth for every claim is the PHP or the DDL, cited inline.

> **Scope reversal — read this first.** An earlier session recorded ADR-0001
> "fresh start, no import". `PROJECT.md` and `PHASES.md` contradict it directly and
> supersede it: Phase 2 must import ~2,153 students and ~3,506 enrolments and
> reconcile to **zero discrepancy**, and reconciliation is described as the spine
> of the project. **The migration is happening.** See ADR-0001 in
> `docs/DECISIONS.md` for the reversal and what it changed.

## 0. Shape of the existing system

- **One school, one database — today.** Zero occurrences of `school_id` /
  `ecole_id` / `etablissement` in all 77 tables. El Ourwa has no branch, school or
  site concept anywhere.

  Toujounine (43), Arafat (74) and Ksar (45) occur only as student **address**
  values. They are *moughataas* (districts) of Nouakchott, not branches, and must
  never be used as school names in seed data or examples — doing so once already
  produced a hallucinated three-branch architecture.

  **Multi-tenancy exists for FUTURE branches**, not to reconcile existing ones.
  That makes the work easier, not harder: school #1 is imported under one
  `school_id`, and every later branch starts empty and clean. There is no merge
  problem to solve.

- **Two separate authentication realms**, deliberately partitioned:
  `includes/auth.php` for staff (`$_SESSION['utilisateur_id']`) and
  `includes/parent_auth.php` for parents (`$_SESSION['parent_id']`). The comment at
  `parent_auth.php:13` states the partition exists to prevent privilege crossing.
- Argon2id passwords, session fingerprinting (UA + first 3 octets of IP), per-account
  *and* per-IP brute-force lockout, and a session seal derived from the password hash so
  a password change invalidates live sessions (`auth.php:127`).
- Bilingual: French + Arabic (`includes/i18n.php`), language resolved from
  `?lang=` -> session -> cookie `EDUPLAT_LANG` -> `parents.langue` -> default `fr`.
- The UI is organised as two AJAX **hubs**, not 57 flat pages:
  - **Finance hub** (`super_admin/finance.php`) -> tabs: Caisse, Revenue Live, Rapport
    Mensuel, Paiement du personnel, Dettes, Depenses, Impayes, Administrateurs.
  - **Scolarite hub** (`super_admin/scolarite.php`) -> tabs: Emploi du temps, Absences,
    Groupes, Niveaux, Exclusions, Notes & bulletins.

  This matters for the web app's information architecture: the direction interface is
  really ~8 destinations, not 42.

---

## 1. The academic year is the system's clock

`annees_scolaires`: `libelle` ('2026-2027'), `annee_debut`, `mois_debut` (default 10),
`mois_fin` (default 6), `statut` in {future, active, cloturee}.

Everything — enrolments, grades, payments, bulletins, invoices — hangs off a year.
`annee_debut` is the canonical form: **2024 means 2024-2025**.

Live data: 2021-22 through 2025-26 closed, **2026-2027 active**, 2027-2028 future.

Rules extracted from `includes/annee_scolaire.php`:

| Rule | Where | Behaviour |
|---|---|---|
| A closed year is **read-only** | `refus_annee_close()` :67 | Rejects any write — payment, exemption, reduction, added/removed payable month, grade. The header calls retroactive writes "the most serious corruption possible here". |
| You may only enrol into an **open** year | `annee_cible_inscription()` :50 | No fallback. `annee_active()` would silently fall back to the newest row (a *future* year); the enrolment target deliberately does not. |
| Which school year a (month, calendar-year) pair belongs to | `annee_scolaire_du_mois()` :94 | Oct–Dec -> the year opening; Jan–Jun -> the year closing. |
| Payable months | `mois_payables_annee()` :123 | Derived from `mois_debut`/`mois_fin`, then `annee_scolaire_mois` is consulted only on **exact (month, calendar-year) couples** — that table is keyed by calendar year, so a naive `WHERE annee = 2026` returns both school years' months. |
| Year closure | `cloturer_annee()` :503 | `etudiant_inscriptions.statut` -> `archive`, year -> `cloturee`, next year created or promoted to `active`. **Nothing is deleted.** `etudiants.groupe_id` is deliberately *not* cleared (18 pages list students from it). |

**`etudiants.groupe_id` is a display cache** of the active year's class. The truth is
`etudiant_inscriptions.groupe_id` (`annee_scolaire.php:10`). Any port must read the
enrolment, never the cache — the debt engine already does exactly this
(`paiements.php:357`).

`annee_vue()` / `annee_avec_donnees()` add a subtlety: the UI opens on the most recent
year that actually *has* enrolments, not the administratively active one, because in
August the new year is empty and an empty screen reads as data loss.

---

## 2. Enrolment and the payment schedule

Chain: **year -> enrolment -> month schedule.**

`etudiant_inscriptions` (one row per student per year, `uq_insc(etudiant_id, annee)`)
carries the whole financial and academic contract for that year:

- `groupe_id`, `niveau_id`, `statut` in {inscrit, archive, bloque_dette, annule}
- `frais_mensuel` — **the negotiated monthly fee. This is the amount owed.**
- `tarif_plein` — the level's rate before reduction; `reduction_mensuelle` is the
  difference, printed as "Red (x)" on invoices
- `gratuit` — 1 means free schooling that year
- `frais_inscription` / `frais_document` / `frais_fourniture` with their `*_paye` and
  `exempte_*` flags
- `decision` in {en_cours, admis, ajourne, exclu} — the **end-of-year decision, carried
  by that year's enrolment**
- `date_entree` — real entry into *this* year; feeds the rule of the 25th

`creer_inscription()` (:170) is idempotent and writes both the enrolment and its month
schedule. Two documented historical gaps it closes: "Inscrire un etudiant" used to write
only to `etudiants` (so the student appeared in *no* year and could never be
re-enrolled), and **no application code ever populated `inscription_mois`** — its 28,881
rows all came from the legacy import, so an app-enrolled student had no months to bill:
invisible at the till, zero debt, empty schedule.

### The rule of the 25th

`premier_mois_du()` (:221): entered **on or before the 25th** -> the entry month is owed;
**after the 25th** -> the first owed month is the next one. Bounded to the year passed
in, so a date from another year can neither advance nor push back this year's first
month.

`creer_mois_inscription()` (:272) writes *all* payable months of the year into
`inscription_mois`, marking months before entry as `gratuit` at 0 — so the till grid
stays complete and readable while weighing nothing. It never touches a month already
invoiced or covered by an invoice.

`inscription_mois.statut` in {a_facturer, facture, gratuit}, plus `montant_du`,
`reliquat` (partial settlement), `couvert_facture`, `facture_source`.

### Progression

`refus_progression()` (:365): a student marked `ajourne` **does not move up a level**.
Cycle outranks `ordre` (fondamental -> college is a promotion even though `ordre`
restarts). Only a holder of `scolarite.niveaux` — the direction — can override; a
comptable or secretaire cannot.

### Annual family fees

Fees exist at **three levels**, and all three must be modelled — collapsing them would
quietly remove a capability the school already has:

| Level | Where | Role |
|---|---|---|
| 1. Global default | `configuration.frais_inscription` / `frais_photocopie` | Seeded to `'0'` by `INSERT IGNORE` at `finance.php:44`. Historic fallback. |
| 2. Per school year | `configuration.frais_inscription_<annee>` / `frais_photocopie_<annee>` | Written by `gestion_caisse.php:723-724`. The barème changes from one intake to the next, and **editing this year's must not rewrite the past** — the page refuses outright to edit a closed year's barème (`:715`), because that would rewrite the amount still owed by families whose accounts are settled. |
| 3. Per enrolment | `etudiant_inscriptions.frais_inscription`, `frais_document`, `frais_fourniture` (+ `exempte_*` flags) | The per-student override. **These are the columns actually carrying data**, and they are what lets the school charge one student differently from another. |

Read path at `gestion_caisse.php:1065`:
`config_get('frais_inscription_' . $annee, config_get('frais_inscription', '0'))` —
per-year key, falling back to global, falling back to zero.

**Current live state:** `configuration` holds six rows and none are year-suffixed, so
levels 1 and 2 both resolve to zero and no year has ever had these fees set. The
inscription-fee debt block *can* fire; today it always resolves to 0. Level 3 is where
the real money is.

`frais_exigibles_famille()` (:311): **inscription** and **photocopie** fees are due once
**per family per year**, not per child. The barème resolves
`frais_<type>_<annee>` then `frais_<type>` from `configuration`. Paid into
`parent_paiements_annuels`; waived via `parent_exemptions` (with `annee` NULL meaning all
years). If an elder sibling already paid, the remainder is zero and the UI says so
instead of charging twice (`encaissement_inscription.php:19`).

`encaissement_inscription.php` makes enrolment and re-enrolment end in the **same
modal**, collecting three amounts: first month of tuition, inscription fee, photocopy
fee. `encaissement_encaisser()` (:237) splits one payment total across those distinct
claims — **annual fees first, remainder to the month** — rather than inflating the month.

---

## 3. Bulletins — two calculation regimes

> ### ⚠ `note_absent = -1` is a MARKER, not a grade
>
> `configuration.note_absent = '-1'`. It records that a student was absent for an
> assessment. **It must be excluded before averaging, never summed as a number.**
>
> If -1 enters an average, every affected student's result is wrong and the error
> is silent — no exception, no empty screen, just a slightly-too-low mark that
> nobody can explain. `packages/shared/src/grades.ts` names the constant and the
> exclusion so it is a rule rather than a magic number repeated at each call site.
>
> `configuration.bulletin_mode_calcul = 'examen_seul'` is the other half of this,
> and **I have not yet traced where the PHP consumes it.** Per PHASES.md session
> 3.2 I am not guessing what "exam only" means — it is an open question below.


Shared code lives in `includes/bulletin.php` (calculation) and `bulletin_vue.php`
(layout), so the parent's copy and the direction's print are literally the same document.

Grades: `notes(etudiant_id, enseignement_id, trimestre, type_note in {devoir, examen},
numero_devoir)`, unique on that tuple. An `enseignement` is the (professeur, groupe,
matiere, annee) tuple. `matieres` carry `coefficient` and `note_sur` (the subject's own
scale — 5, 10, 20, 30 and 50 all occur).

### Regime A — classic (college / lycee)

`calculer_moyennes_groupe_calcul()` (:151), formula per (niveau, trimestre) from
`bulletin_formules`:

```
subject mean = (mean(devoirs) * coef_devoirs + examen * coef_examen) / diviseur
```

Defaults 2 / 3 / 5. `mode_calcul` in {examen_seul, pondere} — `configuration` currently
holds `bulletin_mode_calcul = 'examen_seul'`, described in the DDL as "regle historique
El Ourwa". If only one component exists it is returned as-is (`calc_moy_matiere()` :130).
A `diviseur` of 0 falls back to `coef_devoirs + coef_examen`, then to 1, so one bad level
config cannot flatten every bulletin.

Then: subjects not marked out of 20 are **rescaled** `moy * 20 / note_sur` (without this
the general average exceeded 20), and the general average is the coefficient-weighted
mean.

### Regime B — fondamental (`niveaux.fondamental = 1`)

`calculer_totaux_fondamental_calcul()` (:227):

```
subject mean = (mean(devoirs) + examen) / 2      -- on the subject's OWN note_sur
result       = sum of means  out of  sum of scales   -- a TOTAL, not an average
```

No rescaling, no coefficients. And `bulletin_moyennes.total_fr` carries **the Arabic
total** for the fondamental cycle — the DDL comment says this is the old software's
behaviour, *preserved identically*. This is exactly the kind of odd-looking behaviour
Part 4 rule 18 says usually encodes a real requirement.

Appreciation bands (`appreciation_pour()` :269): >=16 Tres Bien, >=14 Bien, >=12 Assez
Bien, >=10 Passable, otherwise Insuffisant. `niveaux.seuil_eliminatoire` (default 10) is
the pass mark per level. `configuration.note_absent = -1`.

Ranking: `bulletin_moyennes.rang`, indexed `(groupe_id, annee, trimestre, rang)`.

Performance note worth carrying over as a *requirement*, not an optimisation: printing a
class called `bulletin_donnees()` once per student and recomputed the whole group each
time — 333 students meant 2,110 queries for one page. Fixed by request-scoped memoisation
(`BulletinMemo`) plus `bulletin_precharger()`. Every write to `notes` must call
`bulletin_memo_vider()`. In the successor this becomes: **bulletin computation is a
group-level operation, materialised once.**

---

## 4. Money — the part that must reconcile exactly

### Stores

| Table | Holds |
|---|---|
| `paiements` | Tuition, one row per (student, month, calendar-year), unique. Unique `recu_numero`. |
| `parent_paiements_annuels` | Family annual fees (inscription, photocopie). |
| `paiement_lignes` | **Tender split** — polymorphic `(source_type, source_id)` -> `moyen_id`, `montant`, `sens` in {entrant, sortant}. One payment, N means of payment. |
| `factures` / `facture_lignes` / `facture_eleve_lignes` | Invoices: `total`, `total_encaisse`, `total_reste`, `statut` in {ouverte, soldee, annulee}. |
| `recus` | Receipts, with `montant_paye` / `montant_restant` / `total_facture`. |
| `dettes_familles` | Per-family, per-year debt: `arriere`, `reste_inscription`, `reste_livre`, `reste_fourniture`, `reste_mensualites`, `total`, `solde`, `type_dette` in {arriere, facture}. |
| `dettes` / `dette_remboursements` | Miscellaneous named debts (not necessarily tied to a student). |
| `remises_dette` | Debt write-offs by the direction — revocable, and **kept when revoked** for traceability. |
| `depenses`, `paiements_salaire`, `prets_personnel` / `prets_echeances` / `prets_remboursements`, `admin_retraits` | Outflows: expenses, payroll, staff loans with instalments, administrator withdrawals against `administrateurs.limite_mensuelle`. |
| `caisse_jours` | Daily till in/out, with `cloture`. |
| `compta_*` (7 tables) | A **double-entry accounting mirror**: chart of accounts, journals, entries, lines, third parties. Bilingual labels. `libelle_origine` is the legacy system's `Lib_cpt`. |

All money is `DECIMAL(10,2)` or `DECIMAL(12,2)`; accounting lines are `DECIMAL(14,2)`.
This aligns with the successor's `NUMERIC(14,2)` rule.

### The debt rule — single, agreed with the direction

`obtenir_dette_parent_detaillee()` (`paiements.php:430`). Verbatim from the header:

```
debt =  SUM of months ELAPSED, OWED and UNSETTLED
            (not free, not exempted, not already carried by an invoice)
     +  SUM of remainders of invoices issued and not settled
```

Explicitly **not** debt:

- a negotiated rate — `etudiant_inscriptions.frais_mensuel` *is* the amount owed; the
  gap to the level's full rate is never claimed;
- a monthly reduction — already deducted from `frais_mensuel`;
- a free month (`ei.gratuit = 1` or `inscription_mois.statut = 'gratuit'`);
- an exempted month (`exemptions`, or automatic exemption before effective entry);
- a month already carried by an invoice — the **invoice's remainder** counts, never the
  month, or it would be double-counted.

Then a third block adds **unpaid inscription and photocopy fees** for the open year (they
do not evaporate if not collected at enrolment). Finally `remises_dette` is subtracted;
`annule_tout = 1` zeroes the debt outright.

Guards that must not be lost:

- **Start-year floor.** `configuration.dette_mois_depuis_annee = 2024`. Years before it
  have neither invoices nor payments imported (2023-24: 10,134 months, zero recorded
  collections) — counting them would fabricate debt that never existed.
- **Only the truly-schooled year.** Unbilled months are claimed only for the last year
  with real enrolment, found as `MAX(annee) HAVING COUNT(*) >= 50` and *not* plain
  `MAX(annee)`, because the newly opened year may hold only a handful of re-enrolments.
  A student whose last enrolment is older has left; billing them invents a receivable
  (79 of 80 such students are flagged `sorti`).
- **Future months are not owed.** Anything past the current (month, year) is skipped.
- `dette_calculee_depuis = 2026` — the first year El Ourwa computes debt itself. Before
  that, `dettes_familles.solde` is the *arrested* figure the old software recorded,
  verified family by family (741 family/year pairs, zero discrepancy).

### Automatic exemption

`finance.php:435–600`. Months before a student's effective entry into *that specific
year* are auto-exempt. The bug this replaced is instructive: the old version took the
most recent of `date_inscription` / `date_reinscription` across *all* years and compared
every month against that single threshold. Result — 1,128 of 3,209 active enrolments
(35%) showed all nine months as "Exempte (avant inscription)" for non-free students, so
the school stopped claiming anything. And a re-enrolment writes *today's* date, which
retroactively exempted every past year at a stroke.

### Consistency check as a first-class feature

`controle_caisse()` (:682): every payment's `paiement_lignes` must sum to its amount. A
gap means an amount was recorded without a tender split — "the financial reports then
become wrong with nothing signalling it. We measure it instead of hoping." This is
essentially the reconciliation discipline Part 6.4 asks for, already present.

### Receipt numbering — two different things, only one a sequence

| Field | Type | Reality |
|---|---|---|
| `recus.numero` | `int(11)`, `KEY idx_recu_num`, **not unique** | A generated internal counter running 1, 2, 3… `factures.numero` and `factures.recu_numero` are likewise plain ints. |
| `recu_numero` | `varchar(50)` on `paiements` (UNIQUE), `parent_paiements_annuels`, `cs_paiements`, `admin_retraits`, `dette_remboursements`, `prets_remboursements` | A **free-text reference**, not a generated number. Every value in the live data is a migration marker (`MIG…`, `IMP-…`). The system does not own this numbering. |

The paper-receipt constraint is therefore looser than it first appears: what a family
holds is *transcribed* into a free-text field.

**Design decided for the successor:** per-branch sequences, each starting at 1, formatted
with a branch prefix — `TOU-2026-00001`. Rationale: a receipt should be meaningful within
the family's own school; a platform-wide sequence leaks how many receipts other branches
issue, which is commercially sensitive between schools; and gaps in a shared sequence
look like missing receipts to an auditor. The free-text reference field is **kept
alongside** it for the paper number.

Implementation: a `receipt_sequences (school_id, year, last_number)` row taken with
`SELECT … FOR UPDATE`. **Not `MAX(numero) + 1`, which races under concurrency.**

---

## 5. `origine` — data, not branding. Preserved, never dropped.

`origine ENUM('reprise','elourwa')` on 17 tables, with `'impute'` added on
`paiements`. **17,106 rows carry these values and financial reports key off it.**

- `'reprise'` — carried over from the software that preceded El Ourwa (hence
  `compta_plan.libelle_origine` = "Lib_cpt de l ancien systeme", and
  `bulletins.source_id` = "id dans bultins (ancien systeme)").
- `'elourwa'` — created natively.
- `'impute'` — `paiements` only: a reconstructed share of one global legacy
  collection split across months, with `montant_impute` recording how much was
  reconstructed rather than observed.

Maps on import to `origin ENUM('migrated','native','imputed')`
(ARCHITECTURE.md §6). **Never drop it** — the reconciliation logic needs it.

### One caveat the import must handle

Measured across all 15,989 `paiements` rows in the v13 dump: 15,625 are marked
`'elourwa'` and 364 `'impute'`; **none are marked `'reprise'`**. Yet every one of
those rows carries a migration-synthesised receipt reference
(`MIG<id>-<year>-<month>`, `IMP-<n>`), and there is not one natively-issued
receipt number in the table.

So on `paiements` the column was defaulted rather than set, and `'elourwa'` there
does not mean "created natively". A reconciliation check that partitions payments
by `origine` alone would mis-classify essentially the whole table. The importer
must derive origin for payments from the receipt reference, not the column, and
record which rule it applied.

## 6. Permissions

Two layers, with a documented fallback.

**Legacy layer:** `utilisateurs.role`, a single-valued ENUM
{super_admin, admin, professeur, collecteur_absence, secretaire, comptable}. Rights were
then hard-coded page by page (`require_role([...])`) — about 50 lists to maintain, never
combinable.

**Current layer** (`includes/permissions.php`): user -> **many roles** -> union of
permissions, via `roles` / `role_permissions` / `utilisateur_roles`. Seeded roles:
super_admin, admin, comptable, secretaire, collecteur_absence (all `systeme = 1`).

The permission catalogue lives **in code, not in the database**
(`referentiel_permissions()` :29) — the DB stores only grants. **24** permissions in
5 groups (6 + 5 + 5 + 3 + 5). An earlier draft of this document said 29; that was a
miscount:

- **Finance** — consulter, encaisser, depenser, dette, rapport, salaires
- **Scolarite** — inscrire, reinscrire, groupes, niveaux, `annees.gerer`
- **Pedagogie** — notes.saisir, notes.consulter, absences.saisir, absences.consulter,
  exercices.envoyer
- **Comptes** — parents, professeurs, staff
- **Divers** — messagerie.envoyer, demandes.traiter, statistiques.consulter,
  recherche.globale, journal.consulter

Two deliberate design decisions to carry over:

1. **Permissions are never cached in the session** (:14). They are re-read every request
   from two small indexed tables, because a session cache would let an agent keep revoked
   rights until next login — "precisely the hole we want to avoid".
2. Same for the admin tier: `palier_admin()` (`auth.php:448`) re-reads
   `personnel_admin.fonction` each request. Removing "Super Administrateur" from a
   logged-in admin previously did not revoke their finance access until logout.

Business rule on finance access (`auth.php:433`, marked "validated with the client"):
`super_admin` -> total; `admin` with fonction "Super Administrateur" -> total; `admin`
with any other fonction -> everything **except** finance.

### Password hashes are mixed — do not force a reset

`utilisateurs` holds both `$argon2id$` and `$2y$` (bcrypt) hashes. Verification
must accept **both**, then transparently re-hash to Argon2id on the next
successful login (PROJECT.md §2.8).

Forcing a reset instead would lock out 1,372 parents simultaneously — a support
event the school cannot absorb, caused entirely by an implementation detail they
did not choose.

Minor side note: bcrypt and Argon2 verification take measurably different times,
which leaks which hash type an account uses. Add a constant-time floor if this
matters.

`exiger_permission()` (:225): hiding a menu entry is **not** authorisation — every
sensitive page must call the server-side guard, and every sensitive POST must call it
again with the write permission.

---

## 7. Subsystems I would have missed reading only the page list

**Cours du soir** (evening classes) — `super_admin/cours_du_soir.php` is 89 KB and has
its own **eight-table parallel world**: `cs_groupes`, `cs_inscriptions` (which accepts
*external* students who are not `etudiants` at all — `externe_nom`, `externe_tel`),
`cs_enseignements`, `cs_emploi`, `cs_groupe_mois`, `cs_paiements`, `cs_paiements_profs`,
`cs_profs_externes`. It has its own monthly tariff, its own teacher payroll
(`type_salaire` in {fixe, horaire}, `prix_par_heure`, `heures_par_mois`), and its own
reductions (`reductions.contexte = 'cours_soir'`). **This is a second business, not a
feature.** It deserves its own phase.

**Staff loans and payroll** — `prets_personnel` with instalments
(`prets_echeances.retenu_salaire`), and `retenue_pret()` / `crediter_echeances_mois()` /
`imputer_avance_pret()` in `finance.php:601–710`. Loans are recovered by deduction from
salary. Beneficiaries are polymorphic: `beneficiaire_type` in {staff, professeur}.

**Administrator withdrawals** — `administrateurs.limite_mensuelle` caps monthly
withdrawals recorded in `admin_retraits`. Finance-tab access, hidden from comptables.

**Demandes** — `super_admin/demandes.php`, a request/approval workflow
(`demandes.statut = 'en_attente'` -> `decide_par`). The comptable raises, the direction
decides. This is a small approval engine, not a form.

**Parent notifications** — the `notifications` table carries `cle_i18n` + `params_i18n`,
so a notification is stored as a **translation key plus parameters** and rendered in the
parent's current language (`notif_titre()` / `notif_contenu()`). This is exactly the
right shape for push notifications in the Flutter app; carry it over as-is.

**Exclusions** — `expulsions` is keyed on `(nni, rim)`, *not* `etudiant_id`. An expelled
person is remembered by national ID even after the student record is gone, so they cannot
be re-enrolled. Note `etudiants.rim` and `etudiants.nni` are both `UNIQUE`.

---

## 8. Volumes to import (PROJECT.md Part 0)

| | |
|---|---|
| Students | ~2,153 |
| Parents | ~1,372 |
| Enrolments | ~3,506 |
| Staff accounts (`utilisateurs`) | 3 |
| Largest table | `notes`, ~139,000 rows |
| Database size | ~100 MB |

Small by Postgres standards — the engineering risk is **correctness and tenant
isolation, never throughput.** Two places where volume does bite, and both are
algorithmic rather than scale problems:

- **Bulletin printing.** `bulletins_classe.php` calls the bulletin builder once
  per student. Rebuild set-based (§3).
- **Grade import.** ~139,000 rows; batch 1,000 per statement and expect minutes.

## 9. Open questions

**Q1 — `bulletin_mode_calcul = 'examen_seul'`: where does the PHP consume it?**
I found the config key and the `bulletin_formules.mode_calcul` column, but not the
site that branches on it. PHASES.md session 3.2 says explicitly: if the
consumption site cannot be found, say so and ask rather than guessing what "exam
only" means. **Blocking for Phase 3, not before.**

**Q2 — the August boundary rule.** PHASES.md session 2.1 cites
`gestion_caisse.php:240` mapping a payment's month to a year via
`IF(month >= 8, year, year - 1)`, and calls it the August boundary rule. That is
month **8**, whereas `annees_scolaires.mois_debut` is **10**. Both appear real
and they disagree by two months. Which governs which calculation? Getting this
wrong misfiles September payments into the previous year.

**Q3 — the five debt buckets versus the debt rule in `paiements.php`.**
`dettes_familles` decomposes debt into `arriere`, `reste_inscription`,
`reste_livre`, `reste_fourniture`, `reste_mensualites`. But
`obtenir_dette_parent_detaillee()` computes debt live as "elapsed unsettled
months + unsettled invoice remainders". These are two different mechanisms.
`dette_calculee_depuis = 2026` suggests the live calculation took over from the
stored buckets that year. Confirm before Phase 4: are the buckets historical
record only, or still authoritative for years before 2026?

**Q4 — teachers cannot enter grades in v13.** `professeur/saisir_notes.php` is a
disabled redirect: "la saisie des notes a été déplacée vers l'espace
administration." PROJECT.md Phase 6.10 wants the web app responsive so teachers
can enter grades from a browser. Resolution taken: build grade entry behind the
existing `notes.saisir` permission and **do not grant it to the teacher role**.
Behaviour preserved exactly; one grant flips it when the school wants it.

**Q5 — the biggest pages are the least documented here.** `gestion_caisse.php`
(138 KB), `cours_du_soir.php` (89 KB), `reinscrire_etudiant.php` (51 KB),
`dette.php` (44 KB), `reinscriptions.php` (44 KB), `gerer_niveaux.php` (42 KB). I
read their headers and structure, not every branch. Each gets a line-by-line read
before it is ported; flagged so the summary is not mistaken for exhaustive.

**Q6 — `cours du soir` is a second business, not a feature.** 89 KB page, eight
dedicated tables (`cs_*`), its own tariffs, its own teacher payroll, and it
enrols **external** people who are not students of the school. PROJECT.md folds
it into Phase 6.9. It may deserve its own phase; raising it rather than deciding
it.
