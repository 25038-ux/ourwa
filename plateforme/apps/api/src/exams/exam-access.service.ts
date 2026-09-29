import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { money } from '@elourwa/shared';
import type { Queryable } from '@elourwa/db';
import { Decimal } from 'decimal.js';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { DebtService } from '../finance/debt.service.js';
import { CacheService } from '../cache/cache.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * Access to EXAM results, term by term.
 *
 * The school withholds exam results from families who owe it money. This is the
 * single authority for whether the lock is open — every page and every endpoint
 * asks here. Two copies of this rule would drift, and it is the forgotten copy
 * that leaks the marks.
 *
 * ⚠ FAIL CLOSED. A missing year, a failed query, an unknown family: access is
 * refused. A result wrongly hidden produces a phone call; a result wrongly shown
 * takes away the school's only means of recovery. The two errors are not
 * equivalent.
 *
 * Ported from El Ourwa v15/v16 (`includes/acces_examens.php`), which the v13
 * source did not contain.
 */
@Injectable()
export class ExamAccessService {
  private readonly log = new Logger(ExamAccessService.name);
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(DebtService) private readonly debts: DebtService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  /**
   * The term a date falls in: 1, 2 or 3 — or 0 before the year has begun.
   *
   * A school year runs nine months from its start month, three per term. These
   * are the SAME terms as `grades.term`; a second notion of "period" would
   * eventually diverge from the first, and divergence is what produces wrong
   * results.
   *
   * After the year has ended the answer is 3: the last term stays the useful one.
   */
  termOf(
    year: { start_year: number; start_month: number; end_month: number },
    when: Date = new Date(),
  ): number {
    const month = when.getMonth() + 1;
    const calendarYear = when.getFullYear();

    // The year's months in order, from start_month of start_year.
    for (let i = 0; i < 9; i++) {
      const m = ((year.start_month - 1 + i) % 12) + 1;
      const y = year.start_year + Math.floor((year.start_month - 1 + i) / 12);
      if (m === month && y === calendarYear) return Math.floor(i / 3) + 1;
    }

    const startsAt = new Date(year.start_year, year.start_month - 1, 1);
    return when < startsAt ? 0 : 3;
  }

  /**
   * A family's TOTAL debt — every year, not this one.
   *
   * The same figure the till shows. Anything narrower and a parent could be told
   * at the counter that they owe nothing while still finding the door shut.
   *
   * On failure it returns a non-zero debt, so the caller fails closed.
   *
   * ⚠ GARDÉE 60 SECONDES, COMME CHEZ LUI. `acces_examens.php` met ce chiffre en
   * cache une minute parce que le calculer coûte et que la porte le demande à
   * chaque page. Il est OUBLIÉ après chaque encaissement et chaque remise
   * (`afterCollection`) : une famille qui vient de payer ne doit pas trouver la
   * porte fermée une minute de plus. La clé est par école et par famille.
   *
   * Et en chaîne, pas en `number` (règle 6) : le seul usage est « est-ce zéro »,
   * mais un flottant sur de l'argent n'a rien à faire ici, même pour cela.
   */
  private async totalDebt(guardianId: string): Promise<string> {
    try {
      return await this.cache.remember(`dette:${guardianId}`, 60, async () => {
        // ⚠ TOUTES LES ANNÉES, créances comprises — son `parent_dette_totale()`
        // n'a pas d'année. Bornée à l'année active, la porte s'ouvrait à une
        // famille qui devait 40 000 d'arriéré et avait payé ses mois courants,
        // et le cliquet gardait ensuite la porte ouverte.
        const total = await this.debts.outstandingAcrossYears(guardianId);
        return total.toFixed(2);
      });
    } catch (error) {
      // Fermé par défaut — mais DIT : sans cette ligne, une requête cassée
      // refusait les résultats à toutes les familles sans une trace nulle part.
      this.log.error(`dette illisible pour ${guardianId} : accès aux examens refusé par défaut`, error instanceof Error ? error.stack : String(error));
      return '1';
    }
  }

  /** The terms this family has already earned, ignoring any the direction closed. */
  private async earnedTerms(
    tx: Queryable,
    guardianId: string,
    academicYearId: string,
  ): Promise<number[]> {
    const { rows } = await tx.query<{ term: number }>(
      `SELECT term FROM exam_term_access
        WHERE guardian_id = $1 AND academic_year_id = $2 AND revoked_at IS NULL
        ORDER BY term`,
      [guardianId, academicYearId],
    );
    return rows.map((r) => r.term);
  }

  /**
   * Record that the current term is open, if the family owes nothing.
   *
   * Called after every collection and write-off — that is where debt changes,
   * and it must not require the family to log in — and again when a family page
   * is opened, as a safety net in case a new collection path is ever added
   * without remembering this one.
   *
   * `ON CONFLICT DO NOTHING` makes it repeatable, and deliberately does NOT
   * resurrect a row the direction closed: their decision must not be erased by
   * the next payment that happens along.
   */
  async openIfSettled(guardianId: string, academicYearId?: string): Promise<number> {
    const { schoolId } = currentTenant();
    const year = academicYearId
      ? await this.years.byId(academicYearId).catch(() => null)
      : await this.years.defaultView();
    if (!year) return 0;

    const term = this.termOf(year);
    if (term < 1) return 0;
    if (money(await this.totalDebt(guardianId)).greaterThan(0)) return 0;

    return this.db.query(async (tx) => {
      const { rowCount } = await tx.query(
        `INSERT INTO exam_term_access
           (school_id, guardian_id, academic_year_id, term, balance_seen)
         VALUES ($1, $2, $3, $4, 0)
         ON CONFLICT (school_id, guardian_id, academic_year_id, term) DO NOTHING`,
        [schoolId, guardianId, year.id, term],
      );
      return (rowCount ?? 0) > 0 ? term : 0;
    });
  }

  /** After a collection or a write-off: the family's debt has just changed. */
  async afterCollection(guardianId: string | null, academicYearId?: string): Promise<void> {
    if (!guardianId) return;
    // La dette vient de changer : le chiffre gardé ne vaut plus rien.
    this.cache.forget(`dette:${guardianId}`);
    await this.openIfSettled(guardianId, academicYearId).catch((error: unknown) => {
      this.log.error(`ouverture des examens après encaissement ratée pour ${guardianId}`, error instanceof Error ? error.stack : String(error));
    });
  }

  /**
   * THE DOOR. May this family see this term's EXAM results?
   *
   * Decided strongest first:
   *
   *   1. no year ..................... refused (fail closed)
   *   2. closed by the direction ..... refused — a human decision, reasoned and
   *                                    recorded, outranks everything, a settled
   *                                    debt included
   *   3. a derogation ................ allowed
   *   4. owes nothing ................ allowed, and the current term's opening
   *                                    is RECORDED so it survives the next
   *                                    unpaid month
   *   5. term already earned ......... allowed
   *   6. otherwise ................... refused
   *
   * A NULL `term` asks the question globally ("does this family see exams?").
   * The answer is then yes ONLY if they owe nothing: a single earned term is not
   * enough. That is deliberate — a caller who does not know which term it means
   * must not leak one.
   */
  async canSeeExams(
    guardianId: string,
    studentId: string | null,
    academicYearId: string,
    term: number | null,
  ): Promise<boolean> {
    if (!guardianId || !academicYearId) return false;

    try {
      const closed = await this.db.query(async (tx) => {
        if (term === null) return false;
        const { rows } = await tx.query(
          `SELECT 1 FROM exam_term_access
            WHERE guardian_id = $1 AND academic_year_id = $2 AND term = $3
              AND revoked_at IS NOT NULL
            LIMIT 1`,
          [guardianId, academicYearId, term],
        );
        return rows.length > 0;
      });
      if (closed) return false;

      const derogated = await this.db.query(async (tx) => {
        const { rows } = await tx.query(
          `SELECT 1 FROM exam_derogations
            WHERE guardian_id = $1 AND academic_year_id = $2
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > now())
              AND (student_id IS NULL OR student_id = $3::uuid)
              AND (term IS NULL OR term = $4::smallint)
            LIMIT 1`,
          [guardianId, academicYearId, studentId, term],
        );
        return rows.length > 0;
      });
      if (derogated) return true;

      if (!money(await this.totalDebt(guardianId)).greaterThan(0)) {
        // Settled: open the current term and let that survive the next debt.
        await this.openIfSettled(guardianId, academicYearId).catch(() => 0);
        return true;
      }

      if (term === null) return false;

      return this.db.query(async (tx) => {
        const earned = await this.earnedTerms(tx, guardianId, academicYearId);
        return earned.includes(term);
      });
    } catch (error) {
      this.log.error(`termes gagnés illisibles pour ${guardianId} : refusé par défaut`, error instanceof Error ? error.stack : String(error));
      return false; // fail closed
    }
  }

  /** Which terms of this year the family may see. For the parent app. */
  async visibleTerms(guardianId: string, academicYearId: string): Promise<number[]> {
    const open: number[] = [];
    for (const term of [1, 2, 3]) {
      if (await this.canSeeExams(guardianId, null, academicYearId, term)) open.push(term);
    }
    return open;
  }

  // ── The direction's controls ──────────────────────────────────────────────

  async grantDerogation(
    input: {
      guardianId: string;
      studentId?: string;
      academicYearId: string;
      term?: number;
      reason: string;
      expiresAt?: string;
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    if (!input.reason.trim()) {
      throw new BadRequestException(
        'Une dérogation demande un motif : c’est une exception à la politique ' +
          'de recouvrement de l’école, et elle doit rester explicable des mois ' +
          'plus tard.',
      );
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO exam_derogations
           (school_id, guardian_id, student_id, academic_year_id, term, reason,
            granted_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          schoolId, input.guardianId, input.studentId ?? null, input.academicYearId,
          input.term ?? null, input.reason.trim(), actorId, input.expiresAt ?? null,
        ],
      );
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'exam_derogation_granted',
          entity: 'exam_derogation',
          entityId: rows[0]!.id,
          after: {
            guardianId: input.guardianId,
            term: input.term ?? 'all',
            reason: input.reason,
          },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /** Revoked, never deleted — the history has to survive an inspection. */
  async revokeDerogation(id: string, actorId: string) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const result = await tx.query(
        `UPDATE exam_derogations SET revoked_by = $2, revoked_at = now()
          WHERE id = $1 AND revoked_at IS NULL`,
        [id, actorId],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('Aucune dérogation active correspondante.');
      }
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'exam_derogation_revoked',
          entity: 'exam_derogation',
          entityId: id,
        },
        tx,
      );
      return { id };
    });
  }

  /**
   * Close a term the family had earned.
   *
   * The one thing that outranks a settled debt, so the reason is mandatory.
   */
  async closeTerm(
    input: { guardianId: string; academicYearId: string; term: number; reason: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    if (!input.reason.trim()) {
      throw new BadRequestException('Fermer un trimestre déjà acquis demande un motif.');
    }

    return this.db.query(async (tx) => {
      const result = await tx.query(
        `INSERT INTO exam_term_access
           (school_id, guardian_id, academic_year_id, term, balance_seen,
            revoked_by, revoked_at, revoke_reason)
         VALUES ($1, $2, $3, $4, 0, $5, now(), $6)
         ON CONFLICT (school_id, guardian_id, academic_year_id, term)
         DO UPDATE SET revoked_by = $5, revoked_at = now(), revoke_reason = $6`,
        [
          schoolId, input.guardianId, input.academicYearId, input.term,
          actorId, input.reason.trim(),
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'exam_term_closed',
          entity: 'exam_term_access',
          after: { guardianId: input.guardianId, term: input.term, reason: input.reason },
        },
        tx,
      );
      return { closed: result.rowCount ?? 0 };
    });
  }

  /** Reopen a term the direction had closed. */
  async reopenTerm(
    input: { guardianId: string; academicYearId: string; term: number },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const result = await tx.query(
        `UPDATE exam_term_access
            SET revoked_by = NULL, revoked_at = NULL, revoke_reason = NULL
          WHERE guardian_id = $1 AND academic_year_id = $2 AND term = $3
            AND revoked_at IS NOT NULL`,
        [input.guardianId, input.academicYearId, input.term],
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new NotFoundException('Ce trimestre n’est pas fermé.');
      }
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'exam_term_reopened',
          entity: 'exam_term_access',
          after: { guardianId: input.guardianId, term: input.term },
        },
        tx,
      );
      return { reopened: true };
    });
  }

  /**
   * LES FAMILLES EN DETTE, ET LEUR ÉTAT D'ACCÈS — `derogations.php`.
   *
   * « TOUTES ANNÉES CONFONDUES. La dette qui ferme la porte est le total dû à
   * l'école, arriérés compris » : les correspondants dont le total dû est
   * positif, par solde décroissant, 200 au plus ; pour chacun : `ouvert` (une
   * dérogation active couvrant tous les enfants et tous les trimestres),
   * `gagnes` (les trimestres acquis en soldant) et `fermes` (ceux que la
   * direction a refermés, avec le motif).
   */
  async overview(academicYearId: string) {
    const tous = await this.debts.outstanding(null, null);
    const familles = tous
      .filter((f) => new Decimal(f.total).greaterThan(0))
      .sort((a, b) => new Decimal(b.total).comparedTo(new Decimal(a.total)))
      .slice(0, 200);
    if (familles.length === 0) return [];

    return this.db.query(async (tx) => {
      const ids = familles.map((f) => f.guardianId);
      const { rows: acces } = await tx.query<{
        guardian_id: string;
        term: number;
        revoked_at: string | null;
        revoke_reason: string | null;
      }>(
        `SELECT guardian_id, term, revoked_at, revoke_reason
           FROM exam_term_access
          WHERE academic_year_id = $1 AND guardian_id = ANY($2::uuid[])`,
        [academicYearId, ids],
      );
      const { rows: derog } = await tx.query<{ guardian_id: string }>(
        `SELECT DISTINCT guardian_id FROM exam_derogations
          WHERE academic_year_id = $1 AND guardian_id = ANY($2::uuid[])
            AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
            AND student_id IS NULL AND term IS NULL`,
        [academicYearId, ids],
      );
      const ouverts = new Set(derog.map((d) => d.guardian_id));
      const gagnes = new Map<string, number[]>();
      const fermes = new Map<string, Record<number, string>>();
      for (const a of acces) {
        if (a.revoked_at === null) {
          gagnes.set(a.guardian_id, [...(gagnes.get(a.guardian_id) ?? []), a.term].sort());
        } else {
          fermes.set(a.guardian_id, { ...(fermes.get(a.guardian_id) ?? {}), [a.term]: a.revoke_reason ?? '' });
        }
      }
      return familles.map((f) => ({
        guardian_id: f.guardianId,
        full_name: f.name,
        phone: f.phone,
        solde: f.total,
        ouvert: ouverts.has(f.guardianId),
        gagnes: gagnes.get(f.guardianId) ?? [],
        fermes: fermes.get(f.guardianId) ?? {},
      }));
    });
  }

  async derogations(academicYearId: string) {
    return this.db.query(async (tx) => {
      // Son historique : accordées ET révoquées, par date d'octroi, 100 au plus.
      const { rows } = await tx.query(
        `SELECT d.id, d.guardian_id, d.student_id, d.term, d.reason,
                d.granted_at, d.expires_at, d.revoked_at,
                u.full_name AS guardian_name, u.phone AS guardian_phone,
                g.full_name AS granted_by_name,
                r.full_name AS revoked_by_name,
                s.first_name || ' ' || s.last_name AS student_name
           FROM exam_derogations d
           JOIN users u ON u.id = d.guardian_id
           LEFT JOIN users g ON g.id = d.granted_by
           LEFT JOIN users r ON r.id = d.revoked_by
           LEFT JOIN students s ON s.id = d.student_id
          WHERE d.academic_year_id = $1
          ORDER BY d.granted_at DESC
          LIMIT 100`,
        [academicYearId],
      );
      return rows;
    });
  }
}
