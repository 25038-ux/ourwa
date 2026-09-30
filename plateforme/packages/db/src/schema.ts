import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Drizzle schema — the typed view of the database.
 *
 * The migrations in `migrations/*.sql` are the authority. RLS policies, FORCE,
 * composite foreign keys and UUIDv7 defaults have no Drizzle representation, so
 * a generated migration would silently drop them. This file exists for
 * type-safe queries, not for schema generation.
 *
 * Money is `numeric` and arrives as a STRING. Never coerce it to a number.
 */

const uuidv7 = sql`uuid_generate_v7()`;

// ── Enums ───────────────────────────────────────────────────────────────────
export const recordOrigin = pgEnum('record_origin', ['migrated', 'native', 'imputed']);
export const yearStatus = pgEnum('year_status', ['future', 'active', 'closed']);
export const enrollmentStatus = pgEnum('enrollment_status', [
  'enrolled',
  'archived',
  'debt_blocked',
  'cancelled',
]);
export const enrollmentOutcome = pgEnum('enrollment_outcome', [
  'pending',
  'passed',
  'held_back',
  'expelled',
]);
export const schoolCycle = pgEnum('school_cycle', ['fondamental', 'college', 'lycee', 'autre']);
export const gradeKind = pgEnum('grade_kind', ['coursework', 'exam']);
export const monthStatus = pgEnum('month_status', ['billable', 'invoiced', 'free']);

// ── Platform tables (no school_id, no RLS) ──────────────────────────────────

export const schools = pgTable('schools', {
  id: uuid('id').primaryKey().default(uuidv7),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  logoEmoji: text('logo_emoji').notNull().default('🎓'),
  themeColor: text('theme_color').notNull().default('#1d4ed8'),
  timezone: text('timezone').notNull().default('Africa/Nouakchott'),
  currency: char('currency', { length: 3 }).notNull().default('MRU'),
  address: text('address'),
  receiptPrefix: text('receipt_prefix').notNull(),
  receiptFooter: text('receipt_footer'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** 'famille' (El Ourwa, défaut) | 'services' (Jinan) — 0042, ADR-0073. Jamais changé après création. */
  billingModel: text('billing_model').notNull().default('famille'),
});

export const schoolDomains = pgTable('school_domains', {
  id: uuid('id').primaryKey().default(uuidv7),
  schoolId: uuid('school_id').notNull(),
  hostname: text('hostname').notNull().unique(),
  isPrimary: boolean('is_primary').notNull().default(false),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
});

/** Global on purpose: one parent with children in two branches, one account. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(uuidv7),
  email: text('email').unique(),
  phone: text('phone').unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  locale: text('locale').notNull().default('fr'),
  active: boolean('active').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().default(uuidv7),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  sortOrder: smallint('sort_order').notNull().default(100),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    permission: text('permission').notNull(),
  },
  (t) => ({ pk: unique().on(t.roleId, t.permission) }),
);

export const userSchoolRoles = pgTable(
  'user_school_roles',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    userId: uuid('user_id').notNull(),
    schoolId: uuid('school_id').notNull(),
    roleId: uuid('role_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique().on(t.userId, t.schoolId, t.roleId),
    bySchool: index('user_school_roles_school_idx').on(t.schoolId, t.userId),
  }),
);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().default(uuidv7),
  actorId: uuid('actor_id'),
  schoolId: uuid('school_id'),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
  impersonated: boolean('impersonated').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Tenant tables ───────────────────────────────────────────────────────────

export const configuration = pgTable(
  'configuration',
  {
    schoolId: uuid('school_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: unique().on(t.schoolId, t.key) }),
);

export const academicYears = pgTable(
  'academic_years',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    label: text('label').notNull(),
    startYear: smallint('start_year').notNull(),
    startMonth: smallint('start_month').notNull().default(10),
    endMonth: smallint('end_month').notNull().default(6),
    status: yearStatus('status').notNull().default('future'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uqLabel: unique().on(t.schoolId, t.label),
    uqStart: unique().on(t.schoolId, t.startYear),
    uqComposite: unique().on(t.schoolId, t.id),
    byStatus: index('academic_years_school_status_idx').on(t.schoolId, t.status),
  }),
);

export const levels = pgTable(
  'levels',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    name: text('name').notNull(),
    monthlyRate: numeric('monthly_rate', { precision: 14, scale: 2 }).notNull().default('0'),
    cycle: schoolCycle('cycle').notNull().default('autre'),
    isFondamental: boolean('is_fondamental').notNull().default(false),
    passMark: numeric('pass_mark', { precision: 5, scale: 2 }).notNull().default('10.00'),
    sortOrder: smallint('sort_order').notNull().default(0),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
    // École « services » (0042) : NULL = non défini, 0 = gratuit. Défauts pour
    // la prochaine inscription, jamais rétroactifs.
    monthlyRate8h14: numeric('monthly_rate_8h14', { precision: 14, scale: 2 }),
    monthlyRate8h17: numeric('monthly_rate_8h17', { precision: 14, scale: 2 }),
    studentEnrolmentFee: numeric('student_enrolment_fee', { precision: 14, scale: 2 }),
  },
  (t) => ({
    uqName: unique().on(t.schoolId, t.name),
    uqComposite: unique().on(t.schoolId, t.id),
  }),
);

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    levelId: uuid('level_id'),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull().default(40),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uqName: unique().on(t.schoolId, t.name),
    uqComposite: unique().on(t.schoolId, t.id),
    byLevel: index('groups_school_level_idx').on(t.schoolId, t.levelId),
  }),
);

export const subjects = pgTable(
  'subjects',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    levelId: uuid('level_id'),
    name: text('name').notNull(),
    nameAr: text('name_ar'),
    coefficient: smallint('coefficient').notNull().default(1),
    maxScore: numeric('max_score', { precision: 6, scale: 2 }).notNull().default('20.00'),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uqName: unique().on(t.schoolId, t.levelId, t.name),
    uqComposite: unique().on(t.schoolId, t.id),
  }),
);

export const teachers = pgTable(
  'teachers',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    userId: uuid('user_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    sex: char('sex', { length: 1 }),
    phone: text('phone'),
    employment: text('employment'),
    hourlyRate: numeric('hourly_rate', { precision: 14, scale: 2 }).notNull().default('0'),
    salary: numeric('salary', { precision: 14, scale: 2 }).notNull().default('0'),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({ uqComposite: unique().on(t.schoolId, t.id) }),
);

export const teachings = pgTable(
  'teachings',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    teacherId: uuid('teacher_id').notNull(),
    groupId: uuid('group_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    hoursPerWeek: numeric('hours_per_week', { precision: 4, scale: 1 }).notNull().default('0'),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uq: unique().on(t.schoolId, t.academicYearId, t.teacherId, t.groupId, t.subjectId),
    uqComposite: unique().on(t.schoolId, t.id),
    byGroup: index('teachings_school_group_idx').on(t.schoolId, t.academicYearId, t.groupId),
  }),
);

export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    guardianId: uuid('guardian_id'),
    // Facultatifs (0044) : NULL quand absents, jamais '' (CHECK).
    rim: text('rim'),
    nationalId: text('national_id'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    sex: char('sex', { length: 1 }),
    dateOfBirth: date('date_of_birth'),
    address: text('address'),
    hasLeft: boolean('has_left').notNull().default(false),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqRim: unique().on(t.schoolId, t.rim),
    uqNationalId: unique().on(t.schoolId, t.nationalId),
    uqComposite: unique().on(t.schoolId, t.id),
    byName: index('students_school_name_idx').on(t.schoolId, t.lastName, t.firstName),
  }),
);

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    studentId: uuid('student_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    groupId: uuid('group_id'),
    levelId: uuid('level_id'),
    status: enrollmentStatus('status').notNull().default('archived'),
    monthlyFee: numeric('monthly_fee', { precision: 14, scale: 2 }).notNull().default('0'),
    fullRate: numeric('full_rate', { precision: 14, scale: 2 }).notNull().default('0'),
    enrolmentFee: numeric('enrolment_fee', { precision: 14, scale: 2 }).notNull().default('0'),
    documentFee: numeric('document_fee', { precision: 14, scale: 2 }).notNull().default('0'),
    suppliesFee: numeric('supplies_fee', { precision: 14, scale: 2 }).notNull().default('0'),
    isFree: boolean('is_free').notNull().default(false),
    outcome: enrollmentOutcome('outcome').notNull().default('pending'),
    entryDate: date('entry_date'),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** '8h-14h' | '8h-17h' ; NULL dans une école « famille » (0042). */
    studyMode: text('study_mode'),
  },
  (t) => ({
    uq: unique().on(t.schoolId, t.studentId, t.academicYearId),
    uqComposite: unique().on(t.schoolId, t.id),
    byYear: index('enrollments_school_year_idx').on(t.schoolId, t.academicYearId, t.status),
  }),
);

export const enrollmentMonths = pgTable(
  'enrollment_months',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    enrollmentId: uuid('enrollment_id').notNull(),
    monthOrder: smallint('month_order').notNull(),
    monthLabel: text('month_label'),
    calendarMonth: smallint('calendar_month').notNull(),
    calendarYear: smallint('calendar_year').notNull(),
    status: monthStatus('status').notNull().default('billable'),
    amountDue: numeric('amount_due', { precision: 14, scale: 2 }).notNull().default('0'),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uq: unique().on(t.schoolId, t.enrollmentId, t.monthOrder),
    uqComposite: unique().on(t.schoolId, t.id),
  }),
);

export const grades = pgTable(
  'grades',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    studentId: uuid('student_id').notNull(),
    teachingId: uuid('teaching_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    term: smallint('term').notNull(),
    kind: gradeKind('kind').notNull(),
    sequenceNo: smallint('sequence_no').notNull().default(1),
    /** -1 is the ABSENT MARKER, never a number to average. */
    score: numeric('score', { precision: 6, scale: 2 }).notNull(),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uq: unique().on(t.schoolId, t.studentId, t.teachingId, t.term, t.kind, t.sequenceNo),
    uqComposite: unique().on(t.schoolId, t.id),
    byStudent: index('grades_school_student_year_idx').on(
      t.schoolId,
      t.studentId,
      t.academicYearId,
      t.term,
    ),
  }),
);

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => ({
    uqName: unique().on(t.schoolId, t.name),
    uqComposite: unique().on(t.schoolId, t.id),
  }),
);

export const receiptSequences = pgTable(
  'receipt_sequences',
  {
    schoolId: uuid('school_id').notNull(),
    year: smallint('year').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (t) => ({ pk: unique().on(t.schoolId, t.year) }),
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    studentId: uuid('student_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    calendarMonth: smallint('calendar_month').notNull(),
    calendarYear: smallint('calendar_year').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    receiptNumber: text('receipt_number').notNull(),
    paperReference: text('paper_reference'),
    recordedBy: uuid('recorded_by'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    reversesId: uuid('reverses_id'),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uqReceipt: unique().on(t.schoolId, t.receiptNumber),
    uqComposite: unique().on(t.schoolId, t.id),
    byPeriod: index('payments_school_student_period_idx').on(
      t.schoolId,
      t.studentId,
      t.calendarYear,
      t.calendarMonth,
    ),
  }),
);

export const paymentLines = pgTable(
  'payment_lines',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    paymentMethodId: uuid('payment_method_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    direction: text('direction').notNull().default('in'),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uqComposite: unique().on(t.schoolId, t.id),
    byPayment: index('payment_lines_school_payment_idx').on(t.schoolId, t.paymentId),
  }),
);

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    description: text('description').notNull(),
    spentAt: timestamp('spent_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({ uqComposite: unique().on(t.schoolId, t.id) }),
);

// ── La facturation « services » (0042, ADR-0073) ────────────────────────────
// Les CHECK (codes de service, modes, signe du grand livre), les clés
// composites et leurs actions NO ACTION n'ont pas de forme Drizzle : la
// migration fait foi.

/** Le prix d'un service, par école et par année scolaire. Absent = non défini. */
export const servicePrices = pgTable(
  'service_prices',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    service: text('service').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqComposite: unique().on(t.schoolId, t.id),
    uqService: unique().on(t.schoolId, t.academicYearId, t.service),
  }),
);

/** Un abonnement d'un élève à un service, au montant figé à la souscription. */
export const studentServices = pgTable(
  'student_services',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    studentId: uuid('student_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    service: text('service').notNull(),
    /** Générée : 'cantine' pour les trois cantines, sinon le code. */
    famille: text('famille')
      .notNull()
      .generatedAlwaysAs(
        sql`CASE WHEN service IN ('cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet') THEN 'cantine' ELSE service END`,
      ),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    startMonth: smallint('start_month').notNull(),
    startYear: smallint('start_year').notNull(),
    exempt: boolean('exempt').notNull().default(false),
    exemptedBy: uuid('exempted_by'),
    exemptedAt: timestamp('exempted_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: uuid('ended_by'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uqComposite: unique().on(t.schoolId, t.id),
    uqLedgerTarget: unique().on(t.schoolId, t.id, t.studentId, t.academicYearId),
    uqActif: uniqueIndex('student_services_actif_uq')
      .on(t.schoolId, t.studentId, t.academicYearId, t.famille)
      .where(sql`ended_at IS NULL`),
    byStudent: index('student_services_eleve_idx').on(t.schoolId, t.studentId, t.academicYearId),
    byYear: index('student_services_annee_idx').on(t.schoolId, t.academicYearId, t.service),
  }),
);

/** L'échéancier d'un abonnement : une ligne par mois dû (une seule pour un service annuel). */
export const studentServiceMonths = pgTable(
  'student_service_months',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    studentServiceId: uuid('student_service_id').notNull(),
    calendarMonth: smallint('calendar_month').notNull(),
    calendarYear: smallint('calendar_year').notNull(),
    amountDue: numeric('amount_due', { precision: 14, scale: 2 }).notNull(),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uqComposite: unique().on(t.schoolId, t.id),
    uqMonth: unique().on(t.schoolId, t.studentServiceId, t.calendarYear, t.calendarMonth),
  }),
);

/** Le grand livre des services — append-only ; une annulation est une ligne négative. */
export const servicePayments = pgTable(
  'service_payments',
  {
    id: uuid('id').primaryKey().default(uuidv7),
    schoolId: uuid('school_id').notNull(),
    studentServiceId: uuid('student_service_id').notNull(),
    studentId: uuid('student_id').notNull(),
    academicYearId: uuid('academic_year_id').notNull(),
    calendarMonth: smallint('calendar_month').notNull(),
    calendarYear: smallint('calendar_year').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    receiptNumber: text('receipt_number').notNull(),
    receiptId: uuid('receipt_id'),
    paperReference: text('paper_reference'),
    recordedBy: uuid('recorded_by'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    reversesId: uuid('reverses_id'),
    origin: recordOrigin('origin').notNull().default('native'),
    legacyId: integer('legacy_id'),
  },
  (t) => ({
    uqComposite: unique().on(t.schoolId, t.id),
    byPeriod: index('service_payments_period_idx').on(
      t.schoolId,
      t.studentServiceId,
      t.calendarYear,
      t.calendarMonth,
    ),
    byReceipt: index('service_payments_receipt_idx').on(t.schoolId, t.receiptId),
    byStudent: index('service_payments_student_idx').on(t.schoolId, t.studentId),
  }),
);
