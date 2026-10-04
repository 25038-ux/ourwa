-- ============================================================================
--  0048 — LES DOCUMENTS SIGNÉS : UN PAR PIÈCE, PAR ÉLÈVE ET PAR ANNÉE.
--
--  Demande du propriétaire de Jinan (04/10/2026), ADR-0080 :
--    « Each service has a signed document and inscription has a signed
--      document … a placeholder for every service the parent chose for either
--      one of his children + inscription + photocopie. The documents are
--      available to see and delete or replace anytime by the admin and they
--      can only be seen by the parent, not modified or replaced or deleted. »
--
--  Une PIÈCE est l'emplacement d'un document : l'inscription et la
--  photocopie, toujours ; chaque service souscrit cette année-là (cantine,
--  piscine, docteur, transport). Une seule version par pièce : « Remplacer »
--  pose le nouveau fichier et efface l'ancien, « Supprimer » vide la pièce.
--  Ce ne sont pas des écritures financières (règle 7) : le journal d'audit
--  garde la trace de chaque dépôt, remplacement et suppression.
--
--  Le fichier vit hors de la base, comme une pièce jointe d'exercice
--  (UPLOAD_DIR/<école>/<32 hex>.<ext>, sauvegardé avec elle) ; la ligne en
--  porte le nom tiré au hasard et ce que la famille verra.
-- ============================================================================

CREATE TABLE student_documents (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL,
  academic_year_id uuid NOT NULL,
  piece            text NOT NULL
                   CHECK (piece IN ('inscription', 'photocopie',
                                    'cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet',
                                    'piscine', 'docteur', 'transport')),
  -- Le nom sur le disque : jamais celui qu'a donné le navigateur.
  stored_name      text NOT NULL CHECK (stored_name ~ '^[0-9a-f]{32}\.[a-z0-9]{2,5}$'),
  display_name     text NOT NULL,
  -- Un document SIGNÉ : un scan ou une photo. Pas de format modifiable.
  mime             text NOT NULL
                   CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  bytes            integer NOT NULL CHECK (bytes > 0),
  uploaded_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  -- Une pièce, un document : « Remplacer » met à jour cette ligne.
  UNIQUE (school_id, student_id, academic_year_id, piece),
  FOREIGN KEY (school_id, student_id) REFERENCES students (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, academic_year_id) REFERENCES academic_years (school_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE student_documents IS
  'Documents signés (inscription, photocopie, services) : déposés, remplacés, supprimés par '
  'documents.gerer ; lus seulement par la famille (GET /parent/documents). ADR-0080.';

ALTER TABLE student_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_documents FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON student_documents
  USING      (school_id = current_school_id())
  WITH CHECK (school_id = current_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON student_documents TO app_user;
GRANT SELECT ON student_documents TO app_reporter;

-- ── La permission ───────────────────────────────────────────────────────────
--
-- « sent by the admin or a person with the privileges given » : la direction
-- (super_admin, admin) et le secrétariat, qui tient les dossiers d'inscription.
-- Un agent reçoit ce droit en recevant le rôle « Secrétaire » (Comptes du
-- personnel → Rôles). Ni le comptable (la caisse), ni le professeur.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'documents.gerer'
  FROM roles r
 WHERE r.code IN ('super_admin', 'admin', 'secretaire')
ON CONFLICT DO NOTHING;
