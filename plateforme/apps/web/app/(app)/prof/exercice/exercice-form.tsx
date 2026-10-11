'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import { sendHomeworkAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { Dropzone } from '@/components/dropzone';

type Result = { ok?: string; error?: string; info?: string } | null;

/**
 * Son formulaire `form-card` (max-width 720) : « Classe / Matière * »,
 * « Titre de l'exercice * » (maxlength 150), « Description / consignes * »
 * (6 lignes), « Date limite (optionnel) », sa zone de dépôt et son script,
 * « 📨 Envoyer l'exercice ».
 */
export function ExerciceForm({
  enseignements,
  academicYearId,
}: {
  enseignements: { id: string; groupe: string; matiere: string }[];
  academicYearId: string;
}) {
  const [state, action, pending] = useActionMessage(sendHomeworkAction);

  // ⚠ LE FORMULAIRE NE SE VIDE QU'APRÈS UN ENVOI RÉUSSI. Passée à `<form
  // action>`, l'action laissait React réinitialiser le formulaire à CHAQUE
  // retour : un refus effaçait le titre et les consignes, et le champ des
  // fichiers se vidait pendant que la liste affichée gardait leurs noms — le
  // second envoi partait SANS pièce jointe, sans rien dire. On lance l'action
  // nous-mêmes ; après un envoi réussi (son POST / Redirect / GET), on vide le
  // formulaire ET la liste des fichiers.
  const formulaire = useRef<HTMLFormElement>(null);
  const [serie, setSerie] = useState(0);
  useEffect(() => {
    if (!state || 'error' in state) return;
    formulaire.current?.reset();
    setSerie((n) => n + 1);
  }, [state]);

  // Décision du propriétaire (2026-09-17) : on choisit une CLASSE, pas une
  // matière. L'exercice reste rattaché à l'enseignement (classe + matière) ;
  // quand le professeur n'a qu'une matière dans la classe — le cas courant —
  // la classe suffit, et la matière n'apparaît que s'il en a plusieurs.
  const parGroupe = new Map<string, { id: string; matiere: string }[]>();
  for (const en of enseignements) {
    const l = parGroupe.get(en.groupe) ?? [];
    l.push({ id: en.id, matiere: en.matiere });
    parGroupe.set(en.groupe, l);
  }
  const options = [...parGroupe.entries()].flatMap(([groupe, liste]) =>
    liste.length === 1
      ? [{ id: liste[0]!.id, label: groupe }]
      : liste.map((e) => ({ id: e.id, label: `${groupe} (${e.matiere})` })),
  );

  // ⚠ Pas de `required` : React ne lance pas l'action quand un champ requis
  // est vide, et rien ne s'affiche — le refus vient du serveur, en tête de page.
  // Pas d'`encType` : avec une action serveur, React choisit lui-même l'encodage
  // (multipart dès qu'un fichier est joint) et l'attribut rendu côté serveur ne
  // correspondait pas au client — avertissement d'hydratation, bandeau en dev.
  return (
    <form
      ref={formulaire}
      onSubmit={(e) => {
        e.preventDefault();
        const donnees = new FormData(e.currentTarget);
        startTransition(() => action(donnees));
      }}
      className="form-card"
      style={{ maxWidth: 720 }}
    >
      <input type="hidden" name="academicYearId" value={academicYearId} />
      <div className="form-group">
        <label>Classe *</label>
        <select name="enseignement_id" defaultValue={options.length === 1 ? options[0]!.id : ''}>
          <option value="">— Choisir —</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <div className="form-group"><label>Titre de l&apos;exercice *</label><input type="text" name="titre" maxLength={150} /></div>
      <div className="form-group"><label>Description / consignes *</label><textarea name="description" rows={6} /></div>
      <div className="form-group"><label>Date limite (optionnel)</label><input type="date" name="date_limite" /></div>

      {/* La zone de dépôt commune (celle de l'administration) : sa zone à
          elle accrochait le sélecteur aux seuls JPG/PNG/WebP/GIF/PDF — sur un
          téléphone, une fiche Word était grisée, impossible à choisir (Jinan,
          04/10/2026 : « you can't send any document there »). */}
      <Dropzone key={serie} name="fichiers" label="📎 Pièces jointes (optionnel)" />

      <button type="submit" className="btn btn-primary" disabled={pending}>📨 Envoyer l&apos;exercice</button>
    </form>
  );
}
