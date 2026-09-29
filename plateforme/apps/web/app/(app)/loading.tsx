/**
 * PENDANT LA NAVIGATION — une barre de progression en haut et une trame
 * grise à la place de la page : l'application répond au clic tout de suite,
 * même quand le serveur met une seconde (pages rendues côté serveur).
 */
export default function Chargement() {
  return (
    <>
      <div className="nav-progress" aria-hidden="true" />
      <div aria-busy="true" aria-live="polite" style={{ padding: '1rem 0' }}>
        <div className="skeleton" style={{ height: 34, width: '38%', marginBottom: '1.2rem' }} />
        <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
        </div>
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    </>
  );
}
