import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { payableMonths, type AcademicYearShape, type Queryable } from '@elourwa/db';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

export interface AcademicYear {
  id: string;
  label: string;
  start_year: number;
  start_month: number;
  end_month: number;
  status: 'future' | 'active' | 'closed';
  closed_at: string | null;
}

/**
 * The academic year — the school's unit of time.
 *
 * A year opens in a chosen month (October) and closes in another (June).
 * October–December belong to the year that opens; January–June to the year that
 * closes. Everything hangs off it.
 */
@Injectable()
export class AcademicYearService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<AcademicYear[]> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<AcademicYear>(
        `SELECT id, label, start_year, start_month, end_month, status, closed_at
           FROM academic_years ORDER BY start_year DESC`,
      );
      return rows;
    });
  }

  /**
   * LA MÊME LISTE, AVEC CE QUE SON TABLEAU AFFICHE À CÔTÉ DE CHAQUE ANNÉE.
   *
   * `annees_scolaires.php` met deux badges sur chaque ligne — « Inscrits » et
   * « Archivés » — et ce sont eux qui disent si une année a été repeuplée. Une
   * année ouverte à zéro inscrit est le symptôme exact que sa bannière signale.
   */
  async listWithCounts(): Promise<(AcademicYear & { enrolled: number; archived: number })[]> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<
        AcademicYear & { enrolled: number; archived: number }
      >(
        `SELECT y.id, y.label, y.start_year, y.start_month, y.end_month, y.status,
                y.closed_at,
                (SELECT count(*)::int FROM enrollments e
                  WHERE e.academic_year_id = y.id AND e.status = 'enrolled') AS enrolled,
                (SELECT count(*)::int FROM enrollments a
                  WHERE a.academic_year_id = y.id AND a.status = 'archived') AS archived
           FROM academic_years y
          ORDER BY y.start_year DESC`,
      );
      return rows;
    });
  }

  /**
   * RENDRE UNE ANNÉE ACTIVE — son action `activer`.
   *
   * ⚠ UNE SEULE ANNÉE ACTIVE À LA FOIS, et c'est pour cela que l'ancienne
   * redescend dans la même transaction. Deux années actives et `annee_active()`
   * en choisit une au hasard : les encaissements du jour partiraient sur l'une
   * et les inscriptions sur l'autre.
   *
   * ⚠ ET CE N'EST PAS UNE CLÔTURE. Rien n'est archivé, rien n'est vidé ; on
   * déplace seulement l'année de travail. Sa confirmation le dit à l'écran :
   * « Rendre <année> active ? », sans autre avertissement.
   */
  async activate(id: string, actorId: string): Promise<AcademicYear> {
    const { schoolId } = currentTenant();
    const year = await this.byId(id);
    if (year.status === 'active') return year;
    if (year.status === 'closed') {
      // Son `refus_annee_close()` et la phrase de son action `activer`.
      throw new ConflictException(
        `L'année ${year.label} est clôturée : ses écritures ne peuvent plus être modifiées. ` +
          "Sa réouverture n'est pas une opération de routine : elle doit être décidée et faite en base, en connaissance de cause.",
      );
    }

    return this.db.query(async (tx) => {
      /*
       * DÉCISION DU PROPRIÉTAIRE (18/09) — les statuts disent l'histoire :
       * une année ANTÉRIEURE à celle qu'on active est terminée, pas « à
       * venir » (c'est ce que faisait son `UPDATE … SET statut='future' WHERE
       * statut='active'`, et « l'ancienne année passait en À venir »). Rendre
       * active l'année suivante clôture donc l'année en cours — ses
       * inscriptions sont archivées, sa date de clôture posée — exactement
       * comme « Clôturer ». Revenir sur une année antérieure encore ouverte
       * (une année « à venir » plus ancienne, cas d'une activation par
       * erreur) ne clôture rien : l'ultérieure redevient « à venir ».
       */
      // Verrou : deux activations simultanées laissaient deux années actives.
      await tx.query('SELECT 1 FROM academic_years FOR UPDATE');
      const { rows: actives } = await tx.query<AcademicYear>(
        `SELECT id, label, start_year, start_month, end_month, status, closed_at
           FROM academic_years WHERE status = 'active' AND id <> $1`,
        [id],
      );
      const clotures: string[] = [];
      for (const a of actives) {
        if (a.start_year < year.start_year) {
          await tx.query(
            `UPDATE enrollments SET status = 'archived'
              WHERE academic_year_id = $1 AND status <> 'cancelled'`,
            [a.id],
          );
          await tx.query(
            `UPDATE academic_years SET status = 'closed', closed_at = now() WHERE id = $1`,
            [a.id],
          );
          clotures.push(a.label);
        } else {
          await tx.query(`UPDATE academic_years SET status = 'future' WHERE id = $1`, [a.id]);
        }
      }
      const { rows } = await tx.query<AcademicYear>(
        `UPDATE academic_years SET status = 'active' WHERE id = $1
         RETURNING id, label, start_year, start_month, end_month, status, closed_at`,
        [id],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'academic_year_activated',
          entity: 'academic_year',
          entityId: id,
          after: { label: year.label, closed: clotures.join(', ') || null },
        },
        tx,
      );
      return rows[0]!;
    });
  }

  /**
   * MODIFIER LA PÉRIODE D'UNE ANNÉE — son action `modifier_mois`, les deux
   * sélecteurs et le « ✓ » de chaque ligne.
   *
   * ⚠ REFUSÉ SUR UNE ANNÉE CLÔTURÉE. Déplacer le premier ou le dernier mois
   * change quels mois sont facturables, donc ce que chaque famille doit — sur
   * une année close, cela réécrirait des dettes déjà soldées.
   */
  async setPeriod(
    id: string,
    startMonth: number,
    endMonth: number,
    actorId: string,
  ): Promise<AcademicYear> {
    const { schoolId } = currentTenant();
    const year = await this.byId(id);
    if (year.status === 'closed') {
      throw new ConflictException(
        `L'année ${year.label} est clôturée : ses écritures ne peuvent plus être modifiées.`,
      );
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<AcademicYear>(
        `UPDATE academic_years SET start_month = $2, end_month = $3 WHERE id = $1
         RETURNING id, label, start_year, start_month, end_month, status, closed_at`,
        [id, startMonth, endMonth],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'academic_year_period_changed',
          entity: 'academic_year',
          entityId: id,
          before: { start_month: String(year.start_month), end_month: String(year.end_month) },
          after: { start_month: String(startMonth), end_month: String(endMonth) },
        },
        tx,
      );
      return rows[0]!;
    });
  }

  async byId(id: string): Promise<AcademicYear> {
    const year = await this.db.query(async (tx) => {
      const { rows } = await tx.query<AcademicYear>(
        `SELECT id, label, start_year, start_month, end_month, status, closed_at
           FROM academic_years WHERE id = $1`,
        [id],
      );
      return rows[0];
    });
    if (!year) throw new NotFoundException('Année scolaire introuvable.');
    return year;
  }

  /** The year currently open for business. There is at most one. */
  async active(): Promise<AcademicYear | null> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<AcademicYear>(
        `SELECT id, label, start_year, start_month, end_month, status, closed_at
           FROM academic_years WHERE status = 'active' LIMIT 1`,
      );
      return rows[0] ?? null;
    });
  }

  /**
   * The year the UI should open on.
   *
   * NOT the administratively active one. In August the new year has just opened
   * and nobody is re-enrolled yet; opening on it makes the whole application look
   * empty, as though the data had been lost. So: the most recent year that
   * actually has enrolments, falling back to the active one.
   */
  async defaultView(): Promise<AcademicYear | null> {
    // ⚠ UNE SEULE SOURCE DE VÉRITÉ : L'ANNÉE ACTIVE (décision du propriétaire,
    // 18/09). Son `annee_defaut()` préférait « l'année la plus récente qui a
    // des inscriptions », si bien qu'une année qu'on venait d'activer, encore
    // vide, n'était suivie par aucun tableau de bord ni aucune page. L'année
    // avec des données ne sert plus que de repli quand aucune n'est active.
    const active = await this.active();
    if (active) return active;
    const withData = await this.db.query(async (tx) => {
      const { rows } = await tx.query<AcademicYear>(
        `SELECT y.id, y.label, y.start_year, y.start_month, y.end_month, y.status, y.closed_at
           FROM academic_years y
           JOIN enrollments e ON e.academic_year_id = y.id AND e.status <> 'cancelled'
          GROUP BY y.id
          ORDER BY y.start_year DESC
          LIMIT 1`,
      );
      return rows[0] ?? null;
    });
    return withData;
  }

  /**
   * THE YEAR A PARENT IS SHOWN — `parent_annee_visible_id()`.
   *
   * ⚠ THE ACTIVE YEAR, WITH NO FALLBACK OF ANY KIND. `defaultView()` falls back
   * to the most recent year that HAS enrolments, which is right for the office
   * and wrong for a family: in the gap between one year closing and the next
   * opening it would hand a parent June's absences and June's marks as though
   * the term were running.
   *
   * El Ourwa is explicit about it — "page vide, et SURTOUT sans se rabattre sur
   * l'annee precedente" — and the emphasis is theirs. A family reading "3
   * absences ce trimestre" about a trimester that ended in June is being told
   * something false, and they have no way to know it.
   *
   * Null means the app shows its empty state. That is the correct answer, not a
   * failure to find one.
   */
  async activeForParent(): Promise<AcademicYear | null> {
    return this.active();
  }

  /**
   * LES DATES QU'UNE ANNÉE POSSÈDE — pour ce qui n'a qu'une date et aucune
   * colonne d'année : les absences et les remarques.
   *
   * ⚠ PAS SES MOIS NOMINAUX. L'année 2026-2027 « commence » en octobre ; la
   * rentrée existe pourtant, et les absences et remarques de septembre,
   * bornées à octobre–juin, disparaissaient de l'application des familles
   * alors que la notification venait d'arriver (démonstration, 23/09/2026 :
   * une absence du 23/09 saisie sous l'année active, onglet Absences vide,
   * carte de l'enfant à zéro).
   *
   * Une année possède tout ce qui va du lendemain de la fin de l'année
   * précédente à la veille du début de la suivante — c'est-à-dire : ses mois,
   * plus l'été et la rentrée qui la précèdent. Aucune date ne tombe entre
   * deux années, aucune n'appartient à deux. Sans précédente, l'année
   * commence à l'été qui précède sa rentrée ; sans suivante, elle est ouverte
   * (`infinity`, que Postgres compare comme une date).
   */
  async periodeAttribuee(year: {
    id: string;
    start_year: number;
    start_month: number;
    end_month: number;
  }): Promise<[string, string]> {
    const voisines = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ start_year: number; start_month: number; end_month: number; status: string }>(
        'SELECT start_year, start_month, end_month, status FROM academic_years WHERE id <> $1',
        [year.id],
      );
      return rows;
    });
    const [, finNominale] = moisNominaux(year);
    // Sans année précédente : depuis l'été qui précède la rentrée — le lendemain
    // de ce qu'aurait été la fin de l'année d'avant (juillet), pas tout le
    // passé : une absence de 2024 n'est pas de l'année 2025-2026 parce que
    // l'école n'a pas saisi 2024-2025 ici (parent-home.spec). Sans suivante :
    // ouvert — la dernière année possède tout ce qui vient après, jusqu'à ce
    // qu'une autre s'ouvre.
    let debut = decalerJour(moisNominaux({ ...year, start_year: year.start_year - 1 })[1], 1);
    let fin = 'infinity';
    for (const v of voisines) {
      const [vDebut, vFin] = moisNominaux(v);
      if (v.start_year < year.start_year) {
        // La précédente : on commence le lendemain de sa fin.
        const lendemain = decalerJour(vFin, 1);
        if (lendemain > debut) debut = lendemain;
      } else if (v.start_year > year.start_year && v.status !== 'future') {
        // ⚠ Une année seulement CRÉÉE (« future ») ne referme rien : l'école
        // prépare 2026-2027 en juin, saisit encore sous 2025-2026 en septembre
        // — ces absences appartiennent à l'année active tant que la suivante
        // n'est pas ouverte, et passent à celle-ci quand elle l'est.
        // Une suivante existe : l'année s'arrête à sa propre fin nominale (la
        // suivante prend le relais dès le lendemain) — et jamais après la
        // veille du début de la suivante si les deux se chevauchent.
        const veille = decalerJour(vDebut, -1);
        const borne = veille < finNominale ? veille : finNominale;
        if (fin === 'infinity' || borne < fin) fin = borne;
      }
    }
    return [debut, fin];
  }

  async create(input: {
    startYear: number;
    startMonth?: number;
    endMonth?: number;
  }): Promise<AcademicYear> {
    const startMonth = input.startMonth ?? 10;
    const endMonth = input.endMonth ?? 6;
    const label = `${input.startYear}-${input.startYear + 1}`;
    const { schoolId } = currentTenant();

    const existing = await this.db.query(async (tx) => {
      const { rows } = await tx.query(
        'SELECT 1 FROM academic_years WHERE start_year = $1',
        [input.startYear],
      );
      return rows[0];
    });
    if (existing) throw new ConflictException(`L’année ${label} existe déjà.`);

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<AcademicYear>(
        `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, label, start_year, start_month, end_month, status, closed_at`,
        [schoolId, label, input.startYear, startMonth, endMonth],
      );
      return rows[0]!;
    });
  }

  /**
   * ⚠ A CLOSED YEAR IS READ-ONLY.
   *
   * A closed year has settled accounts: receipts handed to families, report cards
   * distributed, debts squared. Writing into it — a payment, an exemption, a
   * discount, an added or removed payable month, a grade — rewrites what the
   * school has already declared. That is the most serious corruption available
   * here, because it is silent and retroactive.
   *
   * Every write path that touches a year calls this first.
   */
  async assertWritable(academicYearId: string): Promise<AcademicYear> {
    const year = await this.byId(academicYearId);
    if (year.status === 'closed') {
      throw new BadRequestException(
        `L’année ${year.label} est clôturée : ses comptes sont arrêtés et ne peuvent plus être modifiés.`,
      );
    }
    return year;
  }

  /**
   * The year you are allowed to enrol into.
   *
   * Deliberately no fallback. El Ourwa's `annee_active()` fell back to the newest
   * row when nothing was marked active — which is a FUTURE year — and the
   * enrolment screens used it as their target. Students could be enrolled into a
   * year that had not started, or, if the ordering shifted, into a closed one.
   */
  async enrolmentTarget(): Promise<AcademicYear> {
    const year = await this.active();
    if (!year) {
      throw new BadRequestException(
        'Aucune année scolaire n’est ouverte. Ouvrez-en une avant d’inscrire qui que ce soit.',
      );
    }
    return year;
  }

  /** The payable months of a year, in order. */
  months(year: AcademicYear) {
    const shape: AcademicYearShape = {
      startYear: year.start_year,
      startMonth: year.start_month,
      endMonth: year.end_month,
    };
    return payableMonths(shape);
  }

  /**
   * LES MOIS PAYABLES, with the year's own selection applied.
   *
   * ⚠ A RANGE CANNOT EXPRESS A SKIPPED MONTH, and El Ourwa's model is a set:
   * `annee_scolaire_mois`, one row per ticked month, with a page whose only job
   * is ticking them. A school that does not bill for Ramadan, or opens late
   * after building works, has no way to say so with two numbers — and every
   * enrolment's schedule is generated from this, so the gap becomes a month of
   * fees invented for every family at once.
   *
   * ⚠ EMPTY MEANS THE RANGE, NOT "NO MONTHS". A year nobody has configured must
   * keep behaving exactly as it does today. The set is an override; its absence
   * is not a school that bills nothing.
   */
  async payableMonthsFor(year: AcademicYear) {
    return this.db.query((tx) => this.payableMonthsIn(tx, year));
  }

  /**
   * La même sélection, lue dans une transaction déjà ouverte — celle d'une
   * inscription qui écrit aussi l'échéancier de ses services — sans prendre une
   * seconde connexion à la pile pendant qu'elle en tient une.
   */
  async payableMonthsIn(tx: Queryable, year: AcademicYear) {
    const all = this.months(year);
    const { rows } = await tx.query<{ calendar_month: number }>(
      'SELECT calendar_month FROM academic_year_months WHERE academic_year_id = $1',
      [year.id],
    );
    const chosen = rows.map((r) => r.calendar_month);
    if (chosen.length === 0) return all;
    return all.filter((m) => chosen.includes(m.month));
  }

  /** Read the selection as it stands, for the screen that edits it. */
  async selectedMonths(academicYearId: string): Promise<number[]> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ calendar_month: number }>(
        `SELECT calendar_month FROM academic_year_months
          WHERE academic_year_id = $1 ORDER BY calendar_month`,
        [academicYearId],
      );
      return rows.map((r) => r.calendar_month);
    });
  }

  /**
   * Set it, replacing the year's list wholesale.
   *
   * ⚠ REFUSED ON A CLOSED YEAR. The months decide what every family was billed;
   * re-deciding them for a settled year rewrites history that receipts already
   * describe.
   *
   * ⚠ AND EXISTING SCHEDULES ARE NOT REBUILT HERE. A month already invoiced or
   * already paid must not vanish because somebody unticked it afterwards — that
   * would delete a debt, or an obligation somebody has already met, without a
   * reversing entry. The selection governs schedules built FROM NOW ON, and the
   * screen says so.
   */
  async setMonths(
    academicYearId: string,
    months: number[],
    actorId: string,
  ): Promise<{ months: number[] }> {
    const { schoolId } = currentTenant();
    const year = await this.assertWritable(academicYearId);
    const unique = [...new Set(months.filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);

    await this.db.query(async (tx) => {
      await tx.query('DELETE FROM academic_year_months WHERE academic_year_id = $1', [
        academicYearId,
      ]);
      for (const m of unique) {
        await tx.query(
          `INSERT INTO academic_year_months (school_id, academic_year_id, calendar_month)
           VALUES ($1, $2, $3)`,
          [schoolId, academicYearId, m],
        );
      }
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'academic_year_months_set',
          entity: 'academic_year',
          entityId: academicYearId,
          after: {
            year: year.label,
            months: unique.join(',') || 'plage par défaut',
          },
        },
        tx,
      );
    });

    return { months: unique };
  }

  /**
   * Close a year: archive its enrolments, open the next.
   *
   * Nothing is deleted. Grades, payments and report cards stay readable by
   * selecting the year. The next year simply has no enrolments until
   * re-enrolment is done — that is where the rule lives, not in wiping anything.
   */
  async close(id: string, actorId: string): Promise<{ archived: number; next: AcademicYear }> {
    const { schoolId } = currentTenant();
    const year = await this.byId(id);
    if (year.status === 'closed') {
      throw new ConflictException(`L'année ${year.label} est déjà clôturée.`);
    }
    // ⚠ Seule l'année ACTIVE se clôture. Clôturer une année « à venir » (le
    // site cache le bouton, l'API acceptait) n'archivait rien mais rendait
    // active la suivante sans toucher à l'année en cours : deux actives.
    if (year.status !== 'active') {
      throw new ConflictException(`L'année ${year.label} n'est pas l'année en cours : rendez-la active avant de la clôturer.`);
    }

    return this.db.query(async (tx) => {
      await tx.query('SELECT 1 FROM academic_years FOR UPDATE');
      const archived = await tx.query(
        `UPDATE enrollments SET status = 'archived'
          WHERE academic_year_id = $1 AND status <> 'cancelled'`,
        [id],
      );
      await tx.query(
        `UPDATE academic_years SET status = 'closed', closed_at = now() WHERE id = $1`,
        [id],
      );

      const nextStart = year.start_year + 1;
      const found = await tx.query<AcademicYear>(
        `SELECT id, label, start_year, start_month, end_month, status, closed_at
           FROM academic_years WHERE start_year = $1`,
        [nextStart],
      );

      let next: AcademicYear;
      if (found.rows[0]) {
        const promoted = await tx.query<AcademicYear>(
          `UPDATE academic_years SET status = 'active' WHERE id = $1
           RETURNING id, label, start_year, start_month, end_month, status, closed_at`,
          [found.rows[0].id],
        );
        next = promoted.rows[0]!;
      } else {
        const created = await tx.query<AcademicYear>(
          `INSERT INTO academic_years
             (school_id, label, start_year, start_month, end_month, status)
           VALUES ($1, $2, $3, $4, $5, 'active')
           RETURNING id, label, start_year, start_month, end_month, status, closed_at`,
          [schoolId, `${nextStart}-${nextStart + 1}`, nextStart, year.start_month, year.end_month],
        );
        next = created.rows[0]!;
      }

      await this.audit.record({
        actorId,
        schoolId,
        action: 'academic_year_closed',
        entity: 'academic_year',
        entityId: id,
        after: { archived: archived.rowCount, opened: next.label },
      }, tx);

      return { archived: archived.rowCount ?? 0, next };
    });
  }
}

/**
 * Les mois nominaux d'une année : du 1er du mois d'ouverture au dernier jour du
 * mois de clôture. 2025-2026 avec 10 → 6 court du 1er octobre 2025 au 30 juin
 * 2026 : janvier à juin sont dans la SECONDE année civile.
 */
export function moisNominaux(year: {
  start_year: number;
  start_month: number;
  end_month: number;
}): [string, string] {
  const startMonth = year.start_month || 10;
  const endMonth = year.end_month || 6;
  const endYear = endMonth >= startMonth ? year.start_year : year.start_year + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return [`${year.start_year}-${pad(startMonth)}-01`, `${endYear}-${pad(endMonth)}-${pad(lastDay)}`];
}

function decalerJour(iso: string, jours: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}
