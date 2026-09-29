'use client';

/**
 * Le filtre « Niveau » du classement — son `filtrerGroupesCl()` : masque les
 * groupes des autres niveaux et vide le choix s'il n'est plus visible.
 */
export function ClassementFiltre({
  niveaux,
  groupes,
  groupeChoisi,
}: {
  niveaux: { id: string; name: string }[];
  groupes: { id: string; label: string; levelId: string | null }[];
  groupeChoisi: string;
}) {
  function filtrer(niv: string) {
    const sel = document.getElementById('cl_groupe') as HTMLSelectElement | null;
    if (!sel) return;
    Array.prototype.forEach.call(sel.options, (o: HTMLOptionElement) => {
      if (!o.value) return;
      const visible = !niv || o.getAttribute('data-niveau') === niv;
      o.hidden = !visible;
      if (!visible && o.selected) sel.value = '';
    });
  }
  return (
    <>
      <div><label>Niveau</label>
        <select id="cl_niveau" onChange={(e) => filtrer(e.target.value)}>
          <option value="">— Tous —</option>
          {niveaux.map((nv) => <option key={nv.id} value={nv.id}>{nv.name}</option>)}
        </select></div>
      <div><label>Groupe *</label>
        <select name="cl_groupe_id" id="cl_groupe" required defaultValue={groupeChoisi}>
          <option value="">— Choisir —</option>
          {groupes.map((g) => (
            <option key={g.id} value={g.id} data-niveau={g.levelId ?? ''}>{g.label}</option>
          ))}
        </select></div>
    </>
  );
}
