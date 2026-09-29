-- ============================================================================
--  0017_platform_settings — the platform's own configuration
--
--  ⚠ NOT A TENANT TABLE, AND DELIBERATELY SO. Everything under `school_id` is
--  one school's business; this is the platform's. `tarif_par_eleve` is what
--  every branch is billed per pupil, so it must not be settable from inside a
--  branch — a school that could edit its own rate would be a school that could
--  set it to zero.
--
--  El Ourwa's equivalent is `define('TARIF_PAR_ELEVE', 500)` in
--  `sidibrahim.php`: changing it means editing PHP on the server. Storing it
--  makes it a decision rather than a deployment, and the audit log records who
--  changed it.
--
--  No RLS: there is no tenant to scope to, and the only role that reaches it is
--  the platform admin. Left out of the tenant-table checklist for that reason.
-- ============================================================================

CREATE TABLE platform_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform_settings IS
  'Platform-wide configuration. NOT tenant-scoped: a branch must not be able to '
  'read or change what it is billed. Its TARIF_PAR_ELEVE lives here.';

-- Its own default, so an unconfigured platform bills what El Ourwa billed.
INSERT INTO platform_settings (key, value) VALUES ('tarif_par_eleve', '500')
  ON CONFLICT (key) DO NOTHING;

GRANT SELECT ON platform_settings TO app_user;
