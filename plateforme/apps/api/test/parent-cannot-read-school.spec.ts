import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { StudentsController } from '../src/students/students.controller.js';
import { EnrollmentController, ReferenceController } from '../src/academic/academic.controller.js';
import { ReferenceService } from '../src/academic/reference.service.js';
import { PermissionsGuard } from '../src/auth/permissions.guard.js';
import { Reflector } from '@nestjs/core';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * ⚠ A SIGNED-IN PARENT COULD READ THE WHOLE SCHOOL.
 *
 * `GET /students`, `GET /students/count` and `GET /students/guardians/search`
 * carried no permission decorator at all. The `parent` role holds ZERO
 * permissions, so "no decorator" meant "everyone with a token", and a parent's
 * token is the easiest in the building to obtain — there are 1 372 of them and
 * the password is often one the office read out across a counter.
 *
 * Proved against the running system before this test was written:
 *
 *   GET /students          -> every child, with name, sex, place of birth, class
 *   GET /students/guardians/search?q=ou -> every family, with full name and PHONE
 *   GET /students/count    -> 200
 *
 * That is 2 153 children and 1 372 families' personal data behind one parent
 * login. RLS was doing its job — it keeps other SCHOOLS out — and this is the
 * other boundary: what a role inside a school may see.
 *
 * ⚠ THE ROLE THAT MATTERS MOST HERE IS THE ONE WITH NO PERMISSIONS. Every guard
 * added below is written as an ALLOW-list of the permissions its real callers
 * hold; a role holding none passes none of them.
 */

let owner: pg.Pool;
let guard: PermissionsGuard;
let schoolId: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'leak' }, fn);
}

/** What the guard decides for a handler, given a set of held permissions. */
function allows(controller: object, handler: string, permissions: string[]): boolean {
  const ctx = {
    getHandler: () => (controller as Record<string, unknown>)[handler],
    getClass: () => controller.constructor,
    switchToHttp: () => ({
      getRequest: () => ({
        auth: { userId: 'u', schoolId, roles: [], permissions, impersonated: false },
      }),
    }),
  } as never;
  try {
    return guard.canActivate(ctx);
  } catch {
    return false;
  }
}

/** The seed's roles, so this test and the catalogue cannot drift apart. */
const PARENT: string[] = [];
const TEACHER = ['absences.consulter', 'exercices.envoyer', 'notes.consulter'];
const ABSENCE_COLLECTOR = ['absences.consulter', 'absences.saisir'];
const SECRETARY = [
  'comptes.parents', 'demandes.traiter', 'messagerie.envoyer', 'notes.consulter',
  'notes.saisir', 'recherche.globale', 'scolarite.inscrire', 'scolarite.reinscrire',
];
const ACCOUNTANT = [
  'demandes.traiter', 'finance.consulter', 'finance.depenser', 'finance.dette',
  'finance.encaisser', 'finance.rapport', 'recherche.globale',
  'scolarite.inscrire', 'scolarite.reinscrire',
];

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('leak', 'Fuite', 'LEK')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  guard = new PermissionsGuard(moduleRef.get(Reflector));
});

afterAll(async () => {
  await owner?.end();
});

describe('⚠ the school roster is not public to everyone with a token', () => {
  let students: StudentsController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    students = moduleRef.get(StudentsController);
  });

  for (const handler of ['list', 'count', 'searchGuardians'] as const) {
    it(`${handler}: a parent is refused`, () => {
      expect(allows(students, handler, PARENT)).toBe(false);
    });

    it(`${handler}: an absence collector is refused`, () => {
      // Their whole job is the register, which they reach by its own route.
      expect(allows(students, handler, ABSENCE_COLLECTOR)).toBe(false);
    });
  }

  it('⚠ a teacher may not enumerate families', () => {
    // A teacher's own students are at `/teacher/my-students`, scoped by the
    // token. The school's parent directory is a different thing entirely.
    expect(allows(students, 'searchGuardians', TEACHER)).toBe(false);
  });

  it('the secretary and the accountant still work', () => {
    // They are the callers: the admission form's parent search, the messagerie,
    // and the till. A guard that broke them would be swapped out within a day.
    for (const role of [SECRETARY, ACCOUNTANT]) {
      expect(allows(students, 'searchGuardians', role)).toBe(true);
      expect(allows(students, 'list', role)).toBe(true);
    }
  });
});

describe('⚠ a fee schedule is not readable by its id alone', () => {
  let enrollments: EnrollmentController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    enrollments = moduleRef.get(EnrollmentController);
  });

  it('a parent is refused', () => {
    // A parent reads their own child's balance at `/parent/balance`, which is
    // scoped by the token. This route takes an enrolment id and trusts it.
    expect(allows(enrollments, 'months', PARENT)).toBe(false);
  });

  it('the till is not', () => {
    expect(allows(enrollments, 'months', ACCOUNTANT)).toBe(true);
  });
});

/**
 * ⚠ AND THE REFERENCE ENDPOINTS WERE OPEN TOO — including one that carries pay.
 *
 * `GET /teachers` returned every teacher's telephone, employment status, HOURLY
 * RATE and SALARY to anybody with a token. `finance.salaires` exists precisely
 * to keep that narrow — its own comment: "It is the one permission that exposes
 * what colleagues earn" — and this route handed the same figures to 1 372
 * parents.
 *
 * The parent app calls `/auth/*` and `/parent/*` and nothing else, so closing
 * these costs it nothing.
 */
describe('⚠ the school’s structure, and what its staff are paid', () => {
  let reference: ReferenceController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    reference = moduleRef.get(ReferenceController);
  });

  for (const handler of ['teachers', 'levels', 'groups', 'subjects', 'teachings', 'hierarchy'] as const) {
    it(`${handler}: a parent is refused`, () => {
      expect(allows(reference, handler, PARENT)).toBe(false);
    });
  }

  it('a teacher still sees the school they teach in', () => {
    // They read the timetable and the mark sheet; the structure is part of both.
    expect(allows(reference, 'levels', TEACHER)).toBe(true);
    expect(allows(reference, 'groups', TEACHER)).toBe(true);
  });

  it('⚠ the accountant sees the staff but not what they earn', async () => {
    // El Ourwa gates `gerer_professeurs.php` — the page carrying the salary
    // column — on `require_role(['super_admin','admin'])`, so an administrateur
    // restreint DOES see teacher pay while `finance.salaires` (which they do
    // not hold) governs paying it. The accountant is refused the page outright
    // there, and here the figures simply are not in the payload.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const svc = moduleRef.get(ReferenceService);

    await owner.query(
      `INSERT INTO teachers (school_id, first_name, last_name, employment, salary)
       VALUES ($1, 'Salaire', 'Visible', 'permanent', 60000)`,
      [schoolId],
    );

    const forDirection = await inTenant(() => svc.teachers(true));
    expect(forDirection[0]).toHaveProperty('salary');

    const forAccountant = await inTenant(() => svc.teachers(false));
    expect(forAccountant[0]).not.toHaveProperty('salary');
  });

  it('⚠ pay is stripped for anyone without `finance.salaires`', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const svc = moduleRef.get(ReferenceService);

    await owner.query(
      `INSERT INTO teachers (school_id, first_name, last_name, phone, employment,
                             hourly_rate, salary)
       VALUES ($1, 'Paie', 'Cachee', '+22240000123', 'permanent', 0, 77000)`,
      [schoolId],
    );

    const withPay = await inTenant(() => svc.teachers(true));
    expect(withPay[0]).toHaveProperty('salary');

    const without = await inTenant(() => svc.teachers(false));
    // ⚠ The field is ABSENT, not zeroed. A zero salary is a statement about a
    // colleague's pay, and a wrong one.
    expect(without[0]).not.toHaveProperty('salary');
    expect(without[0]).not.toHaveProperty('hourly_rate');
    // The name is what the caller actually needed.
    expect(without[0]).toHaveProperty('first_name');
  });
});
