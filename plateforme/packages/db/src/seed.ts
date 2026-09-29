import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hash as argonHash } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';
import { payableMonths, firstOwedMonthOrder } from './academic-year.js';

/**
 * Development seed — three schools, invented names, deliberately colliding data.
 *
 * ⚠ The school names are INVENTED. Toujounine, Arafat and Ksar are moughataas
 * (districts) of Nouakchott that appear in El Ourwa as student ADDRESSES. Using
 * them as school names once caused a hallucinated three-branch architecture, so
 * they appear here only where they belong: in `students.address`.
 */

// Deterministic: a flaky fixture makes every downstream test flaky too.
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260825);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const FIRST_M = ['Ahmed', 'Mohamed', 'Sidi', 'Abdallahi', 'Cheikh', 'Moustapha',
  'Brahim', 'Yahya', 'Baba', 'Ely', 'Hamoud', 'Salem', 'Taleb', 'Mahfoudh'] as const;
const FIRST_F = ['Fatimetou', 'Aminetou', 'Mariem', 'Khadijetou', 'Aichetou',
  'Zeinabou', 'Selma', 'Nejwa', 'Lalla', 'Vatimetou', 'Hapsatou'] as const;
const LAST = ['Ould Mohamed', 'Ould Ahmed', 'Mint Sidi', 'Ould Abdallahi',
  'Ould Cheikh', 'Mint Brahim', 'Ould Deddahi', 'Ould Boubacar', 'Mint Ely',
  'Ould Taleb', 'Ould Jeuda', 'Mint El Ghoutoub', 'Ould Bilal'] as const;

/** Moughataas of Nouakchott — ADDRESSES, exactly as in El Ourwa. Not branches. */
const ADDRESSES = ['Toujounine', 'Arafat', 'Ksar', 'Sebkha', 'Tevragh Zeina',
  'Dar Naim', 'Riyad', 'El Mina', 'Teyarett'] as const;

const SCHOOLS = [
  { slug: 'nour',    name: 'École Nour',    nameAr: 'مدرسة النور',   prefix: 'NOUR', color: '#0f766e', emoji: '🎓' },
  { slug: 'rissala', name: 'École Rissala', nameAr: 'مدرسة الرسالة', prefix: 'RISS', color: '#b45309', emoji: '🌟' },
  { slug: 'salam',   name: 'École Salam',   nameAr: 'مدرسة السلام',  prefix: 'SALM', color: '#7e22ce', emoji: '🌱' },
] as const;

/**
 * People who exist in EVERY school with identical names.
 *
 * If isolation breaks, a search for "Ahmed Ould Mohamed" returns three students
 * instead of one and the failure is obvious rather than subtle.
 */
const SHARED_NAMES = [
  { first: 'Ahmed', last: 'Ould Mohamed', sex: 'M' as const },
  { first: 'Fatimetou', last: 'Mint Sidi', sex: 'F' as const },
  { first: 'Mohamed', last: 'Ould Ahmed', sex: 'M' as const },
];

const LEVELS = [
  { name: '3 AF', rate: 2000,  cycle: 'fondamental', fond: true,  order: 30 },
  { name: '4 AF', rate: 2000,  cycle: 'fondamental', fond: true,  order: 40 },
  { name: '5 AF', rate: 2200,  cycle: 'fondamental', fond: true,  order: 50 },
  { name: '6 AF', rate: 2500,  cycle: 'fondamental', fond: true,  order: 60 },
  { name: '6ème', rate: 15000, cycle: 'college',     fond: false, order: 10 },
  { name: '5ème', rate: 18000, cycle: 'college',     fond: false, order: 20 },
  { name: '4ème', rate: 20000, cycle: 'college',     fond: false, order: 30 },
  { name: '3ème', rate: 22000, cycle: 'college',     fond: false, order: 40 },
] as const;

const SUBJECTS_COLLEGE = [
  { name: 'Mathématiques', ar: 'الرياضيات', coef: 4, max: 20 },
  { name: 'Français',      ar: 'الفرنسية',  coef: 3, max: 20 },
  { name: 'Arabe',         ar: 'العربية',   coef: 3, max: 20 },
  { name: 'Sciences',      ar: 'العلوم',    coef: 2, max: 20 },
  { name: 'Histoire-Géo',  ar: 'التاريخ والجغرافيا', coef: 2, max: 20 },
  // Deliberately NOT out of 20 — exercises the rescaling path in the bulletin.
  { name: 'Éducation islamique', ar: 'التربية الإسلامية', coef: 2, max: 40 },
] as const;

const SUBJECTS_FOND = [
  { name: 'Calcul',   ar: 'الحساب',  coef: 1, max: 50 },
  { name: 'Lecture',  ar: 'القراءة', coef: 1, max: 30 },
  { name: 'Écriture', ar: 'الكتابة', coef: 1, max: 20 },
  { name: 'Coran',    ar: 'القرآن',  coef: 1, max: 50 },
] as const;

import { ROLES } from './seed-roles.js';


const METHODS = ['Espèces', 'Bankily', 'Masrvi', 'Sedad', 'Virement'] as const;

/**
 * Anchored to TODAY, not to a fixed date.
 *
 * The evening and attendance screens open on the current month and the current
 * day, as an office would. A fixture pinned to November 2025 goes quietly blank
 * the moment the calendar moves past it — and a blank screen is indistinguishable
 * from a broken one.
 */
const TODAY = new Date();
const THIS_MONTH = TODAY.getMonth() + 1;
const THIS_YEAR = TODAY.getFullYear();
const PREVIOUS = new Date(THIS_YEAR, THIS_MONTH - 2, 1);
const LAST_MONTH = PREVIOUS.getMonth() + 1;
const LAST_YEAR = PREVIOUS.getFullYear();
const recentDays = [0, 1, 2].map((back) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - back);
  return d.toISOString().slice(0, 10);
});
const PASSWORD = 'dev12345';

async function main() {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL must be set');
  const db = new pg.Client({ connectionString: url });
  await db.connect();

  console.log('Hashing seed password (Argon2id)…');
  const pwd = await argonHash(PASSWORD);
  // One account keeps a legacy bcrypt hash on purpose, so the transparent
  // upgrade path has something real to exercise (PROJECT.md §2.8).
  const legacyPwd = bcrypt.hashSync(PASSWORD, 10).replace('$2a$', '$2y$');

  try {
    await db.query('BEGIN');
    await db.query(`
      TRUNCATE expulsions, timetable_slots,
               approval_requests, messages, withdrawals, fund_holders,
               loan_repayments, loan_instalments, staff_loans, salary_payments,
               staff,
               evening_teacher_payments, evening_payments, evening_enrolments,
               evening_teachings, evening_teachers, evening_group_months,
               evening_groups, notifications, homework, remarks, attendance,
               tender_lines, payments, receipt_sequences, payment_methods,
               family_fee_payments, family_fee_exemptions, debt_write_offs,
               discounts, exemptions, expenses, grades, enrollment_months,
               enrollments, teachings, students, teachers, subjects, groups,
               levels, academic_years, configuration, user_school_roles,
               refresh_tokens, login_attempts, password_resets, audit_log,
               role_permissions, roles, school_domains, users, schools
      RESTART IDENTITY CASCADE
    `);

    const roleIds = new Map<string, string>();
    for (const r of ROLES) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO roles (code, label, description, is_system, sort_order)
         VALUES ($1, $2, $3, true, $4) RETURNING id`,
        [r.code, r.label, 'description' in r ? r.description : null, r.order],
      );
      roleIds.set(r.code, rows[0]!.id);
      for (const p of r.perms) {
        await db.query(
          'INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)',
          [rows[0]!.id, p],
        );
      }
    }

    await db.query(
      `INSERT INTO users (email, password_hash, full_name, is_platform_admin)
       VALUES ('admin@platform.test', $1, 'Platform Owner', true)`,
      [pwd],
    );

    // Guardians shared across two schools: ONE account, two school roles. This
    // is why `users` is global — a parent with children in two branches must not
    // need two logins.
    const crossSchool: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (email, phone, password_hash, full_name, locale)
         VALUES ($1, $2, $3, $4, 'fr') RETURNING id`,
        [`parent.multi${i}@test`, `3000000${i}`, pwd, `Parent Multi ${i + 1}`],
      );
      crossSchool.push(rows[0]!.id);
    }

    let totalStudents = 0;

    for (const [schoolIndex, school] of SCHOOLS.entries()) {
      const { rows: sr } = await db.query<{ id: string }>(
        `INSERT INTO schools (slug, name, name_ar, receipt_prefix, theme_color, logo_emoji)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [school.slug, school.name, school.nameAr, school.prefix, school.color, school.emoji],
      );
      const schoolId = sr[0]!.id;
      await db.query(
        `INSERT INTO school_domains (school_id, hostname, is_primary)
         VALUES ($1, $2, true)`,
        [schoolId, `${school.slug}.localhost`],
      );
      console.log(`\n${school.name} (${school.slug})`);

      // Annual fee scale, so the three-level resolution has something to resolve.
      for (const [key, value] of [
        ['frais_inscription', '0'], ['frais_photocopie', '0'],
        ['frais_inscription_2025', '5000'], ['frais_photocopie_2025', '1500'],
      ] as const) {
        await db.query(
          'INSERT INTO configuration (school_id, key, value) VALUES ($1, $2, $3)',
          [schoolId, key, value],
        );
      }

      // ── Staff ────────────────────────────────────────────────────────────
      const staff = new Map<string, string>();
      for (const [local, name, role] of [
        ['admin', `Directeur ${school.name}`, 'super_admin'],
        ['comptable', 'Agent comptable', 'comptable'],
        ['secretaire', 'Secrétaire', 'secretaire'],
        ['absence', "Collecteur d'absence", 'collecteur_absence'],
      ] as const) {
        // The accountant at Nour keeps a bcrypt hash, to exercise the upgrade.
        const hash = school.slug === 'nour' && local === 'comptable' ? legacyPwd : pwd;
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3)
           RETURNING id`,
          [`${local}@${school.slug}.test`, hash, name],
        );
        staff.set(local, rows[0]!.id);
        await db.query(
          `INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)`,
          [rows[0]!.id, schoolId, roleIds.get(role)],
        );
      }

      // ── Academic years ───────────────────────────────────────────────────
      // The ACTIVE year is deliberately one whose months have already elapsed.
      // Seeding a year that has not started yet produces a system with no
      // tuition owed by anyone — technically correct, and useless as a fixture.
      // This also reproduces the real August situation the year selector was
      // written for: the year just ended, the next one has no enrolments yet,
      // and the UI must open on the one with data rather than looking empty.
      const years = new Map<number, string>();
      for (const [startYear, status] of [
        [2023, 'closed'], [2024, 'closed'], [2025, 'active'], [2026, 'future'],
      ] as const) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO academic_years (school_id, label, start_year, status, closed_at)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [schoolId, `${startYear}-${startYear + 1}`, startYear, status,
           status === 'closed' ? `${startYear + 1}-07-01` : null],
        );
        years.set(startYear, rows[0]!.id);
      }
      const activeYearId = years.get(2025)!;
      const activeYear = { startYear: 2025, startMonth: 10, endMonth: 6 };
      const months = payableMonths(activeYear);

      // ── Levels, groups, subjects ─────────────────────────────────────────
      const levelIds = new Map<string, string>();
      const groupsByLevel = new Map<string, string[]>();
      const subjectsByLevel = new Map<string, string[]>();

      for (const lv of LEVELS) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO levels (school_id, name, monthly_rate, cycle, is_fondamental, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [schoolId, lv.name, lv.rate, lv.cycle, lv.fond, lv.order],
        );
        const levelId = rows[0]!.id;
        levelIds.set(lv.name, levelId);

        const gs: string[] = [];
        for (const suffix of ['A', 'B']) {
          const { rows: g } = await db.query<{ id: string }>(
            `INSERT INTO groups (school_id, level_id, name, capacity)
             VALUES ($1, $2, $3, 40) RETURNING id`,
            [schoolId, levelId, `${lv.name} ${suffix}`],
          );
          gs.push(g[0]!.id);
        }
        groupsByLevel.set(lv.name, gs);

        const subs: string[] = [];
        for (const s of lv.fond ? SUBJECTS_FOND : SUBJECTS_COLLEGE) {
          const { rows: sub } = await db.query<{ id: string }>(
            `INSERT INTO subjects (school_id, level_id, name, name_ar, coefficient, max_score)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [schoolId, levelId, s.name, s.ar, s.coef, s.max],
          );
          subs.push(sub[0]!.id);
        }
        subjectsByLevel.set(lv.name, subs);
      }

      let timetableCells = 0;

      // ── Teachers and teachings ───────────────────────────────────────────
      const teacherIds: string[] = [];
      for (let i = 0; i < 14; i++) {
        const sex = rand() < 0.45 ? 'F' : 'M';
        const { rows: u } = await db.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3)
           RETURNING id`,
          [`prof${i}@${school.slug}.test`, pwd, `Prof ${i + 1}`],
        );
        await db.query(
          `INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)`,
          [u[0]!.id, schoolId, roleIds.get('professeur')],
        );
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO teachers (school_id, user_id, first_name, last_name, sex, phone,
                                 employment, hourly_rate, salary)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [schoolId, u[0]!.id, pick(sex === 'F' ? FIRST_F : FIRST_M), pick(LAST), sex,
           `+2224${int(1000000, 9999999)}`, rand() < 0.7 ? 'permanent' : 'interim',
           int(300, 900), int(28, 55) * 1000],
        );
        teacherIds.push(rows[0]!.id);
      }

      const teachingsByGroup = new Map<string, string[]>();
      for (const lv of LEVELS) {
        for (const groupId of groupsByLevel.get(lv.name)!) {
          const made: string[] = [];
          for (const subjectId of subjectsByLevel.get(lv.name)!) {
            // Some assignments carry their own hourly rate; the rest fall back
            // to the teacher's. NULL here means "the teacher's rate", never 0 —
            // the fixture has to contain both to be worth anything.
            const { rows } = await db.query<{ id: string }>(
              `INSERT INTO teachings
                 (school_id, academic_year_id, teacher_id, group_id, subject_id,
                  hours_per_week, hourly_rate)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
              [schoolId, activeYearId, pick(teacherIds), groupId, subjectId, int(2, 6),
               rand() < 0.3 ? int(400, 900) : null],
            );
            made.push(rows[0]!.id);
          }
          teachingsByGroup.set(groupId, made);
        }
      }

      // ── Payment methods ──────────────────────────────────────────────────
      const methodIds: string[] = [];
      for (const name of METHODS) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO payment_methods (school_id, name) VALUES ($1, $2) RETURNING id`,
          [schoolId, name],
        );
        methodIds.push(rows[0]!.id);
      }

      // ── Guardians and students ───────────────────────────────────────────
      let receiptNo = 0;
      const target = 200;

      for (let i = 0; i < target; i++) {
        const shared = SHARED_NAMES[i];
        const sex = shared ? shared.sex : rand() < 0.5 ? 'F' : 'M';
        const first = shared ? shared.first : pick(sex === 'F' ? FIRST_F : FIRST_M);
        const last = shared ? shared.last : pick(LAST);

        let guardianId: string;
        if (i < crossSchool.length) {
          // Same account, another school. One login, two branches.
          guardianId = crossSchool[i]!;
        } else {
          const { rows } = await db.query<{ id: string }>(
            `INSERT INTO users (email, phone, password_hash, full_name, locale)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            // Un numéro mauritanien valable (huit chiffres, 2/3/4 en tête) :
            // c'est l'identifiant de la famille dans l'application.
            [`parent${i}@${school.slug}.test`, `4${schoolIndex}${String(i).padStart(6, '0')}`,
             pwd, `${pick(FIRST_M)} ${last}`, rand() < 0.3 ? 'ar' : 'fr'],
          );
          guardianId = rows[0]!.id;
        }
        await db.query(
          `INSERT INTO user_school_roles (user_id, school_id, role_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [guardianId, schoolId, roleIds.get('parent')],
        );

        const level = pick(LEVELS);
        const levelId = levelIds.get(level.name)!;
        const groupId = pick(groupsByLevel.get(level.name)!);

        const { rows: st } = await db.query<{ id: string }>(
          `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name,
                                 last_name, sex, date_of_birth, address, matricule)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [schoolId, guardianId, `RIM-${school.prefix}-${1000 + i}`,
           `${school.prefix}${20000000 + i}`, first, last, sex,
           `${int(2008, 2018)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
           pick(ADDRESSES),
           // Son matricule « ETyy##### » (0036).
           `ET25${String(10000 + i).slice(-5)}`],
        );
        const studentId = st[0]!.id;
        totalStudents++;

        const isFree = rand() < 0.06;
        // A negotiated rate: the agreed figure IS what is owed.
        const negotiated = rand() < 0.25;
        const monthlyFee = isFree ? 0
          : negotiated ? Math.round(level.rate * (0.6 + rand() * 0.3)) : level.rate;
        // Most start on day one; some arrive later, which is what makes the rule
        // of the 25th observable in the fixture.
        const entryDate = rand() < 0.8 ? '2025-10-01'
          : `2025-${pick([10, 11, 12])}-${String(int(20, 28)).padStart(2, '0')}`;

        const { rows: en } = await db.query<{ id: string }>(
          `INSERT INTO enrollments
             (school_id, student_id, academic_year_id, group_id, level_id, status,
              monthly_fee, full_rate, is_free, entry_date)
           VALUES ($1, $2, $3, $4, $5, 'enrolled', $6, $7, $8, $9) RETURNING id`,
          [schoolId, studentId, activeYearId, groupId, levelId, monthlyFee,
           level.rate, isFree, entryDate],
        );
        const enrollmentId = en[0]!.id;

        const firstOwed = firstOwedMonthOrder(activeYear, entryDate);
        for (const m of months) {
          const owed = !isFree && m.order >= firstOwed;
          await db.query(
            `INSERT INTO enrollment_months
               (school_id, enrollment_id, month_order, month_label, calendar_month,
                calendar_year, status, amount_due)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [schoolId, enrollmentId, m.order, m.label, m.month, m.year,
             owed ? 'billable' : 'free', owed ? monthlyFee : 0],
          );
        }

        // ── Grades, term 1 ─────────────────────────────────────────────────
        if (rand() < 0.7) {
          for (const teachingId of teachingsByGroup.get(groupId)!) {
            for (const [kind, n] of [['coursework', 1], ['coursework', 2], ['exam', 1]] as const) {
              // ~4% absences, recorded as the marker -1. The bulletin code must
              // exclude these; a fixture without them would never prove it does.
              // Au quart de point, comme les 50 000 notes réelles (une seule exception dans la reprise).
              const score = rand() < 0.04 ? -1 : (int(24, 76) / 4).toFixed(2);
              await db.query(
                `INSERT INTO grades (school_id, student_id, teaching_id, academic_year_id,
                                     term, kind, sequence_no, score)
                 VALUES ($1, $2, $3, $4, 1, $5, $6, $7) ON CONFLICT DO NOTHING`,
                [schoolId, studentId, teachingId, activeYearId, kind, n, score],
              );
            }
          }
        }

        // ── Payments ───────────────────────────────────────────────────────
        if (!isFree && rand() < 0.75) {
          for (let k = 0; k < int(1, 3); k++) {
            const m = months[firstOwed - 1 + k];
            if (!m) break;
            receiptNo++;
            const { rows: pay } = await db.query<{ id: string }>(
              `INSERT INTO payments
                 (school_id, student_id, academic_year_id, calendar_month, calendar_year,
                  amount, receipt_number, recorded_by, paid_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
              [schoolId, studentId, activeYearId, m.month, m.year, monthlyFee,
               `${school.prefix}-2025-${String(receiptNo).padStart(5, '0')}`,
               staff.get('comptable'),
               `${m.year}-${String(m.month).padStart(2, '0')}-${String(int(2, 26)).padStart(2, '0')}`],
            );
            // Tender lines must sum EXACTLY to the payment — in `tender_lines`
            // (0014 : la caisse polymorphe, `payment_lines` n'existe plus), datées
            // du jour du paiement pour que les rapports par mois les voient.
            const paidAt = `${m.year}-${String(m.month).padStart(2, '0')}-${String(int(2, 26)).padStart(2, '0')}`;
            if (rand() < 0.25) {
              const part = Math.round(monthlyFee / 2);
              await db.query(
                `INSERT INTO tender_lines (school_id, source_type, source_id, payment_method_id, amount, direction, created_at)
                 VALUES ($1, 'paiement', $2, $3, $4, 'in', $7), ($1, 'paiement', $2, $5, $6, 'in', $7)`,
                [schoolId, pay[0]!.id, methodIds[0], part,
                 pick(methodIds.slice(1)), monthlyFee - part, paidAt],
              );
            } else {
              await db.query(
                `INSERT INTO tender_lines (school_id, source_type, source_id, payment_method_id, amount, direction, created_at)
                 VALUES ($1, 'paiement', $2, $3, $4, 'in', $5)`,
                [schoolId, pay[0]!.id, pick(methodIds), monthlyFee, paidAt],
              );
            }
          }
        }
      }

      await db.query(
        `INSERT INTO receipt_sequences (school_id, year, last_number) VALUES ($1, 2025, $2)`,
        [schoolId, receiptNo],
      );

      for (let i = 0; i < 25; i++) {
        await db.query(
          `INSERT INTO expenses (school_id, amount, description, spent_at, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [schoolId, int(2000, 60000),
           pick(['Fournitures de bureau', 'Électricité', 'Eau', 'Entretien',
                 'Transport', 'Réparations', 'Imprimerie']),
           `2025-${String(int(10, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
           staff.get('comptable')],
        );
      }

      // ── Cours du soir ────────────────────────────────────────────────────
      // A second business: its own groups and tariffs, and enrolees who are NOT
      // students of the school. The fixture includes both kinds, because the
      // whole point of the subsystem is that outsiders exist.
      const eveningRates = [
        { name: 'Anglais du soir', rate: 3000 },
        { name: 'Soutien Mathématiques', rate: 3500 },
      ];
      for (const spec of eveningRates) {
        const { rows: eg } = await db.query<{ id: string }>(
          `INSERT INTO evening_groups (school_id, name, monthly_rate, description)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [schoolId, spec.name, spec.rate, 'Deux séances par semaine'],
        );
        const eveningGroupId = eg[0]!.id;

        const { rows: et } = await db.query<{ id: string }>(
          `INSERT INTO evening_teachers (school_id, first_name, last_name, phone)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [schoolId, pick(FIRST_M), pick(LAST), `+2224${int(1000000, 9999999)}`],
        );
        await db.query(
          `INSERT INTO evening_teachings
             (school_id, evening_group_id, evening_teacher_id, subject, pay_kind,
              hourly_rate, hours_per_month)
           VALUES ($1, $2, $3, $4, 'hourly', $5, $6)`,
          [schoolId, eveningGroupId, et[0]!.id, spec.name, int(400, 800), int(8, 16)],
        );

        // Some school students…
        const { rows: someStudents } = await db.query<{ id: string }>(
          'SELECT id FROM students WHERE school_id = $1 ORDER BY random() LIMIT 6',
          [schoolId],
        );
        for (const st of someStudents) {
          await db.query(
            `INSERT INTO evening_enrolments (school_id, evening_group_id, student_id)
             VALUES ($1, $2, $3)`,
            [schoolId, eveningGroupId, st.id],
          );
        }
        // …and outsiders, who exist nowhere else in the system.
        for (let i = 0; i < 4; i++) {
          await db.query(
            `INSERT INTO evening_enrolments
               (school_id, evening_group_id, outsider_name, outsider_phone, outsider_sex)
             VALUES ($1, $2, $3, $4, $5)`,
            [schoolId, eveningGroupId, `${pick(FIRST_M)} ${pick(LAST)}`,
             `+2224${int(1000000, 9999999)}`, rand() < 0.5 ? 'M' : 'F'],
          );
        }

        // Roughly two thirds have paid the current month.
        const { rows: enrolees } = await db.query<{ id: string }>(
          'SELECT id FROM evening_enrolments WHERE evening_group_id = $1',
          [eveningGroupId],
        );
        for (const e of enrolees) {
          if (rand() > 0.65) continue;
          receiptNo++;
          await db.query(
            `INSERT INTO evening_payments
               (school_id, enrolment_id, calendar_month, calendar_year, amount,
                receipt_number, recorded_by)
             VALUES ($1, $2, $6, $7, $3, $4, $5)`,
            [schoolId, e.id, spec.rate,
             `${school.prefix}-${THIS_YEAR}-${String(receiptNo).padStart(5, '0')}`,
             staff.get('comptable'), THIS_MONTH, THIS_YEAR],
          );
        }
      }

      // ── A few registers, so the attendance screen is not empty ───────────
      const { rows: someTeachings } = await db.query<{ id: string; group_id: string }>(
        'SELECT id, group_id FROM teachings WHERE school_id = $1 ORDER BY random() LIMIT 4',
        [schoolId],
      );
      for (const t of someTeachings) {
        const { rows: roster } = await db.query<{ student_id: string }>(
          `SELECT student_id FROM enrollments
            WHERE group_id = $1 AND academic_year_id = $2 AND status <> 'cancelled'`,
          [t.group_id, activeYearId],
        );
        for (const day of recentDays) {
          for (const r of roster) {
            // Most are present; the exceptions are what the screen is for.
            const roll = rand();
            const status = roll < 0.08 ? 'absent' : roll < 0.12 ? 'late' : 'present';
            await db.query(
              `INSERT INTO attendance
                 (school_id, student_id, teaching_id, on_date, status, is_excused, recorded_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT DO NOTHING`,
              [schoolId, r.student_id, t.id, day, status,
               status === 'absent' && rand() < 0.5, staff.get('secretaire')],
            );
          }
        }
      }

      // ── Timetable ────────────────────────────────────────────────────────
      //
      // Six days x three slots, one lesson per cell, and never the same teacher
      // in two classes at once — the service refuses that, so the fixture must
      // not create it either or the grid would be a lie.
      {
        const busy = new Set<string>(); // `${teacherId}:${day}:${slot}`
        let placed = 0;
        for (const lv of LEVELS) {
          for (const groupId of groupsByLevel.get(lv.name)!) {
            const teachings = teachingsByGroup.get(groupId)!;
            let n = 0;
            for (let day = 1; day <= 6 && n < teachings.length; day++) {
              for (let slot = 1; slot <= 3 && n < teachings.length; slot++) {
                const teachingId = teachings[n]!;
                const { rows: t } = await db.query<{ teacher_id: string }>(
                  'SELECT teacher_id FROM teachings WHERE id = $1',
                  [teachingId],
                );
                const key = `${t[0]!.teacher_id}:${day}:${slot}`;
                if (busy.has(key)) continue;
                busy.add(key);
                await db.query(
                  `INSERT INTO timetable_slots
                     (school_id, group_id, teaching_id, day_of_week, slot)
                   VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
                  [schoolId, groupId, teachingId, day, slot],
                );
                placed++;
                n++;
              }
            }
          }
        }
        timetableCells = placed;
      }

      // One live block and one lifted, so the register shows both states.
      await db.query(
        `INSERT INTO expulsions
           (school_id, national_id, rim, first_name, last_name, reason, expelled_by)
         VALUES ($1, 'NNI-BLOCK-1', 'RIM-BLOCK-1', 'Mohamed', 'Ould Taleb',
                 'Violences répétées', $2)`,
        [schoolId, staff.get('admin')],
      );
      await db.query(
        `INSERT INTO expulsions
           (school_id, national_id, rim, first_name, last_name, reason, expelled_by,
            lifted_at, lifted_by, lift_reason)
         VALUES ($1, 'NNI-BLOCK-2', 'RIM-BLOCK-2', 'Aicha', 'Mint Bilal',
                 'Absences prolongées', $2, now() - interval '20 days', $2,
                 'Engagement de la famille')`,
        [schoolId, staff.get('admin')],
      );

      // ── Payroll, loans and fund holders ──────────────────────────────────
      //
      // Last month is fully paid and this month is not, so the payroll screen
      // opens on real work to do rather than on an empty or a finished list.
      const PAYROLL = [
        ['Directeur', 'super_admin', 90000],
        ['Comptable', 'comptable', 62000],
        ['Secrétaire', 'secretaire', 45000],
        ['Surveillant', null, 38000],
        ['Gardien', null, 26000],
        ['Femme de ménage', null, 24000],
      ] as const;

      const staffIds: { id: string; salary: number }[] = [];
      for (const [title, account, salary] of PAYROLL) {
        const sex = title === 'Femme de ménage' ? 'F' : rand() < 0.4 ? 'F' : 'M';
        const userId =
          account === 'super_admin' ? staff.get('admin')
          : account ? staff.get(account)
          : null;
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO staff (school_id, user_id, first_name, last_name, sex, phone,
                              role_title, salary, hired_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [schoolId, userId, pick(sex === 'F' ? FIRST_F : FIRST_M), pick(LAST), sex,
           `+2223${int(1000000, 9999999)}`, title, salary,
           `${THIS_YEAR - int(1, 12)}-09-01`],
        );
        staffIds.push({ id: rows[0]!.id, salary });
      }

      // One outstanding loan, so a salary run has a deduction to withhold.
      const borrower = staffIds[3]!;
      const { rows: loan } = await db.query<{ id: string }>(
        `INSERT INTO staff_loans
           (school_id, payee_kind, payee_id, payee_name, principal, reason, granted_by)
         VALUES ($1, 'staff', $2, $3, $4, $5, $6) RETURNING id`,
        [schoolId, borrower.id, 'Surveillant', '60000.00', 'Avance sur salaire',
         staff.get('admin')],
      );
      for (let i = 0; i < 6; i++) {
        const m = ((LAST_MONTH - 1 + i) % 12) + 1;
        const y = LAST_YEAR + Math.floor((LAST_MONTH - 1 + i) / 12);
        await db.query(
          `INSERT INTO loan_instalments
             (school_id, loan_id, calendar_month, calendar_year, amount)
           VALUES ($1, $2, $3, $4, '10000.00')`,
          [schoolId, loan[0]!.id, m, y],
        );
      }

      // Last month's payroll, run in full — and DATED in that month.
      //
      // A report is keyed on when the money moved (ADR-0013), so leaving
      // `paid_at` at now() would show last month's payroll as this month's
      // outgoing and make the demo lie about its own fixture.
      const paidOn = `${LAST_YEAR}-${String(LAST_MONTH).padStart(2, '0')}-28`;
      for (const person of staffIds) {
        const deduction = person.id === borrower.id ? 10000 : 0;
        await db.query(
          `INSERT INTO salary_payments
             (school_id, payee_kind, payee_id, payee_name, calendar_month, calendar_year,
              gross, loan_deduction, net, paid_by, paid_at)
           SELECT $1, 'staff', s.id, s.first_name || ' ' || s.last_name, $3, $4,
                  s.salary, $5, s.salary - $5, $6, $7::timestamptz
             FROM staff s WHERE s.id = $2`,
          [schoolId, person.id, LAST_MONTH, LAST_YEAR, deduction,
           staff.get('comptable'), paidOn],
        );
      }
      await db.query(
        `UPDATE loan_instalments SET repaid = amount, withheld = true
          WHERE loan_id = $1 AND calendar_month = $2 AND calendar_year = $3`,
        [loan[0]!.id, LAST_MONTH, LAST_YEAR],
      );
      await db.query(`UPDATE staff_loans SET repaid = '10000.00' WHERE id = $1`, [loan[0]!.id]);

      // ⚠ A fund holder is a FINANCIAL role with a withdrawal limit. It is not
      // the `admin` access role, and nothing links the two (GLOSSARY §4).
      const holders: string[] = [];
      for (const [name, limit] of [
        ['Fonds de direction', 150000],
        ['Caisse pédagogique', 60000],
      ] as const) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO fund_holders (school_id, full_name, monthly_limit)
           VALUES ($1, $2, $3) RETURNING id`,
          [schoolId, name, limit],
        );
        holders.push(rows[0]!.id);
      }
      await db.query(
        `INSERT INTO withdrawals
           (school_id, fund_holder_id, amount, calendar_month, calendar_year, reason, recorded_by)
         VALUES ($1, $2, '40000.00', $3, $4, 'Fournitures de bureau', $5)`,
        [schoolId, holders[0], THIS_MONTH, THIS_YEAR, staff.get('comptable')],
      );

      // One pending request, so the direction's queue is not empty on arrival.
      await db.query(
        `INSERT INTO approval_requests
           (school_id, raised_by, raiser_name, kind, description, amount)
         VALUES ($1, $2, 'Agent comptable', 'depense',
                 'Réparation du groupe électrogène', '85000.00')`,
        [schoolId, staff.get('comptable')],
      );
      await db.query(
        `INSERT INTO approval_requests
           (school_id, raised_by, raiser_name, kind, description, amount,
            status, decided_by, decided_at, comment)
         VALUES ($1, $2, 'Agent comptable', 'remise',
                 'Remise exceptionnelle pour une famille de quatre élèves', '12000.00',
                 'approved', $3, now() - interval '3 days', 'Accordé pour ce trimestre.')`,
        [schoolId, staff.get('comptable'), staff.get('admin')],
      );

      console.log(`  staff 4 · teachers 14 · levels ${LEVELS.length} · groups ${LEVELS.length * 2}`);
      console.log(`  cours du soir 2 groupes · appels 4 matières x 2 jours`);
      console.log(`  students ${target} · receipts ${receiptNo} · expenses 25`);
      console.log(`  paie ${PAYROLL.length} agents · 1 prêt · 2 caisses · 2 demandes`);
      console.log(`  emploi du temps ${timetableCells} créneaux · 2 expulsions`);
    }

    await db.query('COMMIT');
    console.log(`\nSeed complete — ${SCHOOLS.length} schools, ${totalStudents} students.`);
    console.log(`Password for every account: ${PASSWORD}`);
    console.log('Credentials are listed in docs/TESTING.md.');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main as seed, PASSWORD, SCHOOLS, SHARED_NAMES };
