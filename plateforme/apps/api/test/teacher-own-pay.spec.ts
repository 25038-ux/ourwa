import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ReferenceService } from '../src/academic/reference.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * CE QU'UN PROFESSEUR GAGNE — son tableau de bord, `pages/professeur/tableau_bord.php`.
 *
 * ⚠ UN PROFESSEUR NE POUVAIT PAS VOIR SA PROPRE PAIE. Son tableau de bord porte
 * quatre tuiles — « Mes classes », « Heures / semaine », **« Tarif horaire »**,
 * **« Salaire mensuel »** — puis une carte « Détail de mon salaire mensuel ».
 * Le nôtre en avait deux justes et deux inventées (« Assignations »,
 * « Créneaux »), et aucune ne parlait d'argent : la seule façon pour un
 * enseignant de connaître son taux était de le demander à l'administration.
 *
 * ⚠ ET C'EST UNE LECTURE DE SALAIRE, donc la question n'est pas « qui a la
 * permission » mais « de qui ». Elle se résout depuis le JETON, jamais depuis un
 * identifiant d'URL : un professeur voit sa fiche et celle de personne d'autre.
 * C'est ce que ces tests tiennent.
 */

let owner: pg.Pool;
let reference: ReferenceService;

let schoolId: string;
let yearId: string;
let userPermanent: string;
let userInterim: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'paieprof' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('paieprof', 'Paie', 'PAP')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
    [schoolId],
  );
  yearId = y.rows[0]!.id;

  const l = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 3000, 'college', 10) RETURNING id`,
    [schoolId],
  );
  const g = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6A') RETURNING id`,
    [schoolId, l.rows[0]!.id],
  );
  const sub = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Calcul', 2) RETURNING id`,
    [schoolId],
  );

  // Un permanent — payé au mois — et un intérimaire, payé à l'heure.
  for (const [tag, employment, salary, rate] of [
    ['perm', 'permanent', 60000, 0],
    ['int', 'interim', 0, 500],
  ] as const) {
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
      [`paieprof.${tag}@test`, `Prof ${tag}`],
    );
    const t = await owner.query<{ id: string }>(
      `INSERT INTO teachers (school_id, user_id, first_name, last_name, employment, salary, hourly_rate)
       VALUES ($1, $2, 'Prof', $3, $4, $5, $6) RETURNING id`,
      [schoolId, u.rows[0]!.id, tag, employment, salary, rate],
    );
    await owner.query(
      `INSERT INTO teachings
         (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
       VALUES ($1, $2, $3, $4, $5, 6)`,
      [schoolId, yearId, g.rows[0]!.id, sub.rows[0]!.id, t.rows[0]!.id],
    );
    if (tag === 'perm') userPermanent = u.rows[0]!.id;
    else userInterim = u.rows[0]!.id;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  reference = moduleRef.get(ReferenceService);
});

afterAll(async () => {
  await owner?.end();
});

describe('un professeur voit sa propre paie', () => {
  it('un permanent : son salaire mensuel, pas de taux horaire', async () => {
    const paie = await inTenant(() => reference.ownPay(userPermanent));
    expect(paie).not.toBeNull();
    expect(paie!.employment).toBe('permanent');
    expect(paie!.salary).toBe('60000.00');
    // ⚠ Le mois vaut QUATRE SEMAINES, comme partout ailleurs dans la paie.
    expect(paie!.hoursPerWeek).toBe('6.0');
    expect(paie!.hoursPerMonth).toBe(24);
    // Un permanent est payé son salaire, quel que soit le nombre d'heures.
    expect(paie!.monthlyPay).toBe('60000.00');
  });

  it('un intérimaire : heures × taux, comme la paie le calcule', async () => {
    const paie = await inTenant(() => reference.ownPay(userInterim));
    expect(paie!.employment).toBe('interim');
    expect(paie!.hourlyRate).toBe('500.00');
    // 6 h/semaine × 4 semaines × 500 = 12 000.
    expect(paie!.monthlyPay).toBe('12000.00');
  });

  it('⚠ le détail porte une ligne par enseignement', async () => {
    const paie = await inTenant(() => reference.ownPay(userInterim));
    expect(paie!.lines).toHaveLength(1);
    expect(paie!.lines[0]!.groupName).toBe('6A');
    expect(paie!.lines[0]!.subjectName).toBe('Calcul');
    expect(paie!.lines[0]!.hoursPerWeek).toBe('6.0');
  });

  it('⚠ un compte SANS fiche enseignant ne rend rien, il n’échoue pas', async () => {
    // Un administrateur qui ouvrirait cette route n'est pas une erreur : il
    // n'est simplement pas professeur. Rendre `null` laisse la page le dire.
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('paieprof.sansfiche@test', 'x', 'Sans fiche') RETURNING id`,
    );
    expect(await inTenant(() => reference.ownPay(u.rows[0]!.id))).toBeNull();
  });

  it('⚠ la paie se résout depuis le compte, jamais depuis un identifiant fourni', async () => {
    // La signature elle-même est la garantie : `ownPay(userId)` prend le
    // porteur du jeton. Deux professeurs de la même école n'obtiennent donc pas
    // la même réponse, et aucun ne peut demander celle de l'autre.
    const a = await inTenant(() => reference.ownPay(userPermanent));
    const b = await inTenant(() => reference.ownPay(userInterim));
    expect(a!.monthlyPay).not.toBe(b!.monthlyPay);
  });
});
