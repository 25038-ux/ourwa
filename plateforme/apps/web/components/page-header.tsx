import { apiFetch } from '@/lib/session';
import { anneeConsultee } from '@/lib/annee';
import { SelecteurAnnee } from './selecteur-annee';

/**
 * El Ourwa's page header — `includes/layout_header.php`.
 *
 * Title, optional subtitle, then THE YEAR SELECTOR and the date on the right.
 * Every page sets `$titre_page` and `$sous_titre` there, so every page passes
 * them here.
 *
 * ⚠ THE YEAR SELECTOR IS FETCHED HERE RATHER THAN PASSED IN, so that every one
 * of the thirty pages already using this header gets it without being touched —
 * which is also how El Ourwa does it: `selecteur_annee_entete()` is called by
 * the layout, not by the page. A selector that appears on some screens and not
 * others is worse than none, because its absence reads as "this screen is not
 * year-scoped" when in fact it is.
 */
export async function PageHeader({
  titre,
  sousTitre,
  right,
}: {
  titre: string;
  sousTitre?: string;
  right?: React.ReactNode;
}) {
  const [annees, choisie] = await Promise.all([
    apiFetch<{ id: string; label: string; status: string }[]>('/academic-years').catch(
      () => [],
    ),
    anneeConsultee(),
  ]);

  /**
   * ⚠ THE SELECTOR ALWAYS SHOWED THE ACTIVE YEAR, WHATEVER WAS CHOSEN. It
   * writes `?annee_id=` and this line read none of it, so picking 2024-2025
   * reloaded the page with the box back on 2025-2026 — the control appeared
   * broken because it was.
   *
   * A chosen year that is not in the list (a stale link, another school's id)
   * falls back rather than selecting nothing: an empty select is worse than a
   * wrong one, because the browser then shows the first option while the page
   * computes on something else. That is the disagreement El Ourwa's own comment
   * on this control was written about.
   */
  const courante =
    (choisie && annees.some((a) => a.id === choisie) ? choisie : null) ??
    annees.find((a) => a.status === 'active')?.id ??
    annees[0]?.id ??
    null;

  return (
    <header className="page-header">
      <div className="page-header-left">
        <h1 className="page-title">{titre}</h1>
        {sousTitre && <p className="page-subtitle">{sousTitre}</p>}
      </div>
      <div className="page-header-right">
        {right}
        <SelecteurAnnee annees={annees} courante={courante} />
        <span className="header-date">
          <svg
            aria-hidden="true"
            focusable="false"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            width="18"
            height="18"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
            />
          </svg>
          {dateFr()}
        </span>
      </div>
    </header>
  );
}

/**
 * El Ourwa's `date_fr()` — "lundi 31 août 2026".
 *
 * Written out rather than taken from `toLocaleDateString`, because the server's
 * locale data is not guaranteed and a date that silently renders in English on
 * one host and French on another is the kind of difference nobody notices until
 * a parent does.
 */
export function dateFr(when: Date = new Date()): string {
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const mois = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ];
  return `${jours[when.getDay()]} ${when.getDate()} ${mois[when.getMonth()]} ${when.getFullYear()}`;
}
