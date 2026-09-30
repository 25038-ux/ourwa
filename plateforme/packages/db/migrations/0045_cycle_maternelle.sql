-- ============================================================================
--  0045 — LE CYCLE « MATERNELLE ».
--
--  Demande du propriétaire (30/09/2026) : classer les niveaux en Maternelle,
--  Fondamentale, Collège, Lycée. L'énumération n'avait que fondamental,
--  college, lycee, autre.
--
--  AVANT « fondamental » : l'ordre des valeurs d'une énumération est celui de
--  `ORDER BY l.cycle` dans toutes les listes (niveaux, groupes, tarifs,
--  statistiques) — la maternelle s'y affiche désormais en premier, « autre »
--  toujours en dernier.
--
--  Seule dans sa migration : une valeur ajoutée à une énumération ne peut pas
--  servir dans la transaction qui l'ajoute (0046 l'utilise).
-- ============================================================================

ALTER TYPE school_cycle ADD VALUE IF NOT EXISTS 'maternelle' BEFORE 'fondamental';
