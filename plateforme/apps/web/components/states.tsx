/**
 * Empty and loading states, and the KPI card — in El Ourwa's own markup.
 *
 * ⚠ THESE THREE ARE WHERE THE CONVERSION PAYS FOR ITSELF. Some thirty call
 * sites across the app render a metric or an empty state; rewriting the
 * component is one change that moves all of them, and it cannot leave one page
 * looking different from its neighbour the way thirty edits could.
 *
 * A blank screen is indistinguishable from a broken one. Every list in this app
 * says which of the two it is, and what to do next.
 */
export function Empty({
  mark = '—',
  title,
  children,
}: {
  mark?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="text-center text-muted" role="status" style={{ padding: '2.5rem 1.5rem' }}>
      <div aria-hidden="true" style={{ fontSize: '1.75rem', marginBottom: '.5rem', opacity: 0.7 }}>
        {mark}
      </div>
      <h3 style={{ fontSize: '1rem', marginBottom: '.35rem', color: 'var(--text)' }}>{title}</h3>
      {children && <p style={{ margin: 0 }}>{children}</p>}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-x" aria-busy="true" aria-label="Chargement">
      <table className="data-table">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((__, c) => (
                <td key={c}>
                  <div className="skeleton" style={{ width: c === 0 ? '60%' : '40%' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A figure on the dashboard, in El Ourwa's `.kpi-card`.
 *
 * ⚠ ITS TONES MAP ONTO THE ACCENT BAR ACROSS THE TOP, not onto the number. That
 * is where El Ourwa puts the colour — `kpi-card::before` — so a red figure reads
 * as a broken value while a red bar reads as a category. The distinction
 * matters on a screen where most numbers are money.
 */
export function Metric({
  label,
  value,
  foot,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  tone?: 'danger' | 'ok' | 'warn';
}) {
  const modifier =
    tone === 'ok' ? ' kpi-success' : tone === 'warn' ? ' kpi-warning' : tone === 'danger' ? ' kpi-danger' : '';

  return (
    <div className={`kpi-card${modifier}`}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {foot && <p className="kpi-detail">{foot}</p>}
    </div>
  );
}
