-- ============================================================================
--  0011_attachments — files attached to homework
--
--  Ported from El Ourwa v16 `includes/upload.php`, which is careful and whose
--  care is worth keeping: real MIME read from the bytes, magic-byte signatures,
--  an extension that must agree with the content, a random stored name, and a
--  5 MB ceiling.
--
--  ⚠ ONE DELIBERATE IMPROVEMENT ON THE ORIGINAL.
--
--  El Ourwa serves `/uploads/exercices/<random>.pdf` straight from Apache, with
--  no authentication: the random filename IS the access control. Its own comment
--  explains why — "stockage hors document_root impossible ici (XAMPP)" — so this
--  is a constraint it worked around, not a decision it made.
--
--  We are not on XAMPP. Files live outside any served directory and are handed
--  out by an API route that checks who is asking, so a leaked URL is not a leaked
--  document. See ADR-0016.
-- ============================================================================

CREATE TABLE attachments (
  id           uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  homework_id  uuid NOT NULL,
  -- What the family sees. Sanitised for display, never used to build a path.
  display_name text NOT NULL,
  -- What is actually on disk: 32 hex characters plus the extension. Random, so
  -- one upload cannot overwrite another and a directory cannot be enumerated.
  stored_name  text NOT NULL,
  mime         text NOT NULL,
  bytes        integer NOT NULL CHECK (bytes > 0),
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  origin       record_origin NOT NULL DEFAULT 'native',
  legacy_id    integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  -- The stored name is unique per school, which is what makes "find the file for
  -- this row" a lookup rather than a scan of a directory.
  UNIQUE (school_id, stored_name),
  FOREIGN KEY (school_id, homework_id)
    REFERENCES homework (school_id, id) ON DELETE CASCADE
);
CREATE INDEX attachments_homework_idx ON attachments (school_id, homework_id);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attachments
  USING      (school_id = current_school_id())
  WITH CHECK (school_id = current_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON attachments TO app_user;
GRANT SELECT ON attachments TO app_reporter;
