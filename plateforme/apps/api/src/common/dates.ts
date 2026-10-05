import { z } from 'zod';

/**
 * UNE DATE AAAA-MM-JJ QUI EXISTE AU CALENDRIER — pas seulement qui en a la
 * forme. `/^\d{4}-\d{2}-\d{2}$/` laissait passer « 2026-02-31 » : Postgres la
 * refusait ensuite et la personne lisait « Internal server error » (balayage
 * du 05/10/2026 : `/reports/jour`, `/reports/transactions`,
 * `/accounts/connection-history`).
 */
export function estDateIso(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, j] = s.split('-').map(Number) as [number, number, number];
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

export const dateIso = z.string().refine(estDateIso, 'Date invalide : AAAA-MM-JJ attendue (une date qui existe).');
