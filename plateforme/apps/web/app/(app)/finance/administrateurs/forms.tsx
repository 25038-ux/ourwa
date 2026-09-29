'use client';


import {
  addFundHolderAction,
  toggleFundHolderAction,
  updateFundHolderAction,
} from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

/**
 * AJOUTER UN ADMINISTRATEUR — `administrateurs.php`, action `ajouter_admin`.
 * Sa grille `repeat(auto-fit, minmax(200px, 1fr))`, ses trois champs, son bouton.
 */
export function AjouterAdmin() {
  const [state, action, pending] = useActionMessage(addFundHolderAction);


  return (
    <form action={action}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
          gap: '1rem',
        }}
      >
        <div className="form-group">
          <label>Nom complet *</label>
          <input
            type="text"
            name="fullName"
            required
            minLength={3}
            maxLength={150}
            placeholder="Ex : Mohamed Ould Ahmed"
          />
        </div>
        <div className="form-group">
          <label>Téléphone</label>
          <input type="text" name="phone" maxLength={30} placeholder="Ex : 22 33 44 55" />
        </div>
        <div className="form-group">
          <label>Limite mensuelle (MRU) *</label>
          <input
            type="number"
            name="monthlyLimit"
            min="0"
            step="1"
            required
            placeholder="Ex : 1000000"
          />
        </div>
      </div>
      <button className="btn btn-primary" style={{ width: 'auto' }} disabled={pending}>
        + Ajouter l&apos;administrateur
      </button>
    </form>
  );
}

/**
 * LA COLONNE « GESTION » — ses deux petits champs et son « ✓ » (`modifier_admin`),
 * puis « Désactiver » / « Réactiver » (`basculer_admin`), sans confirmation.
 */
export function GestionAdmin({
  adminId,
  monthlyLimit,
  phone,
  actif,
}: {
  adminId: string;
  monthlyLimit: string;
  phone: string | null;
  actif: boolean;
}) {
  const [state, action, pending] = useActionMessage(updateFundHolderAction);
  const [toggleState, toggleAction, toggling] = useActionMessage(toggleFundHolderAction);



  const champ: React.CSSProperties = {
    width: 110,
    padding: '.35rem .5rem',
    border: '2px solid var(--border)',
    borderRadius: 6,
    fontSize: '.85rem',
  };

  return (
    <>
      <form
        key={`${monthlyLimit}-${phone ?? ''}`}
        action={action}
        style={{ display: 'flex', gap: '.3rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <input type="hidden" name="adminId" value={adminId} />
        <input
          type="number"
          name="monthlyLimit"
          defaultValue={String(Math.round(Number(monthlyLimit)))}
          min="0"
          step="1"
          title="Limite mensuelle (MRU)"
          style={champ}
        />
        <input
          type="text"
          name="phone"
          defaultValue={phone ?? ''}
          placeholder="Téléphone"
          title="Téléphone"
          style={champ}
        />
        <button className="btn btn-sm btn-secondary" style={{ padding: '.3rem .6rem' }} disabled={pending}>
          ✓
        </button>
      </form>
      <form action={toggleAction} style={{ display: 'inline' }}>
        <input type="hidden" name="adminId" value={adminId} />
        <button
          className={`btn btn-sm ${actif ? 'btn-danger' : 'btn-primary'}`}
          style={{ marginTop: '.25rem', fontSize: '.7rem' }}
          disabled={toggling}
        >
          {actif ? 'Désactiver' : 'Réactiver'}
        </button>
      </form>
    </>
  );
}

const MOIS_NOMS = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/** « Rapports des retraits » — ses trois périodes, ses noms de champs, son Imprimer. */
export function RapportForm({
  rapport,
  rDate,
  rMois,
  rAnnee,
  anneeCourante,
}: {
  rapport: string;
  rDate: string;
  rMois: number;
  rAnnee: number;
  anneeCourante: number;
}) {
  const soumettre = (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    e.currentTarget.form?.requestSubmit();
  // Ses deux fenêtres : −2…+1 pour le mensuel, −3…+1 pour l'annuel.
  const debut = rapport === 'annee' ? anneeCourante - 3 : anneeCourante - 2;
  const annees: number[] = [];
  for (let y = debut; y <= anneeCourante + 1; y += 1) annees.push(y);

  return (
    <form
      method="GET"
      style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
    >
      <div style={{ minWidth: 170 }}>
        <label>Type de rapport</label>
        <select name="rapport" defaultValue={rapport} onChange={soumettre}>
          <option value="jour">Journalier</option>
          <option value="mois">Mensuel</option>
          <option value="annee">Annuel</option>
        </select>
      </div>
      {rapport === 'jour' ? (
        <div>
          <label>Date</label>
          <input type="date" name="r_date" defaultValue={rDate} onChange={soumettre} />
        </div>
      ) : rapport === 'mois' ? (
        <>
          <div>
            <label>Mois</label>
            <select name="r_mois" defaultValue={rMois} onChange={soumettre}>
              {MOIS_NOMS.slice(1).map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Année</label>
            <select name="r_annee" defaultValue={rAnnee} onChange={soumettre}>
              {annees.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <div>
          <label>Année</label>
          <select name="r_annee" defaultValue={rAnnee} onChange={soumettre}>
            {annees.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}
      <button type="button" className="btn btn-secondary no-print" onClick={() => window.print()}>
        Imprimer
      </button>
    </form>
  );
}
