'use client';

import { useId, useState } from 'react';

export interface Correspondant {
  id: string;
  fullName: string;
  phone: string | null;
  children: number;
}

/**
 * RECHERCHER UN CORRESPONDANT — `inscrire_etudiant.php`'s `rechercherParent()`,
 * and `messagerie.php`'s `rechercheParent()`, which are the same control.
 *
 * ⚠ A SCHOOL OF 1 372 FAMILIES CANNOT BE A `<select>`. That is what this
 * replaces: a dropdown holding every family, which is unusable the moment the
 * import lands and which nobody notices while the seed has forty.
 *
 * ⚠ TWO CHARACTERS MINIMUM, in its own words: below that "la recherche ramène
 * la moitié de l'école et n'aide personne."
 *
 * Its three feedback states and its three colours, kept because they are the
 * whole of the interaction: terracotta while searching, olive when something is
 * found, its red when nothing is. The counts are its sentences —
 * "3 parent(s) trouvé(s)." and "Aucun parent trouvé. Créez un nouveau parent."
 * — the second of which tells the operator what to do next rather than only
 * that the search failed.
 *
 * Enter searches rather than submitting the form. On an enrolment screen a
 * premature submit creates a child attached to nobody.
 */
export function RechercheParent({
  name = 'guardianId',
  required = true,
  onPick,
  /**
   * ⚠ LES DEUX ÉCRANS QUI L'UTILISENT NE DISENT PAS LA MÊME CHOSE.
   * `inscrire_etudiant.php` : « Rechercher un correspondant » / « Chercher ».
   * `messagerie.php` : « Rechercher un parent (nom ou téléphone) ». Un libellé
   * partagé en avait fait un troisième, qui n'est celui d'aucun des deux.
   */
  label = 'Rechercher un correspondant',
  boutonLabel = 'Chercher',
}: {
  /** The field name the chosen id is submitted under. */
  name?: string;
  required?: boolean;
  onPick?: (c: Correspondant | null) => void;
  label?: string;
  boutonLabel?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Correspondant[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; tone: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const q = query.trim();
    if (!q) {
      setFeedback({ text: 'Veuillez saisir un nom ou un téléphone.', tone: '#a8341f' });
      return;
    }

    setBusy(true);
    setFeedback({ text: 'Recherche en cours...', tone: '#c67139' });
    try {
      const res = await fetch(`/api/guardians/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Correspondant[];
      setResults(data);
      onPick?.(null);
      setFeedback(
        data.length === 0
          ? { text: 'Aucun parent trouvé. Créez un nouveau parent.', tone: '#a8341f' }
          : { text: `${data.length} parent(s) trouvé(s).`, tone: '#728157' },
      );
    } catch {
      setFeedback({ text: 'Erreur lors de la recherche.', tone: '#a8341f' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="form-group">
        <label htmlFor={`${id}-q`}>{label}</label>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <input
            id={`${id}-q`}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Never submit the form from here: on an enrolment screen that
                // creates a child attached to nobody.
                e.preventDefault();
                void search();
              }
            }}
            placeholder="Nom ou téléphone"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-secondary" onClick={() => void search()} disabled={busy}>
            {boutonLabel}
          </button>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor={`${id}-select`}>Correspondant {required && '*'}</label>
        <select
          id={`${id}-select`}
          name={name}
          required={required}
          onChange={(e) =>
            onPick?.(results.find((r) => r.id === e.target.value) ?? null)
          }
        >
          <option value="">— Sélectionner —</option>
          {results.map((r) => (
            <option key={r.id} value={r.id}>
              {r.fullName} — {r.phone ?? ''}
            </option>
          ))}
        </select>
        {/* Son `rp_feedback`, sous la liste. */}
        <span id={`${id}-feedback`} aria-live="polite" style={{ display: 'block', marginTop: '.25rem', fontSize: '.85rem', color: feedback?.tone }}>
          {feedback?.text ?? ''}
        </span>
      </div>
    </>
  );
}
