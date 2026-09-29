-- ============================================================================
--  0035_archives_recus_et_caisse — les archives de l'ancien logiciel, lues par
--  la « Synthèse — Année scolaire » de rapport_financier.php
--
--  `bilan_annee_scolaire()` (includes/paiements.php) : « Pour une année
--  CLOSE, le chiffre de référence est celui des REÇUS de l'ancien système :
--  c'est le seul qui reflète tout l'argent entré — scolarité, inscriptions,
--  livres, fournitures. La table `paiements` d'El Ourwa ne contient que les
--  mensualités et sous-estimait le total de 3 % environ. » Et la dépense
--  d'archive est le débit du compte 560011 (« Caisse — Dépenses ») de
--  `compta_lignes`.
--
--  Sept mille six cent quatre-vingt-trois reçus (septembre 2024 → août 2026),
--  six cent soixante-quatorze lignes de caisse : sans eux, la synthèse
--  annuelle des deux années reprises ne dirait pas ce qu'elle dit chez lui.
--  Ce sont des ARCHIVES : reprises telles quelles, jamais écrites par l'application.
--  Seul le compte 560011 est repris — le seul qu'El Ourwa lise.
-- ============================================================================

CREATE TABLE legacy_receipts (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  legacy_id        integer NOT NULL,
  numero           integer,
  libelle          text,
  guardian_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  amount_paid      numeric(14,2) NOT NULL DEFAULT 0,
  amount_remaining numeric(14,2) NOT NULL DEFAULT 0,
  invoice_total    numeric(14,2) NOT NULL DEFAULT 0,
  received_at      timestamptz,
  origin           record_origin NOT NULL DEFAULT 'migrated',
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  UNIQUE (school_id, legacy_id)
);
CREATE INDEX legacy_receipts_school_date_idx ON legacy_receipts (school_id, received_at);

CREATE TABLE legacy_ledger_lines (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  legacy_id   integer NOT NULL,
  piece_date  date,
  piece_no    text,
  journal     text,
  account     text NOT NULL,
  label       text,
  debit       numeric(14,2) NOT NULL DEFAULT 0,
  credit      numeric(14,2) NOT NULL DEFAULT 0,
  third_party text,
  origin      record_origin NOT NULL DEFAULT 'migrated',
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  UNIQUE (school_id, legacy_id)
);
CREATE INDEX legacy_ledger_lines_school_account_idx
  ON legacy_ledger_lines (school_id, account, piece_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legacy_receipts', 'legacy_ledger_lines']
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
