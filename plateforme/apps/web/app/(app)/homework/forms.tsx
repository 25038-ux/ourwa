'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { sendHomeworkAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';
import { Dropzone } from '@/components/dropzone';

/**
 * ENVOYER UN EXERCICE — le formulaire de `envoyer_exercice.php` : « Classe /
 * Matière * » (« Groupe — Matière »), « Titre de l'exercice * » (150),
 * « Description / consignes * » (6 lignes), « Date limite (optionnel) »,
 * « Pièces jointes (optionnel — jusqu'à 5 fichiers, 5 MB max chacun) » avec sa
 * zone de dépôt, « Envoyer l'exercice ». Le message remonte en haut.
 */
export function HomeworkForm({
  teachings,
  academicYearId,
}: {
  teachings: { id: string; label: string; g?: string; m?: string }[];
  academicYearId: string;
}) {
  const [state, action, pending] = useActionMessage(sendHomeworkAction);
  // LA CLASSE D'ABORD, LA MATIÈRE ENSUITE. Un seul professeur n'a que ses
  // classes ; la direction les a toutes — un sélecteur de classes, puis les
  // matières de cette classe seulement.
  const classes = useMemo(() => [...new Set(teachings.map((t) => t.g ?? t.label.split(' — ')[0] ?? ''))].sort((a, b) => a.localeCompare(b, 'fr')), [teachings]);
  const [classe, setClasse] = useState(classes.length === 1 ? classes[0]! : '');
  const matieres = useMemo(() => teachings.filter((t) => (t.g ?? t.label.split(' — ')[0]) === classe), [teachings, classe]);

  // ⚠ LE FORMULAIRE NE SE VIDE QU'APRÈS UN ENVOI RÉUSSI. Passée à `<form
  // action>`, l'action laissait React réinitialiser le formulaire à CHAQUE
  // retour — un refus (« Échec des téléversements… ») effaçait le titre et les
  // consignes, et le champ des fichiers se vidait pendant que la liste
  // affichée gardait leurs noms : le second envoi partait SANS pièce jointe,
  // et rien ne le disait. On lance donc l'action nous-mêmes ; après un envoi
  // réussi (son POST / Redirect / GET : pas de second exercice au clic
  // suivant), on vide le formulaire ET la liste des fichiers.
  const formulaire = useRef<HTMLFormElement>(null);
  const [serie, setSerie] = useState(0);
  // Une seule fois par résultat : la liste des classes est recalculée quand le
  // serveur rafraîchit la page, et ne doit pas revider un formulaire en cours.
  const classeInitiale = useRef(classe);
  useEffect(() => {
    if (!state || 'error' in state) return;
    formulaire.current?.reset();
    setSerie((n) => n + 1);
    setClasse(classeInitiale.current);
  }, [state]);

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
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="ex-classe">Classe *</label>
          <select id="ex-classe" value={classe} onChange={(e) => setClasse(e.target.value)}>
            <option value="">— Choisir une classe —</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="ex-matiere">Matière *</label>
          <select id="ex-matiere" name="enseignement_id" key={classe} defaultValue={matieres.length === 1 ? matieres[0]!.id : ''} disabled={classe === ''}>
            <option value="">{classe === '' ? '— Choisissez d’abord la classe —' : '— Choisir —'}</option>
            {matieres.map((t) => <option key={t.id} value={t.id}>{t.m ?? t.label.split(' — ')[1] ?? t.label}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group"><label>Titre de l&apos;exercice *</label><input type="text" name="titre" required maxLength={150} /></div>
      <div className="form-group"><label>Description / consignes *</label><textarea name="description" rows={6} required /></div>
      <div className="form-group"><label>Date limite (optionnel)</label><input type="date" name="date_limite" /></div>

      {/* Images, PDF et, depuis le 04/10/2026, documents Word / Excel /
          PowerPoint / OpenDocument : le sélecteur grisait une fiche Word. */}
      <Dropzone key={serie} name="fichiers" label="Pièces jointes (optionnel)" max={5} />

      <button type="submit" className="btn btn-primary" disabled={pending}>Envoyer l&apos;exercice</button>
    </form>
  );
}
