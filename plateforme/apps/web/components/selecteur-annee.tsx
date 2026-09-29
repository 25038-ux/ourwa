'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface AnneeOption {
  id: string;
  label: string;
  status: string;
}

/**
 * LE SÉLECTEUR D'ANNÉE GLOBAL — `selecteur_annee_entete()`.
 *
 * ⚠ IT IS ON EVERY PAGE, in the header, and it was on none of ours. A school
 * that keeps six years of records needs to say which one it is looking at from
 * wherever it happens to be standing; making that a trip to Settings is how
 * somebody ends up reading last year's arrears and calling a family about them.
 *
 * ⚠ CHANGING IT CLEARS THE LOCAL OVERRIDES, and El Ourwa's comment records the
 * bug that taught it: several screens carry their own year parameter — the
 * caisse has `?annee=`, impayés has `?impaye_annee=` — and those survived a
 * change of the global one. "L'en-tête affichait 2026-2027 pendant que le
 * profil de la famille restait sur 2025-2026, et cliquer sur l'en-tête ne
 * pouvait rien y changer." Two different years on one screen, and the control
 * that should fix it powerless to.
 *
 * Its own suffixes: " • en cours", " • clôturée". A closed year is where money
 * cannot be written, so an operator needs to see that before they try.
 */
export function SelecteurAnnee({
  annees,
  courante,
}: {
  annees: AnneeOption[];
  courante: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (annees.length === 0) return null;

  const change = (id: string) => {
    const next = new URLSearchParams(params.toString());
    // ⚠ Every local year override goes, or the header and the page disagree.
    for (const k of ['annee_id', 'annee', 'impaye_annee', 'source_id', 'an', 'page', 'academicYearId']) {
      next.delete(k);
    }
    next.set('annee_id', id);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <form className="header-annee" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor="hdr-annee" className="sr-only">
        Année scolaire
      </label>
      <select
        id="hdr-annee"
        name="annee_id"
        value={courante ?? ''}
        onChange={(e) => change(e.target.value)}
        title="Année scolaire consultée"
      >
        {annees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {a.status === 'active'
              ? ' • en cours'
              : a.status === 'closed'
                ? ' • clôturée'
                : ''}
          </option>
        ))}
      </select>
    </form>
  );
}
