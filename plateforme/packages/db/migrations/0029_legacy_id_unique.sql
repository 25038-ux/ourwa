-- ============================================================================
--  0029_legacy_id_unique — `(school_id, legacy_id)` unique, et indexé, partout
--
--  ⚠ LA REPRISE VENAIT DE PASSER DE DOUZE SECONDES À DIX MINUTES.
--
--  `tools/import` rapproche chaque ligne par `legacy_id` : un SELECT, puis un
--  INSERT ou un UPDATE. Seule `students` avait un index sur ce couple (0001).
--  Sur `enrollment_months`, 28 881 recherches balayaient chacune 28 881 lignes ;
--  sur `payments`, 15 989 fois 15 989. Le coût est quadratique, et il ne s'est vu
--  qu'à la tranche financière, quand les tables ont grossi.
--
--  ⚠ ET L'INDEX EST UNIQUE, PAS SEULEMENT RAPIDE. 0001 dit que `legacy_id` est ce
--  qui « rend l'import répétable ». Jusqu'ici cette répétabilité tenait au code
--  de `reprendre()` — un SELECT avant chaque INSERT. Une coupure entre les deux,
--  ou une seconde reprise lancée pendant la première, aurait produit deux
--  lignes pour un même encaissement d'El Ourwa, et la réconciliation aurait
--  compté un paiement de trop. Avec l'unicité dans la base, ce doublon est
--  IMPOSSIBLE, pas seulement improbable — c'est la même logique que les clés
--  étrangères composites pour le cloisonnement.
--
--  Partiel sur `legacy_id IS NOT NULL` : les lignes créées ici n'en ont pas et
--  ne doivent pas se gêner entre elles.
--
--  Fait depuis le catalogue plutôt qu'en listant les tables : une table ajoutée
--  demain avec un `legacy_id` sera couverte sans qu'on y pense. La condition sur
--  `school_id` écarte `users`, qui n'a ni l'un ni l'autre, à dessein.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.column_name = 'legacy_id'
       AND EXISTS (SELECT 1 FROM information_schema.columns s
                    WHERE s.table_schema = 'public'
                      AND s.table_name = c.table_name
                      AND s.column_name = 'school_id')
     ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (school_id, legacy_id) WHERE legacy_id IS NOT NULL',
      t || '_legacy_uq', t
    );
  END LOOP;
END $$;

-- L'index simple de 0001 sur `students` est désormais redondant avec l'unique.
DROP INDEX IF EXISTS students_school_legacy_idx;
DROP INDEX IF EXISTS payment_methods_school_legacy_idx;
