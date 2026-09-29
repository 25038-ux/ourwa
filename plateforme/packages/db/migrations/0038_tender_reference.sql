-- LA RÉFÉRENCE DU PAIEMENT EXTERNE — décision du propriétaire (2026-09-18).
--
-- Un versement arrive de plus en plus par une application de paiement
-- (Bankily, Masrvi, Sedad…) qui délivre son propre numéro de reçu. L'agent le
-- saisit, facultativement, sur CHAQUE ligne de moyen d'un encaissement — un
-- paiement peut en porter plusieurs (« receipt/receipts ») — et le reçu que
-- l'école imprime le reproduit à côté du moyen : la famille et la caisse
-- retrouvent ainsi l'opération des deux côtés. Texte libre, court, jamais
-- obligatoire ; rien ne change pour ce qui existe.
ALTER TABLE tender_lines ADD COLUMN reference text;
ALTER TABLE tender_lines ADD CONSTRAINT tender_lines_reference_len
  CHECK (reference IS NULL OR char_length(reference) <= 60);
