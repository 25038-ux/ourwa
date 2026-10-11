-- ============================================================================
--  0051 — UN INDEX POUR « LES ANNÉES QUI PORTENT DES PAIEMENTS »
--
--  10/10/2026, le jour de la mise en ligne. Le propriétaire : « the site is
--  still kinda slow ». La page d'accueil de la caisse (/finance), la plus
--  ouverte de l'école, demande à chaque chargement les bornes de sa liste
--  d'années — GET /reports/bornes-annees :
--
--      SELECT MIN(calendar_year), MAX(calendar_year) FROM payments
--
--  Aucun index ne commence par l'année : Postgres lisait donc les 15 989
--  paiements de la table pour en tirer deux nombres. Mesuré sur les données de
--  l'école, sous app_user et son contexte (RLS appliquée) : 17 à 44 ms
--  d'exécution sans l'index selon la charge du poste, 0,2 à 1 ms avec — deux
--  lectures d'une seule entrée, la première et la dernière. Et la table grossit
--  de quelque 8 000 lignes par an.
--
--  L'index commence par school_id, comme tout index d'une table d'école (règle
--  4) : sous RLS c'est la condition pour qu'il serve. 16 000 petits entiers :
--  128 ko.
--
--  (0046 chez El Ourwa ; 0051 chez Jinan, dont 0043 à 0050 sont déjà pris.)
--
--  ⚠ RIEN D'AUTRE NE CHANGE : aucune table, aucune colonne, aucune ligne.
--  IF NOT EXISTS : rejouer la migration ne fait rien.
-- ============================================================================

CREATE INDEX IF NOT EXISTS payments_school_calendar_year_idx
  ON payments (school_id, calendar_year);
