import { PrintButton } from '@/components/print-button';
import { MARQUE } from '@/lib/brand';
import { LOGO_MARQUE } from '@/lib/brand-logo';

/** Son `number_format($x, 0, ',', ' ')`. */
export function mruRecu(v: string | number): string {
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Son `date('d/m/Y H:i', …)`. */
export function dateHeure(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Son `date('d/m/Y à H:i')`. */
export function dateHeureA(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * `recu_toolbar($retour_url, $retour_label)` — `includes/finance.php`.
 *
 * Le bouton d'impression d'abord, le retour ensuite, toute la barre en `no-print`.
 */
export function RecuToolbar({
  retourUrl,
  retourLabel = '← Retour',
}: {
  retourUrl: string;
  retourLabel?: string;
}) {
  return (
    <div
      className="no-print"
      style={{
        maxWidth: 640,
        margin: '0 auto 1rem',
        display: 'flex',
        gap: '.5rem',
        flexWrap: 'wrap',
      }}
    >
      <PrintButton label="Imprimer le reçu" className="btn btn-primary" style={{ width: 'auto' }} />
      <a href={retourUrl} className="btn btn-secondary">
        {retourLabel}
      </a>
    </div>
  );
}

/**
 * `recu_document($opts)` — `includes/finance.php`, ligne pour ligne.
 *
 * `lignes` est sa liste ordonnée libellé → valeur ; une valeur nulle ou vide
 * n'est pas rendue (son `continue`). `moyens` ajoute sa ligne « Moyen(s) de
 * paiement » ; `reduction` sa ligne « Réduction appliquée » ; la date vient en
 * dernier. Le total dit « Montant payé (sortie) » ou « Montant encaissé » selon
 * `sens`, et la signature de droite change avec lui.
 */
export function RecuDocument({
  type = 'REÇU DE PAIEMENT',
  numero = '—',
  date,
  lignes,
  moyens = [],
  montant,
  reduction,
  sens = 'entrant',
  note = 'Merci de votre confiance.',
  ecole,
}: {
  type?: string;
  numero?: string | null;
  /** Déjà formatée `d/m/Y H:i` ; défaut : maintenant. */
  date?: string;
  lignes: [string, string | null | undefined][];
  moyens?: { moyen: string; montant: string; reference?: string | null }[];
  montant: string | number;
  reduction?: string | number | null;
  sens?: 'entrant' | 'sortant';
  note?: string;
  /** Le nom de l'école — son en-tête écrit « El Ourwa — العروة ». */
  ecole: string;
}) {
  const genere = dateHeureA(new Date().toISOString());
  const reduc = Number(reduction ?? 0);
  return (
    <div className="recu-doc" id="recu">
      <div className="recu-head">
        <div className="recu-brand">
          {LOGO_MARQUE ? (
            // Le logo de l'enseigne (Jinan) à la place du « ع » ; sans logo, le « ع » d'El Ourwa.
            <div className="recu-logo" style={{ padding: 0, overflow: 'hidden', flexShrink: 0 }}>
              <img src={LOGO_MARQUE} alt="" width={52} height={52} style={{ display: 'block', width: '100%', height: '100%' }} />
            </div>
          ) : (
            <div className="recu-logo">ع</div>
          )}
          <div>
            <h2>{ecole} — {MARQUE.nomAr}</h2>
            <small>Plateforme de gestion scolaire · Nouakchott</small>
          </div>
        </div>
        <div className="recu-meta">
          <div className="recu-type">{type}</div>
          <div className="recu-num">N° {numero ?? '—'}</div>
        </div>
      </div>

      <div className="recu-body">
        <table className="recu-table">
          <tbody>
            {lignes.map(([label, valeur]) =>
              valeur === null || valeur === undefined || valeur === '' ? null : (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{valeur}</td>
                </tr>
              ),
            )}
            {moyens.length > 0 && (
              <tr>
                <td>Moyen(s) de paiement</td>
                <td>
                  {moyens.map((l, i) => (
                    <span key={i}>
                      {i > 0 && <br />}
                      {l.moyen} : {mruRecu(l.montant)} MRU{l.reference ? ` — réf. ${l.reference}` : ''}
                    </span>
                  ))}
                </td>
              </tr>
            )}
            {reduc > 0.009 && (
              <tr>
                <td>Réduction appliquée</td>
                <td className="recu-reduction">− {mruRecu(reduc)} MRU</td>
              </tr>
            )}
            <tr>
              <td>Date</td>
              <td>{date ?? dateHeure(new Date().toISOString())}</td>
            </tr>
          </tbody>
        </table>

        <div className="recu-total">
          <span className="label">
            {sens === 'sortant' ? 'Montant payé (sortie)' : 'Montant encaissé'}
          </span>
          <span className="amount">{mruRecu(montant)} MRU</span>
        </div>

        <div className="recu-signatures">
          <div>
            <div className="ligne">Cachet &amp; signature de l&apos;établissement</div>
          </div>
          <div>
            <div className="ligne">
              {sens === 'sortant' ? 'Signature du bénéficiaire' : 'Signature du payeur'}
            </div>
          </div>
        </div>
      </div>

      <div className="recu-foot">
        <span>{note}</span>
        <span>Document généré le {genere}</span>
      </div>
    </div>
  );
}
