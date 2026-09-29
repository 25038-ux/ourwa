-- ============================================================================
--  0030_push — notifications poussées aux appareils des parents
--
--  Le dernier des cinq points de FEATURES : l'application parent INTERROGEAIT
--  au lieu de RECEVOIR. Un parent apprenait l'absence de son enfant quand il
--  ouvrait l'application, pas quand elle était saisie.
--
--  Deux tables, et le même dessin que 0012 pour la seconde (ADR-0017).
-- ============================================================================

-- ── Les appareils ──────────────────────────────────────────────────────────
-- Un jeton FCM par appareil. Un parent en a autant que de téléphones ; une
-- famille en a plus encore, parce que les deux parents partagent un compte.
--
-- ⚠ LOCATAIRE, ET CLOISONNÉE : le jeton est le chemin vers l'écran de
-- quelqu'un. Une ligne vue depuis la mauvaise école enverrait « votre enfant
-- est absent » à une famille d'une autre école.
CREATE TABLE device_tokens (
  id           uuid NOT NULL DEFAULT uuid_generate_v7(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  -- Le jeton lui-même. Opaque, rotatif, et révoqué par Google dès qu'un envoi
  -- répond UNREGISTERED — la ligne part alors.
  token        text NOT NULL,
  locale       text NOT NULL DEFAULT 'fr',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (school_id, token),
  UNIQUE (school_id, id)
);
CREATE INDEX device_tokens_user_idx ON device_tokens (school_id, user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_tokens FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON device_tokens
  USING      (school_id = current_school_id())
  WITH CHECK (school_id = current_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON device_tokens TO app_user;

-- ── La file de sortie ──────────────────────────────────────────────────────
-- ⚠ UNE TABLE DE PLATE-FORME, comme `outbound_mail`, et pour la même raison :
-- le travailleur ramasse le travail de toutes les écoles, puis fait la partie
-- locataire — lire les jetons — sous `withTenant()` pour chacune.
--
-- Durable : une coupure au milieu d'un envoi laisse la ligne où elle est, et
-- le prochain passage la reprend. Pas BullMQ (règle 18) pour la raison que
-- 0012 donne : Redis n'est pas là, Postgres l'est, et `FOR UPDATE SKIP LOCKED`
-- est une primitive correcte.
CREATE TABLE outbound_push (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Ce qui s'affiche. Le titre et le corps SEULEMENT : jamais une note, jamais
  -- un montant. Un écran verrouillé les montre à qui tient le téléphone.
  title         text NOT NULL,
  body          text NOT NULL,
  -- Où l'application ouvre en tapant dessus — « notifications », « absences »…
  route         text,
  status        outbound_status NOT NULL DEFAULT 'pending',
  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 5,
  run_after     timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX outbound_push_due_idx
  ON outbound_push (run_after, created_at)
  WHERE status = 'pending';
CREATE INDEX outbound_push_school_idx ON outbound_push (school_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_push TO app_user;
GRANT SELECT ON outbound_push TO app_reporter;

COMMENT ON TABLE outbound_push IS
  'Notifications poussées en attente. Titre et corps seulement, jamais une note '
  'ni un montant : un écran verrouillé les montre à qui tient le téléphone.';
