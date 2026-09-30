'use client';

import { useRef, type ReactNode } from 'react';
import {
  authoriseReEnrolAction,
  bulkReEnrolAction,
  creanceAction,
  writeOffAction,
} from '@/app/actions';
import { MODES_ETUDE, libelleMode } from '@elourwa/shared/facturation';
import { useActionMessage } from '@/components/message-page';
import { OptionsParCycle } from '@/components/options-par-cycle';

/**
 * ⚠ LES FORMULAIRES DE CRÉANCE VIVENT HORS DU FORMULAIRE DE RÉINSCRIPTION, et
 * sa page porte déjà la raison en commentaire : « imbriquer deux <form> est
 * invalide en HTML et le navigateur supprime le second. Les boutons du tableau
 * alimentent celui-ci puis le soumettent. »
 *
 * Même mécanique ici : UN formulaire caché au pied de la page, un identifiant
 * stable, un champ `op` qui dit laquelle des trois opérations part, et les
 * boutons du tableau qui le remplissent avant de l'envoyer.
 */
const F_CREANCE = 'form-creance';

/** Son `envoyerDette(action, champs)`, au caractère près. */
function envoyerCreance(op: string, champs: Record<string, string>) {
  const f = document.getElementById(F_CREANCE) as HTMLFormElement | null;
  if (!f) return;
  const remplir = (name: string, value: string) => {
    const field = f.elements.namedItem(name) as HTMLInputElement | null;
    if (field) field.value = value;
  };
  // Tous les champs sont réécrits à chaque envoi : un reliquat de l'opération
  // précédente partirait avec la suivante.
  remplir('op', op);
  for (const name of ['id', 'guardianId', 'debtorName', 'remaining', 'total', 'reason', 'startYear']) {
    remplir(name, champs[name] ?? '');
  }
  f.requestSubmit();
}

/**
 * LA SÉLECTION ET SA CLASSE DE DESTINATION — son `<form method="POST">` autour
 * de toute la table : la classe de destination, « Réinscrire la sélection »,
 * « Tout cocher » (les cases grisées exceptées — son `:not(:disabled)`) et
 * « Tout décocher ».
 */
export function BulkSelection({
  groups,
  cible,
  modesEtude = false,
  children,
}: {
  groups: { id: string; name: string; level_name: string | null; cycle?: string | null }[];
  cible: { label: string; startYear: number };
  /**
   * École « services » (Jinan, §2) : un mode d'étude pour tout le lot,
   * obligatoire. Les services se souscrivent ensuite élève par élève (caisse).
   */
  modesEtude?: boolean;
  children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  // L'action redirige vers la caisse quand un seul élève est réinscrit.
  const [state, action, pending] = useActionMessage(bulkReEnrolAction);


  const cocher = (value: boolean) => {
    const boxes = form.current?.querySelectorAll<HTMLInputElement>(value ? '.chk-eleve:not(:disabled)' : '.chk-eleve');
    boxes?.forEach((b) => { b.checked = value; });
  };

  return (
    <form action={action} ref={form}>
      <input type="hidden" name="cible_libelle" value={cible.label} />
      <input type="hidden" name="cible_annee" value={cible.startYear} />
      <div className="form-card" style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <label htmlFor="groupe_id">Classe de destination *</label>
          <select id="groupe_id" name="groupe_id" required defaultValue="">
            <option value="">— Choisir —</option>
            <OptionsParCycle rubriques={modesEtude} elements={groups} libelle={(g) => (g.level_name ? g.level_name + ' / ' : '') + g.name} />
          </select>
        </div>
        {modesEtude && (
          <div>
            <label htmlFor="study_mode">Mode d&apos;étude (tout le lot) *</label>
            <select id="study_mode" name="study_mode" required defaultValue="">
              <option value="">— Choisir —</option>
              {MODES_ETUDE.map((m) => (
                <option key={m} value={m}>{libelleMode(m)}</option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending}>Réinscrire la sélection</button>
        <button type="button" className="btn btn-secondary" onClick={() => cocher(true)}>Tout cocher</button>
        <button type="button" className="btn btn-secondary" onClick={() => cocher(false)}>Tout décocher</button>
      </div>

      {children}
    </form>
  );
}

/**
 * CORRIGER / ANNULER UNE CRÉANCE — ses `detteEdit()` et `detteAnnuler()`,
 * mêmes questions, même ordre, mêmes refus.
 */
export function CreanceActions({ id, remaining }: { id: string; remaining: string }) {
  const style = { padding: '.1rem .4rem', fontSize: '.7rem', width: 'auto' } as const;

  const demanderCorrection = () => {
    const brut = window.prompt('Nouveau montant restant dû (MRU) :', String(Number(remaining)));
    if (brut === null) return;
    const montant = brut.replace(',', '.').trim();
    if (montant === '' || Number.isNaN(Number(montant)) || Number(montant) < 0) {
      window.alert('Montant invalide.');
      return;
    }
    const motif = window.prompt('Motif de la correction :', '');
    if (motif === null) return;
    if (!motif.trim()) {
      window.alert('Le motif est obligatoire.');
      return;
    }
    envoyerCreance('corriger', { id, remaining: montant, reason: motif });
  };

  const demanderAnnulation = () => {
    const ok = window.confirm(
      'Annuler cette créance ?\n\nLa ligne est conservée pour l\'historique comptable : ' +
        'son montant restant dû passe à zéro et le motif est enregistré.',
    );
    if (!ok) return;
    const motif = window.prompt('Motif de l\'annulation :', '');
    if (motif === null) return;
    if (!motif.trim()) {
      window.alert('Le motif est obligatoire.');
      return;
    }
    envoyerCreance('annuler', { id, reason: motif });
  };

  return (
    <>
      <button type="button" className="btn btn-secondary" style={style} onClick={demanderCorrection}>
        Corriger
      </button>
      {Number(remaining) > 0.005 && (
        <>
          {' '}
          <button type="button" className="btn btn-secondary" style={style} onClick={demanderAnnulation}>
            Annuler
          </button>
        </>
      )}
    </>
  );
}

/**
 * AJOUTER UNE CRÉANCE — son `detteCreer()` : le montant, puis le motif ; la
 * créance se rattache à l'année cible (`annee_par_id($cible_id)`).
 */
export function AjouterCreance({
  guardianId,
  guardianName,
  startYear,
}: {
  guardianId: string;
  guardianName: string;
  startYear?: number;
}) {
  const demander = () => {
    const brut = window.prompt('Montant de la créance à ajouter (MRU) :', '');
    if (brut === null) return;
    const montant = brut.replace(',', '.').trim();
    if (montant === '' || Number.isNaN(Number(montant)) || Number(montant) <= 0) {
      window.alert('Montant invalide.');
      return;
    }
    const motif = window.prompt('Motif (obligatoire pour la traçabilité) :', '');
    if (motif === null) return;
    if (!motif.trim()) {
      window.alert('Le motif est obligatoire.');
      return;
    }
    envoyerCreance('creer', {
      guardianId,
      debtorName: guardianName,
      total: montant,
      reason: motif,
      startYear: startYear ? String(startYear) : '',
    });
  };

  return (
    <button type="button" className="btn btn-secondary" style={{ padding: '.15rem .5rem', fontSize: '.75rem', width: 'auto' }} onClick={demander}>
      + Ajouter une créance
    </button>
  );
}

/** Son `prefRemise(pid)` : « Remise / annulation globale » — choisit la famille dans le formulaire de remise et y descend. */
export function PrefRemise({ guardianId }: { guardianId: string }) {
  const aller = () => {
    const sel = document.getElementById('r-parent') as HTMLSelectElement | null;
    if (sel) {
      sel.value = guardianId;
      sel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      sel.focus();
    }
  };
  return (
    <>
      {' '}
      <button type="button" className="btn btn-secondary" style={{ padding: '.15rem .5rem', fontSize: '.75rem', width: 'auto' }} onClick={aller}>
        Remise / annulation globale
      </button>
    </>
  );
}

/**
 * LE BUREAU DES CRÉANCES — son `<form id="form-dette" style="display:none">`,
 * rendu UNE fois, hors du formulaire de réinscription.
 */
export function CreanceBureau({ enHaut = false }: { enHaut?: boolean }) {
  // `useActionMessage` publie déjà le message en tête de page au retour de
  // l'action ; le republier ici le faisait apparaître deux fois.
  const [state, action] = useActionMessage(creanceAction);

  return (
    <>
      {!enHaut && state?.error && <div className="alert alert-danger">{state.error}</div>}
      {!enHaut && state?.ok && <div className="alert alert-success">{state.ok}</div>}

      <form action={action} id={F_CREANCE} hidden>
        <input type="hidden" name="op" defaultValue="" />
        <input type="hidden" name="id" defaultValue="" />
        <input type="hidden" name="guardianId" defaultValue="" />
        <input type="hidden" name="debtorName" defaultValue="" />
        <input type="hidden" name="remaining" defaultValue="" />
        <input type="hidden" name="total" defaultValue="" />
        <input type="hidden" name="reason" defaultValue="" />
        <input type="hidden" name="startYear" defaultValue="" />
      </form>
    </>
  );
}

/**
 * ABAISSER OU ANNULER UNE DETTE — son POST `remise` : « Contrairement à
 * l'autorisation, la remise réduit réellement la dette. »
 */
export function RemiseForm({
  familles,
}: {
  familles: { id: string; name: string; debt: string }[];
}) {
  const [state, action, pending] = useActionMessage(writeOffAction);

  // Son `$vus` : une famille une seule fois.
  const uniques = [...new Map(familles.map((f) => [f.id, f])).values()];

  return (
    <div className="form-card" style={{ marginTop: '1.2rem' }}>
      <h3 style={{ marginTop: 0 }}>Abaisser ou annuler une dette</h3>
      <p className="text-muted" style={{ fontSize: '.85rem' }}>
        Pour les cas humains : difficulté familiale, accord d&apos;échelonnement, erreur historique.
        La décision est enregistrée avec son auteur, le montant et le motif.
        Contrairement à l&apos;autorisation, la remise <strong>réduit réellement la dette</strong>.
      </p>
      <form action={action} style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <input type="hidden" name="page" value="reinscriptions" />
        <div>
          <label htmlFor="r-parent">Famille</label>
          <select id="r-parent" name="guardianId" required>
            {uniques.map((f) => (
              <option key={f.id} value={f.id}>{f.name} — {f.debt} MRU</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="r-mode">Décision</label>
          <select id="r-mode" name="mode" defaultValue="partiel">
            <option value="partiel">Retirer un montant</option>
            <option value="total">Annuler toute la dette</option>
          </select>
        </div>
        <div>
          <label htmlFor="r-montant">Montant (MRU)</label>
          <input type="number" id="r-montant" name="amount" min={0} step={100} placeholder="ex. 5000" />
        </div>
        <div style={{ flex: 1, minWidth: '12rem' }}>
          <label htmlFor="r-motif">Motif</label>
          <input type="text" id="r-motif" name="reason" maxLength={200} placeholder="Situation familiale, accord…" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>Enregistrer la remise</button>
      </form>
    </div>
  );
}

/**
 * AUTORISER UNE RÉINSCRIPTION MALGRÉ LA DETTE — son POST `autoriser` :
 * « La décision est enregistrée avec son auteur, le montant dû et le motif. »
 */
export function AutoriserForm({
  eleves,
}: {
  eleves: { id: string; name: string; debt: string }[];
}) {
  const [state, action, pending] = useActionMessage(authoriseReEnrolAction);


  return (
    <div className="form-card" style={{ marginTop: '1.2rem' }}>
      <h3 style={{ marginTop: 0 }}>Autoriser une réinscription malgré la dette</h3>
      <p className="text-muted" style={{ fontSize: '.85rem' }}>La décision est enregistrée avec son auteur, le montant dû et le motif.</p>
      <form action={action} style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label htmlFor="etudiant_id">Élève</label>
          <select id="etudiant_id" name="studentId" required>
            {eleves.map((e) => (
              <option key={e.id} value={e.id}>{e.name} — {e.debt} MRU</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <label htmlFor="motif">Motif</label>
          <input type="text" id="motif" name="reason" maxLength={200} placeholder="Échéancier accepté, situation familiale…" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>Autoriser</button>
      </form>
    </div>
  );
}
