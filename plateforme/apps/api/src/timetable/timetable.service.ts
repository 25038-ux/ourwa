import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../parent/notifications.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * The weekly timetable.
 *
 * A grid of day × slot per class group, each cell holding one teaching
 * assignment — `emploi_du_temps.php` : sept jours, trois créneaux, et les
 * horaires sont affichés, jamais stockés (voir `0008`).
 */
@Injectable()
export class TimetableService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
      @Inject(NotificationsService) private readonly notifications: NotificationsService,
) {}

  /** One class group's week. */
  async forGroup(groupId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT ts.id, ts.day_of_week, ts.slot, ts.teaching_id,
                t.subject_id, sub.name AS subject, sub.name_ar AS subject_ar,
                te.first_name, te.last_name
           FROM timetable_slots ts
           JOIN teachings t ON t.id = ts.teaching_id
           LEFT JOIN subjects sub ON sub.id = t.subject_id
           LEFT JOIN teachers te ON te.id = t.teacher_id
          WHERE ts.group_id = $1
          ORDER BY ts.day_of_week, ts.slot`,
        [groupId],
      );
      return rows;
    });
  }

  /**
   * One teacher's own week, across every class they teach.
   */
  async forTeacher(teacherId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT ts.day_of_week, ts.slot,
                g.name AS group_name, l.name AS level_name,
                sub.name AS subject
           FROM timetable_slots ts
           JOIN teachings t ON t.id = ts.teaching_id
           JOIN groups g ON g.id = ts.group_id
           LEFT JOIN levels l ON l.id = g.level_id
           LEFT JOIN subjects sub ON sub.id = t.subject_id
          WHERE t.teacher_id = $1
          ORDER BY ts.day_of_week, ts.slot`,
        [teacherId],
      );
      return rows;
    });
  }

  /**
   * LES ENSEIGNEMENTS COURANTS D'UN GROUPE — son `SQL_ENS_COURANTS`
   * (`includes/referentiels.php`) : UNE affectation par (groupe, matière), la
   * plus récente, toutes années confondues — « 190 couples existent sur deux
   * années, donc chaque matière apparaissait DEUX fois dans les listes ».
   * Son MAX(id) est un entier repris ; ici l'entier repris d'abord, puis
   * l'UUID v7, ordonné dans le temps. Triés par nom de matière.
   */
  async enseignementsCourants(groupId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        subject_id: string;
        subject_name: string;
        coefficient: number;
        hours_per_week: string;
        first_name: string | null;
        last_name: string | null;
      }>(
        `SELECT c.id, c.subject_id, s.name AS subject_name, s.coefficient,
                c.hours_per_week::text, te.first_name, te.last_name
           FROM (SELECT DISTINCT ON (t.subject_id) t.*
                   FROM teachings t
                  WHERE t.group_id = $1
                  ORDER BY t.subject_id, (t.legacy_id IS NULL) DESC, t.legacy_id DESC, t.id DESC) c
           JOIN subjects s ON s.id = c.subject_id
           JOIN teachers te ON te.id = c.teacher_id
          ORDER BY s.name`,
        [groupId],
      );
      return rows;
    });
  }

  /**
   * PLACER — son `placer`. L'enseignement doit appartenir au groupe, sinon
   * « Enseignement invalide pour ce groupe. » ; une matière ne peut occuper
   * plus de floor(heures par semaine / 2) cases (au moins une) — il compte
   * TOUTES les cases de la matière dans la grille du groupe ; puis
   * `ON DUPLICATE KEY UPDATE`. Rien d'autre : il ne vérifie pas qu'un
   * professeur soit ailleurs au même créneau, nous ne le faisons pas non plus.
   */
  async assign(
    input: { groupId: string; dayOfWeek: number; slot: number; teachingId: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows: ens } = await tx.query<{ hours_per_week: string; subject_id: string }>(
        'SELECT hours_per_week::text, subject_id FROM teachings WHERE id = $1 AND group_id = $2',
        [input.teachingId, input.groupId],
      );
      if (!ens[0]) throw new BadRequestException('Enseignement invalide pour ce groupe.');

      const max = Math.max(1, Math.floor(Number(ens[0].hours_per_week) / 2));
      const { rows: placed } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM timetable_slots ts
           JOIN teachings t ON t.id = ts.teaching_id
          WHERE ts.group_id = $1 AND t.subject_id = $2`,
        [input.groupId, ens[0].subject_id],
      );
      const deja = Number(placed[0]!.n);
      if (deja >= max) {
        throw new BadRequestException(
          `Limite atteinte pour cette matière (${deja}/${max} cases). Réduisez ou supprimez une autre case.`,
        );
      }

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO timetable_slots (school_id, group_id, teaching_id, day_of_week, slot)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (school_id, group_id, day_of_week, slot)
         DO UPDATE SET teaching_id = EXCLUDED.teaching_id
         RETURNING id`,
        [schoolId, input.groupId, input.teachingId, input.dayOfWeek, input.slot],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'timetable_assigned',
          entity: 'timetable_slot',
          entityId: rows[0]!.id,
          after: { day: input.dayOfWeek, slot: input.slot, teachingId: input.teachingId },
        },
        tx,
      );

      return { id: rows[0]!.id };
    });
  }

  /**
   * VALIDER — son `valider` : notifie chaque correspondant (DISTINCT) d'un
   * élève inscrit dans ce groupe l'année consultée, hors inscriptions
   * annulées ; « Emploi du temps publié » ; journalise. Il ne vérifie pas que
   * la grille soit remplie, ni ne demande confirmation.
   */
  async publish(groupId: string, academicYearId: string, actorId: string) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows: info } = await tx.query<{ label: string }>(
        `SELECT COALESCE(l.name, '—') || ' / ' || g.name AS label
           FROM groups g LEFT JOIN levels l ON l.id = g.level_id
          WHERE g.id = $1`,
        [groupId],
      );
      if (info.length === 0) throw new NotFoundException('Classe introuvable.');
      const label = info[0]!.label;

      // DISTINCT ON the guardian: one row per household. `student_id` is left
      // null because the message is about the CLASS, not about one child — a
      // notification tied to one sibling would look like the other's timetable
      // was unchanged.
      const { rows: sent } = await tx.query<{ guardian_id: string }>(
        `INSERT INTO notifications
           (school_id, guardian_id, student_id, academic_year_id, kind, i18n_key, i18n_params)
         -- ⚠ L'ANNÉE, sinon le fil des familles (filtré sur l'année active) et la
         -- tâche de fond ne montrent jamais « Emploi du temps publié ».
         SELECT DISTINCT $1::uuid, st.guardian_id, NULL::uuid, $3::uuid,
                'timetable', 'notif_emploi',
                jsonb_build_object('groupe', $4::text)
           FROM enrollments e
           JOIN students st ON st.id = e.student_id
          WHERE e.group_id = $2 AND e.academic_year_id = $3
            AND e.status <> 'cancelled' AND st.guardian_id IS NOT NULL
         RETURNING guardian_id`,
        [schoolId, groupId, academicYearId, label],
      );
      await this.notifications.pousser(
        tx,
        sent.map((r) => ({ guardianId: r.guardian_id, params: { groupe: label } })),
        'notif_emploi',
        'emploi',
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'timetable_published',
          entity: 'group',
          entityId: groupId,
          after: { label, notified: String(sent.length) },
        },
        tx,
      );

      return { notified: sent.length, label };
    });
  }

  /** EFFACER UNE CASE — son `effacer_case`. */
  async clear(groupId: string, dayOfWeek: number, slot: number, actorId: string) {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const result = await tx.query(
        `DELETE FROM timetable_slots
          WHERE group_id = $1 AND day_of_week = $2 AND slot = $3`,
        [groupId, dayOfWeek, slot],
      );
      if ((result.rowCount ?? 0) > 0) {
        await this.audit.record(
          {
            actorId,
            schoolId,
            action: 'timetable_cleared',
            entity: 'timetable_slot',
            before: { groupId, day: dayOfWeek, slot },
          },
          tx,
        );
      }
      return { cleared: result.rowCount ?? 0 };
    });
  }
}
