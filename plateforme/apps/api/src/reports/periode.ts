import { BadRequestException } from '@nestjs/common';

/**
 * UNE PÉRIODE DE PLUSIEURS JOURS — « du … au … », bornes comprises.
 *
 * Demande du propriétaire (octobre 2026) : El Ourwa ne sait demander qu'un
 * jour (`revenue_live.php?jour=`) ou un mois (`?mois=&annee=`) ; le bureau veut
 * aussi une semaine, une quinzaine, « du 28 au 3 ». Les deux dates arrivent de
 * l'URL : elles sont validées ici, une fois, avant de toucher une requête.
 */
export interface Plage {
  /** AAAA-MM-JJ, compris. */
  from: string;
  /** AAAA-MM-JJ, compris. */
  to: string;
}

/** Une année entière, bissextile comprise — au-delà, c'est le bilan annuel qu'on veut. */
export const PLAGE_MAX_JOURS = 366;

const FORME = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Une date RÉELLE au format AAAA-MM-JJ. `2021-02-30` a la bonne forme et
 * n'existe pas : Postgres la refuserait par une erreur 500 au lieu d'un 400.
 */
export function jourReel(valeur: string): string {
  const m = FORME.exec(valeur);
  if (m) {
    const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const d = new Date(Date.UTC(a, mo - 1, j));
    if (
      a >= 2000 && a <= 2100 &&
      d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j
    ) {
      return valeur;
    }
  }
  throw new BadRequestException('Date invalide : attendu AAAA-MM-JJ, une date qui existe.');
}

/** Le nombre de jours de la période, bornes comprises. */
export function joursDePlage(p: Plage): number {
  const ms = Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Les deux bornes telles que l'URL les donne, ou rien si aucune n'est donnée.
 * Une seule des deux est une demande incomplète, pas « jusqu'à aujourd'hui » :
 * deviner une borne sur un rapport financier, c'est afficher un total que
 * personne n'a demandé.
 */
export function parsePlage(from: string | undefined, to: string | undefined): Plage | undefined {
  if (!from && !to) return undefined;
  if (!from || !to) {
    throw new BadRequestException('Indiquez les deux dates de la période (du … au …).');
  }
  const plage = { from: jourReel(from), to: jourReel(to) };
  if (plage.from > plage.to) {
    throw new BadRequestException('La date de début doit précéder la date de fin.');
  }
  if (joursDePlage(plage) > PLAGE_MAX_JOURS) {
    throw new BadRequestException(`La période ne peut pas dépasser ${PLAGE_MAX_JOURS} jours.`);
  }
  return plage;
}
