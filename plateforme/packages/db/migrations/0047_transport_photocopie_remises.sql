-- ============================================================================
--  0047 — LE TRANSPORT ; LA PHOTOCOPIE OBLIGATOIRE ; LES REMISES SUR LES
--  SERVICES MENSUELS.
--
--  Demande du propriétaire de Jinan (04/10/2026), ADR-0079 :
--    1. « add transport service (billed monthly and selected just like any
--       other service at inscription) » : un service MENSUEL au prix de
--       l'école, coché à l'inscription, ajouté ou arrêté ensuite depuis la
--       fiche — comme la piscine. Seules les listes de codes des CHECK de 0042
--       l'ignoraient ; `famille` (générée) vaut alors « transport ».
--    2. « make frais de photocopie constant for every niveau and mandatory
--       just like frais d'inscription » : son prix était déjà UN prix d'école
--       (service_prices, par année, pas par niveau) ; elle devient d'office à
--       chaque (ré)inscription. Rien à changer ici : c'est la règle de l'API
--       (`SERVICES_D_OFFICE`). ⚠ Pas de rattrapage : les élèves inscrits avant
--       ne reçoivent AUCUNE dette rétroactive (la fiche permet de l'ajouter).
--    3. « make it possible to apply reductions to the monthly services » :
--       `remise`, un montant PAR MOIS retranché du prix figé de l'abonnement,
--       posé par la direction. Il réévalue les SEULS mois sans paiement — la
--       règle de « changer de mode » et de « Modifier le frais mensuel » : un
--       mois réglé garde son prix et son reçu. L'argent, lui, reste dans
--       service_payments (append-only), jamais ici.
--
--  Les lignes existantes ne changent pas : remise = 0 partout.
-- ============================================================================

ALTER TABLE service_prices DROP CONSTRAINT service_prices_service_check;
ALTER TABLE service_prices ADD CONSTRAINT service_prices_service_check
  CHECK (service IN ('cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet',
                     'piscine', 'docteur', 'transport', 'photocopie'));

ALTER TABLE student_services DROP CONSTRAINT student_services_service_check;
ALTER TABLE student_services ADD CONSTRAINT student_services_service_check
  CHECK (service IN ('cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet',
                     'piscine', 'docteur', 'transport', 'photocopie', 'inscription'));

ALTER TABLE student_services
  ADD COLUMN remise    numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN remise_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN remise_at timestamptz,
  -- Jamais négative, jamais plus que le prix : un mois ne peut pas devenir
  -- une dette négative (« la famille est créditrice » n'existe pas ici).
  ADD CONSTRAINT student_services_remise_bornee CHECK (remise >= 0 AND remise <= amount),
  -- Sur un service MENSUEL seulement : un service annuel (inscription,
  -- photocopie) s'exempte, il ne se remise pas.
  ADD CONSTRAINT student_services_remise_mensuelle
    CHECK (remise = 0 OR service NOT IN ('photocopie', 'inscription'));

COMMENT ON COLUMN student_services.remise IS
  'Remise PAR MOIS (MRU), retranchée du prix figé (amount) sur les mois sans paiement. '
  'Posée par la direction (POST /finance/student-services/:id/remise), journalisée.';
