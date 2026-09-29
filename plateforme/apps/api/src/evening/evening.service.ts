import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { money, sum, toStorage } from '@elourwa/shared';

/** Son `number_format($x, 0, ',', ' ') . ' MRU'`. */
function mru0(x: Decimal | string | number): string {
  const n = Math.round(Number(new Decimal(x).toFixed(2)));
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} MRU`;
}
import type { Queryable } from '@elourwa/db';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenderService } from '../finance/tender.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

export interface EveningTenderLine {
  paymentMethodId: string;
  amount: string;
}

export interface PayTeacherInput {
  eveningTeachingId: string;
  calendarMonth: number;
  calendarYear: number;
  /** How the money left. Must sum to what is being paid. */
  tender: EveningTenderLine[];
}

export interface EnrolInput {
  eveningGroupId: string;
  /** A school student … */
  studentId?: string;
  /** … or an outsider, who has a name and a phone and nothing else. */
  outsiderName?: string;
  outsiderPhone?: string;
  outsiderSex?: 'M' | 'F';
}

/**
 * Cours du soir — a second business sharing a login.
 *
 * Kept deliberately separate from the day school: its enrolees may not be
 * students, its teachers may not be staff, and its money must stay separable in
 * every report.
 */
@Injectable()
export class EveningService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenderService) private readonly tender: TenderService,
  ) {}

  async groups() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT g.id, g.name, g.monthly_rate, g.description, g.is_active,
                (SELECT count(*)::int FROM evening_enrolments e
                  WHERE e.evening_group_id = g.id) AS headcount,
                (SELECT count(*)::int FROM evening_enrolments e
                  WHERE e.evening_group_id = g.id AND e.student_id IS NULL) AS outsiders
           FROM evening_groups g
          ORDER BY g.is_active DESC, g.name`,
      );
      return rows;
    });
  }

  /**
   * UN PROFESSEUR EXTERNE — `cs_profs_externes`.
   *
   * ⚠ THE TABLE EXISTED, THE SCREEN SHOWED "Interne / Externe", AND NOTHING
   * COULD CREATE ONE. `evening_teachings` already carries the either/or —
   * `teacher_id` for a day-school teacher, `evening_teacher_id` for someone who
   * exists only for the evening school — and the professeurs page already
   * labels the two. There was simply no write path, so every evening teacher
   * had to be a member of the day staff.
   *
   * That is the whole point of the distinction: evening classes are taught by
   * people the school does not employ by day, and putting them on the staff
   * roll to pay them would put them into the payroll, the headcount and the
   * statistics they do not belong in.
   */
  async createExternalTeacher(
    input: { firstName: string; lastName: string; phone?: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO evening_teachers (school_id, first_name, last_name, phone)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [schoolId, input.firstName, input.lastName, input.phone ?? null],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_teacher_created',
          entity: 'evening_teacher',
          entityId: rows[0]!.id,
          after: { name: `${input.firstName} ${input.lastName}`.trim() },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /**
   * ASSIGNER UN PROFESSEUR À UN GROUPE — `cours_du_soir.php`, `assigner_prof`.
   *
   * ⚠ `evening_teachings` WAS READ AND NEVER WRITTEN. The payroll query reads
   * it, the teacher payments hang off it, the whole "Paiement des Professeurs"
   * tab is built on it — and nothing in the application could put a row in. So
   * that tab was permanently empty and no evening class could ever have a
   * teacher at all.
   *
   * ⚠ EL OURWA'S OWN HANDLER HAD A MUTE BRANCH and says so: with no teacher
   * chosen the condition was false, there was no `else`, and the form came back
   * with no message, no error and nothing saved — "exactement le symptome « je
   * clique Enregistrer et il ne se passe rien »". Every refusal here names the
   * field.
   *
   * ⚠ THE PAY KIND CLEARS THE OTHER SIDE. An hourly teaching stores no fixed
   * salary and a fixed one stores no rate or hours: leaving the other behind
   * would double-count the moment somebody reads the wrong column, and this is
   * a salary.
   */
  async assignTeacher(
    input: {
      eveningGroupId: string;
      teacherId?: string;
      eveningTeacherId?: string;
      subject: string;
      payKind: 'hourly' | 'fixed';
      hourlyRate?: string;
      hoursPerMonth?: number;
      fixedSalary?: string;
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();

    // ⚠ Its own message, and its own reason: "Sans matiere, l'affectation
    // n'apparait dans aucun menu de la grille : la placer deviendrait
    // impossible."
    const subject = input.subject.trim();
    if (!subject) throw new BadRequestException('Indiquez la matière enseignée.');

    const internal = input.teacherId ?? null;
    const external = input.eveningTeacherId ?? null;
    if (!internal && !external) {
      throw new BadRequestException("Sélectionnez un professeur : de l'école, ou externe.");
    }
    if (internal && external) {
      throw new BadRequestException(
        "Un seul professeur par assignation : de l'école, ou externe — pas les deux.",
      );
    }

    const hourly = input.payKind === 'hourly';
    const rate = hourly ? (input.hourlyRate ?? '0').trim() : '0';
    const hours = hourly ? Math.max(0, Math.trunc(input.hoursPerMonth ?? 0)) : 0;
    const salary = hourly ? '0' : (input.fixedSalary ?? '0').trim();

    for (const [label, value] of [['Le tarif horaire', rate], ['Le salaire', salary]] as const) {
      if (!/^\d+(\.\d{1,2})?$/.test(value)) {
        throw new BadRequestException(`${label} doit être un montant positif.`);
      }
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO evening_teachings
           (school_id, evening_group_id, teacher_id, evening_teacher_id, subject,
            pay_kind, hourly_rate, hours_per_month, fixed_salary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          schoolId, input.eveningGroupId, internal, external, subject,
          input.payKind, rate, hours, salary,
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_teaching_assigned',
          entity: 'evening_teaching',
          entityId: rows[0]!.id,
          after: { subject, pay_kind: input.payKind, rate, hours: String(hours), salary },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /** RETIRER — its `retirer_prof`. */
  async removeTeaching(teachingId: string, actorId: string): Promise<void> {
    const { schoolId } = currentTenant();
    await this.db.query(async (tx) => {
      /*
       * ⚠ ELLE EFFAÇAIT LES SALAIRES DÉJÀ VERSÉS.
       *
       * `evening_teacher_payments.evening_teaching_id` est en `ON DELETE
       * CASCADE` : retirer l'assignation emportait toute trace de ce qu'on avait
       * payé au professeur. L'argent était sorti de la caisse, et les livres
       * disaient qu'il n'était jamais sorti — le reproche exact que porte le
       * commentaire d'`annuler_paiement_prof_cs`, quelques centaines de lignes
       * plus bas, contre la façon de faire d'El Ourwa.
       *
       * Les écritures financières sont append-only (règle 7). Une assignation
       * payée se corrige, elle ne se supprime pas.
       */
      const { rows: payes } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM evening_teacher_payments WHERE evening_teaching_id = $1',
        [teachingId],
      );
      const nb = Number(payes[0]!.n);
      if (nb > 0) {
        throw new ConflictException(
          `Cette assignation ne peut pas être supprimée : ${nb} paiement(s) de ` +
            'salaire y sont rattachés et seraient effacés avec elle. Corrigez son ' +
            'taux ou ses heures, ou annulez d’abord les paiements — une sortie de ' +
            'caisse ne s’efface pas.',
        );
      }

      const { rows } = await tx.query<{ subject: string }>(
        'DELETE FROM evening_teachings WHERE id = $1 RETURNING subject',
        [teachingId],
      );
      if (rows.length === 0) throw new NotFoundException('Assignation introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_teaching_removed',
          entity: 'evening_teaching',
          entityId: teachingId,
          before: { subject: rows[0]!.subject },
        },
        tx,
      );
    });
  }

  // ── LA GRILLE DES CRÉNEAUX ───────────────────────────────────

  /** Les sept jours et les sept créneaux de sa grille, dans son ordre. */
  static readonly DAYS = 7;
  static readonly SLOTS = 7;

  /**
   * L'EMPLOI DU TEMPS D'UN GROUPE — sa « Grille des créneaux ».
   *
   * ⚠ LE NOM DU PROFESSEUR VIENT DE L'ASSIGNATION, PAS DE LA CASE. Sa table
   * `cs_emploi` recopie `professeur_id` à côté de `cs_enseignement_id` ; deux
   * copies de la même chose divergent dès qu'on touche à l'une. Ici la case
   * pointe l'assignation et le nom se lit par la jointure — renommer un
   * professeur met la grille à jour toute seule.
   */
  async timetable(eveningGroupId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        day_of_week: number;
        slot: number;
        subject: string;
        evening_teaching_id: string | null;
        teacher_name: string | null;
      }>(
        `SELECT s.id, s.day_of_week, s.slot, s.subject, s.evening_teaching_id,
                COALESCE(
                  t.first_name  || ' ' || t.last_name,
                  et.first_name || ' ' || et.last_name
                ) AS teacher_name
           FROM evening_timetable_slots s
           LEFT JOIN evening_teachings te ON te.id = s.evening_teaching_id
           LEFT JOIN teachers t           ON t.id  = te.teacher_id
           LEFT JOIN evening_teachers et  ON et.id = te.evening_teacher_id
          WHERE s.evening_group_id = $1
          ORDER BY s.day_of_week, s.slot`,
        [eveningGroupId],
      );

      return rows.map((r) => ({
        id: r.id,
        dayOfWeek: r.day_of_week,
        slot: r.slot,
        subject: r.subject,
        eveningTeachingId: r.evening_teaching_id,
        // Un tiret dans sa grille, `null` ici : « à définir plus tard ».
        teacherName: r.teacher_name,
      }));
    });
  }

  /**
   * POSER UN CRÉNEAU — `cours_du_soir.php`, action `placer_creneau`.
   *
   * ⚠ LA MATIÈRE DOIT ÊTRE L'UNE DE CELLES CRÉÉES POUR CE GROUPE, et le refus est
   * le sien, mot pour mot : "Cette matiere n'existe pas dans ce groupe :
   * creez-la d'abord en assignant un professeur." Une matière naît d'une
   * assignation ; une saisie libre poserait à la grille un cours que personne
   * ne donne et que la paie ne connaît pas.
   *
   * ⚠ L'ENSEIGNANT EST FACULTATIF (« Aucun / à définir plus tard ») MAIS DOIT
   * ÊTRE DE CE GROUPE : "Cet enseignant n'est pas assigne a ce groupe."
   *
   * ⚠ SANS MATIÈRE SAISIE, CELLE DE L'ASSIGNATION FAIT FOI — son
   * `if ($matiere_case === '') { $matiere_case = $ens['matiere']; }`.
   *
   * ⚠ ET POSER SUR UNE CASE OCCUPÉE LA REMPLACE. Son action fait DELETE puis
   * INSERT ; l'unique (groupe, jour, créneau) porte la même règle et l'UPSERT
   * la respecte sans fenêtre de course entre les deux.
   */
  async placeSlot(
    input: {
      eveningGroupId: string;
      dayOfWeek: number;
      slot: number;
      subject?: string;
      eveningTeachingId?: string;
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    const { eveningGroupId, dayOfWeek, slot } = input;

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > EveningService.DAYS) {
      throw new BadRequestException('Jour hors de la grille.');
    }
    if (!Number.isInteger(slot) || slot < 1 || slot > EveningService.SLOTS) {
      throw new BadRequestException('Créneau hors de la grille.');
    }

    const chosen = (input.subject ?? '').trim();
    const teachingId = input.eveningTeachingId ?? null;

    if (!chosen && !teachingId) {
      throw new BadRequestException(
        'Données du créneau invalides : choisissez au moins une matière ou un enseignant.',
      );
    }

    return this.db.query(async (tx) => {
      // Les matières du groupe — celles de ses assignations, et rien d'autre.
      const { rows: subjects } = await tx.query<{ subject: string }>(
        `SELECT DISTINCT subject FROM evening_teachings
          WHERE evening_group_id = $1 AND btrim(subject) <> ''`,
        [eveningGroupId],
      );
      const known = new Set(subjects.map((r) => r.subject));

      if (chosen && !known.has(chosen)) {
        throw new BadRequestException(
          "Cette matière n'existe pas dans ce groupe : créez-la d'abord en assignant " +
            'un professeur (section « Assigner un professeur »).',
        );
      }

      let subject = chosen;

      if (teachingId) {
        const { rows } = await tx.query<{ subject: string }>(
          'SELECT subject FROM evening_teachings WHERE id = $1 AND evening_group_id = $2',
          [teachingId, eveningGroupId],
        );
        if (rows.length === 0) {
          throw new BadRequestException("Cet enseignant n'est pas assigné à ce groupe.");
        }
        if (!subject) subject = rows[0]!.subject.trim();
      }

      if (!subject) {
        throw new BadRequestException(
          "Choisissez une matière (ou un enseignant dont l'assignation a une matière).",
        );
      }

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO evening_timetable_slots
           (school_id, evening_group_id, day_of_week, slot, subject, evening_teaching_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (school_id, evening_group_id, day_of_week, slot)
         DO UPDATE SET subject = EXCLUDED.subject,
                       evening_teaching_id = EXCLUDED.evening_teaching_id
         RETURNING id`,
        [schoolId, eveningGroupId, dayOfWeek, slot, subject, teachingId],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_slot_placed',
          entity: 'evening_group',
          entityId: eveningGroupId,
          after: { subject, day: String(dayOfWeek), slot: String(slot) },
        },
        tx,
      );

      return { id: rows[0]!.id, subject, dayOfWeek, slot };
    });
  }

  /**
   * LIBÉRER UN CRÉNEAU — son `effacer_creneau`, et son message : « Créneau
   * libéré. » Une case vide n'est pas une erreur : sa version supprime sans
   * vérifier, et deux clics sur le même bouton ne doivent pas produire de refus.
   */
  async clearSlot(eveningGroupId: string, dayOfWeek: number, slot: number, actorId: string) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ subject: string }>(
        `DELETE FROM evening_timetable_slots
          WHERE evening_group_id = $1 AND day_of_week = $2 AND slot = $3
        RETURNING subject`,
        [eveningGroupId, dayOfWeek, slot],
      );

      if (rows.length > 0) {
        await this.audit.record(
          {
            actorId,
            schoolId,
            action: 'evening_slot_cleared',
            entity: 'evening_group',
            entityId: eveningGroupId,
            before: { subject: rows[0]!.subject, day: String(dayOfWeek), slot: String(slot) },
          },
          tx,
        );
      }

      return { cleared: rows.length };
    });
  }

  /**
   * PROFESSEURS ASSIGNÉS — the group's own table.
   *
   * Professeur · Matière · Mode de paiement · Détails · Gain mensuel. The
   * monthly figure is computed in SQL as NUMERIC: it is what the school pays,
   * and a JS float has no business in it.
   */
  async teachingsForGroup(eveningGroupId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        teacher_name: string;
        internal: boolean;
        subject: string;
        pay_kind: string;
        hourly_rate: string;
        hours_per_month: number;
        fixed_salary: string;
        monthly_pay: string;
      }>(
        `SELECT et.id,
                COALESCE(
                  btrim(t.first_name || ' ' || t.last_name),
                  btrim(ev.first_name || ' ' || ev.last_name),
                  ''
                ) AS teacher_name,
                (et.teacher_id IS NOT NULL) AS internal,
                et.subject, et.pay_kind,
                et.hourly_rate::text, et.hours_per_month, et.fixed_salary::text,
                CASE WHEN et.pay_kind = 'fixed' THEN et.fixed_salary
                     ELSE et.hourly_rate * et.hours_per_month
                END::numeric(14,2)::text AS monthly_pay
           FROM evening_teachings et
           LEFT JOIN teachers t ON t.id = et.teacher_id
           LEFT JOIN evening_teachers ev ON ev.id = et.evening_teacher_id
          WHERE et.evening_group_id = $1
          ORDER BY teacher_name, et.subject`,
        [eveningGroupId],
      );
      return rows.map((r) => ({
        id: r.id,
        teacherName: r.teacher_name,
        internal: r.internal,
        subject: r.subject,
        payKind: r.pay_kind,
        hourlyRate: r.hourly_rate,
        hoursPerMonth: r.hours_per_month,
        fixedSalary: r.fixed_salary,
        monthlyPay: r.monthly_pay,
      }));
    });
  }

  /** Every evening-only teacher, for the assignment picker. */
  async externalTeachers() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, first_name, last_name, phone
           FROM evening_teachers ORDER BY last_name, first_name`,
      );
      return rows;
    });
  }

  async createGroup(
    input: { name: string; monthlyRate: string; description?: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; name: string }>(
        `INSERT INTO evening_groups (school_id, name, monthly_rate, description)
         VALUES ($1, $2, $3, $4) RETURNING id, name`,
        [schoolId, input.name, input.monthlyRate, input.description ?? null],
      );
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_group_created',
          entity: 'evening_group',
          entityId: rows[0]!.id,
          after: { name: input.name, rate: input.monthlyRate },
        },
        tx,
      );
      return rows[0]!;
    });
  }

  /** Who is in a group — students and outsiders in one list, clearly marked. */
  async roster(eveningGroupId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT e.id, e.student_id, e.outsider_name, e.outsider_phone, e.enrolled_at,
                s.first_name, s.last_name,
                COALESCE(
                  NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), ''),
                  e.outsider_name
                ) AS display_name,
                (e.student_id IS NULL) AS is_outsider
           FROM evening_enrolments e
           LEFT JOIN students s ON s.id = e.student_id
          WHERE e.evening_group_id = $1
          ORDER BY display_name`,
        [eveningGroupId],
      );
      return rows;
    });
  }

  /**
   * Enrol someone.
   *
   * The outsider path is the one that matters: a walk-in adult has no RIM, no
   * national id, no guardian and no level, and must never appear in a class
   * roster or a headcount for the day school.
   */
  /**
   * MODIFIER UN GROUPE — its `modifier_groupe`.
   *
   * ⚠ A GROUP COULD BE CREATED AND NEVER CORRECTED. Its name, its monthly rate
   * and its description were fixed at creation, so a rate typed wrong was what
   * every enrolee in that group was billed for the whole year with no way back.
   *
   * ⚠ THE RATE IS FOR THE NEXT ENROLMENT, not a retroactive edit — the same
   * rule as a level's monthly rate. `evening_enrolments` copies nothing from
   * here, so an existing enrolee is untouched; chasing them would rewrite what
   * families already owe.
   */
  async updateGroup(
    groupId: string,
    input: { name: string; monthlyRate: string; description?: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();

    const name = input.name.trim();
    if (name.length < 2) {
      throw new BadRequestException('Le nom du groupe est trop court.');
    }
    const rate = input.monthlyRate.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(rate)) {
      throw new BadRequestException('Le tarif mensuel doit être un montant positif.');
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ name: string }>(
        `UPDATE evening_groups SET name = $2, monthly_rate = $3, description = $4
          WHERE id = $1 RETURNING name`,
        [groupId, name, rate, input.description?.trim() || null],
      );
      if (rows.length === 0) throw new NotFoundException('Groupe de cours du soir introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_group_updated',
          entity: 'evening_group',
          entityId: groupId,
          after: { name, monthly_rate: rate },
        },
        tx,
      );
      return { id: groupId, name };
    });
  }

  /**
   * SUPPRIMER UN GROUPE — its `supprimer_groupe`.
   *
   * ⚠ ITS VERSION IS A BARE DELETE, and the enrolments, the payments and the
   * teachings all cascade behind it. Deleting a group of the evening school
   * therefore destroys its accounting.
   *
   * Refused once anybody has been enrolled — the same judgement El Ourwa reached
   * for day-school classes, and wrote a long comment about, applied to the case
   * it did not revisit.
   */
  async deleteGroup(groupId: string, actorId: string): Promise<void> {
    const { schoolId } = currentTenant();

    await this.db.query(async (tx) => {
      const { rows: counts } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM evening_enrolments WHERE evening_group_id = $1',
        [groupId],
      );
      const nb = Number(counts[0]!.n);
      if (nb > 0) {
        throw new ConflictException(
          `Ce groupe ne peut pas être supprimé : ${nb} inscription(s) y sont ` +
            'rattachées. Supprimer le groupe effacerait leurs paiements — ces ' +
            'écritures ne se reconstituent pas.',
        );
      }

      // Empty: only its teaching assignments remain, and those carry no
      // accounting of their own.
      await tx.query('DELETE FROM evening_teachings WHERE evening_group_id = $1', [groupId]);
      await tx.query('DELETE FROM evening_group_months WHERE evening_group_id = $1', [groupId]);
      const { rows } = await tx.query<{ name: string }>(
        'DELETE FROM evening_groups WHERE id = $1 RETURNING name',
        [groupId],
      );
      if (rows.length === 0) throw new NotFoundException('Groupe de cours du soir introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_group_deleted',
          entity: 'evening_group',
          entityId: groupId,
          before: { name: rows[0]!.name },
        },
        tx,
      );
    });
  }

  async enrol(input: EnrolInput, actorId: string) {
    const { schoolId } = currentTenant();

    const isStudent = Boolean(input.studentId);
    const isOutsider = Boolean(input.outsiderName);
    if (isStudent === isOutsider) {
      throw new BadRequestException(
        'Inscrivez soit un élève de l’école, soit une personne externe — l’un ou l’autre, pas les deux.',
      );
    }

    return this.db.query(async (tx) => {
      if (isStudent) {
        const already = await tx.query(
          `SELECT 1 FROM evening_enrolments
            WHERE evening_group_id = $1 AND student_id = $2`,
          [input.eveningGroupId, input.studentId],
        );
        if (already.rows.length > 0) {
          throw new BadRequestException('Déjà inscrit dans ce groupe de cours du soir.');
        }
      }

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO evening_enrolments
           (school_id, evening_group_id, student_id, outsider_name, outsider_phone, outsider_sex)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          schoolId, input.eveningGroupId, input.studentId ?? null,
          input.outsiderName ?? null, input.outsiderPhone ?? null,
          input.outsiderSex ?? null,
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_enrolled',
          entity: 'evening_enrolment',
          entityId: rows[0]!.id,
          after: { outsider: isOutsider },
        },
        tx,
      );
      return { id: rows[0]!.id, isOutsider };
    });
  }

  /**
   * Collect an evening payment.
   *
   * Draws from the SAME per-branch receipt sequence as the day school. Two
   * sequences would eventually hand one family two receipts bearing the same
   * number, and the family holds the paper.
   */
  async collect(
    input: {
      enrolmentId: string;
      calendarMonth: number;
      calendarYear: number;
      amount: string;
      paperReference?: string;
      /** How the money arrived. Optional only so existing callers still compile. */
      tender?: EveningTenderLine[];
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    const amount = money(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Un paiement doit être d’un montant positif.');
    }

    const school = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ receipt_prefix: string; currency: string }>(
        'SELECT receipt_prefix, currency FROM schools WHERE id = $1',
        [schoolId],
      );
      return rows[0]!;
    });

    return this.db.query(async (tx) => {
      // Son `payer_cs` accepte les versements partiels : le déjà payé du mois
      // s'ajoute au nouveau, et le total ne dépasse pas le dû.
      const { rows: deja } = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM evening_payments
          WHERE enrolment_id = $1 AND calendar_month = $2 AND calendar_year = $3
            AND reverses_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM evening_payments r WHERE r.reverses_id = evening_payments.id)`,
        [input.enrolmentId, input.calendarMonth, input.calendarYear],
      );
      const dejaCs = money(deja[0]?.total ?? '0');

      /**
       * ⚠ THE MONTH HAS A CEILING, AND IT MOVES WITH THE REDUCTION. Its own
       * refusal names both figures: "Le montant dépasse le reste dû du mois
       * (N MRU, réduction de M MRU incluse)."
       *
       * Without this the reduction is decorative. The clerk reads the rate off
       * the wall, types it, and the agreement the direction made with the
       * family is worth nothing — and the school is holding money against a
       * month that does not owe it.
       */
      const { rows: dueRows } = await tx.query<{ rate: string; discount: string | null }>(
        `SELECT g.monthly_rate::text AS rate, d.amount::text AS discount
           FROM evening_enrolments e
           JOIN evening_groups g ON g.id = e.evening_group_id
           LEFT JOIN evening_discounts d
             ON d.evening_enrolment_id = e.id AND d.calendar_month = $2
            AND d.calendar_year = $3
          WHERE e.id = $1`,
        [input.enrolmentId, input.calendarMonth, input.calendarYear],
      );
      if (!dueRows[0]) throw new NotFoundException('Inscription introuvable.');

      const reduction = money(dueRows[0].discount ?? '0');
      const monthDue = Decimal.max(0, money(dueRows[0].rate).minus(reduction));

      if (monthDue.greaterThan(0) && dejaCs.plus(amount).greaterThan(monthDue.plus(0.01))) {
        throw new BadRequestException(
          `Le montant dépasse le reste dû du mois (${mru0(Decimal.max(0, monthDue.minus(dejaCs)))}` +
            (reduction.greaterThan(0) ? `, réduction de ${mru0(reduction)} incluse` : '') +
            ').',
        );
      }

      const receiptNumber = await nextReceiptNumber(
        tx,
        schoolId,
        input.calendarYear,
        school.receipt_prefix,
      );

      const { rows } = await tx.query<{ id: string; paid_at: Date }>(
        `INSERT INTO evening_payments
           (school_id, enrolment_id, calendar_month, calendar_year, amount,
            receipt_number, paper_reference, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, paid_at`,
        [
          schoolId, input.enrolmentId, input.calendarMonth, input.calendarYear,
          toStorage(amount), receiptNumber, input.paperReference ?? null, actorId,
        ],
      );

      // How the money arrived. This was missing: an evening fee paid by Bankily
      // was indistinguishable from one paid in cash, so the till could not be
      // reconciled against the evening school at all. `cours_soir` is one of
      // El Ourwa's own eleven source types.
      if (input.tender && input.tender.length > 0) {
        await this.tender.post(tx, {
          sourceType: 'cours_soir',
          sourceId: rows[0]!.id,
          direction: 'in',
          total: toStorage(amount),
          lines: input.tender,
          at: rows[0]!.paid_at,
        });
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_payment_recorded',
          entity: 'evening_payment',
          entityId: rows[0]!.id,
          after: { amount: toStorage(amount), receiptNumber },
        },
        tx,
      );

      return {
        id: rows[0]!.id,
        receiptNumber,
        amount: toStorage(amount),
        currency: school.currency,
      };
    });
  }

  /**
   * LA FICHE D'UN GROUPE — `cours_du_soir.php?groupe_id=…&cs_annee=…` : le
   * groupe, ses mois dus (configurés, sinon 1..12), ses inscrits (par ordre
   * d'inscription) avec, pour l'année civile consultée, le payé de chaque
   * mois (et le dernier reçu) et la réduction de chaque mois.
   */
  async groupDetail(eveningGroupId: string, calendarYear: number) {
    return this.db.query(async (tx) => {
      const { rows: groupe } = await tx.query<{ id: string; name: string; monthly_rate: string; description: string | null }>(
        'SELECT id, name, monthly_rate::text, description FROM evening_groups WHERE id = $1',
        [eveningGroupId],
      );
      if (!groupe[0]) throw new NotFoundException('Groupe de cours du soir introuvable.');

      const { rows: moisRows } = await tx.query<{ calendar_month: number }>(
        `SELECT calendar_month FROM evening_group_months
          WHERE evening_group_id = $1 AND calendar_year = $2 ORDER BY calendar_month`,
        [eveningGroupId, calendarYear],
      );
      const moisDus = moisRows.length ? moisRows.map((m) => m.calendar_month) : Array.from({ length: 12 }, (_, i) => i + 1);

      const { rows: inscrits } = await tx.query<{
        id: string;
        student_id: string | null;
        etu_nom: string | null;
        matricule: string | null;
        externe_nom: string | null;
        externe_tel: string | null;
      }>(
        `SELECT e.id, e.student_id,
                NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '') AS etu_nom,
                s.matricule, e.outsider_name AS externe_nom, e.outsider_phone AS externe_tel
           FROM evening_enrolments e
           LEFT JOIN students s ON s.id = e.student_id
          WHERE e.evening_group_id = $1
          ORDER BY e.id`,
        [eveningGroupId],
      );
      const ids = inscrits.map((i) => i.id);
      const { rows: pays } = await tx.query<{ enrolment_id: string; calendar_month: number; total: string; last_id: string }>(
        `SELECT p.enrolment_id, p.calendar_month, SUM(p.amount)::text AS total,
                (array_agg(p.id ORDER BY p.paid_at DESC))[1] AS last_id
           FROM evening_payments p
          WHERE p.calendar_year = $1 AND p.enrolment_id = ANY($2::uuid[])
            AND p.reverses_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM evening_payments r WHERE r.reverses_id = p.id)
          GROUP BY p.enrolment_id, p.calendar_month`,
        [calendarYear, ids],
      );
      const { rows: reds } = await tx.query<{ id: string; evening_enrolment_id: string; calendar_month: number; amount: string; reason: string | null }>(
        `SELECT id, evening_enrolment_id, calendar_month, amount::text, reason
           FROM evening_discounts
          WHERE calendar_year = $1 AND evening_enrolment_id = ANY($2::uuid[])`,
        [calendarYear, ids],
      );
      return {
        groupe: groupe[0],
        moisDus,
        inscrits: inscrits.map((i) => ({
          ...i,
          mois_payes: Object.fromEntries(
            pays.filter((p) => p.enrolment_id === i.id).map((p) => [p.calendar_month, { id: p.last_id, montant: p.total }]),
          ) as Record<number, { id: string; montant: string }>,
          reductions: Object.fromEntries(
            reds.filter((r) => r.evening_enrolment_id === i.id).map((r) => [r.calendar_month, { id: r.id, montant: r.amount, motif: r.reason }]),
          ) as Record<number, { id: string; montant: string; motif: string | null }>,
        })),
      };
    });
  }

  /** LE REÇU D'UN PAIEMENT — `?print_recu_cs=…`. */
  async paymentReceipt(paymentId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        receipt_number: string;
        paid_at: string;
        amount: string;
        calendar_month: number;
        calendar_year: number;
        enrolment_id: string;
        student_id: string | null;
        etu_nom: string | null;
        matricule: string | null;
        externe_nom: string | null;
        externe_tel: string | null;
        groupe_nom: string;
        cs_groupe_id: string;
        nom_parent: string | null;
        telephone_parent: string | null;
        discount: string | null;
      }>(
        `SELECT p.id, p.receipt_number, p.paid_at, p.amount::text, p.calendar_month, p.calendar_year,
                e.id AS enrolment_id, e.student_id,
                NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '') AS etu_nom, s.matricule,
                e.outsider_name AS externe_nom, e.outsider_phone AS externe_tel,
                g.name AS groupe_nom, g.id AS cs_groupe_id,
                u.full_name AS nom_parent, u.phone AS telephone_parent,
                d.amount::text AS discount
           FROM evening_payments p
           JOIN evening_enrolments e ON e.id = p.enrolment_id
           JOIN evening_groups g ON g.id = e.evening_group_id
           LEFT JOIN students s ON s.id = e.student_id
           LEFT JOIN users u ON u.id = s.guardian_id
           LEFT JOIN evening_discounts d
             ON d.evening_enrolment_id = e.id AND d.calendar_month = p.calendar_month AND d.calendar_year = p.calendar_year
          WHERE p.id = $1`,
        [paymentId],
      );
      if (!rows[0]) throw new NotFoundException('Reçu introuvable.');
      const moyens = await this.tender.linesFor(tx, 'cours_soir', paymentId);
      return { ...rows[0], moyens };
    });
  }

  /** LE REÇU D'UN PAIEMENT DE PROFESSEUR — `?print_recu_prof_cs=…`, numéro « CSP-000123 ». */
  async teacherPaymentReceipt(paymentId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        legacy_id: number | null;
        paid_at: string;
        amount: string;
        calendar_month: number;
        calendar_year: number;
        groupe_nom: string;
        cs_groupe_id: string;
        matiere: string;
        prof_nom: string | null;
        prof_tel: string | null;
        est_interne: boolean;
      }>(
        `SELECT pp.id, pp.legacy_id, pp.paid_at, pp.amount::text, pp.calendar_month, pp.calendar_year,
                g.name AS groupe_nom, g.id AS cs_groupe_id, et.subject AS matiere,
                COALESCE(t.first_name || ' ' || t.last_name, ev.first_name || ' ' || ev.last_name) AS prof_nom,
                COALESCE(t.phone, ev.phone) AS prof_tel,
                (t.id IS NOT NULL) AS est_interne
           FROM evening_teacher_payments pp
           JOIN evening_teachings et ON et.id = pp.evening_teaching_id
           JOIN evening_groups g ON g.id = et.evening_group_id
           LEFT JOIN teachers t ON t.id = et.teacher_id
           LEFT JOIN evening_teachers ev ON ev.id = et.evening_teacher_id
          WHERE pp.id = $1`,
        [paymentId],
      );
      if (!rows[0]) throw new NotFoundException('Reçu introuvable.');
      const moyens = await this.tender.linesFor(tx, 'cours_soir_prof', paymentId);
      const r = rows[0];
      const numero = r.legacy_id !== null ? String(r.legacy_id).padStart(6, '0') : r.id.replace(/-/g, '').slice(-8);
      return { ...r, numero: `CSP-${numero}`, moyens };
    });
  }

  /** Ses `CS_ETUDIANTS` : tous les élèves, « Prénom Nom (matricule) », par nom. */
  async etudiantsIndex() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; label: string }>(
        `SELECT id, CONCAT(first_name, ' ', last_name, ' (', COALESCE(matricule, ''), ')') AS label
           FROM students ORDER BY last_name`,
      );
      return rows;
    });
  }

  /** What an evening group has collected, and what is still owed for a month. */
  async monthStatus(eveningGroupId: string, calendarMonth: number, calendarYear: number) {
    return this.db.query(async (tx) => {
      const { rows: group } = await tx.query<{ monthly_rate: string; name: string }>(
        'SELECT monthly_rate, name FROM evening_groups WHERE id = $1',
        [eveningGroupId],
      );
      if (!group[0]) throw new NotFoundException('Groupe de cours du soir introuvable.');

      const { rows } = await tx.query<{
        id: string;
        display_name: string;
        is_outsider: boolean;
        paid: string | null;
        receipt_number: string | null;
        discount: string | null;
        discount_reason: string | null;
      }>(
        `SELECT e.id,
                COALESCE(
                  NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), ''),
                  e.outsider_name
                ) AS display_name,
                (e.student_id IS NULL) AS is_outsider,
                p.amount::text AS paid, p.receipt_number,
                d.amount::text AS discount, d.reason AS discount_reason
           FROM evening_enrolments e
           LEFT JOIN students s ON s.id = e.student_id
           -- Agrégé par inscrit : deux versements partiels donnaient deux lignes,
           -- et une originale annulée comptait encore.
           LEFT JOIN (
             SELECT ep.enrolment_id, SUM(ep.amount) AS amount, MAX(ep.receipt_number) AS receipt_number
               FROM evening_payments ep
              WHERE ep.calendar_month = $2 AND ep.calendar_year = $3 AND ep.reverses_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM evening_payments r WHERE r.reverses_id = ep.id)
              GROUP BY ep.enrolment_id
           ) p ON p.enrolment_id = e.id
           LEFT JOIN evening_discounts d
             ON d.evening_enrolment_id = e.id AND d.calendar_month = $2
            AND d.calendar_year = $3
          WHERE e.evening_group_id = $1
          ORDER BY display_name`,
        [eveningGroupId, calendarMonth, calendarYear],
      );

      /**
       * ⚠ SA COLONNE « MOIS PAYÉS » — le bandeau de pastilles.
       *
       * `cours_du_soir.php` rend, sur chaque inscrit, UNE pastille par mois dû
       * du groupe : verte quand le mois est soldé, ambre quand il est entamé,
       * grise quand rien n'est versé, et son infobulle porte la réduction et le
       * « payé / dû » du mois.
       *
       * Nous n'affichions qu'UN mois à la fois — celui du sélecteur. Pour savoir
       * si un inscrit devait encore octobre, il fallait changer de mois et
       * relire ; lui le voit sur la ligne. C'est la même idée que la grille de
       * mois de la caisse, condensée en une cellule.
       */
      const { rows: bandeau } = await tx.query<{
        enrolment_id: string;
        calendar_month: number;
        calendar_year: number;
        paid: string | null;
        discount: string | null;
      }>(
        `SELECT e.id AS enrolment_id, m.calendar_month, m.calendar_year,
                p.amount::text AS paid, d.amount::text AS discount
           FROM evening_group_months m
           JOIN evening_enrolments e ON e.evening_group_id = m.evening_group_id
           LEFT JOIN evening_payments p
             ON p.enrolment_id = e.id AND p.calendar_month = m.calendar_month
            AND p.calendar_year = m.calendar_year AND p.reverses_id IS NULL
           LEFT JOIN evening_discounts d
             ON d.evening_enrolment_id = e.id AND d.calendar_month = m.calendar_month
            AND d.calendar_year = m.calendar_year
          WHERE m.evening_group_id = $1
          ORDER BY m.calendar_year, m.calendar_month`,
        [eveningGroupId],
      );

      const rate = money(group[0].monthly_rate);
      const collected = sum(rows.filter((r) => r.paid).map((r) => r.paid!));
      const owing = rows.filter((r) => !r.paid).length;

      /**
       * ⚠ `expected` IS NET OF THE REDUCTIONS. It used to be rate × headcount,
       * which is what the school would collect if it had agreed nothing with
       * anybody — so the KPI "Encaissé sur X" would never reach X once a single
       * reduction existed, and an office chasing the gap would be chasing money
       * the direction had already decided not to take.
       */
      const expected = rows.reduce(
        (acc, r) => acc.plus(Decimal.max(0, rate.minus(money(r.discount ?? '0')))),
        money('0'),
      );

      return {
        group: group[0].name,
        monthlyRate: toStorage(rate),
        calendarMonth,
        calendarYear,
        collected: toStorage(collected),
        expected: toStorage(expected),
        owing,
        enrolees: rows.map((r) => {
          const discount = r.discount ? money(r.discount) : null;
          return {
            enrolmentId: r.id,
            name: r.display_name,
            isOutsider: r.is_outsider,
            paid: r.paid ? toStorage(money(r.paid)) : null,
            receiptNumber: r.receipt_number,
            // ⚠ The till must be told the REDUCED figure. Offering the full
            // rate makes the agreement worth nothing the moment a clerk
            // accepts the number the screen suggests.
            discount: discount ? toStorage(discount) : null,
            discountReason: r.discount_reason,
            due: toStorage(Decimal.max(0, rate.minus(discount ?? money('0')))),
            /**
             * Sa colonne « Mois payés » : un état par mois dû du groupe.
             * `due` tient compte de la réduction DU MOIS, pas de celle du mois
             * affiché — une remise accordée en janvier ne change pas octobre.
             */
            months: bandeau
              .filter((b) => b.enrolment_id === r.id)
              .map((b) => {
                const remise = b.discount ? money(b.discount) : money('0');
                const du = Decimal.max(0, rate.minus(remise));
                const verse = b.paid ? money(b.paid) : money('0');
                return {
                  month: b.calendar_month,
                  year: b.calendar_year,
                  due: toStorage(du),
                  paid: toStorage(verse),
                  discount: b.discount ? toStorage(remise) : null,
                  status: verse.greaterThanOrEqualTo(du.minus('0.01'))
                    ? ('paid' as const)
                    : verse.greaterThan(0)
                      ? ('partial' as const)
                      : ('unpaid' as const),
                };
              }),
          };
        }),
      };
    });
  }

  /**
   * APPLIQUER UNE RÉDUCTION — `cours_du_soir.php`, `appliquer_reduction_cs`.
   *
   * ⚠ NEITHER THE ACTION NOR A PLACE TO PUT IT EXISTED. An evening enrolment
   * could be charged its group's rate and nothing else: no way to agree a lower
   * figure with a family for one month, which is the only reason the action is
   * there.
   *
   * ⚠ AND IT IS NOT `discounts`. That table is keyed on `student_id NOT NULL`
   * and an evening enrolee may be an OUTSIDER with no student row at all.
   * Migration 0019 sets out why a separate table rather than El Ourwa's
   * `contexte` discriminator.
   *
   * Its two guards are the substance, and both are money:
   *
   *   1. **Not more than the rate.** Beyond it the month owes a negative amount
   *      and the school owes the family — its own message names the rate.
   *   2. **Not below what is already paid.** Reducing under a settled month
   *      leaves the school holding money against nothing.
   *
   * ⚠ AND IT REPLACES RATHER THAN STACKS, as its `ON DUPLICATE KEY UPDATE`
   * does. Two reductions on one month is not a decision the school makes; it is
   * one mistake made twice. The old reason goes with the old amount — keeping
   * it would attribute the new figure to a conversation about a different one.
   */
  async applyDiscount(
    input: {
      enrolmentId: string;
      calendarMonth: number;
      calendarYear: number;
      amount: string;
      reason?: string;
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();

    const amount = money(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Le montant de la réduction doit être positif.');
    }

    return this.db.query(async (tx) => {
      const { rows: rate } = await tx.query<{ monthly_rate: string }>(
        `SELECT g.monthly_rate::text
           FROM evening_enrolments e
           JOIN evening_groups g ON g.id = e.evening_group_id
          WHERE e.id = $1`,
        [input.enrolmentId],
      );
      if (!rate[0]) throw new NotFoundException('Inscription introuvable.');
      const monthly = money(rate[0].monthly_rate);

      if (amount.greaterThan(monthly.plus(0.01))) {
        throw new BadRequestException(
          `La réduction dépasse le tarif mensuel (${mru0(monthly)}).`,
        );
      }

      // What has already been settled for this month. A reversal is excluded on
      // both halves, as everywhere else money is counted.
      const { rows: paidRows } = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total
           FROM evening_payments
          WHERE enrolment_id = $1 AND calendar_month = $2 AND calendar_year = $3
            AND reverses_id IS NULL`,
        [input.enrolmentId, input.calendarMonth, input.calendarYear],
      );
      const already = money(paidRows[0]!.total);

      if (monthly.minus(amount).lessThan(already.minus(0.01))) {
        throw new BadRequestException(
          `${mru0(already)} sont déjà payés pour ce mois.`,
        );
      }

      const reason = input.reason?.trim() || null;
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO evening_discounts
           (school_id, evening_enrolment_id, calendar_month, calendar_year,
            amount, reason, granted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (school_id, evening_enrolment_id, calendar_month, calendar_year)
         DO UPDATE SET amount = EXCLUDED.amount,
                       reason = EXCLUDED.reason,
                       granted_by = EXCLUDED.granted_by,
                       created_at = now()
         RETURNING id`,
        [
          schoolId, input.enrolmentId, input.calendarMonth, input.calendarYear,
          toStorage(amount), reason, actorId,
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_discount_applied',
          entity: 'evening_enrolment',
          entityId: input.enrolmentId,
          after: {
            amount: toStorage(amount),
            month: `${input.calendarYear}-${input.calendarMonth}`,
            reason: reason ?? '',
          },
        },
        tx,
      );

      return { id: rows[0]!.id, amount: toStorage(amount) };
    });
  }

  /** RETIRER LA RÉDUCTION — its `retirer_reduction_cs`. */
  async removeDiscount(
    enrolmentId: string,
    calendarMonth: number,
    calendarYear: number,
    actorId: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();
    await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ amount: string }>(
        `DELETE FROM evening_discounts
          WHERE evening_enrolment_id = $1 AND calendar_month = $2 AND calendar_year = $3
        RETURNING amount::text`,
        [enrolmentId, calendarMonth, calendarYear],
      );
      if (rows.length === 0) {
        throw new NotFoundException('Aucune réduction sur ce mois.');
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_discount_removed',
          entity: 'evening_enrolment',
          entityId: enrolmentId,
          before: {
            amount: rows[0]!.amount,
            month: `${calendarYear}-${calendarMonth}`,
          },
        },
        tx,
      );
    });
  }

  /**
   * PAY AN EVENING TEACHER — `cours_du_soir.php`, action `payer_prof_cs`.
   *
   * ⚠ THE MONTH MUST BE ONE THE GROUP RUNS IN. A group is configured with the
   * months it operates; outside them it does not teach and no salary is due at
   * all. El Ourwa refuses in those words, and the refusal matters because the
   * form offers all twelve months regardless.
   *
   * An empty month list means "not configured yet", not "never runs" — refusing
   * there would stop a school that has not filled its calendar in from paying
   * anybody.
   *
   * ⚠ THE ADVISORY LOCK SERIALISES THE MONTH. Two clerks pressing "payer" at the
   * same instant would otherwise both read the same remaining balance and both
   * pay it in full. The unique key that used to prevent that was dropped in 0015
   * so instalments could each be their own row, and this is what replaces it.
   */
  /** Which months this group runs, for a given calendar year. */
  async groupMonths(groupId: string, calendarYear: number): Promise<{ months: number[] }> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ calendar_month: number }>(
        `SELECT calendar_month FROM evening_group_months
          WHERE evening_group_id = $1 AND calendar_year = $2
          ORDER BY calendar_month`,
        [groupId, calendarYear],
      );
      return { months: rows.map((r) => r.calendar_month) };
    });
  }

  /**
   * Set them, replacing the year's list wholesale.
   *
   * ⚠ REPLACING, NOT MERGING. The screen shows twelve checkboxes and submits
   * all of them; a merge would make unticking a month impossible, which is
   * exactly the edit somebody makes when a course finishes early.
   *
   * ⚠ AND CLEARING THE LIST MEANS "EVERY MONTH", not "no months" — its own
   * `empty($mois_grp) ? true` fallback. A group left unconfigured must stay
   * payable, so the empty list is the permissive state and the screen says so.
   */
  async setGroupMonths(
    groupId: string,
    calendarYear: number,
    months: number[],
    actorId: string,
  ): Promise<{ months: number[] }> {
    const { schoolId } = currentTenant();
    const unique = [...new Set(months)].sort((a, b) => a - b);

    return this.db.query(async (tx) => {
      await tx.query(
        'DELETE FROM evening_group_months WHERE evening_group_id = $1 AND calendar_year = $2',
        [groupId, calendarYear],
      );
      for (const m of unique) {
        await tx.query(
          `INSERT INTO evening_group_months
             (school_id, evening_group_id, calendar_year, calendar_month)
           VALUES ($1, $2, $3, $4)`,
          [schoolId, groupId, calendarYear, m],
        );
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_group_months_set',
          entity: 'evening_group',
          entityId: groupId,
          after: {
            year: String(calendarYear),
            // An empty list is the permissive state, so the audit says which.
            months: unique.join(',') || 'toute l’année',
          },
        },
        tx,
      );
      return { months: unique };
    });
  }

  async payTeacher(input: PayTeacherInput, actorId: string) {
    const { schoolId } = currentTenant();

    if (input.tender.length === 0) {
      throw new BadRequestException(
        'Indiquez comment la somme est sortie : au moins un moyen de paiement.',
      );
    }
    const amount = sum(input.tender.map((t) => t.amount));
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Le montant doit être positif.');
    }

    return this.db.query(async (tx) => {
      // Serialise this teaching's month before anything is read.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `evening-teacher:${input.eveningTeachingId}:${input.calendarYear}-${input.calendarMonth}`,
      ]);

      const { rows: teachings } = await tx.query<{
        evening_group_id: string;
        pay_kind: string;
        hourly_rate: string;
        hours_per_month: number;
        fixed_salary: string;
      }>(
        `SELECT evening_group_id, pay_kind, hourly_rate, hours_per_month, fixed_salary
           FROM evening_teachings WHERE id = $1`,
        [input.eveningTeachingId],
      );
      const teaching = teachings[0];
      if (!teaching) throw new NotFoundException('Enseignement introuvable.');

      // The configured months of this teaching's group.
      const { rows: months } = await tx.query<{ calendar_month: number }>(
        `SELECT calendar_month FROM evening_group_months
          WHERE evening_group_id = $1 AND calendar_year = $2`,
        [teaching.evening_group_id, input.calendarYear],
      );
      const configured = months.map((m) => m.calendar_month);
      if (configured.length > 0 && !configured.includes(input.calendarMonth)) {
        throw new BadRequestException(
          'Ce mois ne fait pas partie des mois configurés pour ce groupe : ' +
            "aucun salaire n'est dû.",
        );
      }

      const due =
        teaching.pay_kind === 'fixed'
          ? money(teaching.fixed_salary)
          : money(teaching.hourly_rate).times(teaching.hours_per_month);

      if (due.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          "Aucun salaire n'est convenu pour cet enseignement : fixez un salaire " +
            'ou un tarif horaire avant de payer.',
        );
      }

      const { rows: paidRows } = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total
           FROM evening_teacher_payments
          WHERE evening_teaching_id = $1 AND calendar_month = $2 AND calendar_year = $3
            -- BOTH halves of a reversal are excluded, exactly as the day-school
            -- payroll does. The arithmetic would come out the same while the
            -- reversal is always for the full amount; naming the rule means it
            -- keeps coming out right if a partial one is ever added.
            AND reversed = false AND reverses_id IS NULL`,
        [input.eveningTeachingId, input.calendarMonth, input.calendarYear],
      );
      const already = money(paidRows[0]!.total);

      if (already.greaterThanOrEqualTo(due.minus(0.01))) {
        throw new BadRequestException(
          `Ce professeur a déjà été intégralement payé pour ce mois ` +
            `(${toStorage(already)}).`,
        );
      }
      if (already.plus(amount).greaterThan(due.plus(0.01))) {
        throw new BadRequestException(
          `Le montant dépasse le reste dû (${mru0(Decimal.max(0, due.minus(already)))}).`,
        );
      }

      const { rows } = await tx.query<{ id: string; paid_at: Date }>(
        `INSERT INTO evening_teacher_payments
           (school_id, evening_teaching_id, calendar_month, calendar_year, amount, paid_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, paid_at`,
        [
          schoolId, input.eveningTeachingId, input.calendarMonth,
          input.calendarYear, toStorage(amount), actorId,
        ],
      );
      const id = rows[0]!.id;

      // Money OUT. Recorded in the same ledger as everything else, so the till
      // balances against what actually left it.
      await this.tender.post(tx, {
        sourceType: 'cours_soir_prof',
        sourceId: id,
        direction: 'out',
        total: toStorage(amount),
        lines: input.tender,
        at: rows[0]!.paid_at,
      });

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_teacher_paid',
          entity: 'evening_teacher_payment',
          entityId: id,
          after: {
            amount: toStorage(amount),
            month: `${input.calendarYear}-${input.calendarMonth}`,
            remaining: toStorage(Decimal.max(0, due.minus(already).minus(amount))),
          },
        },
        tx,
      );

      return {
        id,
        amount: toStorage(amount),
        due: toStorage(due),
        paid: toStorage(already.plus(amount)),
        remaining: toStorage(Decimal.max(0, due.minus(already).minus(amount))),
      };
    });
  }

  /**
   * ANNULER UN PAIEMENT DE PROFESSEUR — its `annuler_paiement_prof_cs`.
   *
   * ⚠ EL OURWA DELETES THE ROW AND ITS TENDER LINES WITH IT: `DELETE FROM
   * cs_paiements_profs` then `DELETE FROM paiement_lignes`. A salary handed over
   * in cash and then cancelled leaves the ledger with no trace that either thing
   * happened — the money left the drawer and the books say it never did, and the
   * till is short by exactly that amount with nothing to explain it.
   *
   * Standing rule 7: a correction is a reversing entry. The same shape
   * `salary_payments` has carried since migration 0009 — a negative row pointing
   * at the original, the original flagged, and BOTH halves excluded from every
   * total, so the month becomes payable again.
   *
   * ⚠ AND THE LEDGER RECORDS THE MONEY COMING BACK, direction `in`. A reversal
   * with no tender line leaves the drawer counted short: it balances against
   * entries, not against intent.
   */
  async reverseTeacherPayment(paymentId: string, reason: string, actorId: string) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        evening_teaching_id: string;
        calendar_month: number;
        calendar_year: number;
        amount: string;
        reverses_id: string | null;
        reversed: boolean;
      }>(
        `SELECT evening_teaching_id, calendar_month, calendar_year, amount::text,
                reverses_id, reversed
           FROM evening_teacher_payments WHERE id = $1 FOR UPDATE`,
        [paymentId],
      );
      const original = rows[0];
      if (!original) throw new NotFoundException('Paiement introuvable.');
      if (original.reverses_id) {
        throw new BadRequestException('Cette écriture est elle-même une annulation.');
      }
      if (original.reversed) {
        throw new BadRequestException('Ce paiement a déjà été annulé.');
      }

      const negated = money(original.amount).negated();

      const { rows: created } = await tx.query<{ id: string; paid_at: Date }>(
        `INSERT INTO evening_teacher_payments
           (school_id, evening_teaching_id, calendar_month, calendar_year, amount,
            paid_by, reverses_id, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, paid_at`,
        [
          schoolId, original.evening_teaching_id, original.calendar_month,
          original.calendar_year, toStorage(negated), actorId, paymentId,
          reason.trim() || null,
        ],
      );

      await tx.query(
        'UPDATE evening_teacher_payments SET reversed = true WHERE id = $1',
        [paymentId],
      );

      // The means it went out by, so it comes back the same way. Reading the
      // original's lines rather than asking the caller: the money returns to
      // the drawer it left, and a clerk should not be able to say otherwise.
      const { rows: lines } = await tx.query<{ payment_method_id: string; amount: string }>(
        `SELECT payment_method_id, amount::text
           FROM tender_lines
          WHERE source_type = 'cours_soir_prof' AND source_id = $1`,
        [paymentId],
      );

      if (lines.length > 0) {
        await this.tender.post(tx, {
          sourceType: 'cours_soir_prof',
          sourceId: created[0]!.id,
          direction: 'in',
          total: toStorage(money(original.amount)),
          lines: lines.map((l) => ({ paymentMethodId: l.payment_method_id, amount: l.amount })),
          at: created[0]!.paid_at,
        });
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'evening_teacher_payment_reversed',
          entity: 'evening_teacher_payment',
          entityId: created[0]!.id,
          before: { paymentId, amount: original.amount },
          after: { reversalId: created[0]!.id, reason },
        },
        tx,
      );

      return { id: created[0]!.id, amount: toStorage(negated) };
    });
  }

  /** One teaching's month: what is due, what has been paid, what is left. */
  async teacherMonth(eveningTeachingId: string, calendarMonth: number, calendarYear: number) {
    const due = await this.teacherDue(eveningTeachingId);
    const paid = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total
           FROM evening_teacher_payments
          WHERE evening_teaching_id = $1 AND calendar_month = $2 AND calendar_year = $3
            AND reversed = false AND reverses_id IS NULL`,
        [eveningTeachingId, calendarMonth, calendarYear],
      );
      return money(rows[0]!.total);
    });
    return {
      due: toStorage(due),
      paid: toStorage(paid),
      remaining: toStorage(Decimal.max(0, due.minus(paid))),
    };
  }

  /**
   * PAIEMENT DES PROFESSEURS — the whole tab, for one month.
   *
   * One query. Asking per teaching would be a round trip each for a page that
   * lists every evening teacher in the school.
   *
   * ⚠ A GROUP THAT DOES NOT RUN THIS MONTH IS NOT LISTED. Showing it with "0 dû"
   * invites someone to pay it anyway, and the service would then refuse in a
   * modal after they had counted out the cash.
   */
  async teacherPayroll(calendarMonth: number, calendarYear: number) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        teaching_id: string;
        group_id: string;
        group_name: string;
        subject: string;
        teacher_name: string | null;
        internal: boolean;
        pay_kind: string;
        hourly_rate: string;
        hours_per_month: number;
        fixed_salary: string;
        paid: string;
        payments: { id: string; amount: string; paidAt: string }[];
      }>(
        `SELECT et.id AS teaching_id,
                g.id AS group_id, g.name AS group_name,
                et.subject,
                COALESCE(
                  t.first_name || ' ' || t.last_name,
                  ev.first_name || ' ' || ev.last_name
                ) AS teacher_name,
                (et.teacher_id IS NOT NULL) AS internal,
                et.pay_kind, et.hourly_rate::text, et.hours_per_month,
                et.fixed_salary::text,
                COALESCE(p.total, 0)::text AS paid,
                -- ⚠ THE PAYMENTS THEMSELVES, not just their sum. Cancelling one
                -- needs its id, and a screen that shows only a total can offer
                -- no way to undo a single instalment — which is the case the
                -- action exists for.
                COALESCE(p.entries, '[]'::json) AS payments
           FROM evening_teachings et
           JOIN evening_groups g ON g.id = et.evening_group_id
           LEFT JOIN teachers t ON t.id = et.teacher_id
           LEFT JOIN evening_teachers ev ON ev.id = et.evening_teacher_id
           LEFT JOIN (
             SELECT evening_teaching_id, SUM(amount) AS total,
                    json_agg(json_build_object(
                      'id', id, 'amount', amount::text, 'paidAt', paid_at
                    ) ORDER BY paid_at) AS entries
               FROM evening_teacher_payments
              WHERE calendar_month = $1 AND calendar_year = $2
                AND reversed = false AND reverses_id IS NULL
              GROUP BY evening_teaching_id
           ) p ON p.evening_teaching_id = et.id
          WHERE NOT EXISTS (
                  SELECT 1 FROM evening_group_months m
                   WHERE m.evening_group_id = g.id AND m.calendar_year = $2
                )
             OR EXISTS (
                  SELECT 1 FROM evening_group_months m
                   WHERE m.evening_group_id = g.id AND m.calendar_year = $2
                     AND m.calendar_month = $1
                )
          ORDER BY g.name, teacher_name`,
        [calendarMonth, calendarYear],
      );

      return rows.map((r) => {
        const due =
          r.pay_kind === 'fixed'
            ? money(r.fixed_salary)
            : money(r.hourly_rate).times(r.hours_per_month);
        const paid = money(r.paid);
        return {
          eveningTeachingId: r.teaching_id,
          groupId: r.group_id,
          groupName: r.group_name,
          subject: r.subject,
          teacherName: r.teacher_name ?? '—',
          /** "Internes" — a teacher of the day school — or "Externes". */
          internal: r.internal,
          /** "Stable" or "Horaire", in its own vocabulary. */
          payKind: r.pay_kind,
          hourlyRate: toStorage(money(r.hourly_rate)),
          hoursPerMonth: r.hours_per_month,
          due: toStorage(due),
          paid: toStorage(paid),
          remaining: toStorage(Decimal.max(0, due.minus(paid))),
          // Live instalments only — a cancelled one is neither counted nor
          // offered for cancelling a second time.
          payments: r.payments ?? [],
        };
      });
    });
  }

  /** What an evening teacher is owed for a month. */
  async teacherDue(eveningTeachingId: string): Promise<Decimal> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        pay_kind: string;
        hourly_rate: string;
        hours_per_month: number;
        fixed_salary: string;
      }>(
        `SELECT pay_kind, hourly_rate, hours_per_month, fixed_salary
           FROM evening_teachings WHERE id = $1`,
        [eveningTeachingId],
      );
      if (!rows[0]) throw new NotFoundException('Enseignement du soir introuvable.');
      const t = rows[0];
      return t.pay_kind === 'fixed'
        ? money(t.fixed_salary)
        : money(t.hourly_rate).times(t.hours_per_month);
    });
  }
}

/**
 * The shared receipt sequence. Identical to the day school's, deliberately:
 * one branch, one run of receipt numbers.
 */
async function nextReceiptNumber(
  tx: Queryable,
  schoolId: string,
  year: number,
  prefix: string,
): Promise<string> {
  await tx.query(
    `INSERT INTO receipt_sequences (school_id, year, last_number)
     VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
    [schoolId, year],
  );
  const { rows } = await tx.query<{ last_number: number }>(
    `UPDATE receipt_sequences SET last_number = last_number + 1
      WHERE school_id = $1 AND year = $2 RETURNING last_number`,
    [schoolId, year],
  );
  return `${prefix}-${year}-${String(rows[0]!.last_number).padStart(5, '0')}`;
}
