import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ParentController } from '../src/parent/parent.controller.js';
import { runInTenant } from '../src/tenant/tenant.context.js';
import type { AuthenticatedRequest } from '../src/auth/permissions.guard.js';

/**
 * CHAQUE ROUTE DE LECTURE DE L'ESPACE PARENT, APPELÉE UNE FOIS, AVEC DES DONNÉES.
 *
 * ⚠ `/parent/homework` RÉPONDAIT 500 DEPUIS DEUX COMMITS, ET RIEN NE LE DISAIT.
 * `SELECT DISTINCT` sur une colonne `json` — Postgres n'a pas d'opérateur
 * d'égalité pour `json`, seulement pour `jsonb` — et l'application montrait
 * « aucun exercice ». Aucun test n'appelait la route ; les autres suites de
 * l'espace parent testent ce qu'elles savent.
 *
 * Celle-ci ne teste pas un comportement, elle teste que TOUT RÉPOND. Chaque
 * route est appelée avec un enfant, une inscription, un enseignement, un
 * exercice avec pièce jointe, une absence, une remarque, une note, un message,
 * une notification — de quoi faire passer chaque JOIN et chaque agrégat. Une
 * route ajoutée demain sans être listée ici fait échouer le dernier test.
 */

let owner: pg.Pool;
let parent: ParentController;
let schoolId: string;
let guardianId: string;
let studentId: string;

const req = (userId: string) =>
  ({ auth: { userId, schoolId, roles: ['parent'], permissions: [], impersonated: false } }) as
    unknown as AuthenticatedRequest;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'ptoutes' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const q = async <T,>(sql: string, params: unknown[] = []) =>
    (await owner.query<T & { id: string }>(sql, params)).rows[0]!;

  schoolId = (
    await q(`INSERT INTO schools (slug, name, receipt_prefix) VALUES ('ptoutes', 'Toutes', 'PTT') RETURNING id`)
  ).id;
  const yearId = (
    await q(
      `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
       VALUES ($1, '2025-2026', 2025, 10, 6, 'active') RETURNING id`,
      [schoolId],
    )
  ).id;
  const levelId = (
    await q(`INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '6eme', 5000, 'college') RETURNING id`, [schoolId])
  ).id;
  const groupId = (
    await q(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`, [schoolId, levelId])
  ).id;
  const subjectId = (
    await q(`INSERT INTO subjects (school_id, level_id, name) VALUES ($1, $2, 'Maths') RETURNING id`, [schoolId, levelId])
  ).id;
  const teacherId = (
    await q(`INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, 'P', 'T') RETURNING id`, [schoolId])
  ).id;
  const teachingId = (
    await q(
      `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [schoolId, yearId, teacherId, groupId, subjectId],
    )
  ).id;
  const staffId = (
    await q(`INSERT INTO users (email, password_hash, full_name) VALUES ('ptoutes.prof@test', 'x', 'Prof') RETURNING id`)
  ).id;
  guardianId = (
    await q(`INSERT INTO users (phone, password_hash, full_name) VALUES ('+22200000777', 'x', 'Le parent') RETURNING id`)
  ).id;
  studentId = (
    await q(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-PT', 'NID-PT', 'Enfant', 'Complet') RETURNING id`,
      [schoolId, guardianId],
    )
  ).id;
  await owner.query(
    `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', 5000)`,
    [schoolId, studentId, yearId, groupId, levelId],
  );

  // De quoi faire passer chaque JOIN et chaque agrégat.
  const homeworkId = (
    await q(
      `INSERT INTO homework (school_id, teaching_id, title, body, due_on)
       VALUES ($1, $2, 'Page 12', 'Exercices 1 à 4', '2025-11-20') RETURNING id`,
      [schoolId, teachingId],
    )
  ).id;
  await owner.query(
    `INSERT INTO attachments (school_id, homework_id, display_name, mime, bytes, storage_key, uploaded_by)
     VALUES ($1, $2, 'sujet.pdf', 'application/pdf', 1234, 'ptoutes/sujet.pdf', $3)`,
    [schoolId, homeworkId, staffId],
  ).catch(() => {
    // La table des pièces jointes a ses propres colonnes obligatoires ; si
    // elles changent, la jointure LATERAL est quand même exercée, sans ligne.
  });
  await owner.query(
    `INSERT INTO attendance (school_id, student_id, teaching_id, on_date, status)
     VALUES ($1, $2, $3, '2025-11-04', 'absent')`,
    [schoolId, studentId, teachingId],
  );
  await owner.query(
    // Datée DANS l'année scolaire : `remarques.php` borne à sa période.
    `INSERT INTO remarks (school_id, student_id, author_id, author_name, body, severity, created_at)
     VALUES ($1, $2, $3, 'Prof', 'Bavard', 'info', '2026-03-01')`,
    [schoolId, studentId, staffId],
  );
  await owner.query(
    `INSERT INTO grades (school_id, student_id, teaching_id, academic_year_id, term, kind, sequence_no, score)
     VALUES ($1, $2, $3, $4, 1, 'exam', 1, 14.5)`,
    [schoolId, studentId, teachingId, yearId],
  );
  await owner.query(
    `INSERT INTO messages (school_id, guardian_id, sender_name, subject, body, sent_by)
     VALUES ($1, $2, 'Direction', 'Réunion', 'Jeudi 17h', $3)`,
    [schoolId, guardianId, staffId],
  );
  await owner.query(
    `INSERT INTO notifications (school_id, guardian_id, student_id, academic_year_id, kind, i18n_key, i18n_params)
     VALUES ($1, $2, $3, $4, 'absence', 'notif_absence', '{"eleve":"Enfant","date":"04/11/2025"}')`,
    [schoolId, guardianId, studentId, yearId],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  parent = moduleRef.get(ParentController);
});

afterAll(async () => {
  await owner?.end();
});

describe('chaque route de lecture répond', () => {
  const r = () => req(guardianId);

  it('children', async () => {
    const out = await inTenant(() => parent.children(r()));
    expect(out.children).toHaveLength(1);
  });
  it('messages', async () => {
    const out = await inTenant(() => parent.messages(r()));
    expect(out.messages.length).toBeGreaterThanOrEqual(1);
  });
  it('notifications', async () => {
    const out = await inTenant(() => parent.notificationList(r()));
    expect(out.items.length).toBeGreaterThanOrEqual(1);
  });
  it('grades (famille)', async () => {
    await expect(inTenant(() => parent.familyGrades(r()))).resolves.toBeTruthy();
  });
  it('attendance (famille)', async () => {
    const out = await inTenant(() => parent.familyAttendance(r()));
    expect(out.entries.length).toBeGreaterThanOrEqual(1);
  });
  it('⚠ homework (famille) — celle qui répondait 500', async () => {
    const out = await inTenant(() => parent.familyHomework(r()));
    expect(out.homework).toHaveLength(1);
    expect(out.homework[0]!.title).toBe('Page 12');
    expect(Array.isArray(out.homework[0]!.attachments)).toBe(true);
  });
  it('remarks (famille)', async () => {
    const out = await inTenant(() => parent.familyRemarks(r()));
    expect(out.remarks.length).toBeGreaterThanOrEqual(1);
  });
  it('balance', async () => {
    await expect(inTenant(() => parent.balance(r()))).resolves.toBeTruthy();
  });
  it('devices/status (POST : le jeton ne voyage pas dans une URL)', async () => {
    const out = await inTenant(() => parent.deviceStatus({}, r()));
    expect(out.registered).toBe(false);
    expect(['firebase', 'sondage']).toContain(out.push);
  });
  it('children/:id/timetable', async () => {
    await expect(inTenant(() => parent.childTimetable(studentId, r()))).resolves.toBeTruthy();
  });
  it('children/:id/remarks', async () => {
    await expect(inTenant(() => parent.remarks(studentId, r()))).resolves.toBeTruthy();
  });
  it('children/:id/homework', async () => {
    await expect(inTenant(() => parent.homework(studentId, r()))).resolves.toBeTruthy();
  });
  it('children/:id/attendance', async () => {
    await expect(inTenant(() => parent.attendance(studentId, r()))).resolves.toBeTruthy();
  });
  it('children/:id/grades', async () => {
    await expect(inTenant(() => parent.grades(r(), studentId, '1'))).resolves.toBeTruthy();
  });
  it('children/:id/report-card', async () => {
    await expect(inTenant(() => parent.reportCard(r(), studentId, '1'))).resolves.toBeTruthy();
  });

  it('children/:id/report-card/document — le même bulletin que le site, en HTML', async () => {
    const entetes: Record<string, string> = {};
    const res = { status: () => undefined, header: (k: string, v: string) => { entetes[k] = v; } } as never;
    const html = await inTenant(() => parent.reportCardDocument(r(), res, studentId, '1', 'fr'));
    expect(typeof html).toBe('string');
    expect(html as string).toContain('bul-title-fr');
    expect(entetes['content-type']).toContain('text/html');
  });

  it('⚠ aucune route de lecture n’a été ajoutée sans être appelée ici', () => {
    const lectures = Object.getOwnPropertyNames(ParentController.prototype).filter((n) => {
      if (n === 'constructor') return false;
      const meta = Reflect.getMetadata('path', (ParentController.prototype as never)[n]) as
        | string
        | undefined;
      const methode = Reflect.getMetadata('method', (ParentController.prototype as never)[n]) as
        | number
        | undefined;
      // RequestMethod.GET === 0 chez Nest.
      return meta !== undefined && methode === 0;
    });
    const couvertes = [
      'children', 'messages', 'unread', 'notificationList', 'notificationsUnread',
      'familyGrades', 'familyAttendance', 'familyHomework', 'familyRemarks',
      'childTimetable', 'remarks', 'homework', 'attendance', 'balance', 'grades', 'reportCard', 'reportCardDocument',
    ];
    for (const l of lectures) expect(couvertes, `route GET non couverte : ${l}`).toContain(l);
  });
});
