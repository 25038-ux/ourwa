/**
 * LES CYCLES D'UN NIVEAU — dans l'ordre de la scolarité.
 *
 * `maternelle` s'ajoute le 30/09/2026 (migration 0045, demande du propriétaire
 * de Jinan : « classify niveaux based on maternelle, fondamentale, collège,
 * lycée »), AVANT `fondamental` : l'ordre des valeurs de l'énumération
 * Postgres `school_cycle` est celui des listes (`ORDER BY l.cycle`), et celui
 * de ce tableau est celui de la progression (réinscription).
 *
 * Les libellés sont ceux de son `libelle_cycle()` (« Fondamentales »,
 * « Collège », « Lycée », « Autres niveaux ») ; « Maternelle » est nouveau.
 */
export const CYCLES = [
  { code: 'maternelle', libelle: 'Maternelle' },
  { code: 'fondamental', libelle: 'Fondamentales' },
  { code: 'college', libelle: 'Collège' },
  { code: 'lycee', libelle: 'Lycée' },
  { code: 'autre', libelle: 'Autres niveaux' },
] as const;

export type Cycle = (typeof CYCLES)[number]['code'];

export const CODES_CYCLES = CYCLES.map((c) => c.code) as [Cycle, ...Cycle[]];

export function estCycle(x: unknown): x is Cycle {
  return typeof x === 'string' && (CODES_CYCLES as readonly string[]).includes(x);
}

/** Le libellé affiché ; un code inconnu tombe dans « Autres niveaux ». */
export function libelleCycle(cycle: string | null | undefined): string {
  return CYCLES.find((c) => c.code === cycle)?.libelle ?? 'Autres niveaux';
}

/**
 * Le rang du cycle dans la scolarité : maternelle 0 < fondamental 1 < collège 2
 * < lycée 3 ; « autre » (et l'inconnu) 9, hors progression.
 */
export function rangCycle(cycle: string | null | undefined): number {
  const i = CODES_CYCLES.indexOf(cycle as Cycle);
  return i < 0 || cycle === 'autre' ? 9 : i;
}

/**
 * Regroupe une liste DÉJÀ TRIÉE (cycle, rang, nom) par cycle, dans l'ordre où
 * les cycles apparaissent — pour les intertitres et les `<optgroup>`.
 */
export function parCycle<T extends { cycle?: string | null }>(elements: readonly T[]): { cycle: string; libelle: string; elements: T[] }[] {
  const groupes: { cycle: string; libelle: string; elements: T[] }[] = [];
  for (const e of elements) {
    const cycle = e.cycle ?? 'autre';
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.cycle === cycle) dernier.elements.push(e);
    else groupes.push({ cycle, libelle: libelleCycle(cycle), elements: [e] });
  }
  return groupes;
}
