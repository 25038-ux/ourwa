import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hash as argonHash } from '@node-rs/argon2';
import { payableMonths, firstOwedMonthOrder } from './academic-year.js';

/**
 * UNE ÉCOLE « SERVICES » DE DÉVELOPPEMENT — `jinan.localhost:3000`.
 *
 *   pnpm seed && pnpm --filter @elourwa/db seed:jinan
 *
 * ⚠ JAMAIS EN PRODUCTION. Tout y est inventé — niveaux, tarifs, prix, noms —
 * pour exercer la facturation « services » (ADR-0073,
 * docs/specs/jinan-facturation.md) et les absences du personnel (ADR-0074)
 * dans un navigateur : rien ici ne dit ce que l'école Jinan facture
 * réellement ; ses tarifs se saisissent sur son site, page « Frais ».
 *
 * Ce que cela pose, à côté des trois écoles de `pnpm seed` (qui ne voient
 * rien de nouveau) :
 *   - l'école `jinan` (facturation « services », reçus JIN-…) ;
 *   - la direction, un comptable, une secrétaire, un collecteur d'absence
 *     (`admin@jinan.test`, … — mot de passe `dev12345`) ;
 *   - 2024-2025 close, 2025-2026 active (ses mois sont échus : il y a de la
 *     dette), 2026-2027 à venir ;
 *   - quatre niveaux, leurs tarifs 8h – 14h / 8h – 17h et leurs frais
 *     d'inscription, deux classes chacun, des matières ;
 *   - les six prix des services, pour les deux années ;
 *   - six professeurs (`prof0@jinan.test` …), leurs enseignements et un
 *     emploi du temps ; quatre agents et leurs horaires de travail ;
 *   - trois familles inscrites (modes différents, cantine, piscine…) — sans
 *     aucun paiement : les tests du navigateur encaissent eux-mêmes ; une
 *     quatrième, inscrite l'an dernier seulement (gratuite, sans dette), à
 *     réinscrire.
 *
 * Relançable : l'école `jinan` et tout ce qui lui appartient sont d'abord
 * supprimés (ses paiements de service compris), puis recréés à l'identique.
 * Les comptes `@jinan.test` aussi. Les autres écoles ne sont pas touchées.
 */

const PASSWORD = 'dev12345';
const SLUG = 'jinan';

const LEVELS = [
  { name: '1 AF', t14: 3000, t17: 4500, fee: 2000, order: 10 },
  { name: '2 AF', t14: 3200, t17: 4800, fee: 2000, order: 20 },
  { name: '3 AF', t14: 3500, t17: 5000, fee: 1500, order: 30 },
  // Inscription gratuite : « 0 », pas « non défini ».
  { name: '4 AF', t14: 3800, t17: 5500, fee: 0, order: 40 },
] as const;

const SUBJECTS = [
  { name: 'Mathématiques', ar: 'الرياضيات', coef: 1, max: 20 },
  { name: 'Français', ar: 'الفرنسية', coef: 1, max: 20 },
  { name: 'Arabe', ar: 'العربية', coef: 1, max: 20 },
] as const;

const PRIX = {
  cantine_petit_dejeuner: 800,
  cantine_dejeuner: 1500,
  cantine_complet: 2000,
  piscine: 1000,
  docteur: 500,
  photocopie: 700,
} as const;

/** Les agents et leurs horaires : 1 = lundi … 6 = samedi. */
const STAFF = [
  { first: 'Mariem', last: 'Mint Ahmed', sex: 'F', title: 'Surveillante', salary: 25000, days: [1, 2, 3, 4, 5], from: '07:30', to: '14:30' },
  { first: 'Sidi', last: 'Ould Salem', sex: 'M', title: 'Gardien', salary: 20000, days: [1, 2, 3, 4, 5, 6], from: '07:00', to: '17:30' },
  { first: 'Aichetou', last: 'Mint Brahim', sex: 'F', title: 'Cuisinière', salary: 22000, days: [1, 2, 3, 4, 5], from: '10:00', to: '15:00' },
  { first: 'Yahya', last: 'Ould Cheikh', sex: 'M', title: 'Chauffeur', salary: 24000, days: [1, 2, 3, 4, 5], from: '07:00', to: '09:00' },
] as const;

const TEACHERS = [
  ['Ahmed', 'Ould Mohamed', 'M'], ['Fatimetou', 'Mint Sidi', 'F'], ['Brahim', 'Ould Taleb', 'M'],
  ['Khadijetou', 'Mint Ely', 'F'], ['Moustapha', 'Ould Jeuda', 'M'], ['Selma', 'Mint Brahim', 'F'],
] as const;

/** Trois familles, des enfants dans des modes différents. */
const FAMILIES = [
  {
    parent: 'Mohamed Ould Abdallahi', phone: '46000001',
    enfants: [
      { first: 'Aminetou', last: 'Mint Mohamed', sex: 'F', level: '1 AF', mode: '8h-17h', services: ['cantine_dejeuner', 'piscine'] },
      { first: 'Hamoud', last: 'Ould Mohamed', sex: 'M', level: '3 AF', mode: '8h-14h', services: ['cantine_petit_dejeuner', 'photocopie'] },
    ],
  },
  {
    parent: 'Zeinabou Mint Bilal', phone: '46000002',
    enfants: [
      { first: 'Ely', last: 'Ould Bilal', sex: 'M', level: '2 AF', mode: '8h-14h', services: [] },
    ],
  },
  {
    parent: 'Baba Ould Deddahi', phone: '46000003',
    enfants: [
      { first: 'Lalla', last: 'Mint Deddahi', sex: 'F', level: '4 AF', mode: '8h-17h', services: ['cantine_complet', 'docteur', 'photocopie'] },
    ],
  },
] as const;

const MENSUELS = new Set(['cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet', 'piscine', 'docteur']);

/** Supprime l'école de développement et ses comptes, dans l'ordre que les clés NO ACTION exigent. */
async function effacer(db: pg.Client): Promise<void> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM schools WHERE slug = $1', [SLUG]);
  const schoolId = rows[0]?.id;
  if (schoolId) {
    // Le grand livre des services refuse (NO ACTION) qu'on retire un abonnement
    // encaissé : on retire donc d'abord ses lignes, annulations en premier.
    await db.query('DELETE FROM service_payments WHERE school_id = $1 AND reverses_id IS NOT NULL', [schoolId]);
    await db.query('DELETE FROM service_payments WHERE school_id = $1', [schoolId]);
    await db.query('DELETE FROM schools WHERE id = $1', [schoolId]);
  }
  await db.query(
    `DELETE FROM users WHERE email LIKE '%@jinan.test' OR email LIKE 'parent%.jinan@test'`,
  );
}

export async function seedJinan(url: string): Promise<void> {
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const pwd = await argonHash(PASSWORD);
  try {
    await db.query('BEGIN');
    const { rows: roles } = await db.query<{ id: string; code: string }>('SELECT id, code FROM roles');
    const role = new Map(roles.map((r) => [r.code, r.id]));
    if (!role.get('super_admin')) throw new Error('Catalogue des rôles absent : lancez d’abord `pnpm seed`.');

    await effacer(db);

    const { rows: sr } = await db.query<{ id: string }>(
      `INSERT INTO schools (slug, name, name_ar, receipt_prefix, theme_color, logo_emoji, billing_model)
       VALUES ($1, 'Heavenly Private Educational Institution', 'جنان', 'JIN', '#047857', '🌿', 'services') RETURNING id`,
      [SLUG],
    );
    const schoolId = sr[0]!.id;
    await db.query(
      `INSERT INTO school_domains (school_id, hostname, is_primary) VALUES ($1, 'jinan.localhost', true)`,
      [schoolId],
    );

    // ── Comptes ────────────────────────────────────────────────────────────
    const comptes = new Map<string, string>();
    for (const [local, name, code] of [
      ['admin', 'Direction Jinan', 'super_admin'],
      ['comptable', 'Comptable Jinan', 'comptable'],
      ['secretaire', 'Secrétaire Jinan', 'secretaire'],
      ['absence', "Collecteur d'absence Jinan", 'collecteur_absence'],
    ] as const) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
        [`${local}@jinan.test`, pwd, name],
      );
      comptes.set(local, rows[0]!.id);
      await db.query(
        'INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)',
        [rows[0]!.id, schoolId, role.get(code)],
      );
    }

    // ── Années ─────────────────────────────────────────────────────────────
    const years = new Map<number, string>();
    for (const [startYear, status] of [[2024, 'closed'], [2025, 'active'], [2026, 'future']] as const) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, label, start_year, status, closed_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [schoolId, `${startYear}-${startYear + 1}`, startYear, status, status === 'closed' ? `${startYear + 1}-07-01` : null],
      );
      years.set(startYear, rows[0]!.id);
    }
    const yearId = years.get(2025)!;
    const shape = { startYear: 2025, startMonth: 10, endMonth: 6 };
    const months = payableMonths(shape);

    for (const [startYear, id] of years) {
      if (startYear < 2025) continue;
      for (const [service, amount] of Object.entries(PRIX)) {
        await db.query(
          `INSERT INTO service_prices (school_id, academic_year_id, service, amount, updated_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [schoolId, id, service, String(amount + (startYear === 2026 ? 100 : 0)), comptes.get('admin')],
        );
      }
    }

    // ── Niveaux, classes, matières ─────────────────────────────────────────
    const levels = new Map<string, { id: string; groups: string[]; subjects: string[]; t14: number; t17: number; fee: number }>();
    for (const lv of LEVELS) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO levels (school_id, name, monthly_rate, monthly_rate_8h14, monthly_rate_8h17,
                             student_enrolment_fee, cycle, is_fondamental, sort_order)
         VALUES ($1, $2, 0, $3, $4, $5, 'fondamental', true, $6) RETURNING id`,
        [schoolId, lv.name, String(lv.t14), String(lv.t17), String(lv.fee), lv.order],
      );
      const levelId = rows[0]!.id;
      const groups: string[] = [];
      for (const suffix of ['A', 'B']) {
        const { rows: g } = await db.query<{ id: string }>(
          `INSERT INTO groups (school_id, level_id, name, capacity) VALUES ($1, $2, $3, 30) RETURNING id`,
          [schoolId, levelId, `${lv.name} ${suffix}`],
        );
        groups.push(g[0]!.id);
      }
      const subjects: string[] = [];
      for (const s of SUBJECTS) {
        const { rows: sub } = await db.query<{ id: string }>(
          `INSERT INTO subjects (school_id, level_id, name, name_ar, coefficient, max_score)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [schoolId, levelId, s.name, s.ar, s.coef, s.max],
        );
        subjects.push(sub[0]!.id);
      }
      levels.set(lv.name, { id: levelId, groups, subjects, t14: lv.t14, t17: lv.t17, fee: lv.fee });
    }

    // ── Professeurs, enseignements, emploi du temps ────────────────────────
    const teacherIds: string[] = [];
    for (const [i, [first, last, sex]] of TEACHERS.entries()) {
      const { rows: u } = await db.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
        [`prof${i}@jinan.test`, pwd, `${first} ${last}`],
      );
      await db.query(
        'INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)',
        [u[0]!.id, schoolId, role.get('professeur')],
      );
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO teachers (school_id, user_id, first_name, last_name, sex, phone, employment, hourly_rate, salary)
         VALUES ($1, $2, $3, $4, $5, $6, 'permanent', 500, 30000) RETURNING id`,
        [schoolId, u[0]!.id, first, last, sex, `+2224600010${i}`],
      );
      teacherIds.push(rows[0]!.id);
    }

    // La classe n° g, la matière n° s est tenue par le professeur (g + s) mod 6,
    // les jours 1 + (g mod 3) et 4 + (g mod 3), au créneau s + 1. Les classes 0
    // et 6, 1 et 7 partagent ainsi un professeur au même créneau : le cas
    // « deux classes à la même heure » (qu'El Ourwa ne refuse pas) existe en
    // développement.
    let cellules = 0;
    const toutesLesClasses = [...levels.values()].flatMap((l) => l.groups.map((g) => ({ g, subjects: l.subjects })));
    for (const [gi, { g, subjects }] of toutesLesClasses.entries()) {
      for (const [si, subjectId] of subjects.entries()) {
        const teacherId = teacherIds[(gi + si) % teacherIds.length]!;
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id, hours_per_week)
           VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
          [schoolId, yearId, teacherId, g, subjectId],
        );
        // Deux créneaux par semaine et par matière : jours 1-3 puis 4-6, créneau si + 1.
        for (const day of [1 + (gi % 3), 4 + (gi % 3)]) {
          const r = await db.query(
            `INSERT INTO timetable_slots (school_id, group_id, teaching_id, day_of_week, slot)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [schoolId, g, rows[0]!.id, day, si + 1],
          );
          cellules += r.rowCount ?? 0;
        }
      }
    }

    // ── Agents et leurs horaires ───────────────────────────────────────────
    for (const s of STAFF) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO staff (school_id, first_name, last_name, sex, role_title, salary, hired_on)
         VALUES ($1, $2, $3, $4, $5, $6, '2025-09-01') RETURNING id`,
        [schoolId, s.first, s.last, s.sex, s.title, String(s.salary)],
      );
      for (const day of s.days) {
        await db.query(
          `INSERT INTO staff_work_hours (school_id, staff_id, day_of_week, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [schoolId, rows[0]!.id, day, s.from, s.to],
        );
      }
    }

    // ── Moyens de paiement ─────────────────────────────────────────────────
    for (const name of ['Espèces', 'Bankily', 'Masrvi']) {
      await db.query('INSERT INTO payment_methods (school_id, name) VALUES ($1, $2)', [schoolId, name]);
    }

    // ── Familles inscrites, avec leurs services ────────────────────────────
    // Comme `EnrollmentService.enrol` : mensualité = tarif du niveau pour le
    // mode, figée sur chaque mois ; l'inscription (frais du niveau, s'ils sont
    // > 0) et les services cochés, au prix de l'année, dès le premier mois dû.
    const entry = '2025-10-01';
    const firstOwed = firstOwedMonthOrder(shape, entry);
    const premier = months.find((m) => m.order === firstOwed)!;
    let n = 0;
    for (const [fi, fam] of FAMILIES.entries()) {
      const { rows: p } = await db.query<{ id: string }>(
        `INSERT INTO users (email, phone, password_hash, full_name) VALUES ($1, $2, $3, $4) RETURNING id`,
        [`parent${fi}.jinan@test`, fam.phone, pwd, fam.parent],
      );
      const guardianId = p[0]!.id;
      await db.query(
        'INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)',
        [guardianId, schoolId, role.get('parent')],
      );
      for (const e of fam.enfants) {
        n++;
        const lv = levels.get(e.level)!;
        const rate = String(e.mode === '8h-14h' ? lv.t14 : lv.t17);
        const { rows: st } = await db.query<{ id: string }>(
          `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name, sex, matricule)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [schoolId, guardianId, `RIM-JIN-${1000 + n}`, `JIN${30000000 + n}`, e.first, e.last, e.sex,
           `ET25${String(90000 + n)}`],
        );
        const studentId = st[0]!.id;
        const { rows: en } = await db.query<{ id: string }>(
          `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status,
                                    monthly_fee, full_rate, is_free, entry_date, study_mode)
           VALUES ($1, $2, $3, $4, $5, 'enrolled', $6, $6, false, $7, $8) RETURNING id`,
          [schoolId, studentId, yearId, lv.groups[0], lv.id, rate, entry, e.mode],
        );
        for (const m of months) {
          const owed = m.order >= firstOwed;
          await db.query(
            `INSERT INTO enrollment_months (school_id, enrollment_id, month_order, month_label, calendar_month,
                                            calendar_year, status, amount_due)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [schoolId, en[0]!.id, m.order, m.label, m.month, m.year, owed ? 'billable' : 'free', owed ? rate : '0'],
          );
        }
        const abonnements: { service: string; amount: string }[] = [];
        if (lv.fee > 0) abonnements.push({ service: 'inscription', amount: String(lv.fee) });
        for (const s of e.services) abonnements.push({ service: s, amount: String(PRIX[s]) });
        for (const a of abonnements) {
          const { rows: ss } = await db.query<{ id: string }>(
            `INSERT INTO student_services (school_id, student_id, academic_year_id, service, amount,
                                           start_month, start_year, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [schoolId, studentId, yearId, a.service, a.amount, premier.month, premier.year, comptes.get('secretaire')],
          );
          const lignes = MENSUELS.has(a.service) ? months.filter((m) => m.order >= firstOwed) : [premier];
          for (const m of lignes) {
            await db.query(
              `INSERT INTO student_service_months (school_id, student_service_id, calendar_month, calendar_year, amount_due)
               VALUES ($1, $2, $3, $4, $5)`,
              [schoolId, ss[0]!.id, m.month, m.year, a.amount],
            );
          }
        }
      }
    }

    // ── Une famille à réinscrire ───────────────────────────────────────────
    // Inscrite en 2024-2025 (close), pas encore en 2025-2026 : ce que la
    // réinscription (unitaire et en lot) propose. Scolarité gratuite l'an
    // dernier, donc aucune dette : rien ne bloque.
    const ancienne = years.get(2024)!;
    const moisAncienne = payableMonths({ startYear: 2024, startMonth: 10, endMonth: 6 });
    const { rows: pr } = await db.query<{ id: string }>(
      `INSERT INTO users (email, phone, password_hash, full_name) VALUES ('parent9.jinan@test', '46000009', $1, 'Salem Ould Reinscrit') RETURNING id`,
      [pwd],
    );
    await db.query('INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)', [pr[0]!.id, schoolId, role.get('parent')]);
    for (const [i, [prenom, niveau]] of ([['Vatimetou', '1 AF'], ['Mahfoudh', '2 AF']] as const).entries()) {
      n++;
      const lv = levels.get(niveau)!;
      const { rows: st } = await db.query<{ id: string }>(
        `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name, sex, matricule)
         VALUES ($1, $2, $3, $4, $5, 'Ould Reinscrit', $6, $7) RETURNING id`,
        [schoolId, pr[0]!.id, `RIM-JIN-${1000 + n}`, `JIN${30000000 + n}`, prenom, i === 0 ? 'F' : 'M', `ET24${String(90000 + n)}`],
      );
      const { rows: en } = await db.query<{ id: string }>(
        `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status,
                                  monthly_fee, full_rate, is_free, entry_date, study_mode, outcome)
         VALUES ($1, $2, $3, $4, $5, 'enrolled', 0, $6, true, '2024-10-01', '8h-14h', 'passed') RETURNING id`,
        [schoolId, st[0]!.id, ancienne, lv.groups[1], lv.id, String(lv.t14)],
      );
      for (const m of moisAncienne) {
        await db.query(
          `INSERT INTO enrollment_months (school_id, enrollment_id, month_order, month_label, calendar_month,
                                          calendar_year, status, amount_due)
           VALUES ($1, $2, $3, $4, $5, $6, 'free', 0)`,
          [schoolId, en[0]!.id, m.order, m.label, m.month, m.year],
        );
      }
    }

    await db.query('COMMIT');
    console.log(`Heavenly Private Educational Institution (Jinan, dév.) — jinan.localhost:3000 · facturation « services »`);
    console.log(`  4 niveaux · 8 classes · 6 professeurs · ${cellules} créneaux · 4 agents · ${n} élèves`);
    console.log(`  comptes : admin@jinan.test, comptable@jinan.test, secretaire@jinan.test, absence@jinan.test — ${PASSWORD}`);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_ADMIN_URL or DATABASE_URL must be set');
    process.exit(1);
  }
  seedJinan(url).catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
