# Glossary — French domain term → English code term

**Binding once written.** El Ourwa's source is French; this codebase is English.
Inconsistent translation causes real bugs — a `discount` that is sometimes a monthly
price reduction and sometimes a write-off of debt already owed will eventually be applied
in the wrong place, and in this system that means money.

Every term below is fixed. If a translation turns out to be wrong, change it *here first*
and then in code — never the other way round, and never introduce a synonym.

Section 4 lists terms that were genuinely ambiguous and how they were resolved. Section 5
lists the ones still open.

---

## 1. Conventions

| Rule | Detail |
|---|---|
| **Spelling** | US spelling in **code identifiers** (`enrollment`, `canceled`, `authorization`). UK spelling is acceptable in prose and comments. This is stated because `enrolment`/`enrollment` appears constantly and a split would be silent and pervasive. |
| **Reserved words** | `class` is reserved in TypeScript and Dart — a *groupe* is `group`, **never** `class`. `request` collides with HTTP — a *demande* is **never** `request`. `collection` collides with arrays/Firestore — generic containers are **never** `collection` in this codebase, because *encaissement* owns that word. |
| **Money** | Any identifier holding money ends in `Amount`, `Fee`, `Total`, `Balance` or `Rate`, and is `NUMERIC(14,2)` / `decimal.js` / string. Never a bare number. |
| **Booleans** | Positive form. `isFree`, not `isNotPaying`. |
| **Table naming** | `snake_case` plural in Postgres, `camelCase` in TypeScript, matching the English term below. |

---

## 2. Core academic domain

| French | English code term | Definition | El Ourwa source |
|---|---|---|---|
| année scolaire | `academicYear` | The school's unit of time: opens in a chosen month (Oct) and closes in another (Jun). `annee_debut` 2024 means 2024-2025. Everything hangs off it. | `annees_scolaires`, `includes/annee_scolaire.php` |
| clôture | `closure` / `closeYear()` | End-of-year operation: enrollments archived, year marked closed, next year opened. Nothing deleted. | `cloturer_annee()` :503 |
| trimestre | `term` | One of three assessment periods. Not "quarter" — there are three. | `notes.trimestre`, `bulletins.trimestre` |
| niveau | `level` | Grade level (6ème, 3 AF…). Carries the full monthly rate, the pass mark and the cycle. **Not** `grade` — see §4. | `niveaux`, `gerer_niveaux.php` |
| cycle | `cycle` | `maternelle` \| `fondamental` \| `college` \| `lycee` \| `autre`, in that order (lists and promotions). `maternelle` added 2026-09-30 (0045, Jinan) — absent from El Ourwa. Outranks `ordre` when deciding whether a move is a promotion. Labels in `@elourwa/shared/cycles`. | `niveaux.cycle` |
| maternelle | `maternelle` (kept) | Pre-school cycle (TPS, PS, SM, GS…), before the fondamental. Not in El Ourwa. | — |
| fondamental | `fondamental` (kept) | The Mauritanian basic-education cycle. **Deliberately not translated** — see §4. | `niveaux.fondamental` |
| groupe | `group` (table `groups`, type `Group`) | A class section within a level ("7D 1"), with a capacity. Table name follows ARCHITECTURE.md §6. In TS/Dart never name a variable `class` — it is reserved. | `groupes`, `gestion_groupes.php` |
| effectif | `headcount` | Number of students in a class group **for a given year**, counted from `enrollments`. ⚠ El Ourwa snapshots it into `effectifs_annuels` on every page load; we do not — see ADR-0023. | `effectifs_annuels` |
| matière | `subject` | A taught subject, with a `coefficient` and its own `note_sur` scale. | `matieres`, `creer_matiere.php` |
| enseignement | `teaching` (table `teachings`) | The (teacher, group, subject, academicYear) tuple. Grades and homework hang off it, not off the subject. | `enseignements` |
| dérogation | `derogation` | The direction lifting the exam-results block for one family, with a mandatory reason. Revoked, never deleted. Direction-only. | `derogations_examens`, `derogations.php` |
| accès examens | `examTermAccess` | The RATCHET: a term earned by settling stays earned even if the family falls back into debt. Recorded, because it cannot be recomputed later. | `acces_examens_trimestre` |
| remise | `writeOff` | Forgiving a debt already incurred. ⚠ NOT `réduction`/`discount`, which lowers what will be charged. | `remises_dette` |
| emploi du temps | `timetable` | Weekly grid of (day, slot) → teachingAssignment. **Not** `schedule` — see §4. | `emplois_du_temps`, `emploi_du_temps.php` |
| lieu de naissance | `placeOfBirth` | Free text, often a moughataa of Nouakchott, often not — Guerou is 300 km away. ⚠ **NOT an address**: `etudiants` has no address column. See ADR-0019. | `etudiants.lieu_naissance` |
| moughataa | (no code term) | A district of Nouakchott. Appears as a **place of birth** value. ⚠ **Never a branch or a school name.** | `etudiants.lieu_naissance` |
| seuil d'admission | `passMark` | The mark, always **out of 20**, at or above which a level's average is `Admis`. ⚠ Out of 20 even where the subjects are marked on /50 — it is compared against the rescaled general average. | `niveaux.seuil_eliminatoire` |
| barème (d'une matière) | `maxScore` | What one subject is marked out of — /50, /30, /20. Only meaningful on a `fondamental` level. | `matieres.note_sur` |
| notification | `notification` | The event **stream**: an absence recorded, a mark entered, an exercise given, a timetable published. ⚠ NOT `message`, which is the messagerie — a person writing to a person. | `notifications`, `api/parent/notifications.php` |
| valider / publier (un emploi du temps) | `publish` | Announcing a finished timetable to every family in the class. One notification per **household**, not per child. | `emploi_du_temps.php`, action `valider` |
| identifiant (de connexion) | `identifier` | What a person types to sign in: an email OR a telephone. ⚠ For a family it is the **telephone**, and telephone numbers change — `changer_identifiant` is not an edge case. | `utilisateurs`, `parents.telephone` |
| assignation / enseignement | `teaching` | (teacher × group × subject × year). ⚠ `hours_per_week` is TWO things: an intérimaire's pay (hours × rate × 4) and the timetable quota (⌊heures ÷ 2⌋). | `enseignements` |
| cours du soir | `evening` | A separate school: its own groups, tariffs, teachers and enrolees — some of whom are not students here at all. Receipts share ONE series with the day school. | `cs_*` tables |
| professeur externe | `eveningTeacher` | Teaches evening classes and is not on the day staff. ⚠ Putting them on the staff roll to pay them would put them in the payroll, the headcount and the statistics. | `cs_profs_externes` |
| étudiant / élève | `student` | | `etudiants` |
| parent / correspondant | `guardian` | The fee-paying adult. El Ourwa uses *parent* in the table and *correspondant* at the till; both mean the same party. One term chosen — see §4. | `parents`, `gestion_caisse.php` |
| professeur | `teacher` | | `professeurs` |
| staff / personnel | `staff` | Non-teaching employees. | `staff`, `personnel_admin` |
| utilisateur | `user` | A staff login account. Distinct from `guardian`, which is a separate auth realm. | `utilisateurs` |

---

## 3. Enrollment, grading, money

### Enrollment

| French | English code term | Definition | El Ourwa source |
|---|---|---|---|
| inscription | `enrollment` | One student in one academic year. Carries the whole financial and academic contract for that year. | `etudiant_inscriptions` |
| réinscription | `reEnrollment` | Enrolling a returning student into the new year. | `reinscriptions`, `reinscrire_etudiant.php` |
| décision | `outcome` | End-of-year verdict carried by *that year's* enrollment: `en_cours`→`pending`, `admis`→`passed`, `ajourné`→`heldBack`, `exclu`→`expelled`. | `etudiant_inscriptions.decision` |
| ajourné | `heldBack` | Held back a year. Such a student may not move up a level except by direction override. | `refus_progression()` :365 |
| expulsion / exclusion | `expulsion` | Barred from re-enrolling. Keyed on national ID, not student id, so it survives record deletion. | `expulsions`, `expelled.php` |
| sorti | `hasLeft` | Student no longer attending. Stops all further billing. | `etudiants.sorti` |
| date d'entrée | `entryDate` | Real entry into *this* year. Drives the rule of the 25th. | `etudiant_inscriptions.date_entree` |
| règle du 25 | `dayOfMonthCutoff` | On or before the 25th → entry month is owed; after → the next month is the first owed. | `premier_mois_du()` :221 |
| demande | `approvalRequest` | A request raised by an accountant for the direction to approve or refuse. **Not** `request`. | `demandes`, `demandes.php` |

### Grading

| French | English code term | Definition | El Ourwa source |
|---|---|---|---|
| note | `grade` | A single mark. `type_note` is `devoir`\|`examen`. | `notes` |
| devoir (as a mark type) | `coursework` | Continuous assessment. **Distinct from homework** — see §4. | `notes.type_note` |
| examen | `exam` | End-of-term examination. | `notes.type_note` |
| exercice | `homework` | An assignment sent to parents with attachments and a due date. | `exercices`, `envoyer_exercice.php` |
| note sur | `maxScore` | The subject's own scale (5, 10, 20, 30, 50 all occur). | `matieres.note_sur` |
| coefficient | `coefficient` | Subject weight in the general average. | `matieres.coefficient` |
| moyenne | `average` | Weighted mean out of 20. For *fondamental* levels the equivalent figure is a **total**, not an average — see §4. | `bulletin_moyennes.moyenne` |
| bulletin | `reportCard` | A student's term report. | `bulletins`, `includes/bulletin.php` |
| rang | `rank` | Position within the class group for the term. | `bulletin_moyennes.rang` |
| appréciation | `performanceBand` | Très Bien / Bien / Assez Bien / Passable / Insuffisant. | `appreciation_pour()` :269 |
| seuil éliminatoire | `passMark` | Minimum average to pass, per level. Default 10/20. | `niveaux.seuil_eliminatoire` |
| absence | `absence` | `absent` \| `present` \| `retard`(`late`), with `justifiee`→`isExcused`. | `absences`, `gerer_absence.php` |
| remarque | `remark` | A note about a student by a teacher or administrator, with a severity. | `remarques` |

### Money

| French | English code term | Definition | El Ourwa source |
|---|---|---|---|
| scolarité (money sense) | `tuition` | The monthly schooling fee. | `dettes_scolarite`, `paiements` |
| scolarité (admin sense) | `schooling` | The administrative area: timetable, absences, groups, levels. Two senses, two words — see §4. | `scolarite.php` hub |
| frais mensuel | `monthlyFee` | **The negotiated amount actually owed.** Not a discount off anything. | `etudiant_inscriptions.frais_mensuel` |
| tarif plein | `fullRate` | The level's rate before any reduction. Informational. | `etudiant_inscriptions.tarif_plein` |
| réduction | `discount` | A reduction in the amount owed for a month. Already deducted from `monthlyFee`. | `reductions`, `reduction_mensuelle` |
| réduction (cours du soir) | `eveningDiscount` | The same idea on an evening enrolment — **its own table**, never a row in `discounts`. El Ourwa keeps both in one `reductions` table with a `contexte` column; splitting them means a day-school debt query cannot subtract an evening reduction by forgetting a `WHERE`. See ADR-0034. | `reductions` where `contexte = 'cours_soir'` → `evening_discounts` |
| annulation d'un paiement | `reversal` | A **reversing entry**: a negated row carrying `reverses_id`, the original flagged `reversed`, and both halves excluded from every total. Never a `DELETE`, never an `UPDATE` of the amount — standing rule 7. A cancelled month can be paid again, because uniqueness counts only *live* entries. | `salary_payments`, `evening_teacher_payments`, `payments` |
| remise | `writeOff` | Forgiveness of debt **already owed**, granted by the direction. Revocable, and retained when revoked. **Never `discount`** — see §4. | `remises_dette` |
| exemption | `exemption` | A month or a student excused from paying. `totale`→`full`, `mensuelle`→`monthly`. | `exemptions`, `parent_exemptions` |
| gratuit | `isFree` | Free schooling for that year. Distinct from an exemption: free is a property of the enrolment, an exemption is a decision about a period. | `etudiant_inscriptions.gratuit` |
| bloqué dette | `debt_blocked` | Enrolment blocked by outstanding debt. A real business rule with financial consequences — ported exactly, never simplified away. | `etudiant_inscriptions.statut` |
| note absent | `NOTE_ABSENT` (−1) | **A marker, not a grade.** Excluded before averaging; summed as a number it makes every affected result silently wrong. | `configuration.note_absent` |
| origine | `origin` | Provenance of a record: `migrated` / `native` / `imputed`. Never dropped. | `origine` on 17 tables |
| échéancier | `paymentSchedule` | The per-enrolment month-by-month billing plan. | `inscription_mois` |
| barème | `feeScale` | The configured fee amount for a year. Three levels: global default, per-year, per-enrollment. | `configuration`, `gestion_caisse.php:723` |
| paiement | `payment` | Money received against tuition, one row per (student, month, year). | `paiements` |
| encaissement | `collection` | The **act of taking money in**, possibly covering several distinct claims at once. Owns the word `collection` in this codebase. | `encaissement_inscription.php`, `encaissements_annexes` |
| moyen de paiement | `paymentMethod` | Cash, Bankily, etc. | `moyens_paiement` |
| ligne de paiement | `paymentLine` (table `payment_lines`) | How one payment was split across payment methods. Must sum to the payment. Table name follows ARCHITECTURE.md §6; "tender line" is the concept. | `paiement_lignes` |
| reçu | `receipt` | Proof of payment given to the family. | `recus` |
| facture | `invoice` | | `factures`, `facture_lignes` |
| reliquat | `remainderDue` | Unsettled portion of an invoice or a partially-paid month. | `factures.total_reste`, `inscription_mois.reliquat` |
| solde | `balance` | | `dettes_familles.solde` |
| dette | `debt` | Elapsed unsettled months, plus remainders of unsettled invoices. Never both for the same month. | `dettes_familles`, `obtenir_dette_parent_detaillee()` |
| arriéré | `arrears` | Debt carried forward from an earlier year. | `dettes_familles.arriere` |
| impayés | `outstanding` | The view of what has not been paid. | `impayes.php` |
| caisse | `cashDesk` | The till: where money is taken in and paid out. | `gestion_caisse.php`, `caisse_jours` |
| dépense | `expense` | Money paid out that is not salary. | `depenses` |
| salaire | `salary`; payment → `payrollPayment` | Staff and teacher pay. | `paiements_salaire` |
| prêt | `loan` | An advance to a staff member, recovered from salary. | `prets_personnel` |
| échéance | `installment` | One scheduled repayment of a loan, for a given month. **Not** a generic due date — see §4. | `prets_echeances` |
| retrait | `withdrawal` | An administrator drawing money against a monthly limit. Recorded from the **third category of « Paiement du personnel »**, not from the Administrateurs tab — that one sets the ceilings and reports on what was taken. | `admin_retraits`, `administrateurs.limite_mensuelle`, `paiement_staff.php?type=admins` |
| ventilation | `tender lines` | *How* one movement was settled, means by means — « Espèces 40 000 · Bankily 10 000 ». Both directions: a receipt, a salary, an expense, a withdrawal. A movement with no ventilation is a till that will not balance at closing. | `paiement_lignes`, `tender_lines` |
| répartition par administrateur | `byHolder` | A period's withdrawals totalled per person, largest first. The ceiling is monthly **and** per person, so a total without it cannot be checked against any ceiling. | `administrateurs.php` :388 |
| fiche | `profile` | The card `recherche.php` opens from its « Action » column: a pupil's nine fields and mark sheet, or a teacher's six and their teachings. Reached by an id in the URL — which is why RLS is what stands between it and another school's records. | `recherche.php?type=…&profil_id=…` |
| mois payable | `payableMonth` | A month of the academic year that can be billed. | `mois_payables_annee()` :123 |
| échéancier de mois | `paymentSchedule` | The per-enrollment month-by-month billing plan. | `inscription_mois` |
| cours du soir | `eveningClasses` | A **separate business**: own groups, tariffs, teacher payroll, and external students who are not enrolled at the school. Code prefix `evening`. | `cours_du_soir.php`, `cs_*` (8 tables) |
| retenue sur salaire | `loanDeduction` | What a month's pay withholds against an outstanding loan. Money that does **not** leave the till, so it is an *outgoing* on the payslip and not on the cash report. | `paiements_salaire.retenue_pret` |
| brut / net | `gross` / `net` | Contracted pay, and what the person actually receives after any `loanDeduction`. The report counts `net`, because that is the cash that moved. | `paiements_salaire` |
| reliquat | `shortfall` | The part of an instalment a month's pay could not cover. Carried into the next month, never forgiven — see ADR-0013's arrears rule. | (behaviour, not a column) |
| demande | `approvalRequest` | An internal request from the accountant to the direction: a spend, a write-off, a loan. Decided once; the decision, its author and its moment are the record. | `demandes.php` |
| emploi du temps | `timetable` | The weekly grid: six days × three slots per class, one teaching per cell. | `emplois_du_temps`, `emploi_du_temps.php` |
| créneau | `slot` | One period of the school day. Ordinals here (1–3 for the day school, 1–7 for the evening); the times are a display concern. | `emplois_du_temps.creneau` |
| créance | `miscDebt` | An arrears line a human asserts is still owed, outside the month schedule — a carry-over, a catch-up agreement, an invoice remainder. Owed by the **correspondent**; the link to a child only says where it came from. Correcting it moves `corrected_balance`, never `total`: what was claimed stays legible. | `dettes_familles` |
| autorisation de réinscription | `reenrolmentAuthorisation` | The direction's decision to let a family re-enrol while they still owe. **Not a remise**: nothing is written off, only the block is lifted — its own screen says so. Stores the amount owed at the moment, frozen. | `reinscriptions_autorisations` |
| grille des créneaux | `eveningTimetable` | The evening timetable: 7 days × 7 two-hour periods, one lesson per cell. A cell sits on a **subject**; the teacher may be « à définir plus tard ». | `cs_emploi` |
| expulsion | `expulsion` | A block on ADMISSION, held against NNI + RIM so it outlives the student record. Lifted, never deleted. | `expulsions`, `expelled.php` |
| intérimaire | `interim` | A teacher paid for what they teach rather than a flat salary: Σ hours/week × 4 × rate. The ×4 is fixed — see ADR-0014. | `professeurs.situation` |
| prix par heure | `hourlyRate` | Per ASSIGNMENT first, per teacher as fallback; it varies with the level taught. NULL means "the teacher's rate", never 0. | `enseignements.prix_par_heure` |
| rapport financier | `monthlyReport` | The month's cash in and out, dated by **when the money moved**, never by the period it settles. | `rapport_financier.php` |

### Roles, access, admin

| French | English code term | Definition | El Ourwa source |
|---|---|---|---|
| rôle | `role` | A named bundle of permissions. A user holds **many**, and gets their union. | `roles`, `utilisateur_roles` |
| permission | `permission` | Catalogue lives in code, grants live in the DB. Never cached in session. | `referentiel_permissions()` :29 |
| administrateur (the table) | `fundHolder` | A person with a monthly withdrawal limit. **Not the `admin` role** — see §4. | `administrateurs` |
| journal de sécurité | `auditLog` | | `journal_securite` |
| historique | `history` | Login and activity history. | `historique.php`, `login_historique` |
| messagerie | `messaging` | Direction → parents messages. | `messages`, `messagerie.php` |
| tableau de bord | `dashboard` | | `tableau_bord.php` |
| moughataa | `moughataa` | An administrative district of Nouakchott (Toujounine, Arafat, Ksar…). In El Ourwa these appear **only as place-of-birth values**. Kept untranslated — see §4. | `etudiants.lieu_naissance` |
| RIM / NNI | `rimNumber` / `nationalId` | Two identity numbers, both unique per student. NNI = *Numéro National d'Identification*. | `etudiants.rim`, `etudiants.nni` |
| MRU | `MRU` | Mauritanian ouguiya. Currency is stored per school, never assumed. | amounts throughout |
| reprise | `migrated` (in `origin`) | A record carried over from the software that preceded El Ourwa. **Preserved, never dropped** — 17,106 rows depend on it and financial reports key off it. Maps to `origin ENUM('migrated','native','imputed')`. | `origine`, `source_id` |

---

## 4. Ambiguities found, and how they were resolved

These were not obvious. Each was decided deliberately; each would have caused a real bug.

**`remise` vs `réduction` — both translate naturally to "discount".** They are different
operations on different objects. A `réduction` lowers the price of a month *before* it is
owed and is already baked into `monthlyFee`. A `remise` forgives debt *after* it is owed,
is a direction decision, and is revocable with an audit trail. Fixed as `discount` and
`writeOff`. Never interchangeable.

**`scolarité` means two different things.** The `scolarite.php` hub is school
administration (timetable, absences, groups, levels). `dettes_scolarite` is tuition money.
Fixed as `schooling` (administration) and `tuition` (money).

**`administrateurs` is not the `admin` role.** The table holds people with a
`limite_mensuelle` who may draw funds — a *financial* concept. `utilisateurs.role='admin'`
is an *access* concept. Same word, unrelated meanings. Fixed as `fundHolder` and `admin`.
This is the single most dangerous collision in the glossary: conflating them would grant
withdrawal rights to every administrator.

**`devoir` means two different things.** In `notes.type_note` it is graded continuous
assessment. In everyday use and in `exercices` it is homework sent to parents. Fixed as
`coursework` (the mark type) and `homework` (the assignment).

**`niveau` is not `grade`, because `note` is.** `niveau`→`level`, `note`→`grade`. Using
"grade" for both — as US English invites — would make `studentGrade` unreadable.

**`moyenne` is not always an average.** For non-fondamental levels it is a weighted mean
out of 20. For fondamental levels the same field holds a **total** out of the sum of the
subjects' scales. The name `average` is kept because it matches the column, but the
fondamental path must be named explicitly (`fondamentalTotal`) wherever it is computed.

**`emploi du temps` is not `schedule`.** `schedule` is already taken twice over — the
monthly billing plan (`paymentSchedule`) and background jobs. Fixed as `timetable`.

**`échéance` is not a due date here.** Generically it means a deadline; in
`prets_echeances` it is one scheduled repayment. Fixed as `installment`.

**`parent` vs `correspondant`.** El Ourwa uses `parents` in the schema and
"correspondant" in the till UI, for the same party — the fee-paying adult, who may not be
the biological parent. Fixed as `guardian` throughout, because the financial relationship
is what the system actually models.

**`fondamental` is kept untranslated.** "Primary" / "basic education" are both inexact for
the Mauritanian cycle, and the term appears on printed report cards. Translating it would
make the code disagree with the paper. Same reasoning for `moughataa`.

**`moughataa` is a district, not a branch.** Recorded here because it was misread as a
branch name during session 1. In El Ourwa these strings are place-of-birth values in
`etudiants.lieu_naissance`; there is no address column and no site concept anywhere.

---

## 5. Still open

**`caisse` → `cashDesk`.** Reasonable but not certain. Alternatives: `till` (British,
short, unambiguous), `cashRegister` (implies hardware the school does not have). Also
note `caisse_jours` is a daily cash summary, provisionally `dailyCashSummary`. Confirm
before the finance phase.

**Cycle names for `college` and `lycee`.** Kept as-is for now, matching `fondamental`.
If these ever surface in English-facing UI they will need real translations (`middle
school` / `secondary school`), which are imperfect fits for the Mauritanian system.
Decide when the UI language question is settled.

**`retard` → `late`.** Fine as an absence status, but if lateness ever gains its own
handling it may want to be a separate concept rather than an absence variant.

**`échéance` → `installment` vs `instalment`.** The glossary says `installment`
(American, two Ls); `payroll/payroll.service.ts` and migration `0007` use
`instalment` (British, one L), matching the French spelling and the rest of the
codebase's register. The **code** is consistently one L — `loan_instalments`,
`creditInstalments`. This entry should be corrected to match rather than the
other way round; left visible here so the discrepancy is not silently absorbed.

**UI language.** El Ourwa is French + Arabic, with Arabic RTL support and translated
notification keys. Whether the successor's UI adds English — and whether the *code* being
English while the *product* is French/Arabic causes friction for future maintainers in
Nouakchott — is a question for the owner, not a naming decision.

---

## Le bulletin officiel — vocabulaire ajouté le 2026-09-06

Ces termes viennent du formulaire d'État mauritanien rendu par
`includes/bulletin_vue.php`. Ils se ressemblent assez pour qu'on les confonde,
et deux d'entre eux décident si un enfant passe.

| El Ourwa | Ici | Ce que c'est |
|---|---|---|
| `verdict_admission()` | `admissionVerdict()` | La **décision d'un trimestre ou de l'année** : `admis` · `ajourne` · `non_evalue`. Calculée à chaque affichage, jamais stockée. |
| `décision` (`outcome`) | `outcome` sur l'inscription | Le **verdict de fin d'année enregistré**, celui qui décide de la réinscription. À ne pas confondre avec le précédent : l'un est un calcul, l'autre une écriture. |
| `seuil_eliminatoire` | `pass_mark` (sur `levels`) | Le seuil d'admission **du niveau**, pas une constante à 10. |
| `appreciation_pour()` | `performanceBand()` | Très Bien · Bien · Assez Bien · Passable · Insuffisant. Une appréciation n'est pas une décision. |
| `moyenne_sur_20()` | `equivalentOutOf20()` | Ramène des points fondamentaux sur 20 **avant** toute comparaison au seuil. |
| `recap_trimestres` | `termRecap` | Les moyennes générales de T1 au trimestre affiché. |
| `moyenne_annee` | `annualAverage` | La moyenne des trimestres **renseignés**, au 3ᵉ trimestre seulement. |
| `bulletin-lot` | `bulletin-lot` | Le conteneur d'un bulletin dans l'impression d'une classe : il porte le saut de page. |
| `matricule` (sur le bulletin) | `rim` | L'identifiant de l'élève. |
| `matricule` (sur `enfant.php`) | `classRank` | ⚠ **Le même mot pour autre chose** : le rang de l'enfant dans sa classe, par ordre de nom. C'est le numéro que la famille cite au secrétariat. |

⚠ **« Non évalué » n'est pas « Ajourné ».** Un élève sans note n'a pas échoué.
Le confondre imprime une accusation sur un document d'État. La règle vit dans
`admissionVerdict()` et un test la tient.

⚠ **« Exemption » n'est pas « réduction ».** Une *exemption totale* dispense de
toute scolarité ; une *exemption mensuelle* excuse un mois nommé ; une
*réduction* baisse le prix d'un mois sans l'annuler. Les trois coexistent sur le
même écran chez lui, et l'écran dit laquelle est laquelle.

## La plateforme et la session famille — vocabulaire ajouté le 2026-09-14

| Terme | Code | Sens |
|---|---|---|
| session famille | `espace: 'parent'`, `schoolId: null` | La session d'un parent connecté **sans école** : le jeton ne porte aucune école, le garde relit à chaque requête celles où le numéro tient le rôle `parent` (`ecolesFamille`), et `/parent/*` boucle dessus sous RLS. Voir ADR-0061 §1. |
| numéro mauritanien | `telephoneMauritanien()` | Huit chiffres, le premier parmi 2, 3, 4 ; `+222` / `00222` toléré et retiré. Forme canonique stockée à l'admission et au changement d'identifiant ; comparaison sur les huit derniers chiffres pour les numéros repris. |
| administrateur de la plateforme | `users.is_platform_admin` | Un privilège, pas un rôle d'école : voit et gère toutes les branches, en crée d'autres à son image. Jamais dans `user_school_roles`. |
| cumul | `tableauBord().cumul` | La somme, en Decimal, des caisses de toutes les branches — `null` quand elles ne comptent pas dans la même monnaie. |
| débiteur | `misc_debts` sans `guardian_id` | Sa table `dettes` : une dette due par quelqu'un qui n'est pas un foyer (une demande de type `dette` approuvée). Se rembourse avec des lignes de moyens et un reçu `REMB-…`. Les arriérés des familles (`dettes_familles`) sont les `misc_debts` **avec** foyer et ne passent jamais par là. |
| bulletin téléchargeable | `renderBulletinOfficiel()`, `BULLETIN_CSS` | Le PDF du bulletin dans l'application des familles, tiré du MÊME HTML que le site imprime (`/parent/children/:id/report-card/document`) et converti sur le téléphone. À l'écran, le bulletin est dessiné en widgets avec la même mise en page (ADR-0068). |
| reçu groupé | `receipts`, `payments.receipt_id`, `family_fee_payments.receipt_id` | UN reçu pour plusieurs mois (d'un enfant) et les frais annuels réglés d'un coup : un numéro de la séquence de l'école, que chaque ligne encaissée désigne et reprend. Le grand livre reste ligne par ligne. Voir ADR-0068. |
| Frais Graytna | `FEE_PHOTOCOPY_LABEL`, `libelleFraisPhotocopie()` (`@elourwa/shared/brand`) | Le nom qu'El Mourad donne au frais annuel « photocopie » (clé technique `photocopy`, barèmes `frais_photocopie_<année>`). Réglé par installation (deploy/brands/elmourad.env) ; sans réglage : « Frais de photocopie ». Seul le nom change — montants, barèmes et reçus émis restent. |
| mot de passe généré | `genererMotDePasse()` (`@elourwa/shared/password`), `MotDePasseGenere` | Le mot de passe proposé pour un compte parent (admission, « Reset mdp ») : 10 caractères, recette de `mdp_provisoire()`, sans O/0, l/1, I. Affiché, modifiable, ↻ en tire un autre ; le parent le change à la première connexion. |
| affectations équivalentes | `GradesService.equivalents()` | Deux affectations de la même (année, groupe, matière) — deux professeurs — qui partagent UNE feuille de notes ; la canonique (la plus récente) porte les notes, les autres y rapatrient les leurs à l'écriture. L'emploi du temps garde chacune. Voir ADR-0068. |


## Ajouts du 22/09 — la marque, l'école unique, l'école neuve

- **Marque (enseigne)** — le nom sous lequel une installation se présente :
  « El Ourwa » par défaut, « El Mourad » par l'environnement (`BRAND_NAME`,
  `BRAND_NAME_AR`, …). Tout libellé visible la lit ; les identifiants
  techniques (paquets, canal de notification, dossier CSS) ne changent pas.
  `packages/shared/src/brand.ts`, ADR-0069.
- **Slug de marque** — l'identifiant technique de la marque en minuscules
  (`elourwa`, `elmourad`) : préfixe des cookies de session, noms des paquets
  livrés (`dist/elmourad-…`).
- **École unique** — une installation qui ne sert qu'une école
  (`SINGLE_SCHOOL_SLUG`) : tout nom d'hôte la désigne, la console de la
  plateforme n'existe pas. Le contraire : la **plateforme** (multi-écoles,
  `admin.<domaine>`).
- **Console retirée** — `PLATFORM_CONSOLE=off` : `/platform` (site) et
  `/platform/*` (API) répondent 404 ; implicite en école unique.
- **Installation d'une école (bootstrap)** — `pnpm --filter @elourwa/db
  bootstrap-school` : le catalogue des rôles, la ligne de l'école, un compte
  de direction à mot de passe provisoire — et rien d'autre. Ce n'est PAS la
  graine (`pnpm seed`, trois écoles fictives, 600 élèves), qui tronque tout.
- **Bail (file sortante)** — la ligne réclamée par un travailleur recule de
  cinq minutes (`run_after`) le temps de l'envoi : un second processus ne la
  reprend pas, une famille ne reçoit pas deux fois. ADR-0070.
- **Verrou de rafraîchissement (application)** — l'application ouverte et la
  tâche de fond (WorkManager) ne présentent jamais le même jeton en même
  temps : un horodatage de 30 s dans les préférences partagées. ADR-0070.
- **Période attribuée (année)** — les dates qu'une année scolaire possède pour
  ce qui n'a qu'une date (absences, remarques) : du lendemain de la fin de la
  précédente à la veille du début de la suivante — ses mois, plus l'été et la
  rentrée qui les précèdent. `AcademicYearService.periodeAttribuee()`.
  ADR-0071.
- **Numéros supplémentaires (famille)** — `user_phones` (0041) : les numéros,
  en plus du principal (`users.phone`), qui ouvrent le compte d'une famille
  avec le même mot de passe. Un numéro n'appartient qu'à un compte. ADR-0071.
- **Réveil de la file (push)** — `PushService.reveiller()` : dès qu'une
  notification est écrite, la file est vidée une seconde plus tard, sans
  attendre le minuteur (3 s). ADR-0071.
- **Tiroir de navigation** — la barre latérale du personnel sous 1024 px :
  hors de l'écran, ouverte par le bouton `#sidebar-toggle`
  (`tiroir-navigation.tsx`, port de son `app.js`). ADR-0072.
- **Seau de verrouillage** — la clé sous laquelle les échecs de connexion
  sont comptés (`login_attempts.bucket`) ; un numéro supplémentaire compte dans
  celui du numéro principal du compte. ADR-0072.


## Ajouts du 29/09 — la facturation « services » (Jinan), les absences du personnel

- **Modèle de facturation** — `schools.billing_model` / `School.billingModel` :
  `famille` (El Ourwa : un tarif mensuel par niveau, frais annuels PAR FAMILLE)
  ou `services` (Jinan). Posé à la création de l'école, jamais changé. ADR-0073.
- **Mode d'étude** — `enrollments.study_mode` / `studyMode` : `8h-14h` ou
  `8h-17h` (libellés « 8h – 14h », « 8h – 17h »). Obligatoire à la
  (ré)inscription dans une école « services » ; le tarif mensuel du niveau
  dépend de lui (`levels.monthly_rate_8h14`, `monthly_rate_8h17`).
- **Frais d'inscription (élève)** — `levels.student_enrolment_fee` : dus une
  fois PAR ÉLÈVE et par année dans une école « services », sous la forme d'un
  abonnement `inscription` créé d'office. ⚠ À ne pas confondre avec les frais
  d'inscription PAR FAMILLE d'El Ourwa (`family_fee_payments`) ni avec
  `enrollments.enrolment_fee`, que l'import remplit et que rien ne lit.
- **Service (optionnel)** — cantine (trois formules exclusives : petit
  déjeuner, déjeuner, les deux), piscine, docteur (mensuels), photocopie
  (annuelle). Prix par école et par année : `service_prices`.
- **Abonnement de service** — `student_services` / `studentService` : un élève,
  une année, un service, au montant **figé** à la souscription ; son
  **échéancier** : `student_service_months`. Exempté (`exempt`) : ses mois
  pèsent 0. **Arrêté** (`ended_at`, geste `stop`) : les mois non payés à
  partir du mois d'arrêt sont retirés ; l'inscription ne s'arrête jamais.
- **Grand livre des services** — `service_payments` : l'argent des services,
  append-only, jamais dans `payments`. Encaissé par le reçu groupé.
- **Page « Frais »** — `/frais` : les tarifs 8h – 14h / 8h – 17h et les frais
  d'inscription de chaque niveau, les six prix de l'année. Direction, écoles
  « services » seulement.
- **Catalogue (formulaire)** — `CatalogueFacturation` (site) : ce qu'un
  formulaire d'inscription lit de `GET /finance/tarifs` pour l'année visée.
  `<ChoixFacturation>` le rend (mode, frais d'inscription, services).
- **Horaires de travail (agent)** — `staff_work_hours` / `workHours` :
  l'emploi du temps d'un agent (`staff`), période par période (jour ISO, début,
  fin). ADR-0074.
- **Absence du personnel** — `personnel_absences` : une **séance manquée**
  (professeur : date, créneau, classe, enseignement, d'après la grille) ou une
  **période manquée** (agent : entière ou en partie, d'après ses horaires).
  **Justifiée** (`justified`) : décision de la direction, avec un motif. Aucune
  retenue sur la paie. ADR-0074.
- **Journée (absences)** — la feuille d'une date : ce que l'emploi du temps
  donnait à chacun, et ce qui est déclaré. **Synthèse du mois** : par
  personne, absences et heures manquées, justifiées ou non.
- **Créneau** — `timetable_slots.slot` : 1 = 8h-9h45 (105 min), 2 = 10h-11h45
  (105 min), 3 = 12h-14h (120 min) ; au-delà, sans heure ni durée connues.
  `@elourwa/shared/emploi-du-temps`.
- **production.env (Jinan)** — `deploy/jinan/production.env` : l'IP du VPS et
  le domaine de production, écrits par `configurer-production.sh`, lus par les
  scripts de mise à jour et `install.sh`. ADR-0075.
