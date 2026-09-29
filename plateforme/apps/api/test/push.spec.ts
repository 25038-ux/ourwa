import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PushService } from '../src/push/push.service.js';
import { NotificationsService } from '../src/parent/notifications.service.js';
import { PedagogyService } from '../src/pedagogy/pedagogy.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES NOTIFICATIONS POUSSÉES — ce qui doit être vrai avant qu'un téléphone
 * vibre.
 *
 *   - une notification écrite pour une famille met UNE ligne en file, rendue
 *     dans la langue du compte ;
 *   - la note d'un enfant ne part jamais vers un écran verrouillé ;
 *   - un jeton enregistré dans une école est invisible depuis l'autre ;
 *   - une absence prise au registre prévient la famille, un présent non.
 *
 * L'envoi lui-même (FCM) n'est pas testé ici : il demande un compte de
 * service, et la file est précisément ce qui le rend inutile pour prouver le
 * reste.
 */

let owner: pg.Pool;
let push: PushService;
let notifications: NotificationsService;
let pedagogy: PedagogyService;

let nour: string;
let rissala: string;
let annee: string;
let groupe: string;
let enseignement: string;
let parentAr: string;
let parentFr: string;
let enfantAr: string;
let enfantFr: string;
let ACTOR: string;

const dans = <T>(school: string, fn: () => Promise<T>) =>
  runInTenant({ schoolId: school, slug: 'push' }, fn);

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const ecoles = await owner.query<{ id: string; slug: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix)
     VALUES ('push-nour', 'Push Nour', 'PN'), ('push-rissala', 'Push Rissala', 'PR')
     RETURNING id, slug`,
  );
  nour = ecoles.rows.find((r) => r.slug === 'push-nour')!.id;
  rissala = ecoles.rows.find((r) => r.slug === 'push-rissala')!.id;

  annee = (
    await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2020-2021', 2020, 'active') RETURNING id`,
      [nour],
    )
  ).rows[0]!.id;
  const niveau = (
    await owner.query<{ id: string }>(
      `INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '6e', 1000, 'college') RETURNING id`,
      [nour],
    )
  ).rows[0]!.id;
  groupe = (
    await owner.query<{ id: string }>(
      `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6e A') RETURNING id`,
      [nour, niveau],
    )
  ).rows[0]!.id;
  const matiere = (
    await owner.query<{ id: string }>(
      `INSERT INTO subjects (school_id, level_id, name) VALUES ($1, $2, 'Maths') RETURNING id`,
      [nour, niveau],
    )
  ).rows[0]!.id;
  const prof = (
    await owner.query<{ id: string }>(
      `INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, 'Prof', 'Push') RETURNING id`,
      [nour],
    )
  ).rows[0]!.id;
  enseignement = (
    await owner.query<{ id: string }>(
      `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [nour, annee, prof, groupe, matiere],
    )
  ).rows[0]!.id;

  ACTOR = (
    await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name) VALUES ('push.actor@test', 'x', 'Actor') RETURNING id`,
    )
  ).rows[0]!.id;
  parentAr = (
    await owner.query<{ id: string }>(
      `INSERT INTO users (phone, password_hash, full_name, locale)
       VALUES ('+22200009001', 'x', 'Parent AR', 'ar') RETURNING id`,
    )
  ).rows[0]!.id;
  parentFr = (
    await owner.query<{ id: string }>(
      `INSERT INTO users (phone, password_hash, full_name, locale)
       VALUES ('+22200009002', 'x', 'Parent FR', 'fr') RETURNING id`,
    )
  ).rows[0]!.id;
  const enfants = await owner.query<{ id: string; rim: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name) VALUES
       ($1, $2, 'P-AR', 'N-AR', 'Aicha', 'Test'),
       ($1, $3, 'P-FR', 'N-FR', 'Bilal', 'Test')
     RETURNING id, rim`,
    [nour, parentAr, parentFr],
  );
  enfantAr = enfants.rows.find((r) => r.rim === 'P-AR')!.id;
  enfantFr = enfants.rows.find((r) => r.rim === 'P-FR')!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  push = moduleRef.get(PushService);
  notifications = moduleRef.get(NotificationsService);
  pedagogy = moduleRef.get(PedagogyService);
});

afterAll(async () => {
  await owner.query('DELETE FROM outbound_push WHERE school_id IN ($1, $2)', [nour, rissala]);
  await owner.query('DELETE FROM schools WHERE id IN ($1, $2)', [nour, rissala]);
  await owner.query("DELETE FROM users WHERE email = 'push.actor@test' OR phone LIKE '+2220000900%'");
  await owner.end();
});

async function enFile(userId: string) {
  const { rows } = await owner.query<{ title: string; body: string; route: string | null }>(
    'SELECT title, body, route FROM outbound_push WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
  return rows;
}

describe('notifier()', () => {
  it('écrit la notification ET met en file, dans la langue du compte', async () => {
    await dans(nour, () =>
      notifications['db'].query((tx) =>
        notifications.notifier(tx, {
          guardianId: parentAr,
          studentId: enfantAr,
          academicYearId: annee,
          kind: 'absence',
          souche: 'notif_absence',
          params: { eleve: 'Aicha Test', date: '12/09/2020' },
          route: 'absences',
        }),
      ),
    );
    const file = await enFile(parentAr);
    expect(file).toHaveLength(1);
    expect(file[0]!.title).toBe('تسجيل غياب');
    expect(file[0]!.body).toContain('Aicha Test');
    expect(file[0]!.route).toBe('absences');

    const { rows } = await owner.query(
      "SELECT i18n_key FROM notifications WHERE guardian_id = $1 AND kind = 'absence'",
      [parentAr],
    );
    expect(rows).toHaveLength(1);
  });

  it('⚠ ne met jamais la note sur l’écran verrouillé', async () => {
    await dans(nour, () =>
      notifications['db'].query((tx) =>
        notifications.notifier(tx, {
          guardianId: parentFr,
          studentId: enfantFr,
          academicYearId: annee,
          kind: 'grade',
          souche: 'notif_note',
          params: { eleve: 'Bilal Test', note: '4.5', matiere: 'Maths', trimestre: 'T1' },
        }),
      ),
    );
    const file = await enFile(parentFr);
    expect(file[0]!.title).toBe('Nouvelle note : Maths');
    expect(file[0]!.body).not.toContain('4.5');
    // Et la notification, elle, porte bien la note : le filtre est à l'écran.
    const { rows } = await owner.query<{ i18n_params: { note: string } }>(
      "SELECT i18n_params FROM notifications WHERE guardian_id = $1 AND kind = 'grade'",
      [parentFr],
    );
    expect(rows[0]!.i18n_params.note).toBe('4.5');
  });
});

describe('le registre', () => {
  it('prévient la famille d’une absence et d’un retard, pas d’une présence', async () => {
    const avant = (await enFile(parentAr)).length;
    await dans(nour, () =>
      pedagogy.enregistrerAppel(
        {
          groupId: groupe,
          date: '2020-11-03',
          academicYearId: annee,
          teachingId: enseignement,
          statuts: [
            { studentId: enfantAr, statut: 'absent' },
            { studentId: enfantFr, statut: 'present' },
          ],
        },
        ACTOR,
      ),
    );
    const ar = await enFile(parentAr);
    expect(ar.length).toBe(avant + 1);
    expect(ar.at(-1)!.body).toContain('03/11/2020');
    // Bilal était présent : rien de plus pour sa famille.
    expect((await enFile(parentFr)).length).toBe(1);
  });
});

describe('les appareils', () => {
  it('s’enregistrent, se ré-enregistrent sans doublon, et se retirent', async () => {
    const jeton = 'fcm-token-'.padEnd(40, 'x');
    await dans(nour, () => push.registerDevice(parentAr, 'android', jeton, 'ar'));
    await dans(nour, () => push.registerDevice(parentAr, 'android', jeton, 'ar'));
    let n = await owner.query('SELECT COUNT(*)::int AS n FROM device_tokens WHERE user_id = $1', [parentAr]);
    expect(n.rows[0]!.n).toBe(1);
    await dans(nour, () => push.unregisterDevice(parentAr, jeton));
    n = await owner.query('SELECT COUNT(*)::int AS n FROM device_tokens WHERE user_id = $1', [parentAr]);
    expect(n.rows[0]!.n).toBe(0);
  });

  it('⚠ un jeton d’une école est invisible depuis l’autre', async () => {
    const jeton = 'fcm-token-nour-'.padEnd(40, 'y');
    await dans(nour, () => push.registerDevice(parentAr, 'ios', jeton, 'fr'));
    // Depuis Rissala, avec le bon utilisateur : rien à voir, rien à retirer.
    await dans(rissala, () => push.unregisterDevice(parentAr, jeton));
    const n = await owner.query('SELECT COUNT(*)::int AS n FROM device_tokens WHERE token = $1', [jeton]);
    expect(n.rows[0]!.n).toBe(1);
  });
});

describe('drain()', () => {
  it('ne touche à rien quand FCM n’est pas configuré, et ne perd rien', async () => {
    delete process.env.FCM_SERVICE_ACCOUNT;
    const avant = await owner.query("SELECT COUNT(*)::int AS n FROM outbound_push WHERE status = 'pending'");
    expect(PushService.configured()).toBe(false);
    // Une passe sans compte : chaque ligne reste, et compte une tentative
    // échouée plutôt qu'un envoi réussi.
    const r = await push.drain();
    expect(r.sent).toBe(0);
    const apres = await owner.query("SELECT COUNT(*)::int AS n FROM outbound_push WHERE status IN ('pending','abandoned')");
    expect(apres.rows[0]!.n).toBe(avant.rows[0]!.n);
  });
});
