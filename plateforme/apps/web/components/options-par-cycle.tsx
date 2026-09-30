import { parCycle } from '@elourwa/shared/cycles';

/**
 * LES OPTIONS D'UNE LISTE DE CLASSES, RANGÉES PAR CYCLE — une rubrique par
 * cycle (« Maternelle », « Fondamentales », « Collège », « Lycée »), dans
 * l'ordre de la scolarité : la liste arrive déjà triée (`ORDER BY l.cycle,
 * l.sort_order`), les rubriques ne font que la couper.
 *
 * Demande du propriétaire de Jinan (30/09/2026) : « une barrière entre chaque
 * classification ». `rubriques` à false (une école « famille » comme El
 * Mourad, dont les listes sont celles d'El Ourwa) ou un seul cycle : les
 * options telles quelles, sans rubrique.
 */
export function OptionsParCycle<T extends { id: string; cycle?: string | null }>({
  elements,
  libelle,
  rubriques,
}: {
  elements: readonly T[];
  libelle: (e: T) => string;
  rubriques: boolean;
}) {
  const groupes = parCycle(elements);
  if (!rubriques || groupes.length <= 1) {
    return (
      <>
        {elements.map((e) => (
          <option key={e.id} value={e.id}>{libelle(e)}</option>
        ))}
      </>
    );
  }
  return (
    <>
      {groupes.map((g) => (
        <optgroup key={g.cycle} label={`── ${g.libelle} ──`}>
          {g.elements.map((e) => (
            <option key={e.id} value={e.id}>{libelle(e)}</option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
