-- ============================================================================
--  0049 — DOCUMENTS SIGNÉS : « COMPORTEMENTS SOCIAUX » ENTRE, LA PHOTOCOPIE SORT.
--
--  Demande du propriétaire de Jinan (04/10/2026, après 0048), ADR-0080 :
--    « add comportement sociaux to documents and change frais d'inscription
--      to inscription and delete photocopie ».
--
--  - `comportement_social` : une pièce de plus, présente pour CHAQUE enfant
--    (comme l'inscription), quels que soient ses services.
--  - `photocopie` n'est plus une pièce. Elle reste un service facturé
--    (0047) ; seul son document signé disparaît. 0048 et 0049 partent en
--    production ensemble : aucune ligne « photocopie » n'y a jamais existé.
--    Les seules possibles (bancs d'essai) sont retirées ci-dessous ; leur
--    fichier, s'il en reste un, est signalé comme orphelin par
--    GET /attachments/integrity — rien d'autre ne le lit.
--  - Le libellé « Inscription » (et non « Frais d'inscription ») est celui de
--    l'API (`libellePiece`) : rien à changer en base.
-- ============================================================================

DELETE FROM student_documents WHERE piece = 'photocopie';

ALTER TABLE student_documents DROP CONSTRAINT student_documents_piece_check;
ALTER TABLE student_documents ADD CONSTRAINT student_documents_piece_check
  CHECK (piece IN ('inscription', 'comportement_social',
                   'cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet',
                   'piscine', 'docteur', 'transport'));
