/**
 * El Ourwa's hub shell — `finance.php`, `scolarite.php`.
 *
 * A row of tabs above a panel. There it loads each tab as an AJAX fragment into
 * the same page, for a stated reason: no iframe, no second sidebar, no window
 * that jumps. Here each tab is a real route, server-rendered, which reaches the
 * same result without the fragment machinery — and works before JavaScript does.
 *
 * The labels and the order are its labels and its order.
 */
export interface HubTab {
  key: string;
  label: string;
  href: string;
  /** Hidden from the accountant, as its `est_comptable()` check does. */
  hideFromAccountant?: boolean;
  /** A mark before the label. Scolarité puts ⚠ on Exclusions. */
  ico?: string;
}

export function HubNav({
  tabs,
  active,
  label,
}: {
  tabs: HubTab[];
  active: string;
  label: string;
}) {
  return (
    <nav className="hub-nav" id="hub-nav" aria-label={label}>
      {tabs.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          className={`hub-tab${tab.key === active ? ' is-active' : ''}`}
          aria-current={tab.key === active ? 'page' : undefined}
        >
          {tab.ico && <span className="hub-tab-ico">{tab.ico}</span>}
          <span className="hub-tab-label">{tab.label}</span>
        </a>
      ))}
    </nav>
  );
}

/** El Ourwa's `number_format($n, 0, ',', ' ')`. */
export function mru(value: string | number): string {
  // Son `number_format($x, 0, ',', ' ')` — le signe moins est le sien, le trait
  // d'union ; le « − » typographique n'est pas ce qu'il imprime.
  const n = typeof value === 'string' ? Number(value) : value;
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * A money cell as El Ourwa prints it: the amount with MRU, or an em dash.
 *
 * ⚠ Its threshold is 0.009, not 0 — a rounding remainder below a centime is
 * shown as nothing owed rather than as a debt of zero.
 */
export function mruOrDash(value: string): string {
  return Number(value) > 0.009 ? `${mru(value)} MRU` : '—';
}
