-- ============================================================================
--  0023 — l'index que « Historique des connexions » attendait
-- ============================================================================
--
-- `historique.php` porte cette note dans son propre code, à côté de la requête :
--
--   « Il n existe pas encore d index sur `date_connexion` : voir la
--     recommandation jointe a la livraison. Le code est pret a en profiter des
--     qu il sera pose. »
--
-- Il n'a jamais été posé. Notre écran lit les mêmes faits depuis
-- `refresh_tokens` — `issued_at` est la connexion, `revoked_at` la déconnexion —
-- et se heurtait au même Seq Scan : la table grossit d'une ligne par connexion,
-- pour ~2 000 comptes, et chaque affichage la relisait entière.
--
--     Seq Scan on refresh_tokens  (cost=0.06..15.91)
--
-- ⚠ `school_id` EN TÊTE, comme toute clé de ce schéma (règle 4). La requête
-- filtre toujours sur l'école avant la date, et un index qui commencerait par
-- `issued_at` obligerait à lire les lignes de toutes les écoles pour en écarter
-- la plupart.
--
-- ⚠ `DESC` sur la date parce que l'écran trie ainsi : les connexions les plus
-- récentes en haut. L'index rend alors l'ordre sans étape de tri.
CREATE INDEX refresh_tokens_school_issued_idx
  ON refresh_tokens (school_id, issued_at DESC);

COMMENT ON INDEX refresh_tokens_school_issued_idx IS
  'Sert « Historique des connexions » : une journée d''une école, du plus '
  'récent au plus ancien.';
