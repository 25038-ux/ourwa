import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DebtService } from '../src/finance/debt.service.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LA DETTE DE SCOLARITÉ NE PORTE QUE SUR L'ANNÉE SCOLARISÉE.
 *
 * ⚠ TROUVÉ PAR LA RÉCONCILIATION, PAS PAR UN RAPPORT DE BOGUE. Sur les 1 372
 * familles réelles, El Ourwa calcule 1 574 000.00 de scolarité due ; nous en
 * calculions 34 038 500.00. Il compte 611 mois impayés, nous 11 844. Vingt fois
 * plus, sur le chiffre que l'école réclame à une famille.
 *
 * Sa règle, dans `obtenir_dette_parent_detaillee()`, et ses raisons dans ses
 * propres commentaires :
 *
 *   « Un mois NON FACTURÉ n'est réclamé que pour l'année réellement scolarisée.
 *     Un élève dont la dernière inscription est antérieure a QUITTÉ l'école :
 *     l'ancien logiciel ne lui réclame plus rien, et lui facturer les mois
 *     postérieurs à son départ inventerait une créance. »
 *
 *   « Les années antérieures à `dette_mois_depuis_annee` n'ont ni facture ni
 *     paiement repris. Les compter fabriquerait une dette qui n'a jamais
 *     existé. »
 *
 * Les arriérés des années passées ne disparaissent pas : ils ont été constatés
 * un par un dans `dettes_familles` — nos `misc_debts`, 9 875 500.00 d'arriérés,
 * réconciliés au centime. Les recompter depuis l'échéancier les ferait payer
 * deux fois.
 *
 * ⚠ Une divergence sur de l'argent est un défaut bloquant (règle 25), et
 * El Ourwa a raison jusqu'à preuve du contraire (règle 26). Ici la preuve va
 * dans son sens : c'est nous qui inventions une créance.
 */

let owner: pg.Pool;
let debts: DebtService;
let enrollments: EnrollmentService;

let schoolId: string;
let anneePassee: string;
let anneeCourante: string;
let groupId: string;
let guardianId: string;
let studentId: string;
let ACTOR: string;

const DIRECTION = ['scolarite.niveaux'];

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'dette-annee' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  schoolId = (
    await owner.query<{ id: string }>(
      `INSERT INTO schools (slug, name, receipt_prefix)
       VALUES ('dette-annee', 'Dette Année', 'DAN') RETURNING id`,
    )
  ).rows[0]!.id;

  // Deux années, toutes deux dans le passé pour que chaque mois soit échu :
  // l'une close, l'autre ACTIVE — c'est elle « l'année scolarisée ».
  anneePassee = (
    await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2019-2020', 2019, 'active') RETURNING id`,
      [schoolId],
    )
  ).rows[0]!.id;
  anneeCourante = (
    await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2020-2021', 2020, 'future') RETURNING id`,
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

  ACTOR = (
    await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('dette.annee.actor@test', 'x', 'Actor') RETURNING id`,
    )
  ).rows[0]!.id;
  guardianId = (
    await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('dette.annee.parent@test', 'x', 'Parent') RETURNING id`,
    )
  ).rows[0]!.id;
  studentId = (
    await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-DA', 'NID-DA', 'Enfant', 'Test') RETURNING id`,
      [schoolId, guardianId],
    )
  ).rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  debts = moduleRef.get(DebtService);
  enrollments = moduleRef.get(EnrollmentService);

  // Inscrit les deux annees, sans jamais rien payer : 9 mois dus chaque annee.
  // Seule l'annee ACTIVE accepte une inscription, donc l'annee tourne entre
  // les deux, exactement comme dans la vie : on inscrit, l'annee se clot, la
  // suivante s'ouvre, on reinscrit.
  const inscrire = (annee: string, an: number) =>
    inTenant(() =>
      enrollments.enrol(
        { studentId, academicYearId: annee, groupId, entryDate: `${an}-10-01` },
        ACTOR,
        DIRECTION,
      ),
    );
  await inscrire(anneePassee, 2019);
  await owner.query("UPDATE academic_years SET status = 'closed' WHERE id = $1", [anneePassee]);
  await owner.query("UPDATE academic_years SET status = 'active' WHERE id = $1", [anneeCourante]);
  await inscrire(anneeCourante, 2020);
});

afterAll(async () => {
  await owner.query('DELETE FROM schools WHERE id = $1', [schoolId]);
  await owner.query("DELETE FROM users WHERE email LIKE 'dette.annee.%'");
  await owner.end();
});

describe('la dette de scolarité, toutes années confondues', () => {
  it('⚠ ne compte que les mois de l’année scolarisée, jamais ceux d’une année passée', async () => {
    const d = await inTenant(() => debts.detailAcrossYears(guardianId));

    // 9 mois × 10 000 pour 2020-2021 — et RIEN pour 2019-2020, dont les
    // arriérés relèvent des dettes constatées, pas de l'échéancier.
    expect(d.tuition).toHaveLength(9);
    expect(d.total.toFixed(2)).toBe('90000.00');
    expect(d.tuition.every((l) => l.label.includes('2020') || l.label.includes('2021'))).toBe(true);
  });

  it('respecte `dette_mois_depuis_annee` quand l’école l’a posé', async () => {
    // El Ourwa : « les années antérieures n'ont ni facture ni paiement repris ».
    await owner.query(
      `INSERT INTO configuration (school_id, key, value) VALUES ($1, 'dette_mois_depuis_annee', '2021')
       ON CONFLICT (school_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [schoolId],
    );
    try {
      const d = await inTenant(() => debts.detailAcrossYears(guardianId));
      expect(d.tuition).toHaveLength(0);
      expect(d.total.toFixed(2)).toBe('0.00');
    } finally {
      await owner.query(
        "DELETE FROM configuration WHERE school_id = $1 AND key = 'dette_mois_depuis_annee'",
        [schoolId],
      );
    }
  });

  it('sans cette clé, ne coupe rien : une école neuve n’a rien à couper', async () => {
    const d = await inTenant(() => debts.detailAcrossYears(guardianId));
    expect(d.total.toFixed(2)).toBe('90000.00');
  });
});

describe('la dette d’une année précise', () => {
  it('⚠ rend zéro de scolarité pour une année qui n’est pas la scolarisée', async () => {
    // La même règle chez lui : `ei.annee = :courante AND ei.annee_id = :a`. Une
    // année passée n'a plus de mois « non facturés » à réclamer.
    const d = await inTenant(() => debts.forGuardian(guardianId, anneePassee, 2019));
    expect(d.tuition).toHaveLength(0);
    expect(d.total).toBe('0.00');
  });

  it('rend les 9 mois pour l’année scolarisée', async () => {
    const d = await inTenant(() => debts.forGuardian(guardianId, anneeCourante, 2020));
    expect(d.tuition).toHaveLength(9);
    expect(d.total).toBe('90000.00');
  });
});
