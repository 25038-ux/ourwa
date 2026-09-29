import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { CommsService } from '../src/comms/comms.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * DEMANDES — `demandes.php`, action `decider` : « If approving, auto-execute
 * the transaction. » Approuver une demande de dépense CRÉE la dépense (et ses
 * lignes de caisse) au nom du demandeur ; approuver une demande de frais
 * mensuel APPLIQUE le tarif à l'inscription et aux mois non réglés ; approuver
 * une demande de dette CRÉE la créance. Rejeter n'exécute rien. Tout cela dans
 * la même transaction que la décision (règle 7 : de l'argent, jamais à moitié).
 */

let owner: pg.Pool;
let comms: CommsService;
let enrollments: EnrollmentService;

let schoolId: string;
let yearId: string;
let groupId: string;
let guardianId: string;
let studentId: string;
let ACTOR: string;
let COMPTABLE: string;
let CASH: string;

const DIRECTION = ['scolarite.niveaux'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'demandes-exec' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  schoolId = (
    await owner.query<{ id: string }>(
      `INSERT INTO schools (slug, name, receipt_prefix)
       VALUES ('demandes-exec', 'Demandes Exécution', 'DEX') RETURNING id`,
    )
  ).rows[0]!.id;
  yearId = (
    await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2020-2021', 2020, 'active') RETURNING id`,
      [schoolId],
    )
  ).rows[0]!.id;
  const level = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle)
     VALUES ($1, '6eme', 10000, 'college') RETURNING id`,
    [schoolId],
  );
  groupId = (
    await owner.query<{ id: string }>(
      `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6eme A') RETURNING id`,
      [schoolId, level.rows[0]!.id],
    )
  ).rows[0]!.id;
  const users = await owner.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES
       ('demandes.exec.admin@test', 'x', 'Direction'),
       ('demandes.exec.comptable@test', 'x', 'Agent comptable'),
       ('demandes.exec.parent@test', 'x', 'Parent')
     RETURNING id, email`,
  );
  ACTOR = users.rows.find((r) => r.email === 'demandes.exec.admin@test')!.id;
  COMPTABLE = users.rows.find((r) => r.email === 'demandes.exec.comptable@test')!.id;
  guardianId = users.rows.find((r) => r.email === 'demandes.exec.parent@test')!.id;
  studentId = (
    await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-DEX', 'NID-DEX', 'Enfant', 'Demande') RETURNING id`,
      [schoolId, guardianId],
    )
  ).rows[0]!.id;
  CASH = (
    await owner.query<{ id: string }>(
      `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Espèces') RETURNING id`,
      [schoolId],
    )
  ).rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  comms = moduleRef.get(CommsService);
  enrollments = moduleRef.get(EnrollmentService);

  await inTenant(() =>
    enrollments.enrol({ studentId, academicYearId: yearId, groupId, entryDate: '2020-10-01' }, ACTOR, DIRECTION),
  );
});

afterAll(async () => {
  await owner.query('DELETE FROM schools WHERE id = $1', [schoolId]);
  await owner.query("DELETE FROM users WHERE email LIKE 'demandes.exec.%'");
  await owner.end();
});

describe('approuver exécute la demande', () => {
  it('une dépense approuvée est créée, avec ses lignes, au nom du demandeur', async () => {
    const raised = await inTenant(() =>
      comms.raise(
        {
          kind: 'depense',
          description: 'Réparation du groupe électrogène',
          amount: '85000.00',
          metadata: {
            montant: '85000.00',
            description: 'Réparation du groupe électrogène',
            lignes: [{ paymentMethodId: CASH, amount: '85000.00' }],
          },
        },
        COMPTABLE,
      ),
    );
    const decided = await inTenant(() => comms.decide(raised.id, 'approved', 'Accordé.', ACTOR));
    expect(decided.message).toBe('Demande approuvée et exécutée.');

    const { rows } = await owner.query<{ amount: string; created_by: string; lignes: string }>(
      `SELECT e.amount::text, e.created_by,
              (SELECT count(*)::text FROM tender_lines t WHERE t.source_type = 'depense' AND t.source_id = e.id) AS lignes
         FROM expenses e WHERE e.school_id = $1`,
      [schoolId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('85000.00');
    expect(rows[0]!.created_by).toBe(COMPTABLE);
    expect(rows[0]!.lignes).toBe('1');
  });

  it('une dépense rejetée ne crée rien', async () => {
    const raised = await inTenant(() =>
      comms.raise(
        {
          kind: 'depense',
          description: 'Achat de craie',
          amount: '2000.00',
          metadata: { montant: '2000.00', description: 'Achat de craie', lignes: [{ paymentMethodId: CASH, amount: '2000.00' }] },
        },
        COMPTABLE,
      ),
    );
    const decided = await inTenant(() => comms.decide(raised.id, 'refused', 'Non.', ACTOR));
    expect(decided.message).toBe('Demande rejetée.');
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM expenses WHERE school_id = $1',
      [schoolId],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('⚠ un frais mensuel approuvé est appliqué à l’inscription et aux mois non réglés', async () => {
    const raised = await inTenant(() =>
      comms.raise(
        {
          kind: 'frais_mensuel',
          description: 'Modification du frais mensuel de Enfant Demande : 10 000 MRU → 7 500 MRU',
          amount: '7500.00',
          metadata: { etudiant_id: studentId, etudiant_nom: 'Enfant Demande', frais_demande: '7500.00', frais_actuel: '10000.00' },
        },
        COMPTABLE,
      ),
    );
    await inTenant(() => comms.decide(raised.id, 'approved', undefined, ACTOR));

    const { rows } = await owner.query<{ monthly_fee: string; mois: string }>(
      `SELECT e.monthly_fee::text,
              (SELECT string_agg(DISTINCT m.amount_due::text, ',') FROM enrollment_months m
                WHERE m.enrollment_id = e.id AND m.status = 'billable') AS mois
         FROM enrollments e WHERE e.student_id = $1 AND e.academic_year_id = $2`,
      [studentId, yearId],
    );
    expect(rows[0]!.monthly_fee).toBe('7500.00');
    expect(rows[0]!.mois).toBe('7500.00');
  });

  it('une dette approuvée crée la créance', async () => {
    const raised = await inTenant(() =>
      comms.raise(
        {
          kind: 'dette',
          description: 'Prêt de service',
          amount: '12000.00',
          metadata: { debiteur_nom: 'Sidi Ould Baba', telephone: '22000000', montant_total: '12000.00', motif: 'Prêt de service' },
        },
        COMPTABLE,
      ),
    );
    await inTenant(() => comms.decide(raised.id, 'approved', undefined, ACTOR));
    const { rows } = await owner.query<{ total: string; debtor_name: string }>(
      'SELECT total::text, debtor_name FROM misc_debts WHERE school_id = $1',
      [schoolId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBe('12000.00');
    expect(rows[0]!.debtor_name).toBe('Sidi Ould Baba');
  });

  it('⚠ une exécution qui échoue n’enregistre pas la décision', async () => {
    const raised = await inTenant(() =>
      comms.raise(
        {
          kind: 'depense',
          description: 'Lignes qui ne font pas le compte',
          amount: '5000.00',
          metadata: { montant: '5000.00', description: 'Lignes fausses', lignes: [{ paymentMethodId: CASH, amount: '1000.00' }] },
        },
        COMPTABLE,
      ),
    );
    await expect(inTenant(() => comms.decide(raised.id, 'approved', undefined, ACTOR))).rejects.toThrow();
    const { rows } = await owner.query<{ status: string }>(
      'SELECT status::text FROM approval_requests WHERE id = $1',
      [raised.id],
    );
    expect(rows[0]!.status).toBe('pending');
  });
});
