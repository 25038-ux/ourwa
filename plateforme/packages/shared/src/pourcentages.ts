import { Decimal } from 'decimal.js';

/**
 * LES POURCENTAGES PROPOSÉS DANS LES FENÊTRES DE RÉDUCTION — demande du
 * propriétaire de Jinan (06/10/2026), ADR-0082 : « for each reduction window
 * (whether monthly reduction or frais changement) add some proposed
 * percentages 5% 10% 15% 20% 25% 30% 35% until 50%, and the system deducts
 * automatically ».
 *
 * Un pourcentage ne s'enregistre nulle part : il PROPOSE un montant, que la
 * fenêtre envoie comme avant (une réduction, une remise, un nouveau frais).
 * Le serveur garde ses contrôles (jamais plus que le prix, jamais négatif).
 *
 * ⚠ De l'argent (règle 6) : en décimal, à partir d'une chaîne. Arrondi UNE
 * fois (règle 8), à l'ouguiya entier, au demi supérieur — les champs des
 * fenêtres sont en MRU entiers. Le reste se calcule depuis la part ARRONDIE,
 * pour que part + reste = base, toujours.
 */
export const POURCENTAGES_PROPOSES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const;

function base(v: string | null | undefined): Decimal | null {
  if (v === null || v === undefined) return null;
  const t = v.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const d = new Decimal(t);
  return d.greaterThan(0) ? d : null;
}

function part(b: Decimal, pct: number): Decimal {
  return b.times(pct).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/** Ce que retire `pct` % de `montant` (« 640 » pour 20 % de 3 200), ou null sans base. */
export function partPourcentage(montant: string | null | undefined, pct: number): string | null {
  const b = base(montant);
  return b ? part(b, pct).toFixed(0) : null;
}

/** Ce qui reste après `pct` % (« 2560 » pour 20 % de 3 200), ou null sans base. */
export function resteApresPourcentage(montant: string | null | undefined, pct: number): string | null {
  const b = base(montant);
  return b ? b.minus(part(b, pct)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0) : null;
}
