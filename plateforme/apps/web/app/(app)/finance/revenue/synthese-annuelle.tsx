import { mru } from '@/components/hub';

export interface Bilan {
  libelle: string;
  du: string;
  au: string;
  jour: string;
  encaisse: string;
  depense: string;
  nb: number;
  source: 'recus' | 'caisse';
  controle: { paiements: number; sans_ligne: number; ecart_nb: number; ecart_montant: string };
}

/** Son `date('d/m/Y', strtotime($d))`. */
const dmy = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/**
 * « SYNTHÈSE — ANNÉE SCOLAIRE » — le même bloc, au pied de `rapport_financier.php`
 * et de `revenue_live.php` : `bilan_annee_scolaire()` puis `controle_caisse()`.
 */
export function SyntheseAnnuelle({ bilan }: { bilan: Bilan }) {
  const ctrlKo = bilan.controle.sans_ligne > 0 || bilan.controle.ecart_nb > 0;
  const diff = Number(bilan.encaisse) - Number(bilan.depense);
  const tuile: React.CSSProperties = {
    background: 'rgba(255,255,255,.12)',
    borderRadius: 12,
    padding: '1rem',
    border: '1px solid rgba(255,255,255,.25)',
  };
  const etiquette: React.CSSProperties = {
    fontSize: '.78rem',
    opacity: 0.85,
    textTransform: 'uppercase',
    letterSpacing: '.5px',
  };
  return (
    <>
      <style>{`
@media print {
    .synthese-annuelle { background:#fff !important; color:#000 !important; border:2px solid #000 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .synthese-annuelle h3 { color:#000 !important; }
    .synthese-annuelle .syn-tile { background:#fff !important; border:1.5px solid #000 !important; color:#000 !important; }
    .synthese-annuelle .syn-tile div { color:#000 !important; opacity:1 !important; }
}
`}</style>
      <div
        className="form-card synthese-annuelle"
        style={{ marginTop: '1.5rem', background: 'linear-gradient(135deg,#1E3A8A,#8c491a)', color: '#fff' }}
      >
        <h3 style={{ marginTop: 0, color: '#fff' }}>Synthèse — Année scolaire {bilan.libelle}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '1rem' }}>
          <div className="syn-tile" style={tuile}>
            <div style={etiquette}>Total encaissé ({bilan.libelle})</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#6EE7B7' }}>+ {mru(bilan.encaisse)} MRU</div>
          </div>
          <div className="syn-tile" style={tuile}>
            <div style={etiquette}>Total dépensé ({bilan.libelle})</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#FCA5A5' }}>− {mru(bilan.depense)} MRU</div>
          </div>
          <div className="syn-tile" style={tuile}>
            <div style={etiquette}>Différence ({bilan.libelle})</div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: diff >= 0 ? '#6EE7B7' : '#FCA5A5' }}>
              {diff >= 0 ? '+' : '−'} {mru(Math.abs(diff))} MRU
            </div>
          </div>
          <div
            className="syn-tile"
            style={{ ...tuile, background: 'rgba(255,255,255,.22)', border: '2px solid rgba(255,255,255,.5)' }}
          >
            <div style={{ ...etiquette, opacity: 0.95 }}>Solde de caisse au {dmy(bilan.jour)}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: diff >= 0 ? '#A7F3D0' : '#FECACA' }}>
              {mru(diff)} MRU
            </div>
            <div style={{ fontSize: '.72rem', opacity: 0.8 }}>
              {bilan.source === 'recus'
                ? `Établi sur les ${mru(bilan.nb)} reçus de l'année (${dmy(bilan.du)} → ${dmy(bilan.au)})`
                : `Entrées − sorties depuis le ${dmy(bilan.du)}`}
            </div>
            <div
              style={{
                marginTop: '.6rem',
                padding: '.45rem .6rem',
                borderRadius: 6,
                fontSize: '.72rem',
                lineHeight: 1.45,
                background: ctrlKo ? 'rgba(180,83,9,.30)' : 'rgba(16,185,129,.25)',
              }}
            >
              {ctrlKo ? (
                <>
                  ⚠ <strong>{bilan.controle.ecart_nb + bilan.controle.sans_ligne} paiement(s) à vérifier</strong> :{' '}
                  {bilan.controle.sans_ligne} sans ventilation, {bilan.controle.ecart_nb} avec écart (
                  {Number(bilan.controle.ecart_montant).toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  MRU).
                </>
              ) : (
                <>✓ Contrôle de caisse : {mru(bilan.controle.paiements)} paiements intégralement ventilés, aucun écart.</>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
