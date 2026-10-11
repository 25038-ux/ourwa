import { Injectable } from '@nestjs/common';
import pg from 'pg';
import { withTenant, type Queryable } from '@elourwa/db';
import { currentTenant } from '../tenant/tenant.context.js';

export const DB = Symbol('DB');

/*
 * ⚠ LES CONNEXIONS SE FERMAIENT AU BOUT DE DIX SECONDES DE SILENCE (10/10/2026,
 * le jour de la mise en ligne : « the site is still kinda slow »).
 *
 * `pg` ferme par défaut une connexion inoccupée depuis 10 s. Une personne qui
 * lit une page plus de dix secondes — c'est-à-dire tout le monde — retrouvait
 * donc, au clic suivant, un pool VIDE : chaque appel de la page ouvrait sa
 * connexion (poignée de main, mot de passe SCRAM), et Postgres lui donnait un
 * processus neuf dont tous les caches de catalogue étaient à remplir avant de
 * planifier la première requête. Mesuré ici sur les données de l'école : la
 * même page, 25–35 ms d'API quand on enchaîne, 95–280 ms après douze secondes
 * de pause. Ce n'était pas « le premier appel après un redémarrage » : c'était
 * presque CHAQUE page d'une personne seule.
 *
 * Désormais `CONNEXIONS_GARDEES` connexions restent ouvertes pour toujours
 * (`min`), et celles qu'une pointe ajoute tiennent une minute. Dix, parce que
 * la page la plus gourmande (/finance/revenue) ouvre dix appels de front : à
 * moins, les appels en trop retrouveraient une connexion neuve dès qu'on a lu
 * autre chose plus d'une minute. Ce que coûte une connexion neuve, mesuré à
 * part sous `app_user` : 35 à 100 ms pour l'ouvrir, puis 20 à 140 ms à sa
 * première requête jointe — contre 3 à 5 ms sur une connexion réchauffée.
 * Un processus Postgres inoccupé pèse quelques mégaoctets ; le serveur en a
 * 3 900, et Postgres en accepte cent.
 */
const CONNEXIONS_GARDEES = 10;

@Injectable()
export class DbService {
  private readonly pool: pg.Pool;

  constructor() {
    const connectionString =
      process.env.DATABASE_URL ?? 'postgres://app_user:devpassword@localhost:5432/elourwa';
    // The API connects as app_user — subject to RLS, no BYPASSRLS.
    // Standing rule 3: the admin and reporting URLs never appear here.
    this.pool = new pg.Pool({ connectionString, max: 20, min: CONNEXIONS_GARDEES, idleTimeoutMillis: 60_000 });
  }

  /**
   * OUVRIR ET RÉCHAUFFER LES CONNEXIONS GARDÉES, avant d'écouter — appelé par
   * `main.ts` seulement (pas par les tests, qui n'en ont pas l'usage).
   *
   * Sans cela les premières pages après un redémarrage payaient, chacune sur
   * ses propres connexions, l'ouverture et le remplissage des caches : la même
   * attente qu'après une pause, au pire moment — celui où l'on vient de
   * déployer et où l'on regarde si « ça marche ».
   *
   * Réchauffer = faire PLANIFIER (jamais exécuter) une lecture de chaque table
   * que `app_user` peut lire : `EXPLAIN … LIMIT 0` charge la table, ses index
   * et sa politique RLS dans les caches du processus. Aucun contexte d'école
   * n'est posé et rien n'est lu : RLS reste fermée, comme pour toute connexion
   * sans école. Un échec ne bloque pas le démarrage — l'API sait attendre sa
   * base — il est seulement signalé.
   */
  async rechauffer(n: number = CONNEXIONS_GARDEES): Promise<number> {
    const clients: pg.PoolClient[] = [];
    try {
      // Toutes à la fois : c'est en les demandant ensemble qu'on en obtient `n`.
      clients.push(...(await Promise.all(Array.from({ length: n }, () => this.pool.connect()))));
      const { rows } = await clients[0]!.query<{ sql: string | null }>(
        `SELECT string_agg(format('EXPLAIN SELECT 1 FROM %I LIMIT 0', c.relname), '; ' ORDER BY c.relname) AS sql
           FROM pg_class c
          WHERE c.relkind = 'r'
            AND c.relnamespace = 'public'::regnamespace
            AND has_table_privilege(c.oid, 'SELECT')`,
      );
      const sql = rows[0]?.sql;
      if (sql) await Promise.all(clients.map((c) => c.query(sql)));
      return clients.length;
    } catch (error) {
      console.warn(`[db] connexions non réchauffées : ${(error as Error).message}`);
      return 0;
    } finally {
      for (const c of clients) c.release();
    }
  }

  /** Every tenant-scoped read or write goes through here. */
  async query<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const { schoolId } = currentTenant();
    return withTenant(schoolId, fn, this.pool);
  }

  /**
   * Untenanted access, for the school registry only. `schools` is the tenant
   * registry itself and carries no school_id, so it is not RLS-protected — which
   * is exactly why this method is deliberately narrow and separately named.
   */
  async registry<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /**
   * A tenant-scoped query for an EXPLICIT school, rather than the request's own.
   *
   * For the platform layer only, which visits each branch in turn to build a
   * combined figure. It still goes through RLS — this names the tenant, it does
   * not escape it. `app_reporter` and its BYPASSRLS stay out of request paths.
   */
  async queryFor<T>(schoolId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return withTenant(schoolId, fn, this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
