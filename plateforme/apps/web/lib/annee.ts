import { cache } from 'react';
import { headers } from 'next/headers';
import { apiFetch } from '@/lib/session';

/**
 * L'ANNÉE CONSULTÉE — the year the header's selector is pointing at.
 *
 * ⚠ THE SELECTOR WAS INERT. It is rendered by `PageHeader`, so it appears on
 * every screen; it writes `?annee_id=` and nothing anywhere read that parameter,
 * including the header itself, which always drew the *active* year as selected.
 * Choosing 2024-2025 reloaded the page unchanged, and an operator reading
 * arrears had no way to know they were this year's.
 *
 * ⚠ IT CANNOT BE `searchParams`. The selector lives in the layout's header, and
 * a layout does not receive `searchParams` — which is exactly why the header
 * could never reflect the choice. Middleware copies the parameter onto the
 * request, so the header and the page read the SAME value and cannot disagree.
 * El Ourwa's comment on this control records what happens when they can.
 *
 * ⚠ UNVALIDATED BY DESIGN. This came from the URL. It is passed to the API as an
 * opaque string and resolved there against the tenant's own years; one belonging
 * to another school comes back not-found, which is the check that matters.
 * Callers must never interpolate it into SQL or trust it as a fact.
 */
export async function anneeConsultee(): Promise<string | null> {
  const h = await headers();
  return h.get('x-annee-id') || null;
}

/**
 * `?academicYearId=…` for an API call, or the empty string.
 *
 * A helper rather than a habit: written by hand at each call site, half of them
 * end up with `?academicYearId=undefined`, which the API rejects and the page
 * swallows into an empty screen.
 */
export async function anneeQuery(): Promise<string> {
  const id = await anneeConsultee();
  return id ? `?academicYearId=${encodeURIComponent(id)}` : '';
}

export interface Annee {
  id: string;
  label: string;
  start_year?: number;
  start_month?: number;
  end_month?: number;
  status: string;
}

/**
 * L'ANNÉE QUE LA PAGE DOIT AFFICHER.
 *
 * The chosen one when the header's selector points at a real year of THIS
 * school; the default view otherwise. Every year-scoped page should ask this
 * rather than `/academic-years/default` directly — that endpoint answers "the
 * most recent year with data", which is the right *default* and the wrong answer
 * once somebody has said which year they want to look at.
 *
 * ⚠ THE CHOSEN ID IS VERIFIED AGAINST THE TENANT'S OWN YEARS. `/academic-years`
 * is behind the tenant guard, so a year id belonging to another school is simply
 * not in the list and the page falls back — the URL cannot reach across schools.
 */
export const anneeAffichee = cache(async function anneeAffichee(): Promise<Annee | null> {
  const chosen = await anneeConsultee();

  if (chosen) {
    const annees = await apiFetch<Annee[]>('/academic-years').catch(() => []);
    const found = annees.find((a) => a.id === chosen);
    if (found) return found;
    // Not this school's, or deleted. Fall through to the default rather than
    // rendering an empty page that reads as lost data.
  }

  const { year } = await apiFetch<{ year: Annee | null }>('/academic-years/default').catch(
    () => ({ year: null }),
  );
  return year;
});
