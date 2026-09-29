-- 0039 — CE QUE LE BALAYAGE DU 19/09 A TROUVÉ DANS LE SCHÉMA (revue « base »).
--
-- 1. UNE ANNULATION PAR ÉCRITURE. Le contrôle « déjà annulé » vivait dans le
--    code, hors verrou : deux clics simultanés sur « Annuler » inséraient deux
--    contre-passations, et l'élève se retrouvait crédité de deux fois la somme.
--    Le service verrouille désormais l'original (FOR UPDATE) ; la base, elle,
--    refuse structurellement la seconde ligne.
CREATE UNIQUE INDEX payments_reverses_uq
  ON payments (school_id, reverses_id) WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX expenses_reverses_uq
  ON expenses (school_id, reverses_id) WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX evening_payments_reverses_uq
  ON evening_payments (school_id, reverses_id) WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX evening_teacher_payments_reverses_uq
  ON evening_teacher_payments (school_id, reverses_id) WHERE reverses_id IS NOT NULL;

-- 2. LA CLÉ ÉTRANGÈRE DE 0019 ÉTAIT LA SEULE À UNE COLONNE (règle 5 : toutes
--    composites, pour qu'une contre-passation ne puisse pas viser une autre
--    école) et la seule en SET NULL (supprimer l'original orphelinait
--    l'annulation en silence). Comme ses trois sœurs : composite, RESTRICT.
ALTER TABLE evening_teacher_payments
  DROP CONSTRAINT IF EXISTS evening_teacher_payments_reverses_id_fkey;
ALTER TABLE evening_teacher_payments
  ADD CONSTRAINT evening_teacher_payments_reverses_fk
  FOREIGN KEY (school_id, reverses_id)
  REFERENCES evening_teacher_payments (school_id, id) ON DELETE RESTRICT;

-- 3. UN NUMÉRO DE REÇU N'EXISTE QU'UNE FOIS (règle 10). Les remboursements de
--    dette diverse (REMB-…), de prêt (PRT-…) et les retraits (ADM-…) tiraient
--    quatre chiffres au sort ; deux du même jour pouvaient se répéter, et rien
--    ne l'interdisait. Le service prend maintenant le compteur par école
--    (document_sequences) ; la base garantit l'unicité. Les lignes importées
--    sans numéro (NULL) restent possibles.
CREATE UNIQUE INDEX misc_debt_repayments_receipt_uq
  ON misc_debt_repayments (school_id, receipt_number) WHERE receipt_number IS NOT NULL;
CREATE UNIQUE INDEX loan_repayments_receipt_uq
  ON loan_repayments (school_id, receipt_number) WHERE receipt_number IS NOT NULL;
CREATE UNIQUE INDEX withdrawals_receipt_uq
  ON withdrawals (school_id, receipt_number) WHERE receipt_number IS NOT NULL;

-- 4. LES INDEX QUE CHAQUE GRAND LIVRE ATTENDAIT. « NOT EXISTS (… WHERE
--    r.reverses_id = p.id) » se joue par ligne de reçu : sans index, chaque
--    relevé de famille parcourait toute la table des paiements — 16 000 lignes
--    aujourd'hui, davantage chaque année.
CREATE INDEX payments_reverses_idx
  ON payments (school_id, reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX expenses_reverses_idx
  ON expenses (school_id, reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX evening_payments_reverses_idx
  ON evening_payments (school_id, reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX evening_payments_enrolment_idx
  ON evening_payments (school_id, enrolment_id);
CREATE INDEX loan_repayments_loan_idx
  ON loan_repayments (school_id, loan_id);

-- 5. UNE SEULE EXONÉRATION « TOUTES ANNÉES » PAR FAMILLE ET PAR FRAIS. Dans
--    UNIQUE (…, academic_year_id), deux NULL sont distincts : les exonérations
--    permanentes s'empilaient. NULLS NOT DISTINCT (Postgres 15+) ferme la porte.
ALTER TABLE family_fee_exemptions
  DROP CONSTRAINT IF EXISTS family_fee_exemptions_school_id_guardian_id_kind_academic_y_key;
ALTER TABLE family_fee_exemptions
  ADD CONSTRAINT family_fee_exemptions_unique
  UNIQUE NULLS NOT DISTINCT (school_id, guardian_id, kind, academic_year_id);
