-- ============================================================================
--  0050 — LES FRAIS DE PLATEFORME (mensuels, d'office) ; LES FRAIS DE
--  FOURNITURE (annuels, au choix).
--
--  Demande du propriétaire de Jinan (06/10/2026), ADR-0082 :
--    1. « frais de fourniture (annuel et par étudiant et optionnel) (service
--       optionnel) » : un service au prix de l'école, COCHÉ à l'inscription
--       comme la piscine, payé UNE FOIS l'an comme la photocopie (une seule
--       ligne d'échéancier). Il n'a pas de remise (annuel : il s'exempte) ; il
--       a une pièce dans « Documents » (un service que la famille choisit).
--    2. « Frais de plateforme obligatoire et par étudiant et mensuel » : un
--       prix d'école, créé D'OFFICE à chaque (ré)inscription comme la
--       photocopie, mais facturé CHAQUE MOIS comme la scolarité. Remisable
--       (mensuel), exemptable, jamais arrêté ; pas de pièce (d'office, comme
--       la photocopie). ⚠ Prix non défini → l'inscription est refusée (D4 :
--       non défini n'est pas gratuit) ; 0 = gratuit, rien d'écrit. Aucun prix
--       n'est posé ici : c'est une donnée de l'école (page « Frais »).
--
--  ⚠ PAS DE RATTRAPAGE (comme la photocopie en 0047) : un élève déjà inscrit
--  ne reçoit AUCUNE plateforme rétroactive ; la fiche permet de l'ajouter.
--
--  Seules les listes des CHECK changent : aucune ligne existante n'est
--  réécrite, aucun montant n'est posé. `famille` (générée) vaut le code.
-- ============================================================================

ALTER TABLE service_prices DROP CONSTRAINT service_prices_service_check;
ALTER TABLE service_prices ADD CONSTRAINT service_prices_service_check
  CHECK (service IN ('cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet',
                     'piscine', 'docteur', 'transport', 'plateforme', 'fourniture',
                     'photocopie'));

ALTER TABLE student_services DROP CONSTRAINT student_services_service_check;
ALTER TABLE student_services ADD CONSTRAINT student_services_service_check
  CHECK (service IN ('cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet',
                     'piscine', 'docteur', 'transport', 'plateforme', 'fourniture',
                     'photocopie', 'inscription'));

-- Une remise est PAR MOIS : un service annuel (fournitures, photocopie,
-- inscription) s'exempte, il ne se remise pas. La plateforme, mensuelle, se
-- remise comme la cantine.
ALTER TABLE student_services DROP CONSTRAINT student_services_remise_mensuelle;
ALTER TABLE student_services ADD CONSTRAINT student_services_remise_mensuelle
  CHECK (remise = 0 OR service NOT IN ('fourniture', 'photocopie', 'inscription'));

-- Les pièces signées : les fournitures (un service choisi) en ont une ; la
-- plateforme (d'office, comme la photocopie) non.
ALTER TABLE student_documents DROP CONSTRAINT student_documents_piece_check;
ALTER TABLE student_documents ADD CONSTRAINT student_documents_piece_check
  CHECK (piece IN ('inscription', 'comportement_social',
                   'cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet',
                   'piscine', 'docteur', 'transport', 'fourniture'));
