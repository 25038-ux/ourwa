-- 0040 — UN SEUL REÇU POUR PLUSIEURS MOIS ET LES FRAIS ANNUELS
--
-- Décision du propriétaire (2026-09-20) : « it makes no sense to issue multiple
-- receipts for paying October and June ». À l'inscription, à la réinscription
-- et à la caisse, l'agent coche les mois de l'année affichée et les frais
-- annuels que la famille règle, encaisse, et remet UN reçu.
--
-- Le grand livre ne change pas : un mois = une ligne de `payments` (toute la
-- dette, les rapports, les annulations reposent dessus) ; un frais = une ligne
-- de `family_fee_payments`. Ce qui est nouveau, c'est le REÇU qui les réunit :
-- une ligne de `receipts`, avec le numéro tiré de la même séquence, que chaque
-- ligne encaissée désigne par `receipt_id` — et dont elle reprend le numéro,
-- pour que tout ce qui affiche `receipt_number` (cartes de mois, rapports)
-- montre le bon numéro sans changer.
--
-- Les lignes encaissées seules (chemins historiques) gardent leur numéro
-- propre : l'unicité du numéro par ligne ne vaut donc plus que hors reçu
-- groupé — le reçu groupé porte la sienne.

CREATE TABLE receipts (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL,
  guardian_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  receipt_number   text NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  recorded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  UNIQUE (school_id, receipt_number),
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE RESTRICT
);
CREATE INDEX receipts_guardian_idx ON receipts (school_id, guardian_id, paid_at DESC);
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON receipts
  USING      (school_id = current_school_id())
  WITH CHECK (school_id = current_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON receipts TO app_user;
GRANT SELECT ON receipts TO app_reporter;

ALTER TABLE payments ADD COLUMN receipt_id uuid;
ALTER TABLE payments ADD CONSTRAINT payments_receipt_fk
  FOREIGN KEY (school_id, receipt_id) REFERENCES receipts (school_id, id) ON DELETE RESTRICT;
CREATE INDEX payments_receipt_idx ON payments (school_id, receipt_id) WHERE receipt_id IS NOT NULL;
ALTER TABLE payments DROP CONSTRAINT payments_school_id_receipt_number_key;
CREATE UNIQUE INDEX payments_receipt_number_uq
  ON payments (school_id, receipt_number) WHERE receipt_id IS NULL;

ALTER TABLE family_fee_payments ADD COLUMN receipt_id uuid;
ALTER TABLE family_fee_payments ADD CONSTRAINT family_fee_payments_receipt_fk
  FOREIGN KEY (school_id, receipt_id) REFERENCES receipts (school_id, id) ON DELETE RESTRICT;
CREATE INDEX family_fee_payments_receipt_idx ON family_fee_payments (school_id, receipt_id) WHERE receipt_id IS NOT NULL;
ALTER TABLE family_fee_payments DROP CONSTRAINT family_fee_payments_school_id_receipt_number_key;
CREATE UNIQUE INDEX family_fee_payments_receipt_number_uq
  ON family_fee_payments (school_id, receipt_number) WHERE receipt_id IS NULL;
