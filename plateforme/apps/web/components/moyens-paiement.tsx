'use client';

import { useId, useState } from 'react';

export interface Moyen {
  id: string;
  name: string;
}

export interface LigneMoyen {
  /** N° de reçu de l'application de paiement (Bankily, Masrvi…) — facultatif. */
  reference?: string;
  moyenId: string;
  montant: string;
}

interface Props {
  moyens: Moyen[];
  /** "à régler" — what the lines are expected to total. */
  cible: string;
  onChange: (lignes: LigneMoyen[]) => void;
  lignes: LigneMoyen[];
  currency: string;
  /** "(sortie)" on the label, for money leaving the till. */
  sens?: 'entrant' | 'sortant';
}

/**
 * MOYEN(S) DE PAIEMENT — `widget_moyens_paiement()` in `includes/paiements.php`.
 *
 * One payment arrives by several means: half in cash, half by Bankily. El Ourwa
 * lets the operator add a line per means and shows the running total, and the
 * server then refuses anything whose lines do not sum to the payment.
 *
 * ⚠ THE TOTAL TURNS OLIVE WHEN IT MATCHES, within a centime. That colour is the
 * whole feedback loop: the operator sees the refusal coming rather than meeting
 * it after pressing the button. Its own threshold is `Math.abs(t - c) < 0.01`
 * and its own colour is #728157 — kept, because an operator who has learnt to
 * look for green has learnt something about this screen, not about mine.
 *
 * The first line is pre-filled with the whole expected amount, because that is
 * the common case and typing it again is work the screen can do.
 *
 * ⚠ RIEN D'AUTRE. Nous ajoutions sous le total une phrase — « il manque »,
 * « de trop », « versement partiel » — qu'il n'a pas. Son seul retour est la
 * couleur du total ; ce qui manque ou dépasse, c'est le serveur qui le dit.
 */
export function MoyensPaiement({ moyens, cible, lignes, onChange, currency, sens = 'entrant' }: Props) {
  const id = useId();
  const total = lignes.reduce((acc, l) => acc + (parseFloat(l.montant) || 0), 0);
  const target = parseFloat(cible) || 0;
  const matches = target > 0 && Math.abs(total - target) < 0.01;

  if (moyens.length === 0) {
    return (
      <div className="alert alert-warning" style={{ margin: '.5rem 0' }}>
        Aucun moyen de paiement configuré. Ajoutez-en un depuis l’en-tête de
        « Gestion de Caisse » avant d’enregistrer un paiement.
      </div>
    );
  }

  const set = (index: number, patch: Partial<LigneMoyen>) =>
    onChange(lignes.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  return (
    <div className="mp-widget" style={{ margin: '.5rem 0' }}>
      <label style={{ fontWeight: 600, display: 'block', marginBottom: '.4rem' }}>
        Moyen(s) de paiement {sens === 'sortant' ? '(sortie)' : ''}
        {target > 0 && (
          <span className="text-muted" style={{ fontWeight: 400 }}>
            {' '}
            — à régler : {fr(target)} {currency}
          </span>
        )}
      </label>

      <div className="mp-lignes">
        {lignes.map((ligne, i) => (
          <div key={i} className="mp-ligne">
            <label className="sr-only" htmlFor={`${id}-m-${i}`}>
              Moyen de paiement {i + 1}
            </label>
            <select
              id={`${id}-m-${i}`}
              className="mp-moyen"
              value={ligne.moyenId}
              onChange={(e) => set(i, { moyenId: e.target.value })}
              required
              style={{ flex: 1, minWidth: 140 }}
            >
              <option value="">— Moyen —</option>
              {moyens.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor={`${id}-a-${i}`}>
              Montant {i + 1}
            </label>
            <input
              id={`${id}-a-${i}`}
              className="mp-montant"
              type="number"
              min="0"
              step="0.01"
              placeholder="Montant"
              value={ligne.montant}
              onChange={(e) => set(i, { montant: e.target.value })}
              required
              style={{ width: 140 }}
            />

            {sens === 'entrant' && (
              <>
                <label className="sr-only" htmlFor={`${id}-r-${i}`}>
                  N° de reçu de l&apos;application de paiement {i + 1}
                </label>
                <input
                  id={`${id}-r-${i}`}
                  className="mp-reference"
                  type="text"
                  maxLength={60}
                  placeholder="N° reçu appli (facultatif)"
                  title="Le numéro du reçu délivré par l'application de paiement (Bankily, Masrvi…) — il sera imprimé sur le reçu"
                  value={ligne.reference ?? ''}
                  onChange={(e) => set(i, { reference: e.target.value })}
                  autoComplete="off"
                  style={{ width: 170 }}
                />
              </>
            )}

            {/* Son ✕ est sur chaque ligne, la première comprise. */}
            <button
              type="button"
              className="btn btn-sm btn-danger mp-remove"
              onClick={() => onChange(lignes.filter((_, j) => j !== i))}
              aria-label={`Retirer le moyen de paiement ${i + 1}`}
              style={{ padding: '.25rem .5rem' }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
          marginTop: '.4rem',
        }}
      >
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => onChange([...lignes, { moyenId: '', montant: '' }])}
        >
          + Ajouter un moyen de paiement
        </button>
        <span className="mp-total" style={{ fontWeight: 600 }} aria-live="polite">
          {/* Olive when it reconciles — its own #728157. */}
          Total : <span style={{ color: matches ? '#728157' : undefined }}>{fr(total)}</span>{' '}
          {currency}
        </span>
      </div>

    </div>
  );
}

/** Its `number_format(…, 0, ',', ' ')` — thin space thousands, no decimals. */
export function fr(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const whole = Number.isInteger(rounded);
  const text = whole ? String(rounded) : rounded.toFixed(2).replace('.', ',');
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
