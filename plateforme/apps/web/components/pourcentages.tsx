'use client';

import { useState, type MouseEvent } from 'react';
import { POURCENTAGES_PROPOSES, partPourcentage, resteApresPourcentage } from '@elourwa/shared/pourcentages';

const fr = (v: string) => Number(v).toLocaleString('fr-FR');

/**
 * LES POURCENTAGES PROPOSÉS — 5 %, 10 %, … 50 % (06/10/2026, ADR-0082).
 *
 * Dans chaque fenêtre de réduction : un clic remplit le champ du montant
 * avec ce que le pourcentage donne, et la ligne dessous dit ce qui sera
 * retiré et ce qui restera. Le formulaire s'envoie comme avant — le
 * pourcentage n'est qu'une proposition, le montant reste modifiable, et le
 * serveur garde ses contrôles.
 *
 *   - `sens="part"`    : le champ reçoit la PART retirée (une réduction, une
 *                        remise par mois, une remise sur la dette) ;
 *   - `sens="reste"`   : le champ reçoit ce qui RESTE (un nouveau frais
 *                        mensuel, un frais personnalisé).
 *
 * `cible` : le nom du champ dans le même formulaire ; `motif` : celui du motif,
 * prérempli « Réduction de 20 % » s'il est vide (ou déjà prérempli ainsi).
 * `onChoisir` : pour un champ contrôlé par React (le formulaire d'inscription).
 * `variante="liste"` : une liste déroulante compacte, pour une ligne étroite.
 */
export function PourcentagesProposes({
  base,
  cible,
  sens,
  motif,
  libelleBase,
  onChoisir,
  variante = 'puces',
}: {
  base: string | null | undefined;
  cible: string;
  sens: 'part' | 'reste';
  motif?: string;
  libelleBase?: string;
  onChoisir?: (valeur: string, pct: number) => void;
  variante?: 'puces' | 'liste';
}) {
  const [choisi, setChoisi] = useState<number | null>(null);
  if (partPourcentage(base, 5) === null) return null;

  const valeurDe = (pct: number) => (sens === 'part' ? partPourcentage(base, pct) : resteApresPourcentage(base, pct))!;

  const appliquer = (form: HTMLFormElement | null, pct: number) => {
    const valeur = valeurDe(pct);
    setChoisi(pct);
    if (onChoisir) {
      onChoisir(valeur, pct);
    } else if (form) {
      const champ = form.elements.namedItem(cible);
      if (champ instanceof HTMLInputElement) {
        champ.value = valeur;
        champ.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (motif && form) {
      const m = form.elements.namedItem(motif);
      if (m instanceof HTMLInputElement && (m.value.trim() === '' || /^Réduction de \d+ %$/.test(m.value))) {
        m.value = `Réduction de ${pct} %`;
      }
    }
  };

  const resume =
    choisi === null ? null : (
      <small className="text-muted" data-testid="pourcentage-resume" style={{ display: 'block', marginTop: '.25rem' }}>
        {choisi} % de {fr(base!)} MRU{libelleBase ? ` (${libelleBase})` : ''} : {fr(partPourcentage(base, choisi)!)} MRU retirés,
        reste {fr(resteApresPourcentage(base, choisi)!)} MRU.
      </small>
    );

  if (variante === 'liste') {
    return (
      <select
        aria-label="Réduction en pourcentage"
        defaultValue=""
        onChange={(e) => {
          const pct = Number(e.target.value);
          if (pct) appliquer(e.currentTarget.form, pct);
        }}
        style={{ width: 'auto', padding: '.1rem .2rem', fontSize: '.72rem' }}
      >
        <option value="">%</option>
        {POURCENTAGES_PROPOSES.map((p) => (
          <option key={p} value={p}>
            −{p} %
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="pourcentages" role="group" aria-label="Réduction en pourcentage" style={{ margin: '.35rem 0 .5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
        {POURCENTAGES_PROPOSES.map((p) => (
          <button
            key={p}
            type="button"
            className={`btn btn-sm ${choisi === p ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '.15rem .5rem', fontSize: '.78rem', minWidth: '3.2rem' }}
            aria-pressed={choisi === p}
            onClick={(e: MouseEvent<HTMLButtonElement>) => appliquer(e.currentTarget.form, p)}
          >
            {p} %
          </button>
        ))}
      </div>
      {resume}
    </div>
  );
}
