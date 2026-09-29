-- ============================================================================
--  0034_pret_numero_contrat — le contrat de prêt « PRET-000123 »
--
--  `dette.php` imprime, après chaque prêt au personnel, un contrat numéroté
--  'PRET-' . str_pad(id, 6, '0'). Le compteur `document_sequences` (0033),
--  sorte `pret`, rend le même numéro.
-- ============================================================================

ALTER TABLE staff_loans ADD COLUMN receipt_no integer;
ALTER TABLE staff_loans
  ADD CONSTRAINT staff_loans_school_receipt_no_key UNIQUE (school_id, receipt_no);
