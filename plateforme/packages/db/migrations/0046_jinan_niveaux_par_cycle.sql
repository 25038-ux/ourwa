-- ============================================================================
--  0046 — JINAN : SES NIVEAUX CLASSÉS PAR CYCLE, DANS L'ORDRE DEMANDÉ.
--
--  Demande du propriétaire (30/09/2026), pour les niveaux déjà créés sur le
--  site de Jinan (tous « autre », rang 0 : le formulaire ne demandait pas le
--  cycle) :
--    Maternelle   : TPS, PS, SM, GS, PGS, PGSB
--    Fondamentale : 6AF
--    Collège      : 1AS, 2AS, 3AS, 4AS
--    Lycée        : 5AS, 6AS, 7AS
--  dans cet ordre (le rang recommence à 1 dans chaque cycle, comme la
--  progression le lit : le cycle d'abord, puis le rang).
--
--  ⚠ UNE SEULE ÉCOLE : celle dont le slug est « jinan ». Ailleurs (El Mourad,
--  les bases de développement), aucune ligne ne correspond et rien ne bouge.
--  Les noms sont comparés sans espaces ni casse (« 1 AS » = « 1AS ») ; un
--  niveau au nom différent reste où il est, et se classe à la main dans
--  « Gestion de scolarité → Niveaux » (cycle et rang modifiables).
--
--  Seuls `cycle` et `sort_order` changent : ni tarif, ni seuil, ni
--  « fondamental » (qui décide du bulletin), ni élève. Migration : une fois,
--  jamais rejouée — un classement refait ensuite à la main n'est pas écrasé.
-- ============================================================================

UPDATE levels l
   SET cycle = c.cycle::school_cycle,
       sort_order = c.rang
  FROM (VALUES
         ('TPS',  'maternelle',  1),
         ('PS',   'maternelle',  2),
         ('SM',   'maternelle',  3),
         ('GS',   'maternelle',  4),
         ('PGS',  'maternelle',  5),
         ('PGSB', 'maternelle',  6),
         ('6AF',  'fondamental', 1),
         ('1AS',  'college',     1),
         ('2AS',  'college',     2),
         ('3AS',  'college',     3),
         ('4AS',  'college',     4),
         ('5AS',  'lycee',       1),
         ('6AS',  'lycee',       2),
         ('7AS',  'lycee',       3)
       ) AS c (nom, cycle, rang),
       schools s
 WHERE s.id = l.school_id
   AND s.slug = 'jinan'
   AND upper(regexp_replace(l.name, '\s', '', 'g')) = c.nom;
