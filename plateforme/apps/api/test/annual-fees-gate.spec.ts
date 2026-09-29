import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DebtService } from '../src/finance/debt.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES FRAIS ANNUELS DANS LA DETTE D'UNE FAMILLE — section B bis d'El Ourwa.
 *
 * ⚠ L'ÉCRAN DU GUICHET DISAIT « ✓ En règle (0 MRU) » À CÔTÉ DE 6 500 MRU DE
 * FRAIS NON PAYÉS, ET REFUSAIT DE LES ENCAISSER.
 *
 * Trouvé en ouvrant la fiche d'une famille dans le navigateur : elle affichait
 * « Frais d'inscription — 5 000 MRU — Non payé » et « Frais de photocopie —
 * 1 500 MRU — Non payé », un total de 0, et le bouton « Encaisser un règlement /
 * avance » grisé — il est `disabled` quand la dette vaut zéro. Deux autres
 * écrans (Impayés, Réinscriptions) annonçaient bien 6 500 pour la même famille.
 *
 * ⚠ LA CAUSE : `forGuardian()` conditionnait les frais annuels à
 * `rows.length > 0`, `rows` étant les lignes de MOIS facturables. El Ourwa
 * conditionne sur tout autre chose, et le dit :
 *
 *   « Ne comptent que si la famille a bien un eleve inscrit CETTE annee-la. »
 *
 *   SELECT COUNT(*) FROM etudiant_inscriptions i JOIN etudiants e …
 *    WHERE e.parent_id = :p AND i.annee = :an AND i.statut <> 'annule'
 *
 * — un compte d'INSCRIPTIONS. Une famille dont l'enfant est inscrit mais dont
 * les mois sont gratuits, exemptés ou pas encore échus n'a aucune ligne de mois :
 * ses frais annuels disparaissaient du total tout en restant affichés comme dus.
 * `detailAcrossYears()` teste l'année ouverte et n'a jamais eu le défaut, d'où
 * le désaccord entre les écrans.
 *
 * Et le commentaire d'El Ourwa dit pourquoi cela compte :
 * « S'ils ne sont pas encaisses a ce moment-la, ils ne s'evaporent pas : ils
 * sont dus. »
 *
 * De l'argent. Le test d'abord (règle 15).
 */

let owner: pg.Pool;
let debts: DebtService;

let schoolId: string;
let yearId: string;
let startYear: number;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'fraisan' }, fn);
}

/** Une famille dont l'enfant est inscrit et dont aucun mois n'est facturable. */
async function familleSansMois(tag: string): Promise<string> {
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`fraisan.${tag}@test`, `Famille ${tag}`],
  );
  const guardianId = g.rows[0]!.id;

  const s = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'SansMois') RETURNING id`,
    [schoolId, guardianId, `RIM-FA-${tag}`, `NID-FA-${tag}`, tag],
  );

  // ⚠ INSCRIT, ET C'EST TOUT CE QUI COMPTE POUR EL OURWA. Aucune ligne dans
  // `enrollment_months` : c'est le cas exact qui faisait disparaître les frais.
  await owner.query(
    `INSERT INTO enrollments
       (school_id, student_id, academic_year_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, (SELECT id FROM levels WHERE school_id = $1 LIMIT 1), 'enrolled', 0)`,
    [schoolId, s.rows[0]!.id, yearId],
  );

  return guardianId;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('fraisan', 'Frais', 'FRA')
     RETURNING id`,
  );
  schoolId = school.rows[0]!.id;
  startYear = 2025;

  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', $2, 'active') RETURNING id`,
    [schoolId, startYear],
  );
  yearId = y.rows[0]!.id;

  await owner.query(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order)
     VALUES ($1, '6eme', 10000, 'college', 10)`,
    [schoolId],
  );

  // Le barème de l'école, sous SES clés françaises — un futur import lira les
  // mêmes lignes de `configuration`.
  await owner.query(
    `INSERT INTO configuration (school_id, key, value) VALUES
       ($1, $2, '5000'), ($1, $3, '1500')`,
    [schoolId, `frais_inscription_${startYear}`, `frais_photocopie_${startYear}`],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  debts = moduleRef.get(DebtService);
});

afterAll(async () => {
  await owner?.end();
});

describe('les frais annuels comptent dès que la famille a un inscrit', () => {
  it('⚠ un enfant inscrit sans mois facturable doit quand même les frais', async () => {
    const guardianId = await familleSansMois('gate');

    const debt = await inTenant(() => debts.forGuardian(guardianId, yearId, startYear));

    // Ils étaient affichés comme dus…
    expect(debt.annualFees.map((f) => f.outstanding)).toEqual(['5000.00', '1500.00']);
    // …et c'est le total qui les oubliait, donc le guichet refusait de les encaisser.
    expect(debt.total).toBe('6500.00');
  });

  it('le frais « photocopie » porte le nom de l’école (El Mourad : « Frais Graytna ») — le montant ne change pas', async () => {
    const guardianId = await familleSansMois('libelle');

    const avant = await inTenant(() => debts.forGuardian(guardianId, yearId, startYear));
    expect(avant.annualFees.map((f) => f.label)).toEqual(["Frais d'inscription", 'Frais de photocopie']);

    process.env.FEE_PHOTOCOPY_LABEL = 'Frais Graytna';
    try {
      const apres = await inTenant(() => debts.forGuardian(guardianId, yearId, startYear));
      expect(apres.annualFees.map((f) => f.label)).toEqual(["Frais d'inscription", 'Frais Graytna']);
      // Seul le nom change : mêmes montants, même total.
      expect(apres.annualFees.map((f) => f.outstanding)).toEqual(['5000.00', '1500.00']);
      expect(apres.total).toBe(avant.total);
    } finally {
      delete process.env.FEE_PHOTOCOPY_LABEL;
    }
  });

  it('les deux écrans qui comptaient juste continuent de compter juste', async () => {
    const guardianId = await familleSansMois('accord');

    const fiche = await inTenant(() => debts.forGuardian(guardianId, yearId, startYear));
    const across = await inTenant(() => debts.detailAcrossYears(guardianId));

    // ⚠ LE DÉSACCORD ENTRE ÉCRANS EST CE QU'ON CORRIGE : la fiche du guichet et
    // le calcul multi-années doivent annoncer le même chiffre à la famille.
    expect(fiche.total).toBe(across.total.toFixed(2));
  });

  it('⚠ une famille SANS aucun inscrit cette année ne les doit pas', async () => {
    // Sa condition est bien une condition : « Ne comptent que si la famille a
    // bien un eleve inscrit CETTE annee-la. » Un correspondant sans enfant
    // inscrit ne se voit rien réclamer.
    const g = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('fraisan.vide@test', 'x', 'Sans enfant') RETURNING id`,
    );
    const debt = await inTenant(() => debts.forGuardian(g.rows[0]!.id, yearId, startYear));
    expect(debt.annualFees).toEqual([]);
    expect(debt.total).toBe('0.00');
  });

  it('une inscription annulée ne suffit pas non plus', async () => {
    const g = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('fraisan.annule@test', 'x', 'Annulee') RETURNING id`,
    );
    const s = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'RIM-FA-ANN', 'NID-FA-ANN', 'Ann', 'Ulee') RETURNING id`,
      [schoolId, g.rows[0]!.id],
    );
    await owner.query(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, level_id, status, monthly_fee)
       VALUES ($1, $2, $3, (SELECT id FROM levels WHERE school_id = $1 LIMIT 1), 'cancelled', 0)`,
      [schoolId, s.rows[0]!.id, yearId],
    );

    const debt = await inTenant(() => debts.forGuardian(g.rows[0]!.id, yearId, startYear));
    expect(debt.annualFees).toEqual([]);
    expect(debt.total).toBe('0.00');
  });
});
