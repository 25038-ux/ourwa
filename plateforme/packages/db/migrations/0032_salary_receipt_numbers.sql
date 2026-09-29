-- ============================================================================
--  0032_salary_receipt_numbers — le numéro du reçu de salaire, « SAL-000123 »
--
--  `paiement_staff.php` imprime, après chaque paiement, un reçu numéroté
--  'SAL-' . str_pad(id, 6, '0') : l'identifiant entier de la ligne
--  `paiements_salaire`. Nos identifiants sont des UUID ; un reçu « SAL-0192a7… »
--  n'est pas le sien, et un bénéficiaire qui garde ses reçus depuis des années
--  y lirait une rupture.
--
--  Un compteur par école, pris SOUS VERROU dans la transaction du paiement
--  (règle 10 : jamais MAX()+1). `receipt_sequences` reste aux encaissements :
--  y mêler les salaires décalerait la numérotation des reçus de scolarité.
--
--  Nullable : les lignes déjà écrites, et les écritures inverses (qui ne sont
--  pas un paiement), n'en portent pas.
-- ============================================================================

CREATE TABLE salary_receipt_sequences (
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id)
);

ALTER TABLE salary_payments ADD COLUMN receipt_no integer;
ALTER TABLE salary_payments
  ADD CONSTRAINT salary_payments_school_receipt_no_key UNIQUE (school_id, receipt_no);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['salary_receipt_sequences']
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
