'use client';


import { closeTermAction, grantDerogationAction, reopenTermAction, revokeDerogationAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { mru } from '@/components/hub';

type Result = { ok?: string; error?: string } | null;

/** « Accorder une dérogation » — son formulaire `accorder`. */
export function GrantForm({
  families,
  academicYearId,
}: {
  families: { guardian_id: string; full_name: string; phone: string | null; solde: string }[];
  academicYearId: string;
}) {
  const [state, action, pending] = useActionMessage(grantDerogationAction);


  return (
    <form action={action}>
      <input type="hidden" name="academicYearId" value={academicYearId} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '1rem' }}>
        <div className="form-group">
          <label htmlFor="d-parent">Famille *</label>
          <select id="d-parent" name="parent_id" required defaultValue="">
            <option value="">— Choisir —</option>
            {families.map((f) => (
              <option key={f.guardian_id} value={f.guardian_id}>
                {f.full_name || f.phone} — {mru(f.solde)} MRU
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="d-tri">Trimestre</label>
          <select id="d-tri" name="trimestre" defaultValue="0">
            <option value="0">Tous les trimestres</option>
            <option value="1">1er trimestre</option>
            <option value="2">2e trimestre</option>
            <option value="3">3e trimestre</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="d-exp">Expire le <small className="text-muted">(facultatif)</small></label>
          <input type="date" id="d-exp" name="expire_le" />
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="d-motif">Motif * <small className="text-muted">(obligatoire, conservé)</small></label>
        <input type="text" id="d-motif" name="motif" maxLength={190} required placeholder="Ex : échéancier accepté le 12/03, solde contesté en cours de vérification" />
      </div>
      <button className="btn btn-primary" disabled={pending}>Accorder la dérogation</button>
    </form>
  );
}

/** « Révoquer » — avec sa confirmation. */
export function RevokeForm({ id }: { id: string }) {
  const [state, action, pending] = useActionMessage(revokeDerogationAction);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm('Révoquer cette dérogation ? Les examens redeviendront masqués.')) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-sm btn-danger" disabled={pending}>Révoquer</button>
    </form>
  );
}

/**
 * Les pastilles « T1 T2 T3 » de la colonne « Trimestres acquis » : un trimestre
 * acquis se referme après `prompt('Motif de la fermeture du trimestre N ?')` ;
 * un trimestre refermé (barré) se rouvre d'un clic.
 */
export function TermBadge({
  guardianId,
  academicYearId,
  term,
  acquis,
  motifFermeture,
}: {
  guardianId: string;
  academicYearId: string;
  term: number;
  acquis: boolean;
  motifFermeture?: string;
}) {
  const [closeState, closeAction, closePending] = useActionMessage(closeTermAction);
  const [reopenState, reopenAction, reopenPending] = useActionMessage(reopenTermAction);



  return (
    <form
      action={acquis ? closeAction : reopenAction}
      style={{ display: 'inline-block', margin: '0 .25rem .25rem 0' }}
      onSubmit={(e) => {
        if (!acquis) return;
        const m = prompt(`Motif de la fermeture du trimestre ${term} ?`);
        if (!m) {
          e.preventDefault();
          return;
        }
        (e.currentTarget.elements.namedItem('motif_fermeture') as HTMLInputElement).value = m;
      }}
    >
      <input type="hidden" name="parent_id" value={guardianId} />
      <input type="hidden" name="academicYearId" value={academicYearId} />
      <input type="hidden" name="trimestre" value={term} />
      <input type="hidden" name="motif_fermeture" value="" />
      <button
        type="submit"
        className="badge"
        disabled={closePending || reopenPending}
        title={acquis ? 'Acquis en soldant la dette — cliquer pour refermer' : `Refermé par la direction : ${motifFermeture || 'sans motif'} — cliquer pour rouvrir`}
        style={acquis
          ? { cursor: 'pointer', border: 0, background: '#e1eecc', color: '#3d472b' }
          : { cursor: 'pointer', border: 0, background: '#eceff1', color: '#546e7a', textDecoration: 'line-through' }}
      >
        T{term}
      </button>
    </form>
  );
}
