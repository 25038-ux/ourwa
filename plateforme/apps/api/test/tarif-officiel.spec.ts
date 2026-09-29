import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LE TARIF OFFICIEL S'APPLIQUE EN ATTENDANT — `inscrire_etudiant.php`.
 *
 * ⚠ LA CAISSE ET LE SECRÉTARIAT NE FIXENT PAS CE QU'UNE FAMILLE PAIERA. El Ourwa
 * ne les refuse pas : il **substitue**. Si un comptable ou une secrétaire saisit
 * un frais différent du tarif du niveau, c'est le tarif du niveau qui est écrit,
 * et une demande part à l'administration :
 *
 *   ```php
 *   $est_role_limite = est_comptable() || est_secretaire();
 *   if ($est_role_limite && abs($frais - $tarif_niveau) > 0.01) {
 *       $frais_demande_attente = (float) $frais;
 *       $frais = (float) $tarif_niveau;   // tarif officiel appliqué en attendant
 *   }
 *   ```
 *
 * « Le frais mensuel saisi diffère du tarif du niveau : une demande a été
 * envoyée à l'administrateur. Le tarif officiel s'applique en attendant sa
 * validation. »
 *
 * ⚠ NOUS ÉCRIVIONS LE MONTANT SAISI, QUEL QU'IL SOIT. `scolarite.inscrire` est
 * détenue par le comptable et la secrétaire ; l'une ou l'autre pouvait donc
 * inscrire un enfant à 1 000 MRU dans un niveau à 22 000 et l'échéancier entier
 * était construit dessus. Ce n'est pas une remise accordée : c'est un tarif
 * décidé par quelqu'un qui n'en a pas l'autorité, et rien à l'écran ne le
 * signalait.
 *
 * ⚠ ÉCRIT AVANT LE CORRECTIF (règle 15) : cela décide de ce qu'une famille doit.
 */

let owner: pg.Pool;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let groupId: string;
let levelId: string;

const ACTEUR = '00000000-0000-0000-0000-000000000000';
const DIRECTION = ['scolarite.inscrire'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'tarifoff' }, fn);
}

/** Un élève neuf, pour que chaque cas parte d'une inscription vierge. */
async function eleve(tag: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $2, 'E', $3) RETURNING id`,
    [schoolId, `RIM-TO-${tag}`, tag],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('tarifoff', 'Tarif', 'TAR')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, '2025-2026', 2025, 10, 6, 'active') RETURNING id`,
    [schoolId],
  );
  yearId = y.rows[0]!.id;

  // Un niveau à 22 000 — le tarif officiel.
  const l = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '3eme', 22000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  levelId = l.rows[0]!.id;

  const g = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '3B') RETURNING id`,
    [schoolId, levelId],
  );
  groupId = g.rows[0]!.id;

  const u = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('tarifoff.acteur@test', 'x', 'Acteur') RETURNING id`,
  );
  // L'acteur réel, pour que l'audit et la demande aient un auteur valide.
  (globalThis as Record<string, unknown>).__acteur = u.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  enrollments = moduleRef.get(EnrollmentService);
});

afterAll(async () => {
  await owner?.end();
});

const acteur = () => (globalThis as Record<string, unknown>).__acteur as string;

describe('qui décide du frais mensuel à l’inscription', () => {
  it('la direction écrit le montant qu’elle saisit', async () => {
    const studentId = await eleve('dir');
    const r = await inTenant(() =>
      enrollments.enrol(
        { studentId, academicYearId: yearId, groupId, monthlyFee: '15000.00' },
        acteur(),
        DIRECTION,
        ['super_admin'],
      ),
    );
    expect(r.monthlyFee).toBe('15000.00');
    expect(r.feeRequested).toBeUndefined();
  });

  it('⚠ le comptable voit son montant remplacé par le tarif du niveau', async () => {
    const studentId = await eleve('cpt');
    const r = await inTenant(() =>
      enrollments.enrol(
        { studentId, academicYearId: yearId, groupId, monthlyFee: '1000.00' },
        acteur(),
        DIRECTION,
        ['comptable'],
      ),
    );
    // Le tarif officiel s'applique en attendant — tel qu'il est stocké.
    expect(r.monthlyFee).toBe('22000.00');
    expect(r.feeRequested).toBe('1000.00');
  });

  it('⚠ et l’échéancier est bâti sur le tarif officiel, pas sur le montant saisi', async () => {
    // C'est là que se jouait le vrai dégât : douze mois construits à 1 000.
    const { rows } = await owner.query<{ amount_due: string }>(
      `SELECT DISTINCT m.amount_due::text
         FROM enrollment_months m
         JOIN enrollments e ON e.id = m.enrollment_id
         JOIN students s ON s.id = e.student_id
        WHERE s.rim = 'RIM-TO-cpt' AND m.status = 'billable'`,
    );
    expect(rows.map((r) => r.amount_due)).toEqual(['22000.00']);
  });

  it('⚠ une demande part à l’administration, avec les deux montants', async () => {
    const { rows } = await owner.query<{ kind: string; amount: string; description: string }>(
      `SELECT kind, amount::text, description FROM approval_requests
        WHERE school_id = $1 AND kind = 'frais_mensuel'`,
      [schoolId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('1000.00');
    // Sa description porte le passage d'un montant à l'autre.
    expect(rows[0]!.description).toContain('22 000');
    expect(rows[0]!.description).toContain('1 000');
  });

  it('la secrétaire est traitée comme le comptable', async () => {
    const studentId = await eleve('sec');
    const r = await inTenant(() =>
      enrollments.enrol(
        { studentId, academicYearId: yearId, groupId, monthlyFee: '500.00' },
        acteur(),
        DIRECTION,
        ['secretaire'],
      ),
    );
    expect(r.monthlyFee).toBe('22000.00');
    expect(r.feeRequested).toBe('500.00');
  });

  it('⚠ un montant ÉGAL au tarif ne déclenche aucune demande', async () => {
    // Sa tolérance : `abs($frais - $tarif_niveau) > 0.01`.
    const compte = async () => {
      const { rows } = await owner.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM approval_requests
          WHERE school_id = $1 AND kind = 'frais_mensuel'`,
        [schoolId],
      );
      return rows[0]!.n;
    };
    const avant = await compte();

    const studentId = await eleve('egal');
    const r = await inTenant(() =>
      enrollments.enrol(
        { studentId, academicYearId: yearId, groupId, monthlyFee: '22000.00' },
        acteur(),
        DIRECTION,
        ['comptable'],
      ),
    );
    expect(r.feeRequested).toBeUndefined();
    // Aucune demande de plus : c'est le nombre qui ne bouge pas qui le prouve.
    expect(await compte()).toBe(avant);
  });

  it('⚠ une bourse (gratuité) reste possible : elle est déjà tracée ailleurs', async () => {
    // `isFree` passe par l'exemption, qui a sa propre garde de direction.
    // Substituer le tarif ici ferait payer un boursier.
    const studentId = await eleve('libre');
    const r = await inTenant(() =>
      enrollments.enrol(
        { studentId, academicYearId: yearId, groupId, isFree: true },
        acteur(),
        DIRECTION,
        ['comptable'],
      ),
    );
    expect(r.monthlyFee).toBe('0');
    expect(r.feeRequested).toBeUndefined();
  });
});
