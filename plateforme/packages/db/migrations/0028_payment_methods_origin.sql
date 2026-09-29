-- ============================================================================
--  0028_payment_methods_origin — `payment_methods` rejoint la convention que
--  0001 énonce pour toutes les autres
--
--  ⚠ 0001 LE DIT EN TOUTES LETTRES, ET FAIT UNE EXCEPTION SANS LE DIRE :
--
--      « TENANT TABLES — Each carries: school_id, origin, legacy_id.
--        `legacy_id` stays permanently — it makes reconciliation possible and
--        lets imports re-run idempotently. Four bytes that save the project. »
--
--  Quinze tables locataires les portent. `payment_methods` ne les avait pas, et
--  cela ne s'est vu que le jour où la reprise a voulu écrire dedans : ses sept
--  moyens de paiement — espèces, Bankily, Masrivi… — sont des données de
--  référence qui appartiennent à l'école, exactement comme les niveaux.
--
--  Sans `legacy_id`, un moyen RENOMMÉ chez El Ourwa arriverait ici en double au
--  lieu d'être mis à jour, et chaque encaissement ventilé sur l'ancien nom
--  pointerait une ligne que plus personne ne choisit. C'est précisément ce que
--  les quatre octets évitent.
--
--  `receipt_sequences` reste à l'écart, et c'est voulu : ce n'est pas une donnée
--  de l'école mais un compteur du système. Rien à reprendre, rien à réconcilier.
-- ============================================================================

ALTER TABLE payment_methods
  ADD COLUMN origin    record_origin NOT NULL DEFAULT 'native',
  ADD COLUMN legacy_id integer;

-- Le même index que partout ailleurs : il mène le rapprochement de l'import.
CREATE INDEX payment_methods_school_legacy_idx
  ON payment_methods (school_id, legacy_id);

COMMENT ON COLUMN payment_methods.legacy_id IS
  'L''identifiant de `moyens_paiement` chez El Ourwa. Permanent : il rend la '
  'réconciliation possible et l''import répétable.';
