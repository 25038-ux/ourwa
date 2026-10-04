# Spécification — la facturation « services » (Jinan)

> Demande du propriétaire, 29/09/2026, pour l'école **Jinan** (Heavenly Private
> Educational Institution) : deux modes d'étude, des tarifs par niveau et par
> mode, des frais d'inscription par niveau et **par élève**, des services
> optionnels par élève (cantine ×3, piscine, docteur, photocopie), leurs
> exemptions une à une, un bouton « Frais ». Réponses du propriétaire : prix des
> services **identiques pour tous les niveaux** ; à la caisse, **lignes séparées**
> (payables ensemble sur un reçu ou séparément ; revenus par service). Décision :
> ADR-0073 (docs/DECISIONS.md).
>
> ⚠ **Rien ne change pour les écoles existantes** (El Mourad, Nour, Rissala,
> Salam). Tout est gardé par `schools.billing_model = 'services'` ; avec la valeur
> par défaut `'famille'`, chaque requête nouvelle rend zéro ligne et chaque
> chiffre existant reste identique. Toute la suite de tests existante doit rester
> verte **sans modification**.

## 1. Le modèle de facturation, par école

- `schools.billing_model text NOT NULL DEFAULT 'famille' CHECK (billing_model IN ('famille','services'))`.
- `'famille'` : le comportement d'El Ourwa, inchangé (frais d'inscription et de
  photocopie **par famille**, `family_fee_payments`, un tarif mensuel par niveau).
- `'services'` : tout ce qui suit. Posé à la création de l'école
  (`bootstrap-school --billing-model services`) ; jamais changé ensuite.
- Exposé par `GET /school` (`billingModel`) → `School.billingModel` côté web.
- Côté API, un seul point de lecture : `BillingModelService.current()` (lit
  `schools.billing_model` de l'école du contexte ; `schools` est une table de
  plateforme, lue par id).

## 2. Les modes d'étude

- Deux valeurs, fixes : `'8h-14h'` et `'8h-17h'` (libellés « 8h – 14h » et
  « 8h – 17h »). Constantes partagées `MODES_ETUDE`, `libelleMode()` dans
  `@elourwa/shared` (nouveau fichier `facturation.ts`).
- `levels.monthly_rate_8h14 numeric(14,2) NULL`, `levels.monthly_rate_8h17 numeric(14,2) NULL`
  — NULL = « non défini ». `levels.monthly_rate` reste (écoles « famille »).
- `enrollments.study_mode text NULL CHECK (study_mode IN ('8h-14h','8h-17h'))` —
  NULL pour les écoles « famille » et toutes les lignes existantes.
- **Obligatoire** à l'inscription, à la réinscription (unitaire et en lot) dans
  une école « services » : `EnrollmentService.enrol` refuse sans mode
  (« Choisissez le mode d'étude : 8h – 14h ou 8h – 17h. ») et refuse un mode dont
  le tarif du niveau n'est pas défini (« Le tarif 8h – 17h du niveau 6ème n'est
  pas défini — bouton « Frais ». »).
- `fullRate` = le tarif du niveau **pour ce mode** ; `monthlyFee` = `input.monthlyFee ?? fullRate`
  (gratuit : 0). La substitution « tarif officiel » des rôles comptable /
  secrétaire compare au tarif **du mode**. `buildSchedule` inchangé : le montant
  est figé dans `enrollment_months.amount_due` comme aujourd'hui → la dette de
  scolarité, la caisse, les reçus, les rapports n'ont RIEN à changer pour la
  scolarité.
- `ON CONFLICT` de l'INSERT `enrollments` : met aussi à jour `study_mode` et
  `full_rate` (seulement si `study_mode` est fourni).
- Changer de mode en cours d'année : `POST /finance/concessions/study-mode
  {studentId, academicYearId?, studyMode}` (direction seule) — met à jour
  `study_mode`, `full_rate` et `monthly_fee` (= tarif du nouveau mode, 0 si
  gratuit) et **réévalue les seuls mois non réglés** (même règle que
  `changeMonthlyFeeWithin` : un mois payé garde son prix).
- Réinscription en lot : un sélecteur de mode (obligatoire dans une école
  « services ») s'applique à tous les élèves cochés.

## 3. Les frais d'inscription, par niveau et par élève

- `levels.student_enrolment_fee numeric(14,2) NULL` (NULL = non défini ; 0 = gratuit).
- **Ne pas lire `enrollments.enrolment_fee`** : l'import d'El Ourwa le remplit ;
  le lire créerait des dettes chez El Mourad.
- À chaque (ré)inscription dans une école « services », un abonnement
  obligatoire `inscription` (§4) est créé pour l'élève et l'année, au montant du
  niveau **figé** à ce moment, s'il est > 0. Exemptable par élève ; jamais arrêté.
- Dans une école « services », les frais annuels **par famille**
  (`FeesService.annualFeesDue` / `annualFeesDueFor`, `annexes` de la fenêtre,
  bloc « Frais annuels » de la fiche) n'existent pas : ces fonctions rendent `[]`
  / `{}` pour une école « services ». Pas de double facturation.

## 4. Les services

| code | libellé | périodicité | prix |
|---|---|---|---|
| `cantine_petit_dejeuner` | Cantine — petit déjeuner | mensuel | école, par année |
| `cantine_dejeuner` | Cantine — déjeuner | mensuel | école, par année |
| `cantine_complet` | Cantine — petit déjeuner + déjeuner | mensuel | école, par année |
| `piscine` | Piscine | mensuel | école, par année |
| `docteur` | Docteur | mensuel | école, par année |
| `photocopie` | `libelleFraisPhotocopie()` | annuel (une fois) | école, par année |
| `inscription` | Frais d'inscription | annuel, **obligatoire** | **par niveau** (§3) |

- Les trois cantines sont exclusives (famille `cantine`) : un seul abonnement
  cantine actif par élève et par année. Changer de formule = arrêter l'une,
  commencer l'autre.
- Prix : table `service_prices` (par école, par **année scolaire**, par service ;
  `amount numeric(14,2) NOT NULL CHECK (amount >= 0)`, `UNIQUE (school_id,
  academic_year_id, service)`). Un prix absent = non défini → on ne peut pas
  souscrire le service (« Le prix de la piscine n'est pas défini pour 2026-2027 —
  bouton « Frais ». »). Modifier un prix n'est jamais rétroactif : le montant est
  **figé sur l'abonnement** à la souscription.
- Abonnements : `student_services` (school_id, student_id, academic_year_id,
  service, `famille` générée (`cantine` pour les trois cantines, sinon le code),
  `amount` figé, `start_month`/`start_year` (premier mois facturé ; pour un
  service annuel, le mois où il est dû), `exempt` + `exempted_by`/`exempted_at`,
  `ended_at`/`ended_by`, `created_by`/`created_at`, origin, legacy_id).
  `UNIQUE (school_id, student_id, academic_year_id, famille) WHERE ended_at IS NULL`.
- Échéancier : `student_service_months` (school_id, student_service_id,
  calendar_month, calendar_year, `amount_due` = le montant figé ;
  `UNIQUE (school_id, student_service_id, calendar_year, calendar_month)`).
  - mensuel : une ligne par mois payable de l'année (`payableMonthsFor`) à partir
    du mois de départ ; mois de départ par défaut = règle du 25 appliquée à la
    date du jour (le mois courant si le jour ≤ 25, sinon le suivant ; avant le
    début de l'année : le premier mois ; à l'inscription : le premier mois dû de
    la scolarité, `firstOwedMonthOrder(entryDate)`).
  - annuel : une seule ligne, au mois de départ.
- **Exemption** : par abonnement (donc par élève et par service, un par un).
  Un abonnement exempté reste visible (« Exempté »), ses mois pèsent 0 dans la
  dette ; ce qui a déjà été payé reste payé. Réversible (lever l'exemption).
- **Arrêt** : à partir d'un mois M (par défaut le mois suivant) : les lignes
  d'échéancier ≥ M **sans aucun paiement** sont supprimées ; s'il existe un
  paiement net > 0 sur un mois ≥ M, refus (« Octobre est déjà réglé : arrêtez
  à partir de Novembre, ou annulez d'abord le paiement. »). `ended_at` est posé.
  L'abonnement `inscription` ne s'arrête pas.
- Qui : souscrire (à l'inscription : les rôles qui inscrivent ; depuis la fiche :
  `finance.encaisser`) ; arrêter, exempter, lever l'exemption, changer de mode :
  **direction seule** (`@RequirePermission('finance.dette') + @RequireRole('super_admin','admin')`,
  ajoutés à `DIRECTION_SEULE` de caisse-direction-only.spec.ts) ; prix et tarifs
  (page « Frais ») : `@RequirePermission('scolarite.niveaux') + @RequireRole('super_admin','admin')`.
  **Aucune permission nouvelle** (catalogue figé).

## 5. Le grand livre des services

- `service_payments` — append-only, comme `payments` : school_id,
  student_service_id, student_id, academic_year_id, calendar_month,
  calendar_year, `amount numeric(14,2)` avec
  `CHECK ((reverses_id IS NULL AND amount > 0) OR (reverses_id IS NOT NULL AND amount < 0))`,
  receipt_number, receipt_id (NULL seulement pour une annulation ;
  `CHECK (reverses_id IS NOT NULL OR receipt_id IS NOT NULL)`), paper_reference,
  recorded_by, paid_at, reverses_id, origin, legacy_id.
  Unicités : `(school_id, reverses_id) WHERE reverses_id IS NOT NULL` ;
  `(school_id, receipt_number) WHERE receipt_id IS NULL`. Index :
  `(school_id, student_service_id, calendar_year, calendar_month)`,
  `(school_id, receipt_id)`, `(school_id, paid_at DESC)`, `(school_id, student_id)`.
- **Jamais dans `payments` ni `family_fee_payments`** : une cinquantaine de
  requêtes somment `payments` par (élève, mois) sans type ; un paiement de cantine
  y marquerait la scolarité d'octobre comme réglée.
- Encaissement : **toujours** par le reçu groupé (`encaisserGroupe`) — un reçu
  pour une ou plusieurs lignes, sous le même verrou consultatif, le même numéro
  (`receipt_sequences`, jamais MAX()+1), la même règle « moyens = total au centime ».
  Payer « séparément » = un reçu groupé d'une seule ligne. Chaque ligne cochée est
  réglée pour son reste entier.
- Moyens : `tender_lines.source_type` = `service_cantine`, `service_piscine`,
  `service_docteur`, `service_photocopie`, `service_inscription` (colonne libre,
  pas de migration) → les revenus par service tombent tout seuls dans
  « Revenue Live → Par origine ».
- Annulation : `POST /finance/service-payments/:id/reverse {reason}` (direction
  seule, comme `payments/:id/reverse`) : FOR UPDATE sur l'original, re-vérification,
  nouveau numéro, ligne négative, moyens recopiés en « out », audit.

## 6. La dette

Dans une école « services », les quatre chemins — `forGuardian`,
`forGuardians`, `detailAcrossYears`, `outstanding` — ajoutent **les mêmes**
termes, **avant** la déduction des remises de dette :

- mois de service **échus** (index ≤ maintenant), non exemptés, abonnement non
  arrêté ou mois antérieur à l'arrêt (les lignes supprimées n'existent plus),
  inscription non annulée, dans le **même périmètre d'année** que la scolarité
  (`anneeScolarisee`, `dette_mois_depuis_annee`) : `reste = amount_due − payé net`.
- services annuels (`inscription`, `photocopie`) non exemptés : dus pour l'année
  demandée (`forGuardian`) / l'année ouverte (`detailAcrossYears`) — même règle que
  les frais annuels famille d'aujourd'hui.
- `FamilyDebt.services[] : {studentId, studentName, studentServiceId, service,
  label, month|null, year|null, outstanding}` ; `tuition[]` inchangé (« Mois
  impayés » = scolarité seulement) ; `total` les inclut.
- Invariant épinglé par test : pour une famille de l'année courante,
  `forGuardian.total == detailAcrossYears.total == ligne d'outstanding()`.
- Pour une école « famille » : `services` vaut `[]`, tous les totaux identiques.
- Les dettes de services comptent pour la réinscription et les examens comme
  toute dette ; chaque encaissement / annulation / exemption de service appelle
  `examAccess.afterCollection`.

## 7. La caisse (fiche du correspondant)

- `familyLedger` : par enfant `studyMode`, `services[]` (abonnements : id, code,
  libellé, périodicité, montant, exempt, début, arrêté) et, par mois,
  `services[] : {studentServiceId, service, label, due, paid, state
  ('paid'|'partial'|'due'|'exempt'), receiptId}` ; les services annuels dans
  `annualServices[]` avec le même état. La grille des mois s'affiche même si la
  scolarité est exemptée / gratuite dès qu'un service existe.
- `fenetreInscription` : `services[] : {studentServiceId, service, label,
  periodicite, mois|null, annee|null, du, paye, reste, etat}` ; `annexes = {}`
  pour une école « services ».
- `encaisserGroupe` : entrée `services?: {studentServiceId, mois?, annee?}[]` (≤ 60) ;
  « Cochez au moins une ligne » accepte un reçu fait de seuls services ; ordre
  d'allocation : mois de scolarité, frais famille, services (ordre de la fenêtre).
- `receiptGroup` : `services[] : {id, studentName, service, label, month, year,
  amount, reversedBy}` ; l'union des moyens inclut les `service_*`.
- Web : dans chaque carte de mois, sous la scolarité, une sous-ligne par service
  actif (libellé, montant, état, case « Cocher pour l'encaisser », « Reçu »,
  annulation ✕ direction) ; un bloc « Services » par enfant (ajouter, changer de
  formule cantine, arrêter, exempter / lever l'exemption, changer de mode) ; les
  services annuels (inscription, photocopie) comme lignes de l'enfant.

## 8. Inscription et réinscription

- Formulaires (admission, réinscription unitaire) dans une école « services » :
  mode obligatoire (deux boutons radio) → le « Frais mensuel » se pré-remplit du
  tarif niveau + mode ; frais d'inscription du niveau affiché ; services :
  cantine (aucune / petit déjeuner / déjeuner / les deux), piscine, docteur,
  photocopie — chaque choix avec son prix de l'année.
- API : `studyMode` et `services: ServiceCode[]` (sans `inscription`, ajouté
  d'office) dans `POST /admissions/students`, `POST /enrollments/re-enrol`,
  `POST /enrollments/re-enrol/bulk` (mode seulement) ; créés **dans la
  transaction de `enrol`**, avec l'inscription. Idempotent : un abonnement actif
  de la même famille n'est pas recréé.
- La fenêtre d'encaissement qui suit montre les services cochés (1er mois) et
  l'inscription.

## 9. Page « Frais » (/frais) et Niveaux

- Entrée « Frais » dans la barre latérale (super_admin, admin ; écoles
  « services » seulement), bouton « Frais » sur la page Niveaux et sur la caisse.
- Contenu, pour l'année choisie (défaut : l'année active ; une année close est en
  lecture seule) : tableau des niveaux — 8h – 14h, 8h – 17h, Frais d'inscription
  (modifiables) ; tableau des services — six prix.
- API : `GET /finance/tarifs?academicYearId` (lecture : tout le personnel qui
  inscrit, réinscrit ou encaisse) → `{billingModel, annee, niveaux[{id, nom,
  tarif8h14, tarif8h17, fraisInscription}], services[{code, libelle, periodicite,
  prix|null}]}` ; `PATCH /levels/:id/tarifs {tarif8h14?, tarif8h17?,
  fraisInscription?}` ; `POST /finance/tarifs/services {academicYearId, prix:
  {code: montant|''}}` (année close refusée). Montants en chaînes, regex money,
  audit.
- Page Niveaux d'une école « services » : colonnes 8h – 14h / 8h – 17h / Frais
  d'inscription à la place de « Tarif mensuel ».

## 10. Rapports et reçus

- `SOURCE_LABELS` : `service_cantine` « Cantine », `service_piscine` « Piscine »,
  `service_docteur` « Docteur », `service_photocopie` (libellé photocopie),
  `service_inscription` « Frais d'inscription (élève) ».
- `transactions()` : jointure `service_payments` → description « Cantine
  (déjeuner) : Nom Prénom (Octobre 2026) ».
- `monthly()` : `income.services` (daté par `paid_at`, ADR-0013), inclus dans
  `income.total` ; `mostRecentActivity` ; contrôles `tillConsistency` et bilan
  annuel étendus au grand livre des services.
- Reçu groupé (web) : « Cantine — déjeuner — Nom : Octobre, Novembre », etc.

## 11. Ce que la suite de tests doit prouver (écrits AVANT le code)

`apps/api/test/facturation-services.spec.ts` (une école « services » et une école
« famille » dans la même base) :
1. l'école « famille » : `billingModel = 'famille'`, aucun service, totaux
   inchangés (la suite existante le prouve aussi) ;
2. inscription sans mode → refus ; mode sans tarif → refus ; 8h – 14h et 8h – 17h
   au même niveau → mensualités différentes, figées ;
3. inscription par élève : deux enfants = deux frais d'inscription ; frais
   famille jamais dus ;
4. services souscrits à l'inscription : échéancier mois par mois au prix figé ;
   un changement de prix ensuite ne touche rien ;
5. cantine exclusive ; arrêt : mois futurs non payés supprimés, refus si payé ;
6. exemption d'un service seul : ses mois pèsent 0, les autres restent dus ;
7. reçu groupé scolarité + cantine + photocopie + inscription : un numéro, moyens =
   total, dette baisse exactement du total ; payer un service seul ;
8. annulation d'un paiement de service : ligne négative, une seule fois ;
9. dette : `forGuardian == detailAcrossYears == outstanding` avec services ;
   mois futurs non comptés ;
10. rapports : `revenusDuJour` par origine `service_*` ; `monthly().income.services`.
Plus : `rls.test.ts` (nouvelles tables sous RLS forcée), caisse-direction-only
(nouvelles routes direction), permission-names.

---

## Addendum du 04/10/2026 — transport, photocopie obligatoire, remises (ADR-0079, migration 0047)

Demande du propriétaire : « add transport service (billed monthly and selected
just like any other service at inscription) and make frais de photocopie
constant for every niveau and mandatory just like frais d'inscription and make
it possible to apply reductions to the monthly services and also add services
or stop one later after inscription ».

1. **Transport** (`transport`) : mensuel, au prix de l'école par année (page
   « Frais »), une case à l'inscription et à la réinscription comme la
   piscine ; s'ajoute (« + Ajouter un service », la caisse) et s'arrête
   (direction) depuis la fiche. `source_type` : `service_transport`.
2. **Photocopie obligatoire** : son prix était déjà UN prix d'école (pas par
   niveau). Elle n'est plus cochée : créée d'office à chaque (ré)inscription,
   comme les frais d'inscription — prix non défini → l'inscription est
   refusée (« Le prix de « Frais de photocopie » n'est pas défini… — bouton
   « Frais » ») ; prix 0 → rien. Elle s'exempte, elle ne s'arrête pas. **Pas de
   rattrapage** : un élève inscrit avant ne reçoit aucune dette rétroactive ;
   la fiche permet de la lui ajouter.
3. **Remises sur les services mensuels** (cantine, piscine, docteur,
   transport) : un montant PAR MOIS (`student_services.remise`), posé par la
   direction depuis la fiche (« Remise / mois »). Les mois **sans paiement**
   passent à `prix − remise` ; un mois réglé garde son prix et son reçu ; 0 la
   retire ; jamais plus que le prix, jamais sur un service annuel (CHECK).
   L'encaissement relit le montant sous son verrou : une remise posée pendant
   qu'une fenêtre est ouverte fait refuser l'ancien montant. (D3 — « remises
   sur la scolarité seule » — reste vrai pour les remises de dette ; celle-ci
   est une remise de prix, par service.)
4. **Reprendre un service arrêté** : un mois ne se facture jamais deux fois —
   la reprise commence après le dernier mois de l'abonnement arrêté (un mois
   choisi plus tôt est refusé, avec le mois où reprendre).

Tests : `apps/api/test/transport-photocopie-remises.spec.ts` (15),
`facturation-services.spec.ts` (mis à jour : chaque inscription porte sa
photocopie), `packages/db/test/facturation-services.test.ts` (0047),
`e2e/jinan-transport-remises.spec.ts`, `e2e/jinan-facturation.spec.ts`.
