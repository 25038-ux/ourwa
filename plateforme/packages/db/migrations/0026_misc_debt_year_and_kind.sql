-- ============================================================================
--  0026 — une créance dit de quelle année elle vient, et de quelle nature
-- ============================================================================
--
-- Le repli « Gérer les créances » de `reinscriptions.php` a SEPT colonnes :
--
--     Année · Élève · Type · Réclamé · Restant dû · Note · Actions
--
-- La nôtre en avait six. Il manquait l'ANNÉE — sur l'écran dont tout le propos
-- est « les arriérés de TOUTES les années » — et son « Type » était remplacé
-- par notre texte libre `reason`, qui n'est pas la même chose.
--
-- `dettes_familles` porte les trois colonnes qui manquaient :
--
--     `annee`          smallint          l'année de début (2024 pour 2024-2025)
--     `type_dette`     enum('arriere','facture')
--     `facture_source` int               le numéro de la facture non soldée
--
-- ⚠ UN `smallint`, PAS UNE CLÉ ÉTRANGÈRE VERS `academic_years`. Une créance
-- reprise de l'ancien système peut porter sur une année dont nous n'avons
-- aucune ligne — c'est même le cas le plus courant à la bascule. Une clé
-- étrangère rendrait ces reprises impossibles à saisir, ce qui est exactement
-- le contraire du but. El Ourwa a d'ailleurs les deux (`annee_id` ET `annee`)
-- et n'utilise que la seconde à l'affichage.
--
-- ⚠ NULLABLE, ET AFFICHÉ « — ». Les créances déjà saisies ne portent pas
-- d'année et nous n'allons pas en inventer une (règle 24) : la déduire de
-- `created_at` serait faux dans le cas qui compte — un arriéré de 2024-2025
-- enregistré en septembre 2026 se lirait 2026. El Ourwa affiche exactement le
-- même tiret : `$ld['annee'] ? $ld['annee'] . '-' . ($ld['annee'] + 1) : '—'`.

ALTER TABLE misc_debts
  ADD COLUMN start_year     smallint,
  ADD COLUMN kind           text NOT NULL DEFAULT 'arriere'
             CHECK (kind IN ('arriere', 'facture')),
  ADD COLUMN invoice_source integer;

COMMENT ON COLUMN misc_debts.start_year IS
  'Année de début à laquelle la créance se rattache (2024 pour 2024-2025). '
  'NULL quand elle est inconnue — affiché « — », jamais deviné. Son `annee`.';

COMMENT ON COLUMN misc_debts.kind IS
  'Son `type_dette` : « arriere » (avance non régularisée) ou « facture » '
  '(facture non soldée). Décide de ce qu''affiche la colonne « Type ».';

COMMENT ON COLUMN misc_debts.invoice_source IS
  'Son `facture_source` : le numéro de la facture non soldée, affiché '
  '« Reliquat facture n° 12 ». NULL pour un arriéré.';

-- L'écran des réinscriptions lit les créances d'un foyer, les plus récentes
-- d'abord. `guardian_id` menait déjà l'index ; l'année s'y ajoute pour que le
-- tri ne repasse pas derrière.
CREATE INDEX misc_debts_school_guardian_year_idx
  ON misc_debts (school_id, guardian_id, start_year DESC NULLS LAST);
