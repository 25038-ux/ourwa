import { MOIS_NOMS } from '@/lib/mois';
import { sum, toStorage } from '@elourwa/shared/money';

interface Periode {
  entrees: string;
  sorties: string;
  net: string;
}
export interface TableauBord {
  mois: number;
  annee: number;
  currency: string | null;
  cumul: {
    jour: Periode & { recus: number };
    mois: Periode;
    annee: Periode;
    parMois: { mois: number; entrees: string; sorties: string; net: string }[];
    effectif: number;
  } | null;
  branches: {
    id: string;
    slug: string;
    name: string;
    currency: string;
    active: boolean;
    effectif: number;
    jour: Periode & { recus: number };
    mois: Periode & { parSource: { source_type: string; direction: string; total: string; label: string }[] };
    annee: Periode & { parMois: { mois: number; entrees: string; sorties: string }[] };
  }[];
}

/** Son `number_format($x, 0, ',', ' ')`. */
function mru(v: string): string {
  const n = Math.round(Number(v));
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return n < 0 ? `-${s}` : s;
}


/**
 * LE TABLEAU DE BORD DE LA PLATEFORME — le cumul de toutes les branches
 * (décision du propriétaire, 2026-09-14) : encaissé et dépensé aujourd'hui,
 * le mois, l'année ; chaque chiffre est la somme des branches, depuis leurs
 * caisses. Un mois et une année se choisissent ; la journée est toujours celle
 * d'aujourd'hui.
 */
export function TableauBordPlateforme({ tb }: { tb: TableauBord }) {
  const devise = tb.currency ?? '';
  const anCivile = new Date().getFullYear();
  return (
    <>
      <form method="GET" className="form-card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="mois">Mois</label>
          <select id="mois" name="mois" defaultValue={String(tb.mois)}>
            {MOIS_NOMS.slice(1).map((nom, i) => <option key={i + 1} value={i + 1}>{nom}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label htmlFor="annee">Année</label>
          <select id="annee" name="annee" defaultValue={String(tb.annee)}>
            {Array.from({ length: 5 }, (_, i) => anCivile - 3 + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" style={{ width: 'auto' }}>Afficher</button>
      </form>

      {tb.cumul === null ? (
        <div className="alert alert-info">
          Les branches ne comptent pas dans la même monnaie : les chiffres ne s&apos;additionnent pas. Chaque branche est détaillée ci-dessous.
        </div>
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
            <div className="kpi-card kpi-success">
              <p className="kpi-label">Encaissé aujourd&apos;hui — toutes branches</p>
              <p className="kpi-value">{mru(tb.cumul.jour.entrees)}</p>
              <p className="kpi-detail">{devise} · {tb.cumul.jour.recus} encaissement{tb.cumul.jour.recus > 1 ? 's' : ''}</p>
            </div>
            <div className="kpi-card kpi-danger">
              <p className="kpi-label">Dépensé aujourd&apos;hui — toutes branches</p>
              <p className="kpi-value">{mru(tb.cumul.jour.sorties)}</p>
              <p className="kpi-detail">{devise}</p>
            </div>
            <div className="kpi-card">
              <p className="kpi-label">Net du jour</p>
              <p className="kpi-value">{mru(tb.cumul.jour.net)}</p>
              <p className="kpi-detail">{devise}</p>
            </div>
            <div className="kpi-card">
              <p className="kpi-label">Élèves inscrits — toutes branches</p>
              <p className="kpi-value">{tb.cumul.effectif}</p>
              <p className="kpi-detail">année active de chaque branche</p>
            </div>
          </div>

          <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
            <div className="kpi-card">
              <p className="kpi-label">{MOIS_NOMS[tb.mois]} {tb.annee} — encaissé</p>
              <p className="kpi-value">{mru(tb.cumul.mois.entrees)}</p>
              <p className="kpi-detail">{devise}</p>
            </div>
            <div className="kpi-card">
              <p className="kpi-label">{MOIS_NOMS[tb.mois]} {tb.annee} — dépensé</p>
              <p className="kpi-value">{mru(tb.cumul.mois.sorties)}</p>
              <p className="kpi-detail">net {mru(tb.cumul.mois.net)} {devise}</p>
            </div>
            <div className="kpi-card">
              <p className="kpi-label">Année {tb.annee} — encaissé</p>
              <p className="kpi-value">{mru(tb.cumul.annee.entrees)}</p>
              <p className="kpi-detail">{devise}</p>
            </div>
            <div className="kpi-card">
              <p className="kpi-label">Année {tb.annee} — dépensé</p>
              <p className="kpi-value">{mru(tb.cumul.annee.sorties)}</p>
              <p className="kpi-detail">net {mru(tb.cumul.annee.net)} {devise}</p>
            </div>
          </div>
        </>
      )}

      <div className="table-container" style={{ marginBottom: '1.5rem' }}>
        <div className="table-header">
          <h3>Rapport mensuel — {MOIS_NOMS[tb.mois]} {tb.annee}, par branche</h3>
        </div>
        <div className="overflow-x">
          <table>
            <thead><tr><th>Branche</th><th>Élèves</th><th>Aujourd&apos;hui</th><th>Encaissé (mois)</th><th>Dépensé (mois)</th><th>Net (mois)</th><th>Monnaie</th></tr></thead>
            <tbody>
              {tb.branches.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong>{!b.active && <span className="badge badge-warning" style={{ marginLeft: '.5rem' }}>suspendue</span>}</td>
                  <td>{b.effectif}</td>
                  <td>{mru(b.jour.entrees)} / {mru(b.jour.sorties)}</td>
                  <td>{mru(b.mois.entrees)}</td>
                  <td>{mru(b.mois.sorties)}</td>
                  <td><strong>{mru(b.mois.net)}</strong></td>
                  <td>{b.currency}</td>
                </tr>
              ))}
              {tb.cumul && (
                <tr style={{ fontWeight: 800, background: 'var(--bg)' }}>
                  <td>TOTAL</td>
                  <td>{tb.cumul.effectif}</td>
                  <td>{mru(tb.cumul.jour.entrees)} / {mru(tb.cumul.jour.sorties)}</td>
                  <td>{mru(tb.cumul.mois.entrees)}</td>
                  <td>{mru(tb.cumul.mois.sorties)}</td>
                  <td>{mru(tb.cumul.mois.net)}</td>
                  <td>{devise}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-container" style={{ marginBottom: '1.5rem' }}>
        <div className="table-header">
          <h3>Détail du mois par origine — toutes branches</h3>
        </div>
        <div className="overflow-x">
          <table>
            <thead><tr><th>Origine</th><th>Sens</th>{tb.branches.map((b) => <th key={b.id}>{b.name}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {(() => {
                const cles = new Map<string, { source: string; direction: string; label: string }>();
                for (const b of tb.branches) for (const s of b.mois.parSource) cles.set(`${s.direction}|${s.source_type}`, { source: s.source_type, direction: s.direction, label: s.label });
                const lignes = [...cles.values()].sort((a, b) => a.direction.localeCompare(b.direction) || a.source.localeCompare(b.source));
                if (lignes.length === 0) return <tr><td colSpan={tb.branches.length + 3} className="text-muted" style={{ textAlign: 'center', padding: '1.5rem' }}>Aucun mouvement ce mois.</td></tr>;
                return lignes.map((l) => {
                  const montants = tb.branches.map((b) => b.mois.parSource.find((s) => s.source_type === l.source && s.direction === l.direction)?.total ?? '0');
                  // Règle 6 : la somme se fait en Decimal, même pour une ligne d'affichage.
                  const total = toStorage(sum(montants));
                  return (
                    <tr key={`${l.direction}-${l.source}`}>
                      <td>{l.label}</td>
                      <td>{l.direction === 'in' ? 'Entrée' : 'Sortie'}</td>
                      {montants.map((m, i) => <td key={i}>{mru(m)}</td>)}
                      <td><strong>{mru(total)}</strong></td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {tb.cumul && (
        <div className="table-container" style={{ marginBottom: '1.5rem' }}>
          <div className="table-header">
            <h3>Rapport annuel — {tb.annee}, toutes branches, mois par mois</h3>
          </div>
          <div className="overflow-x">
            <table>
              <thead><tr><th>Mois</th><th>Encaissé</th><th>Dépensé</th><th>Net</th></tr></thead>
              <tbody>
                {tb.cumul.parMois.map((m) => (
                  <tr key={m.mois}>
                    <td>{MOIS_NOMS[m.mois]}</td>
                    <td>{mru(m.entrees)}</td>
                    <td>{mru(m.sorties)}</td>
                    <td><strong>{mru(m.net)}</strong></td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 800, background: 'var(--bg)' }}>
                  <td>TOTAL {tb.annee}</td>
                  <td>{mru(tb.cumul.annee.entrees)}</td>
                  <td>{mru(tb.cumul.annee.sorties)}</td>
                  <td>{mru(tb.cumul.annee.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
