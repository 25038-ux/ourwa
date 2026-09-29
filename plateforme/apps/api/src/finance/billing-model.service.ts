import { Inject, Injectable } from '@nestjs/common';
import type { Queryable } from '@elourwa/db';
import { estModeleFacturation, type ModeleFacturation } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

/** 'famille' (El Ourwa, défaut) | 'services' (Jinan). */
export type BillingModel = ModeleFacturation;

/**
 * LE MODÈLE DE FACTURATION DE L'ÉCOLE DU CONTEXTE — le seul point de lecture.
 *
 * ADR-0073, docs/specs/jinan-facturation.md §1. `schools.billing_model` (0042) :
 * « famille » par défaut, c'est-à-dire El Ourwa inchangé (El Mourad, Nour,
 * Rissala, Salam) ; « services » pour Jinan. Chaque comportement nouveau de la
 * facturation « services » se décide ICI, et nulle part ailleurs : une école
 * « famille » doit rester identique au centime près.
 *
 * `schools` est une table de plateforme (sans school_id, sans RLS) : on la lit
 * par id, dans la transaction du tenant, comme `receipt_prefix` et `currency`.
 * Pas de cache : une clé primaire, et un modèle mémorisé serait une occasion
 * de facturer une école sous le modèle d'une autre.
 */
@Injectable()
export class BillingModelService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Le modèle de l'école du contexte. Lève hors de tout tenant. */
  async current(): Promise<BillingModel> {
    return this.db.query((tx) => this.currentIn(tx));
  }

  /**
   * Le même, dans une transaction déjà ouverte (celle d'un encaissement, d'une
   * inscription) — sans en ouvrir une seconde.
   */
  async currentIn(tx: Queryable): Promise<BillingModel> {
    const { schoolId } = currentTenant();
    const { rows } = await tx.query<{ billing_model: string }>(
      'SELECT billing_model FROM schools WHERE id = $1',
      [schoolId],
    );
    const modele = rows[0]?.billing_model;
    // Une école absente n'a aucune donnée (toute table de tenant la désigne par
    // clé étrangère) : le chemin d'El Ourwa n'y trouvera rien, et c'est lui
    // qu'on garde. Une valeur inconnue, elle, est impossible (CHECK de 0042) —
    // si elle arrivait, mieux vaut s'arrêter que facturer au hasard.
    if (modele === undefined) return 'famille';
    if (!estModeleFacturation(modele)) {
      throw new Error(`Modèle de facturation inconnu pour l’école ${schoolId} : « ${modele} ».`);
    }
    return modele;
  }

  /** Vrai pour une école « services » (Jinan). */
  async isServices(tx?: Queryable): Promise<boolean> {
    return (await (tx ? this.currentIn(tx) : this.current())) === 'services';
  }
}
