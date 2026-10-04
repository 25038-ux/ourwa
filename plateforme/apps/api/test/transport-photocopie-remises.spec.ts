import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { TarifsService } from '../src/finance/tarifs.service.js';
import { StudentServicesService } from '../src/finance/student-services.service.js';
import { CollectionService } from '../src/finance/collection.service.js';
import { DebtService } from '../src/finance/debt.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LE TRANSPORT, LA PHOTOCOPIE OBLIGATOIRE, LES REMISES SUR LES SERVICES
 * MENSUELS — demande du propriétaire de Jinan (04/10/2026), ADR-0079,
 * migration 0047.
 *
 *   1. le transport : mensuel, au prix de l'école, coché à l'inscription,
 *      ajouté ou arrêté ensuite ;
 *   2. la photocopie : UN prix pour tous les niveaux, d'office à chaque
 *      (ré)inscription comme les frais d'inscription (prix non défini → refus ;
 *      0 → rien), exemptable, jamais arrêtée ;
 *   3. une remise PAR MOIS sur un service mensuel : les mois sans paiement
 *      seulement ; un mois réglé garde son prix ; l'encaissement relit le
 *      montant sous son verrou.
 *
 * ⚠ DE L'ARGENT (règle 15) : écrit avant les écrans.
 *
 * L'année 2025-2026 (octobre → juin), active.
 */

let owner: pg.Pool;
let enrollments: EnrollmentService;
let tarifs: TarifsService;
let abonnements: StudentServicesService;
let collection: CollectionService;
let debts: DebtService;

const S = { schoolId: '', slug: 'tpr-jinan' };
const inS = <T>(fn: () => Promise<T>) => runInTenant(S, fn);
let yearS: string;
let group6: string;
let ACTOR: string;
let especes: string;
const DIRECTION = ['scolarite.niveaux', 'scolarite.inscrire', 'scolarite.reinscrire'];
let seq = 0;

async function eleve(guardianId: string | null = null): Promise<string> {
  const t = `tpr-${++seq}`;
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, first_name, last_name) VALUES ($1, $2, $3, 'Tpr') RETURNING id`,
    [S.schoolId, guardianId, t],
  );
  return rows[0]!.id;
}

async function parent(): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Parent Tpr') RETURNING id`,
    [`tpr.parent.${++seq}@test`],
  );
  return rows[0]!.id;
}

async function inscrire(services: string[] = [], guardianId: string | null = null) {
  const studentId = await eleve(guardianId);
  await inS(() =>
    enrollments.enrol(
      { studentId, academicYearId: yearS, groupId: group6, studyMode: '8h-14h', services: services as never, entryDate: '2025-10-01' },
      ACTOR,
      DIRECTION,
      [],
    ),
  );
  return studentId;
}

async function abonnementsDe(studentId: string) {
  return inS(() => abonnements.forStudent(studentId, yearS));
}

async function prix(p: Record<string, string>) {
  await inS(() => tarifs.setServicePrices({ academicYearId: yearS, prix: p }, ACTOR));
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const s = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix, billing_model) VALUES ('tpr-jinan', 'TPR Jinan', 'TPR', 'services') RETURNING id`,
  );
  S.schoolId = s.rows[0]!.id;
  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order) VALUES ('parent', 'Parent', true, 30) ON CONFLICT (code) DO NOTHING`,
  );
  const a = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('tpr.acteur@test', 'x', 'Direction') RETURNING id`,
  );
  ACTOR = a.rows[0]!.id;
  const y = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
    [S.schoolId],
  );
  yearS = y.rows[0]!.id;
  const l = await owner.query<{ id: string }>(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle, sort_order, monthly_rate_8h14, monthly_rate_8h17, student_enrolment_fee)
     VALUES ($1, '6AF', 0, 'fondamental', 1, 3000, 4500, 2000) RETURNING id`,
    [S.schoolId],
  );
  const g = await owner.query<{ id: string }>(
    `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6AF A') RETURNING id`,
    [S.schoolId, l.rows[0]!.id],
  );
  group6 = g.rows[0]!.id;
  const m = await owner.query<{ id: string }>(
    `INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Espèces') RETURNING id`,
    [S.schoolId],
  );
  especes = m.rows[0]!.id;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  enrollments = moduleRef.get(EnrollmentService);
  tarifs = moduleRef.get(TarifsService);
  abonnements = moduleRef.get(StudentServicesService);
  collection = moduleRef.get(CollectionService);
  debts = moduleRef.get(DebtService);
});

afterAll(async () => {
  await owner?.end();
});

describe('la photocopie, obligatoire comme les frais d’inscription', () => {
  it('⚠ prix non défini : l’inscription est refusée, et rien n’est écrit', async () => {
    const studentId = await eleve();
    await expect(
      inS(() =>
        enrollments.enrol(
          { studentId, academicYearId: yearS, groupId: group6, studyMode: '8h-14h', entryDate: '2025-10-01' },
          ACTOR,
          DIRECTION,
          [],
        ),
      ),
    ).rejects.toThrow(/Le prix de « Frais de photocopie » n'est pas défini pour 2025-2026 — bouton « Frais »/);
    const { rows } = await owner.query(`SELECT 1 FROM enrollments WHERE student_id = $1`, [studentId]);
    expect(rows).toHaveLength(0);
  });

  it('prix 0 : rien d’écrit (comme une inscription gratuite)', async () => {
    await prix({ photocopie: '0' });
    const studentId = await inscrire();
    expect((await abonnementsDe(studentId)).map((a) => a.service)).toEqual(['inscription']);
  });

  it('⚠ d’office, au prix de l’école — le même pour tout niveau — sans être cochée', async () => {
    await prix({ photocopie: '1500', transport: '1200', cantine_dejeuner: '800' });
    const studentId = await inscrire([]);
    const subs = await abonnementsDe(studentId);
    expect(subs.map((a) => [a.service, a.amount, a.periodicite, a.arretable])).toEqual([
      ['photocopie', '1500.00', 'annuel', false],
      ['inscription', '2000.00', 'annuel', false],
    ]);
    // Une seule ligne, due dès l'inscription.
    expect(subs[0]!.months.map((m) => [m.month, m.year, m.due])).toEqual([[10, 2025, '1500.00']]);
  });

  it('cochée par un ancien écran : acceptée, souscrite une seule fois', async () => {
    const studentId = await inscrire(['photocopie', 'cantine_dejeuner']);
    expect((await abonnementsDe(studentId)).map((a) => a.service).sort()).toEqual(['cantine_dejeuner', 'inscription', 'photocopie']);
  });

  it('⚠ ne s’arrête pas — elle s’exempte', async () => {
    const studentId = await inscrire();
    const photo = (await abonnementsDe(studentId)).find((a) => a.service === 'photocopie')!;
    await expect(inS(() => abonnements.stop(photo.id, {}, ACTOR))).rejects.toThrow(/obligatoire, il ne s'arrête pas : exemptez-le/);
    const r = await inS(() => abonnements.setExempt(photo.id, { exempt: true }, ACTOR));
    expect(r.changed).toBe(true);
  });

  it('un élève inscrit AVANT (sans photocopie) peut la recevoir depuis la fiche — jamais d’office rétroactivement', async () => {
    const studentId = await eleve();
    // Une inscription d'avant 0047 : sans photocopie.
    await owner.query(`DELETE FROM service_prices WHERE academic_year_id = $1 AND service = 'photocopie'`, [yearS]);
    await prix({ photocopie: '0' });
    await inS(() =>
      enrollments.enrol({ studentId, academicYearId: yearS, groupId: group6, studyMode: '8h-14h', entryDate: '2025-10-01' }, ACTOR, DIRECTION, []),
    );
    await prix({ photocopie: '1500' });
    expect((await abonnementsDe(studentId)).map((a) => a.service)).toEqual(['inscription']);
    const ajout = await inS(() => abonnements.subscribe({ studentId, academicYearId: yearS, service: 'photocopie' }, ACTOR, new Date('2025-11-03T09:00:00Z')));
    expect(ajout).toMatchObject({ created: true, service: 'photocopie', amount: '1500.00' });
  });
});

describe('le transport, mensuel et coché', () => {
  it('se coche à l’inscription : un mois par mois payable, au prix de l’année', async () => {
    const studentId = await inscrire(['transport']);
    const t = (await abonnementsDe(studentId)).find((a) => a.service === 'transport')!;
    expect(t).toMatchObject({ periodicite: 'mensuel', amount: '1200.00', remise: '0.00', arretable: true, famille: 'transport' });
    expect(t.months).toHaveLength(9);
    expect(t.months.every((m) => m.due === '1200.00')).toBe(true);
  });

  it('prix non défini : refusé à l’inscription, avec son nom', async () => {
    await owner.query(`DELETE FROM service_prices WHERE academic_year_id = $1 AND service = 'transport'`, [yearS]);
    await expect(inscrire(['transport'])).rejects.toThrow(/Le prix du transport n'est pas défini pour 2025-2026/);
    await prix({ transport: '1200' });
  });

  it('s’ajoute après l’inscription, depuis la fiche, puis s’arrête', async () => {
    const studentId = await inscrire();
    const ajout = await inS(() =>
      abonnements.subscribe({ studentId, academicYearId: yearS, service: 'transport', startMonth: 1, startYear: 2026 }, ACTOR),
    );
    expect(ajout).toMatchObject({ created: true, amount: '1200.00', startMonth: 1, startYear: 2026 });
    let t = (await abonnementsDe(studentId)).find((a) => a.service === 'transport')!;
    expect(t.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6]);
    const stop = await inS(() => abonnements.stop(ajout.id, { fromMonth: 4, fromYear: 2026 }, ACTOR));
    expect(stop.monthsRemoved).toBe(3);
    t = (await abonnementsDe(studentId)).find((a) => a.service === 'transport')!;
    expect(t.endedAt).not.toBeNull();
    expect(t.months.map((m) => m.month)).toEqual([1, 2, 3]);
  });
});

describe('reprendre un service arrêté', () => {
  it('⚠ un mois ne se facture pas deux fois : la reprise commence après le dernier mois facturé', async () => {
    const studentId = await inscrire(['transport']);
    const t = (await abonnementsDe(studentId)).find((a) => a.service === 'transport')!;
    // Arrêté à partir de février : octobre → janvier restent facturés.
    await inS(() => abonnements.stop(t.id, { fromMonth: 2, fromYear: 2026 }, ACTOR));
    // Reprendre en décembre : refusé, avec le mois où reprendre.
    await expect(
      inS(() => abonnements.subscribe({ studentId, academicYearId: yearS, service: 'transport', startMonth: 12, startYear: 2025 }, ACTOR)),
    ).rejects.toThrow("« Transport » est déjà facturé jusqu'en Janvier : reprenez à partir de Février 2026.");
    // Sans mois (règle du 25 au 3 novembre → novembre) : le premier mois libre, février.
    const reprise = await inS(() =>
      abonnements.subscribe({ studentId, academicYearId: yearS, service: 'transport' }, ACTOR, new Date('2025-11-03T09:00:00Z')),
    );
    expect(reprise).toMatchObject({ created: true, startMonth: 2, startYear: 2026 });
    // Chaque mois de l'année, une seule fois.
    const tous = (await abonnementsDe(studentId))
      .filter((a) => a.service === 'transport')
      .flatMap((a) => a.months.map((m) => `${m.month}/${m.year}`));
    expect(new Set(tous).size).toBe(tous.length);
    expect(tous).toHaveLength(9);
  });
});

describe('les remises sur les services mensuels', () => {
  async function cantineDe(studentId: string) {
    return (await abonnementsDe(studentId)).find((a) => a.service === 'cantine_dejeuner')!;
  }

  it('⚠ réévalue les mois SANS paiement ; un mois réglé garde son prix', async () => {
    const guardianId = await parent();
    const studentId = await inscrire(['cantine_dejeuner'], guardianId);
    const c = await cantineDe(studentId);
    // Octobre payé (800) par le reçu groupé.
    await inS(() =>
      collection.encaisserGroupe(
        {
          studentId,
          academicYearId: yearS,
          mois: [],
          services: [{ studentServiceId: c.id, mois: 10, annee: 2025 }],
          tender: [{ paymentMethodId: especes, amount: '800' }],
        },
        ACTOR,
      ),
    );
    const r = await inS(() => abonnements.setRemise(c.id, { remise: '300' }, ACTOR));
    expect(r).toMatchObject({ remise: '300.00', monthsChanged: 8, changed: true });
    const apres = await cantineDe(studentId);
    expect(apres.remise).toBe('300.00');
    expect(apres.amount).toBe('800.00');
    expect(apres.months.map((m) => [m.month, m.due, m.state])).toEqual([
      [10, '800.00', 'paid'],
      [11, '500.00', 'due'], [12, '500.00', 'due'], [1, '500.00', 'due'], [2, '500.00', 'due'],
      [3, '500.00', 'due'], [4, '500.00', 'due'], [5, '500.00', 'due'], [6, '500.00', 'due'],
    ]);
    // Retirer la remise : les mois non réglés reviennent au prix.
    const zero = await inS(() => abonnements.setRemise(c.id, { remise: '0' }, ACTOR));
    expect(zero.monthsChanged).toBe(8);
    expect((await cantineDe(studentId)).months.slice(1).every((m) => m.due === '800.00')).toBe(true);
    // Journalisé.
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log WHERE entity_id = $1 AND action = 'student_service_remise_set'`,
      [c.id],
    );
    expect(rows[0]!.n).toBe('2');
  });

  it('la dette compte le prix remisé', async () => {
    const guardianId = await parent();
    const studentId = await inscrire(['transport'], guardianId);
    const t = (await abonnementsDe(studentId)).find((a) => a.service === 'transport')!;
    await inS(() => abonnements.setRemise(t.id, { remise: '1200' }, ACTOR));
    const sansTransport = (await abonnementsDe(studentId)).find((a) => a.service === 'transport')!;
    expect(sansTransport.months.every((m) => m.due === '0.00' && m.outstanding === '0.00')).toBe(true);
    const fiche = await inS(() => debts.familyLedger(guardianId, yearS));
    const ab = JSON.stringify(fiche);
    expect(ab).toContain('"remise":"1200.00"');
  });

  it('refuse : plus que le prix, un montant illisible, un service annuel, un abonnement arrêté', async () => {
    const studentId = await inscrire(['transport']);
    const subs = await abonnementsDe(studentId);
    const t = subs.find((a) => a.service === 'transport')!;
    const photo = subs.find((a) => a.service === 'photocopie')!;
    await expect(inS(() => abonnements.setRemise(t.id, { remise: '1500' }, ACTOR))).rejects.toThrow(/dépasse le prix du service \(1200\.00 MRU par mois\)/);
    for (const mauvais of ['-100', 'abc', '', '1e3']) {
      await expect(inS(() => abonnements.setRemise(t.id, { remise: mauvais }, ACTOR))).rejects.toThrow(/montant positif/);
    }
    await expect(inS(() => abonnements.setRemise(photo.id, { remise: '100' }, ACTOR))).rejects.toThrow(/se paie une fois l'an : il ne se remise pas/);
    await inS(() => abonnements.stop(t.id, { fromMonth: 11, fromYear: 2025 }, ACTOR));
    await expect(inS(() => abonnements.setRemise(t.id, { remise: '100' }, ACTOR))).rejects.toThrow(/arrêté/);
  });

  it('la base elle-même refuse une remise annuelle ou au-dessus du prix', async () => {
    const studentId = await inscrire();
    const photo = (await abonnementsDe(studentId)).find((a) => a.service === 'photocopie')!;
    await expect(owner.query(`UPDATE student_services SET remise = 10 WHERE id = $1`, [photo.id])).rejects.toThrow(/student_services_remise_mensuelle/);
    const s2 = await inscrire(['transport']);
    const t = (await abonnementsDe(s2)).find((a) => a.service === 'transport')!;
    await expect(owner.query(`UPDATE student_services SET remise = 5000 WHERE id = $1`, [t.id])).rejects.toThrow(/student_services_remise_bornee/);
  });

  it('⚠ une remise posée pendant que la fenêtre est ouverte : l’encaissement refuse l’ancien montant', async () => {
    const guardianId = await parent();
    const studentId = await inscrire(['transport'], guardianId);
    const t = (await abonnementsDe(studentId)).find((a) => a.service === 'transport')!;
    // La fenêtre est lue (1 200 dus en novembre), puis la direction remise de 400.
    const fenetre = await inS(() => collection.fenetreInscription(studentId, yearS));
    const novembre = (fenetre as unknown as { services: { studentServiceId: string; mois: number | null; reste: string }[] }).services
      .find((l) => l.studentServiceId === t.id && l.mois === 11)!;
    expect(novembre.reste).toBe('1200.00');
    // L'encaissement lit la fenêtre (hors verrou), puis relit sous le verrou :
    // on simule la course en posant la remise entre les deux.
    type Lecteur = (studentId: string, yearId?: string) => Promise<unknown>;
    const cible = collection as unknown as { construireFenetre: Lecteur };
    const orig = cible.construireFenetre.bind(collection);
    cible.construireFenetre = async (...args) => {
      const f = await orig(...args);
      await abonnements.setRemise(t.id, { remise: '400' }, ACTOR);
      return f;
    };
    try {
      await expect(
        inS(() =>
          collection.encaisserGroupe(
            {
              studentId,
              academicYearId: yearS,
              mois: [],
              services: [{ studentServiceId: t.id, mois: 11, annee: 2025 }],
              tender: [{ paymentMethodId: especes, amount: '1200' }],
            },
            ACTOR,
          ),
        ),
      ).rejects.toThrow(/vient de changer \(encaissé, exempté, remisé ou arrêté par ailleurs\)/);
    } finally {
      cible.construireFenetre = orig;
    }
    // Rien n'a été encaissé ; novembre est dû 800.
    const nov = (await abonnementsDe(studentId)).find((a) => a.service === 'transport')!.months.find((m) => m.month === 11)!;
    expect([nov.due, nov.paid]).toEqual(['800.00', '0.00']);
  });
});
