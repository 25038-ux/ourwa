-- ============================================================================
--  0010_exam_access — exam results are locked TERM BY TERM against family debt
--
--  Ported from El Ourwa v15 + v16, which the v13 source we had been reading
--  does not contain at all. `includes/acces_examens.php` is the authority.
--
--  THE RULE
--  --------
--  The school withholds EXAM results from families who owe it money. The lock
--  is per TERM, and the debt considered is the family's TOTAL — arrears from
--  previous years included, exactly the figure the till shows. A parent told at
--  the counter that they owe nothing must not still find the door shut.
--
--  THE LOCK IS A RATCHET. When the total debt reaches zero the CURRENT term is
--  opened, and that opening is RECORDED. It holds for good. If the family falls
--  back into debt the next term closes, but the term already earned stays open.
--  Only the direction may close it again.
--
--      T1  debt unpaid ................. T1 shut
--      T1  family settles everything ... T1 open, and permanently
--      T2  they fall behind again ...... T2 shut, T1 still open
--      T2  they settle again ........... T2 opens in turn
--      T3  they fall behind ............ T3 shut, T1 and T2 open
--
--  WHY A TABLE AND NOT A CALCULATION
--  ---------------------------------
--  You cannot work out afterwards what a family owed on 31 December: the debt
--  balance is updated in place, with no history. "This family was up to date
--  during term 1" therefore has to be written down at the moment it is true.
-- ============================================================================

-- ── The ratchet ─────────────────────────────────────────────────────────────
CREATE TABLE exam_term_access (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  guardian_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL,
  -- The SAME terms as grades.term. A second notion of "period" would drift
  -- from the first, and it is the drift that produces wrong results.
  term             smallint NOT NULL CHECK (term BETWEEN 1 AND 3),
  opened_at        timestamptz NOT NULL DEFAULT now(),
  -- Zero by construction; kept because "what did we observe when we opened it"
  -- is the first question anyone will ask of this row.
  balance_seen     numeric(14,2) NOT NULL DEFAULT 0,
  -- Closed again by the direction. Never deleted: this is an access decision
  -- with financial consequences and its history must survive an inspection.
  revoked_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at       timestamptz,
  revoke_reason    text,
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  -- Makes the ratchet write idempotent: a term can only be earned once, and a
  -- later payment must NOT resurrect a row the direction has closed.
  UNIQUE (school_id, guardian_id, academic_year_id, term),
  FOREIGN KEY (school_id, academic_year_id)
    REFERENCES academic_years (school_id, id) ON DELETE CASCADE
);
CREATE INDEX exam_term_access_lookup_idx
  ON exam_term_access (school_id, guardian_id, academic_year_id, revoked_at);

-- ── Derogations ─────────────────────────────────────────────────────────────
--
-- The direction may lift the block case by case: hardship, a disputed balance,
-- an agreed instalment plan.
--
-- `reason` is NOT NULL on purpose. A derogation is an exception to the school's
-- own recovery policy and has to be explicable months later.
CREATE TABLE exam_derogations (
  id               uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  guardian_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = every child of this family.
  student_id       uuid,
  academic_year_id uuid NOT NULL,
  -- NULL = every term.
  term             smallint CHECK (term BETWEEN 1 AND 3),
  reason           text NOT NULL,
  granted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  -- NULL = no expiry. Honoured to the second: an expired derogation protects
  -- nothing.
  expires_at       timestamptz,
  revoked_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at       timestamptz,
  origin           record_origin NOT NULL DEFAULT 'native',
  legacy_id        integer,
  PRIMARY KEY (id),
  UNIQUE (school_id, id),
  FOREIGN KEY (school_id, academic_year_id)
    REFERENCES academic_years (school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, student_id)
    REFERENCES students (school_id, id) ON DELETE CASCADE
);
CREATE INDEX exam_derogations_lookup_idx
  ON exam_derogations (school_id, guardian_id, academic_year_id, revoked_at, expires_at);

-- ── Notifications belong to a year ──────────────────────────────────────────
--
-- They were attached to no year at all, so once a year closed the old ones
-- would have stayed visible to families while everything else disappeared.
--
-- Existing rows keep NULL and become invisible to parents. That is deliberate:
-- attaching them after the fact would be guesswork, and they point at a year
-- families no longer consult. The direction keeps them.
ALTER TABLE notifications ADD COLUMN academic_year_id uuid;
CREATE INDEX notifications_year_idx
  ON notifications (school_id, guardian_id, academic_year_id, read_at);

-- ── The permission to grant one ─────────────────────────────────────────────
--
-- ⚠ DIRECTION ONLY — super_admin and admin. NOT the accountant, NOT the
-- secretary. When a debt is settled the door opens by itself, so the accountant
-- needs no power of derogation to do their job. A derogation is an exception to
-- school policy: a decision of the direction, not of the till.
--
-- This takes the catalogue from 24 permissions to 25.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'derogations.gerer'
  FROM roles r
 WHERE r.code IN ('super_admin', 'admin')
ON CONFLICT DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exam_term_access', 'exam_derogations']
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
