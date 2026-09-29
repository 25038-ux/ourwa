-- ============================================================================
--  0033_depenses_et_demandes — le bon de dépense « DEP-000123 », la
--  suppression d'une dépense sans rien effacer, et ce qu'une demande porte
--
--  `depenses.php` imprime un bon numéroté 'DEP-' . str_pad(id, 6, '0') et
--  offre « Supprimer » à l'administration : `DELETE FROM depenses`, lignes de
--  moyens comprises. Règle 7 : ici une écriture financière ne s'efface pas ;
--  une écriture inverse la neutralise. Pour que l'écran reste le sien — la
--  dépense supprimée disparaît de l'historique et du total — l'original est
--  marqué `reversed` et l'écriture négative le désigne par `reverses_id` ; la
--  liste n'affiche ni l'un ni l'autre, le grand livre garde les deux.
--
--  `document_sequences` : UN compteur par école et par sorte de document
--  (règle 10, sous verrou). `salary_receipt_sequences` (0032) reste tel quel.
--
--  `approval_requests.metadata` : `demandes.php` EXÉCUTE une demande approuvée
--  — la dépense est créée avec ses moyens de paiement, le tarif de l'élève
--  changé, la dette ouverte. Il lui faut donc ce que le demandeur a saisi,
--  son `metadata` JSON.
-- ============================================================================

CREATE TABLE document_sequences (
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, kind)
);

ALTER TABLE expenses
  ADD COLUMN receipt_no  integer,
  ADD COLUMN reverses_id uuid,
  ADD COLUMN reversed    boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT expenses_school_receipt_no_key UNIQUE (school_id, receipt_no),
  ADD CONSTRAINT expenses_reverses_fk
    FOREIGN KEY (school_id, reverses_id) REFERENCES expenses (school_id, id) ON DELETE RESTRICT;

ALTER TABLE approval_requests ADD COLUMN metadata jsonb;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_sequences']
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
