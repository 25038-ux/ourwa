import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * Un NNI ou un RIM tel qu'on le range : le texte sans ses blancs, ou NULL
 * quand il n'y en a pas. Jamais '' (0044) : l'unique de l'école et le blocage
 * « NNI OU RIM » traiteraient tous les « sans numéro » comme une seule
 * personne.
 */
export function identiteOuNull(valeur: string | null | undefined): string | null {
  const v = (valeur ?? '').trim();
  return v === '' ? null : v;
}

/**
 * The expulsion register.
 *
 * ⚠ Blocking is by IDENTITY — NNI and RIM — never by student id. That is the
 * entire point: it has to outlive the deletion of the student record, so a
 * family that deletes and re-creates a child cannot slip past it.
 *
 * Scoped to one school (ADR-0014).
 */
@Injectable()
export class ExpulsionsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Is this identity blocked here? Called before an admission is allowed. */
  async blockFor(
    nationalIdBrut: string | null | undefined,
    rimBrut: string | null | undefined,
    opts: { exact?: boolean } = {},
  ): Promise<{ reason: string | null; expelledAt: Date } | null> {
    // ⚠ Un numéro ABSENT ne correspond à rien (NULL = NULL est faux en SQL) :
    // un enfant sans NNI n'est pas « le même » qu'un exclu sans NNI (0044).
    const nationalId = identiteOuNull(nationalIdBrut);
    const rim = identiteOuNull(rimBrut);
    if (!opts.exact && nationalId === null && rim === null) return null;
    return this.db.query(async (tx) => {
      // ⚠ L'UN OU L'AUTRE, comme son `WHERE nni = :n OR rim = :r` : la phrase du
      // refus le disait (« ce NNI ou ce RIM ») mais la requête exigeait les
      // deux — changer un caractère du RIM réadmettait un exclu. `exact` sert
      // au registre lui-même (la même paire ne s'y inscrit pas deux fois).
      const { rows } = await tx.query<{ reason: string | null; expelled_at: Date }>(
        opts.exact
          ? `SELECT reason, expelled_at FROM expulsions
               WHERE national_id IS NOT DISTINCT FROM $1 AND rim IS NOT DISTINCT FROM $2
                 AND lifted_at IS NULL`
          : `SELECT reason, expelled_at FROM expulsions
               WHERE (national_id = $1 OR rim = $2) AND lifted_at IS NULL
               ORDER BY expelled_at DESC`,
        [nationalId, rim],
      );
      const r = rows[0];
      return r ? { reason: r.reason, expelledAt: r.expelled_at } : null;
    });
  }

  /**
   * LE REGISTRE — `expelled.php`.
   *
   * ⚠ SA RECHERCHE EST UN `LIKE` EN SQL, PAGINÉ À 25. La nôtre ramenait 200
   * lignes et filtrait en JavaScript : au-delà de 200 blocages la recherche
   * cessait silencieusement de trouver, et chaque affichage transportait la
   * table entière pour en montrer vingt-cinq.
   *
   * ⚠ CURSEUR, PAS `OFFSET` (règle 17). Le sien pagine en OFFSET ; un blocage
   * posé pendant la consultation décalerait alors toutes les pages suivantes.
   * Le curseur porte `(expelled_at, id)` — la date seule ne tranche pas deux
   * blocages posés dans la même seconde, ce qui arrive quand on en saisit
   * plusieurs à la suite.
   */
  async list(input: { includeLifted?: boolean; q?: string; cursor?: string; limit?: number } = {}) {
    const includeLifted = input.includeLifted ?? false;
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const term = (input.q ?? '').trim();

    return this.db.query(async (tx) => {
      // Le curseur : « <iso>~<uuid> ». Le séparateur est ordinaire ; un NUL ne
      // traverse pas une colonne `text` de Postgres.
      const cut = input.cursor ? input.cursor.lastIndexOf('~') : -1;
      const afterAt = cut >= 0 ? input.cursor!.slice(0, cut) : null;
      const afterId = cut >= 0 ? input.cursor!.slice(cut + 1) : null;

      const { rows } = await tx.query<{ id: string; expelled_at: string }>(
        `SELECT e.id, e.national_id, e.rim, e.first_name, e.last_name, e.reason,
                e.expelled_at, e.lifted_at, e.lift_reason,
                u.full_name AS expelled_by_name,
                v.full_name AS lifted_by_name
           FROM expulsions e
           LEFT JOIN users u ON u.id = e.expelled_by
           LEFT JOIN users v ON v.id = e.lifted_by
          WHERE ($1::boolean OR e.lifted_at IS NULL)
            AND ($2::text IS NULL OR (
                  e.first_name  ILIKE $2 ESCAPE '\\'
               OR e.last_name   ILIKE $2 ESCAPE '\\'
               OR e.national_id ILIKE $2 ESCAPE '\\'
               OR e.rim         ILIKE $2 ESCAPE '\\'
            ))
            AND ($3::timestamptz IS NULL
                 OR (e.expelled_at, e.id) < ($3::timestamptz, $4::uuid))
          ORDER BY e.expelled_at DESC, e.id DESC
          LIMIT $5`,
        [
          includeLifted,
          // `%` et `_` sont des jokers de LIKE : un motif qui en contient
          // chercherait autre chose que ce qui a été tapé.
          term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null,
          afterAt,
          afterId,
          limit + 1,
        ],
      );

      // Son « N résultats » sous la pagination.
      const { rows: compte } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM expulsions e
          WHERE ($1::boolean OR e.lifted_at IS NULL)
            AND ($2::text IS NULL OR (
                  e.first_name  ILIKE $2 ESCAPE '\\'
               OR e.last_name   ILIKE $2 ESCAPE '\\'
               OR e.national_id ILIKE $2 ESCAPE '\\'
               OR e.rim         ILIKE $2 ESCAPE '\\'
            ))`,
        [includeLifted, term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null],
      );

      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        total: Number(compte[0]!.n),
        rows: page,
        nextCursor:
          rows.length > limit && last
            ? `${new Date(last.expelled_at).toISOString()}~${last.id}`
            : null,
      };
    });
  }

  async expel(
    input: {
      nationalId?: string | null;
      rim?: string | null;
      firstName: string;
      lastName: string;
      reason?: string;
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();

    const nationalId = identiteOuNull(input.nationalId);
    const rim = identiteOuNull(input.rim);
    // Sans l'un ni l'autre, le blocage ne bloquerait personne (0044).
    if (nationalId === null && rim === null) {
      throw new BadRequestException(
        "Pour bloquer un élève, il faut le NNI ou le RIM : renseignez l'un des deux dans sa fiche.",
      );
    }

    return this.db.query(async (tx) => {
      const existing = await this.blockFor(nationalId, rim, { exact: true });
      if (existing) {
        throw new BadRequestException('Cette personne est déjà bloquée dans cette école.');
      }

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO expulsions
           (school_id, national_id, rim, first_name, last_name, reason, expelled_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          schoolId,
          nationalId,
          rim,
          input.firstName.trim(),
          input.lastName.trim(),
          input.reason ?? null,
          actorId,
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'student_expelled',
          entity: 'expulsion',
          entityId: rows[0]!.id,
          after: {
            name: `${input.firstName} ${input.lastName}`.trim(),
            nni: nationalId,
            rim,
            reason: input.reason ?? null,
          },
        },
        tx,
      );

      return { id: rows[0]!.id };
    });
  }

  /**
   * Lift a block.
   *
   * Son `debloquer` — chez lui un DELETE ; ici la ligne reste, marquée levée
   * (le journal, comme le sien, garde le déblocage). Sans motif : il n'en
   * demande pas.
   */
  async lift(expulsionId: string, reason: string | null, actorId: string) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ first_name: string; last_name: string; national_id: string | null; rim: string | null }>(
        `UPDATE expulsions
            SET lifted_at = now(), lifted_by = $2, lift_reason = $3
          WHERE id = $1 AND lifted_at IS NULL
          RETURNING first_name, last_name, national_id, rim`,
        [expulsionId, actorId, reason],
      );
      const row = rows[0];
      if (!row) {
        throw new NotFoundException('Aucun blocage actif correspondant.');
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'expulsion_lifted',
          entity: 'expulsion',
          entityId: expulsionId,
          // Son `journaliser("Déblocage NNI … / RIM … (Prénom Nom)")`.
          after: { reason, nni: row.national_id, rim: row.rim, nom: `${row.first_name} ${row.last_name}` },
        },
        tx,
      );

      return { id: expulsionId, lifted: true, prenom: row.first_name, nom: row.last_name };
    });
  }
}
