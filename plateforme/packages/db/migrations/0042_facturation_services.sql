-- ============================================================================
--  0042 — LA FACTURATION « SERVICES » (Jinan) : modes d'étude, frais
--  d'inscription par élève, services optionnels par élève.
--
--  ADR-0073 ; spécification complète : docs/specs/jinan-facturation.md.
--
--  Jinan facture autrement qu'El Ourwa : deux modes d'étude (8h – 14h,
--  8h – 17h) au tarif différent par niveau ; des frais d'inscription par niveau
--  et PAR ÉLÈVE ; des services optionnels par élève (cantine en trois formules,
--  piscine, docteur, photocopie annuelle), chacun exemptable seul.
--
--  ⚠ RIEN NE CHANGE POUR LES ÉCOLES EXISTANTES. Tout est additif : des colonnes
--  NULL ou à valeur par défaut, quatre tables neuves. Le modèle de facturation
--  est une colonne de schools, « famille » par défaut, c'est-à-dire El Ourwa tel
--  qu'il est ; le code ne lit les nouveautés que pour une école « services ».
--  Aucune ligne existante n'est réécrite.
--
--  ⚠ L'ARGENT DES SERVICES A SON PROPRE GRAND LIVRE (service_payments), jamais
--  payments ni family_fee_payments : une cinquantaine de requêtes somment
--  payments par (élève, mois) sans type ; un paiement de cantine y marquerait
--  la scolarité d'octobre comme réglée. Même raison que 0019.
-- ============================================================================

-- ── 1. Le modèle de facturation, par école (§1) ─────────────────────────────
-- Une colonne de la table de plateforme, lisible par id comme receipt_prefix
-- et currency. Pas une variable d'environnement : les tests font vivre
-- plusieurs écoles dans une même base, et un réglage d'installation ne
-- pourrait pas y différer. Posé à la création de l'école, jamais changé.
ALTER TABLE schools
  ADD COLUMN billing_model text NOT NULL DEFAULT 'famille'
  CONSTRAINT schools_billing_model_check CHECK (billing_model IN ('famille', 'services'));

COMMENT ON COLUMN schools.billing_model IS
  'famille : El Ourwa inchangé (frais annuels par famille, un tarif mensuel par niveau). '
  'services : Jinan (modes d''étude, frais d''inscription par élève, services optionnels). '
  'Posé à la création (bootstrap-school --billing-model), jamais changé ensuite. ADR-0073.';

-- ── 2. Les tarifs par mode et les frais d'inscription, par niveau (§2, §3) ──
-- NULL = « non défini » : on ne peut pas inscrire dans un mode dont le tarif
-- manque. 0 = gratuit. Ce sont des défauts pour la PROCHAINE inscription,
-- jamais rétroactifs : le montant est figé à l'inscription (monthly_fee,
-- full_rate, enrollment_months.amount_due) et sur l'abonnement inscription.
-- levels.monthly_rate reste celui des écoles « famille ».
ALTER TABLE levels
  ADD COLUMN monthly_rate_8h14 numeric(14,2)
    CONSTRAINT levels_monthly_rate_8h14_check CHECK (monthly_rate_8h14 >= 0),
  ADD COLUMN monthly_rate_8h17 numeric(14,2)
    CONSTRAINT levels_monthly_rate_8h17_check CHECK (monthly_rate_8h17 >= 0),
  ADD COLUMN student_enrolment_fee numeric(14,2)
    CONSTRAINT levels_student_enrolment_fee_check CHECK (student_enrolment_fee >= 0);

COMMENT ON COLUMN levels.student_enrolment_fee IS
  'Frais d''inscription PAR ÉLÈVE d''une école « services » (NULL = non défini, 0 = gratuit). '
  '⚠ Distinct de enrollments.enrolment_fee, que l''import d''El Ourwa remplit et que rien ne lit.';

-- Le mode d'étude de l'inscription. NULL pour toute école « famille » et pour
-- toutes les lignes existantes ; obligatoire (dans le code) pour une école
-- « services ».
ALTER TABLE enrollments
  ADD COLUMN study_mode text
    CONSTRAINT enrollments_study_mode_check CHECK (study_mode IN ('8h-14h', '8h-17h'));

-- ── 3. Les prix des services, par école et par année scolaire (§4) ──────────
-- Un prix absent = non défini : on ne peut pas souscrire le service. Modifier
-- un prix n'est jamais rétroactif : le montant est figé sur l'abonnement. Pas
-- de ligne « inscription » : son prix est celui du niveau.
CREATE TABLE service_prices (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL,
  service          text NOT NULL
                   CHECK (service IN ('cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet',
                                      'piscine', 'docteur', 'photocopie')),
  amount           numeric(14,2) NOT NULL CHECK (amount >= 0),
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  UNIQUE (school_id, academic_year_id, service),
  -- Un réglage de l'année : il part avec elle.
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE
);

-- ── 4. Les abonnements (§4) ─────────────────────────────────────────────────
-- Un élève, une année, un service, au montant FIGÉ à la souscription. La même
-- forme que la scolarité (enrollments + enrollment_months), donc les mêmes
-- règles : un mois payé garde son prix, un mois échu est dû.
--
-- famille est générée : « cantine » pour les trois cantines, sinon le code.
-- L'index unique partiel plus bas n'admet qu'un abonnement ACTIF par élève,
-- par année et par famille : les trois cantines sont exclusives, et changer de
-- formule, c'est arrêter l'une puis commencer l'autre.
CREATE TABLE student_services (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  service          text NOT NULL
                   CHECK (service IN ('cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet',
                                      'piscine', 'docteur', 'photocopie', 'inscription')),
  famille          text NOT NULL GENERATED ALWAYS AS (
                     CASE WHEN service IN ('cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet')
                          THEN 'cantine' ELSE service END
                   ) STORED,
  -- Le prix au jour de la souscription (service_prices, ou le niveau pour
  -- l'inscription). Jamais relu dans service_prices ensuite.
  amount           numeric(14,2) NOT NULL CHECK (amount >= 0),
  -- Premier mois facturé ; pour un service annuel, le mois où il est dû.
  start_month      smallint NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_year       smallint NOT NULL,
  -- Exemption par abonnement, donc par élève et par service, une à une.
  -- Réversible ; ce qui a déjà été payé reste payé.
  exempt           boolean NOT NULL DEFAULT false,
  exempted_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  exempted_at      timestamptz,
  -- Arrêt : les mois non réglés à partir du mois d'arrêt sont retirés de
  -- l'échéancier, et l'abonnement ne compte plus comme actif.
  ended_at         timestamptz,
  ended_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  -- La cible de la clé du grand livre : une ligne encaissée désigne l'élève et
  -- l'année de SON abonnement, structurellement (voir service_payments).
  UNIQUE (school_id, id, student_id, academic_year_id),
  -- L'inscription est obligatoire : elle s'exempte, elle ne s'arrête jamais.
  CONSTRAINT student_services_inscription_jamais_arretee
    CHECK (service <> 'inscription' OR ended_at IS NULL),
  -- Un abonnement est une décision, comme une inscription : il suit l'élève et
  -- l'année. Mais dès qu'une ligne du grand livre le désigne, service_payments
  -- (NO ACTION) refuse qu'il disparaisse.
  FOREIGN KEY (school_id, student_id)       REFERENCES students       (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX student_services_actif_uq
  ON student_services (school_id, student_id, academic_year_id, famille) WHERE ended_at IS NULL;
CREATE INDEX student_services_eleve_idx
  ON student_services (school_id, student_id, academic_year_id);
CREATE INDEX student_services_annee_idx
  ON student_services (school_id, academic_year_id, service);
CREATE UNIQUE INDEX student_services_legacy_uq
  ON student_services (school_id, legacy_id) WHERE legacy_id IS NOT NULL;

COMMENT ON COLUMN student_services.famille IS
  'Générée : cantine pour les trois cantines, sinon le code. Un seul abonnement actif '
  '(ended_at IS NULL) par élève, par année et par famille (student_services_actif_uq).';

-- ── 5. L'échéancier des abonnements (§4) ────────────────────────────────────
-- Mensuel : une ligne par mois payable de l'année à partir du mois de départ.
-- Annuel : une seule ligne, au mois de départ. amount_due = le montant figé
-- de l'abonnement. Un arrêt supprime les lignes futures SANS paiement : elles
-- n'ont jamais été dues.
CREATE TABLE student_service_months (
  id                 uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id          uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_service_id uuid NOT NULL,
  calendar_month     smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year      smallint NOT NULL,
  amount_due         numeric(14,2) NOT NULL CHECK (amount_due >= 0),
  origin             record_origin NOT NULL DEFAULT 'native',
  legacy_id          integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  UNIQUE (school_id, student_service_id, calendar_year, calendar_month),
  FOREIGN KEY (school_id, student_service_id)
    REFERENCES student_services (school_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX student_service_months_legacy_uq
  ON student_service_months (school_id, legacy_id) WHERE legacy_id IS NOT NULL;

-- ── 6. Le grand livre des services (§5) ─────────────────────────────────────
-- Append-only, comme payments (règle 7) : une correction est une ligne
-- négative qui désigne l'originale (reverses_id), jamais un UPDATE ni un
-- DELETE. Encaissé seulement par le reçu groupé (receipts, 0040) : chaque
-- ligne en porte le numéro, tiré de receipt_sequences (règle 10).
--
-- ⚠ NO ACTION ET NON RESTRICT sur chaque clé qui porte de l'argent (voir 0025) :
-- la base refuse qu'un abonnement, un élève, une année, un reçu ou une ligne
-- annulée disparaisse sous un encaissement ; mais la vérification a lieu en
-- fin d'instruction, si bien que supprimer une ÉCOLE entière, qui efface tout
-- d'un même geste, reste possible.
CREATE TABLE service_payments (
  id                 uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id          uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_service_id uuid NOT NULL,
  student_id         uuid NOT NULL,
  academic_year_id   uuid NOT NULL,
  -- La ligne d'échéancier réglée ; pour un service annuel, son unique mois.
  calendar_month     smallint NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  calendar_year      smallint NOT NULL,
  amount             numeric(14,2) NOT NULL,
  receipt_number     text NOT NULL,
  -- NULL seulement pour une annulation (elle prend son propre numéro).
  receipt_id         uuid,
  paper_reference    text,
  recorded_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at            timestamptz NOT NULL DEFAULT now(),
  reverses_id        uuid,
  origin             record_origin NOT NULL DEFAULT 'native',
  legacy_id          integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  -- Un encaissement est positif ; une annulation, négative, et elle seule.
  CONSTRAINT service_payments_signe
    CHECK ((reverses_id IS NULL AND amount > 0) OR (reverses_id IS NOT NULL AND amount < 0)),
  -- Une ligne encaissée appartient à un reçu ; seule une annulation n'en a pas.
  CONSTRAINT service_payments_recu
    CHECK (reverses_id IS NOT NULL OR receipt_id IS NOT NULL),
  -- ⚠ L'élève et l'année SONT ceux de l'abonnement : une ligne ne peut pas
  -- créditer l'enfant d'à côté.
  CONSTRAINT service_payments_abonnement_fk
    FOREIGN KEY (school_id, student_service_id, student_id, academic_year_id)
    REFERENCES student_services (school_id, id, student_id, academic_year_id) ON DELETE NO ACTION,
  CONSTRAINT service_payments_student_fk
    FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id) ON DELETE NO ACTION,
  CONSTRAINT service_payments_year_fk
    FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE NO ACTION,
  CONSTRAINT service_payments_receipt_fk
    FOREIGN KEY (school_id, receipt_id) REFERENCES receipts (school_id, id) ON DELETE NO ACTION,
  CONSTRAINT service_payments_reverses_fk
    FOREIGN KEY (school_id, reverses_id) REFERENCES service_payments (school_id, id) ON DELETE NO ACTION
);
-- Une annulation par écriture (comme 0039) : deux clics simultanés sur
-- « Annuler » ne créditent pas deux fois.
CREATE UNIQUE INDEX service_payments_reverses_uq
  ON service_payments (school_id, reverses_id) WHERE reverses_id IS NOT NULL;
-- Un numéro de reçu n'existe qu'une fois hors reçu groupé (comme 0040) ; le
-- reçu groupé porte sa propre unicité.
CREATE UNIQUE INDEX service_payments_receipt_number_uq
  ON service_payments (school_id, receipt_number) WHERE receipt_id IS NULL;
CREATE INDEX service_payments_period_idx
  ON service_payments (school_id, student_service_id, calendar_year, calendar_month);
CREATE INDEX service_payments_receipt_idx ON service_payments (school_id, receipt_id);
CREATE INDEX service_payments_paid_at_idx ON service_payments (school_id, paid_at DESC);
CREATE INDEX service_payments_student_idx ON service_payments (school_id, student_id);
CREATE UNIQUE INDEX service_payments_legacy_uq
  ON service_payments (school_id, legacy_id) WHERE legacy_id IS NOT NULL;

COMMENT ON TABLE service_payments IS
  'Grand livre des services (cantine, piscine, docteur, photocopie, inscription par élève). '
  'Append-only : une correction est une ligne négative avec reverses_id. Jamais payments '
  'ni family_fee_payments (ADR-0073). Moyens : tender_lines.source_type service_*.';

-- ── 7. Isolation (règle 4) ──────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'service_prices', 'student_services', 'student_service_months', 'service_payments'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING      (school_id = current_school_id())
        WITH CHECK (school_id = current_school_id())
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    EXECUTE format('GRANT SELECT ON %I TO app_reporter', t);
  END LOOP;
END $$;
