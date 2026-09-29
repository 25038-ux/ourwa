'use client';

import { setLevelTarifAction, setServicePriceAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

/**
 * LES CELLULES DE PRIX DE LA FACTURATION « SERVICES » (Jinan) — page « Frais »
 * et « Gérer les niveaux » d'une école « services ».
 *
 * Le motif de `RateCell` (`gerer_niveaux.php`, `modifier_tarif`) : chaque
 * cellule est son propre `<form>`, la boîte, « MRU », « ✓ », et le message qui
 * remonte EN HAUT de la page (`useActionMessage`, sous un `<MessagePage>`).
 *
 * Un champ vide = « non défini » (l'indication grise du champ le dit) : on ne
 * peut alors ni inscrire dans ce mode ni souscrire ce service. `valeur` arrive
 * déjà prête pour le champ (`montantSaisi()`, lib/facturation.ts) : aucun
 * nombre JS ne touche le montant, qui part en chaîne vers l'action.
 *
 * ⚠ `key={valeur}` SUR LE CHAMP. React ne met pas à jour le `defaultValue`
 * d'un `<input type="number">` qui a le focus — or on valide par Entrée, le
 * focus dedans — et il remet ensuite le formulaire à zéro : le prix enregistré
 * (« 4 500 MRU », dit le message) réapparaissait vide. Une nouvelle valeur du
 * serveur recrée donc le champ.
 */

const BOITE: React.CSSProperties = {
  width: 100,
  minWidth: 80,
  padding: '.35rem .5rem',
  border: '2px solid var(--border)',
  borderRadius: 6,
  fontSize: '.85rem',
};
// `nowrap` : dans un tableau serré (huit colonnes sur « Gérer les niveaux »),
// « MRU » se cassait lettre par lettre en colonne.
const UNITE: React.CSSProperties = { fontSize: '.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' };
const VALIDER: React.CSSProperties = { padding: '.3rem .6rem', fontSize: '.8rem' };
const LIGNE: React.CSSProperties = { display: 'flex', gap: '.4rem', alignItems: 'center' };

/**
 * UN TARIF D'UN NIVEAU — 8h – 14h, 8h – 17h ou frais d'inscription
 * (`PATCH /levels/:id/tarifs`, `setLevelTarifAction`).
 */
export function TarifNiveauCellule({
  levelId,
  niveau,
  champ,
  libelle,
  valeur,
}: {
  levelId: string;
  /** Le nom du niveau — pour le nom accessible du champ. */
  niveau: string;
  champ: 'tarif8h14' | 'tarif8h17' | 'fraisInscription';
  /** « 8h – 14h », « Frais d'inscription »… */
  libelle: string;
  /** Le montant tel qu'il s'écrit dans le champ (« 3000 ») ; '' = non défini. */
  valeur: string;
}) {
  const [, action, pending] = useActionMessage(setLevelTarifAction);
  return (
    <form action={action} style={LIGNE}>
      <input type="hidden" name="levelId" value={levelId} />
      <input type="hidden" name="champ" value={champ} />
      <input
        key={valeur}
        type="number"
        name="montant"
        defaultValue={valeur}
        min={0}
        step="0.01"
        placeholder="non défini"
        aria-label={`${libelle} — ${niveau}`}
        style={BOITE}
      />
      <span style={UNITE}>MRU</span>
      <button type="submit" className="btn btn-sm btn-secondary" disabled={pending} style={VALIDER} title="Enregistrer">
        ✓
      </button>
    </form>
  );
}

/**
 * LE PRIX D'UN SERVICE POUR UNE ANNÉE (`POST /finance/tarifs/services`,
 * `setServicePriceAction`). Le même prix pour tous les niveaux (réponse du
 * propriétaire, spécification §4).
 */
export function PrixServiceCellule({
  academicYearId,
  anneeLabel,
  code,
  libelle,
  valeur,
}: {
  academicYearId: string;
  /** « 2025-2026 » — pour le message seulement. */
  anneeLabel: string;
  code: string;
  libelle: string;
  /** Le montant tel qu'il s'écrit dans le champ ; '' = non défini. */
  valeur: string;
}) {
  const [, action, pending] = useActionMessage(setServicePriceAction);
  return (
    <form action={action} style={LIGNE}>
      <input type="hidden" name="academicYearId" value={academicYearId} />
      <input type="hidden" name="anneeLabel" value={anneeLabel} />
      <input type="hidden" name="code" value={code} />
      <input
        key={valeur}
        type="number"
        name="prix"
        defaultValue={valeur}
        min={0}
        step="0.01"
        placeholder="non défini"
        aria-label={`Prix — ${libelle}`}
        style={BOITE}
      />
      <span style={UNITE}>MRU</span>
      <button type="submit" className="btn btn-sm btn-secondary" disabled={pending} style={VALIDER} title="Enregistrer">
        ✓
      </button>
    </form>
  );
}
