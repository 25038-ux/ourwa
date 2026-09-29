'use client';

import { useRef, useState } from 'react';
import { sendHomeworkAction } from '@/app/actions';
import { useActionMessage } from '@/components/message-page';

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
    <form action={action} className="form-card" style={{ maxWidth: 720 }}>
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

      <ZoneFichiers />

      <button type="submit" className="btn btn-primary" disabled={pending}>📨 Envoyer l&apos;exercice</button>
    </form>
  );
}

/**
 * SA ZONE DE DÉPÔT — le `#dropzone` de `envoyer_exercice.php` et son script :
 * cliquer ouvre le sélecteur, glisser-déposer remplit le même `input`, chaque
 * fichier est listé avec sa taille — en rouge et « — trop volumineux ! »
 * au-delà de 5 Mo, avant l'envoi.
 */
function ZoneFichiers() {
  const input = useRef<HTMLInputElement>(null);
  const [fichiers, setFichiers] = useState<{ nom: string; taille: number; image: boolean }[]>([]);
  const [survol, setSurvol] = useState(false);
  const MAX = 5;
  const MAX_SIZE = 5 * 1024 * 1024;

  const fmtSize = (b: number) =>
    b < 1024 ? `${b} o` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} Ko` : `${(b / 1024 / 1024).toFixed(1)} Mo`;

  const render = (files: FileList | null) =>
    setFichiers(
      Array.from(files ?? [])
        .slice(0, MAX)
        .map((f) => ({ nom: f.name, taille: f.size, image: f.type.startsWith('image/') })),
    );

  return (
    <div className="form-group">
      <label>📎 Pièces jointes (optionnel — jusqu&apos;à 5 fichiers, 5 MB max chacun)</label>
      <div
        id="dropzone"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSurvol(false);
          if (input.current) {
            input.current.files = e.dataTransfer.files;
            render(input.current.files);
          }
        }}
        style={{
          border: `2px dashed ${survol ? '#c67139' : '#94a3b8'}`,
          borderRadius: 12,
          padding: '1.5rem',
          textAlign: 'center',
          background: survol ? '#eef2ff' : '#f8fafc',
          cursor: 'pointer',
          transition: 'all .2s',
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c67139" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '.5rem' }}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p style={{ margin: 0, fontWeight: 600, color: '#334155' }}>Glissez-déposez vos fichiers ici</p>
        <p style={{ margin: '.3rem 0 0', fontSize: '.85rem', color: '#64748b' }}>
          ou <span style={{ color: '#c67139', textDecoration: 'underline' }}>parcourez</span> · JPG, PNG, WebP, GIF, PDF
        </p>
        <input
          ref={input}
          type="file"
          id="files"
          name="fichiers"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => render(e.target.files)}
        />
      </div>
      <div id="preview-list" style={{ marginTop: '.75rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {fichiers.map((f, i) => {
          const ok = f.taille <= MAX_SIZE;
          return (
            <div key={`${f.nom}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.6rem .85rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <span style={{ fontSize: '1.5rem' }}>{f.image ? '🖼️' : '📄'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '.88rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nom}</div>
                <div style={{ fontSize: '.75rem', color: ok ? '#64748b' : '#dc2626' }}>{fmtSize(f.taille)}{ok ? '' : ' — trop volumineux !'}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
