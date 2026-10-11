import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { Decimal } from 'decimal.js';
import { money, toStorage } from '@elourwa/shared';
import { AppModule } from '../src/app.module.js';
import { PaymentsService } from '../src/finance/payments.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * « SYNTHÈSE — ANNÉE SCOLAIRE » : À QUELLE ANNÉE VA L'ARGENT DE L'ÉTÉ.
 *
 * Propriétaire, 10/10/2026, le jour de la mise en ligne : « the 569k in
 * synthèse d'année which is a lie cuz 2026-2027 the school recorded no money ».
 * Il avait raison au centime : 569 000,00 de lignes de caisse de juillet et
 * août 2026, toutes des mensualités EN RETARD de 2025-2026 et de 2024-2025.
 * La synthèse de 2026-2027 les comptait parce qu'une année « possède » l'été
 * qui la précède (`periodeAttribuee`) — règle ajoutée huit jours plus tôt pour
 * le défaut inverse : l'argent de la rentrée, en septembre, n'était dans la
 * synthèse d'aucune année.
 *
 * Les deux demandes tiennent ensemble dès qu'on lit, HORS DES MOIS NOMINAUX,
 * l'année que porte le paiement lui-même :
 *
 *   - une ligne de caisse datée hors des mois nominaux de toute année, et qui
 *     règle un paiement rattaché à une année, appartient à CETTE année ;
 *   - une ligne qui n'est rattachée à aucune année (dépense, salaire, dette…)
 *     garde l'attribution d'avant : l'année qui possède la date ;
 *   - dans les mois nominaux d'une année (octobre → juin), la date fait foi,
 *     comme dans El Ourwa (`bilan_annee_scolaire()`).
 *
 * Aucune ligne n'est comptée deux fois, aucune n'est perdue.
 */

let owner: pg.Pool;
let payments: PaymentsService;
let reports: ReportsService;

let schoolId: string;
let studentId: string;
let guardianId: string;
let cashId: string;
let ACTOR: string;

type Annee = { id: string; label: string; start_year: number; start_month: number; end_month: number };
/** A, B, C : trois années qui se suivent, octobre → juin. D : la suivante, seulement créée. */
let A: Annee;
let B: Annee;
let C: Annee;
let D: Annee;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'syn' }, fn);
}

const bilan = (annee: Annee) => inTenant(() => reports.bilanAnneeScolaire(annee));

async function creerAnnee(startYear: number): Promise<Annee> {
  // « future » : une année créée et non clôturée accepte les écritures ; les
  // statuts réels (clôturée / active) sont posés une fois la caisse remplie.
  const { rows } = await owner.query<Annee>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, $2, $3, 'future')
     RETURNING id, label, start_year, start_month, end_month`,
    [schoolId, `${startYear}-${startYear + 1}`, startYear],
  );
  return rows[0]!;
}

/** Une mensualité rattachée à `annee`, encaissée le `jour` (reçu et ligne de caisse à cette date). */
async function mensualite(annee: Annee, jour: string, montant: string): Promise<string> {
  const p = await inTenant(() =>
    payments.record(
      {
        studentId,
        academicYearId: annee.id,
        calendarMonth: 10,
        calendarYear: annee.start_year,
        amount: montant,
        tender: [{ paymentMethodId: cashId, amount: montant }],
      },
      ACTOR,
    ),
  );
  await owner.query(`UPDATE payments SET paid_at = $2::date + time '10:00' WHERE id = $1`, [p.id, jour]);
  await owner.query(`UPDATE tender_lines SET created_at = $2::date + time '10:00' WHERE source_id = $1`, [p.id, jour]);
  return p.id;
}

/** Des frais annuels (inscription) rattachés à `annee`, encaissés le `jour`. */
async function fraisAnnuels(annee: Annee, jour: string, montant: string): Promise<void> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO family_fee_payments
       (school_id, guardian_id, academic_year_id, kind, amount, receipt_number, recorded_by, paid_at)
     VALUES ($1, $2, $3, 'enrolment', $4, $5, $6, $7::date + time '10:00') RETURNING id`,
    [schoolId, guardianId, annee.id, montant, `SYN-FA-${jour}`, ACTOR, jour],
  );
  await owner.query(
    `INSERT INTO tender_lines (school_id, source_type, source_id, payment_method_id, amount, direction, created_at)
     VALUES ($1, 'frais_annuel', $2, $3, $4, 'in', $5::date + time '10:00')`,
    [schoolId, rows[0]!.id, cashId, montant, jour],
  );
}

/** Une ligne de caisse qui ne porte AUCUNE année : une dette remboursée, une dépense… */
async function ligneSansAnnee(origine: string, sens: 'in' | 'out', jour: string, montant: string): Promise<void> {
  await owner.query(
    `INSERT INTO tender_lines (school_id, source_type, source_id, payment_method_id, amount, direction, created_at)
     VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6::date + time '10:00')`,
    [schoolId, origine, cashId, montant, sens, jour],
  );
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('syn', 'Synthese', 'SYN') RETURNING id`,
  );
  schoolId = school.rows[0]!.id;

  A = await creerAnnee(2020);
  B = await creerAnnee(2021);
  C = await creerAnnee(2022);

  const actor = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('syn.caisse@test', 'x', 'Caissier') RETURNING id`,
  );
  ACTOR = actor.rows[0]!.id;
  const guardian = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('syn.parent@test', 'x', 'Parent Syn') RETURNING id`,
  );
  guardianId = guardian.rows[0]!.id;
  const student = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, 'RIM-SYN', 'NID-SYN', 'Syn', 'Eleve') RETURNING id`,
    [schoolId, guardianId],
  );
  studentId = student.rows[0]!.id;
  const methods = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes') RETURNING id`,
    [schoolId],
  );
  cashId = methods.rows[0]!.id;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  payments = moduleRef.get(PaymentsService);
  reports = moduleRef.get(ReportsService);

  /*
   * LA CAISSE, inventée — chaque montant est unique pour qu'une ligne comptée
   * au mauvais endroit se lise dans le total.
   *
   *   date         quoi                                   année du paiement   attendue dans
   *   2021-03-10   mensualité                             A                   A (mois nominaux)
   *   2021-08-05   mensualité EN RETARD                   A                   A  ← était dans B
   *   2021-08-10   dette remboursée (aucune année)        —                   B (possède l'été 2021)
   *   2021-09-15   mensualité de RENTRÉE                  B                   B
   *   2021-09-20   dépense (aucune année), sortie         —                   B
   *   2021-11-10   mensualité                             B                   B (mois nominaux)
   *   2021-12-01   mensualité en retard, en plein hiver   A                   B (la date fait foi)
   *   2022-01-10   dépense, sortie                        —                   B
   *   2022-07-10   mensualité EN RETARD de deux ans       A                   A  ← était dans C
   *   2022-08-01   mensualité EN RETARD                   B                   B  ← était dans C
   */
  await mensualite(A, '2021-03-10', '10000.00');
  await mensualite(A, '2021-08-05', '4000.00');
  await ligneSansAnnee('dette', 'in', '2021-08-10', '300.00');
  await mensualite(B, '2021-09-15', '7000.00');
  await ligneSansAnnee('depense', 'out', '2021-09-20', '700.00');
  await mensualite(B, '2021-11-10', '10000.00');
  await mensualite(A, '2021-12-01', '2000.00');
  await ligneSansAnnee('depense', 'out', '2022-01-10', '450.00');
  await mensualite(A, '2022-07-10', '1000.00');
  await mensualite(B, '2022-08-01', '5000.00');

  // Comme à l'école aujourd'hui : les années passées clôturées, la dernière ouverte.
  await owner.query(`UPDATE academic_years SET status = 'closed', closed_at = now() WHERE id = ANY($1::uuid[])`, [[A.id, B.id]]);
  await owner.query(`UPDATE academic_years SET status = 'active' WHERE id = $1`, [C.id]);
});

afterAll(async () => {
  await owner?.end();
});

describe('la synthèse d’une année : l’argent de l’été va à l’année du paiement', () => {
  it('⚠ ce que le propriétaire a vu : une année ouverte dont l’été n’a encaissé que des RETARDS affiche 0,00', async () => {
    // Juillet et août 2022 : 1 000 + 5 000 de mensualités des années A et B.
    // L'année C n'a rien encaissé pour elle-même.
    const c = await bilan(C);
    expect(c.source).toBe('caisse');
    expect(c.encaisse).toBe('0.00');
    expect(c.depense).toBe('0.00');
    expect(typeof c.encaisse).toBe('string');
    // « Entrées − sorties depuis le … » dit toujours la borne que l'année possède.
    expect(c.du).toBe('2022-07-01');
  });

  it('les retards encaissés l’été sont dans l’année qu’ils règlent — même deux ans plus tard', async () => {
    // A : mars 2021 (10 000) + retard d'août 2021 (4 000) + retard de juillet 2022 (1 000).
    expect((await bilan(A)).encaisse).toBe('15000.00');
    // B : dette de l'été (300) + rentrée (7 000) + novembre (10 000)
    //     + retard de A payé en décembre (2 000, la date fait foi) + son propre retard d'août 2022 (5 000).
    const b = await bilan(B);
    expect(b.encaisse).toBe('24300.00');
    // Ses sorties : la dépense de septembre (l'été lui appartient) et celle de janvier.
    expect(b.depense).toBe('1150.00');
  });

  it('⚠ la RENTRÉE reste dans la nouvelle année : mensualités et frais annuels de septembre', async () => {
    // Le défaut d'octobre 2026 ne revient pas : l'argent encaissé en septembre
    // POUR la nouvelle année est dans sa synthèse.
    await mensualite(C, '2022-09-10', '8000.00');
    await fraisAnnuels(C, '2022-09-11', '1500.00');
    await mensualite(C, '2022-10-15', '10000.00');

    const c = await bilan(C);
    expect(c.encaisse).toBe('19500.00');
    // Et rien n'a bougé chez les autres.
    expect((await bilan(A)).encaisse).toBe('15000.00');
    expect((await bilan(B)).encaisse).toBe('24300.00');
  });

  it('une ligne sans année garde l’attribution d’avant : l’année qui possède la date', async () => {
    // Une dépense d'août 2022 : l'été 2022 appartient à C.
    await ligneSansAnnee('depense', 'out', '2022-08-20', '620.00');
    // Un remboursement de prêt en septembre 2022 : entrée sans année → C.
    await ligneSansAnnee('pret_remb', 'in', '2022-09-05', '250.00');
    const c = await bilan(C);
    expect(c.depense).toBe('620.00');
    expect(c.encaisse).toBe('19750.00');
    expect((await bilan(B)).depense).toBe('1150.00');
  });

  it('⚠ aucune ligne comptée deux fois, aucune perdue : les années additionnées valent TOUTE la caisse', async () => {
    const { rows } = await owner.query<{ e: string; s: string; n: string }>(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0)::numeric(14,2)::text AS e,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0)::numeric(14,2)::text AS s,
              count(*)::text AS n
         FROM tender_lines WHERE school_id = $1`,
      [schoolId],
    );
    // 12 encaissements et 3 sorties, aucun annulé à ce stade.
    expect(rows[0]!.n).toBe('15');
    expect(rows[0]!.e).toBe('59050.00');
    expect(rows[0]!.s).toBe('1770.00');

    const bilans = [await bilan(A), await bilan(B), await bilan(C)];
    for (const b of bilans) expect(b.source).toBe('caisse');
    const entrees = bilans.reduce((a, b) => a.plus(money(b.encaisse)), new Decimal(0));
    const sorties = bilans.reduce((a, b) => a.plus(money(b.depense)), new Decimal(0));
    expect(toStorage(entrees)).toBe(rows[0]!.e);
    expect(toStorage(sorties)).toBe(rows[0]!.s);
  });

  it('un retard d’été ANNULÉ ne compte nulle part, ni lui ni son annulation', async () => {
    const avant = { a: await bilan(A), b: await bilan(B), c: await bilan(C) };
    // Un retard de B encaissé le 15 août 2022, puis annulé.
    await owner.query(`UPDATE academic_years SET status = 'future' WHERE id = $1`, [B.id]);
    const id = await mensualite(B, '2022-08-15', '3300.00');
    expect((await bilan(B)).encaisse).toBe('27600.00');
    expect((await bilan(C)).encaisse).toBe(avant.c.encaisse);

    const annulation = await inTenant(() => payments.reverse(id, 'Saisi deux fois', ACTOR));
    await owner.query(`UPDATE payments SET paid_at = '2022-08-16 10:00' WHERE id = $1`, [annulation.id]);
    await owner.query(`UPDATE tender_lines SET created_at = '2022-08-16 10:00' WHERE source_id = $1`, [annulation.id]);
    await owner.query(`UPDATE academic_years SET status = 'closed' WHERE id = $1`, [B.id]);

    const apres = { a: await bilan(A), b: await bilan(B), c: await bilan(C) };
    for (const k of ['a', 'b', 'c'] as const) {
      expect(apres[k].encaisse).toBe(avant[k].encaisse);
      expect(apres[k].depense).toBe(avant[k].depense);
    }
  });

  it('⚠ une année suivante seulement CRÉÉE : son argent d’avance n’est pas dans l’année ouverte, et n’est compté qu’une fois', async () => {
    // L'école prépare D en juin et encaisse des réinscriptions POUR D en août
    // 2023, alors que D n'est pas encore ouverte. Avant : la ligne était dans C
    // (ouverte, donc sans fin) ET dans D (qui possède son été) — comptée deux fois.
    D = await creerAnnee(2023);
    const avantC = await bilan(C);
    await mensualite(D, '2023-08-20', '9000.00');
    // Et un retard de C payé le même été, toujours pour C.
    await mensualite(C, '2023-08-21', '600.00');

    expect((await bilan(D)).encaisse).toBe('9000.00');
    expect((await bilan(C)).encaisse).toBe(toStorage(money(avantC.encaisse).plus(money('600.00'))));
  });

  it('⚠ une année REPRISE garde son chiffre d’archive au centime, quoi que l’été lui rattache', async () => {
    // Des reçus de l'ancien système dans les mois nominaux de B : ce sont eux
    // qui font foi (`bilan_annee_scolaire()`), et rien d'autre n'y entre.
    await owner.query(
      `INSERT INTO legacy_receipts (school_id, legacy_id, amount_paid, received_at)
       VALUES ($1, 1, 100000.25, '2021-11-05 09:00'), ($1, 2, 23456.53, '2022-06-30 18:00')`,
      [schoolId],
    );
    const b = await bilan(B);
    expect(b.source).toBe('recus');
    expect(b.nb).toBe(2);
    expect(b.encaisse).toBe('123456.78');
    // La dépense d'une année reprise : le plus grand du débit d'archive et des
    // sorties de caisse de SES MOIS NOMINAUX — la dépense de janvier, pas celle
    // de septembre.
    expect(b.depense).toBe('450.00');
    expect(b.du).toBe('2021-10-01');
    expect(b.au).toBe('2022-06-30');
  });
});
