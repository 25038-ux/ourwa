import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { EnrollmentService } from '../src/academic/enrollment.service.js';
import { TarifsService } from '../src/finance/tarifs.service.js';
import { StudentServicesService } from '../src/finance/student-services.service.js';
import { CollectionService } from '../src/finance/collection.service.js';
import { DebtService } from '../src/finance/debt.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { DocumentsService } from '../src/documents/documents.service.js';
import { FacturationController } from '../src/finance/facturation.controller.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES FRAIS DE PLATEFORME ET LES FRAIS DE FOURNITURE — demande du
 * propriétaire de Jinan (06/10/2026), ADR-0082, migration 0050.
 *
 *   1. la plateforme : « obligatoire et par étudiant et mensuel » — d'office à
 *      chaque (ré)inscription comme la photocopie (prix non défini → refus ;
 *      0 → rien), mais facturée CHAQUE MOIS, à partir du premier mois dû de la
 *      scolarité ; exemptable, remisable, jamais arrêtée ;
 *   2. les fournitures : « annuel et par étudiant et optionnel » — cochées à
 *      l'inscription, UNE ligne au mois de départ, au prix de l'école ;
 *      retirées tant qu'elles ne sont pas réglées ; pas de remise (annuelles).
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
let reports: ReportsService;
let documents: DocumentsService;
let facturation: FacturationController;

const S = { schoolId: '', slug: 'pf-jinan' };
const inS = <T>(fn: () => Promise<T>) => runInTenant(S, fn);
let yearS: string;
let group6: string;
let ACTOR: string;
let especes: string;
const DIRECTION = ['scolarite.niveaux', 'scolarite.inscrire', 'scolarite.reinscrire'];
let seq = 0;

async function eleve(guardianId: string | null = null): Promise<string> {
  const t = `pf-${++seq}`;
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, first_name, last_name) VALUES ($1, $2, $3, 'Pf') RETURNING id`,
    [S.schoolId, guardianId, t],
  );
  return rows[0]!.id;
}

async function parent(): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Parent Pf') RETURNING id`,
    [`pf.parent.${++seq}@test`],
  );
  return rows[0]!.id;
}

async function inscrire(services: string[] = [], guardianId: string | null = null, entryDate = '2025-10-01') {
  const studentId = await eleve(guardianId);
  await inS(() =>
    enrollments.enrol(
      { studentId, academicYearId: yearS, groupId: group6, studyMode: '8h-14h', services: services as never, entryDate },
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

const de = async (studentId: string, service: string) => (await abonnementsDe(studentId)).find((a) => a.service === service);

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const s = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix, billing_model) VALUES ('pf-jinan', 'PF Jinan', 'PF', 'services') RETURNING id`,
  );
  S.schoolId = s.rows[0]!.id;
  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order) VALUES ('parent', 'Parent', true, 30) ON CONFLICT (code) DO NOTHING`,
  );
  const a = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('pf.acteur@test', 'x', 'Direction') RETURNING id`,
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
  reports = moduleRef.get(ReportsService);
  documents = moduleRef.get(DocumentsService);
  facturation = moduleRef.get(FacturationController);
  // La photocopie, d'office depuis 0047 : gratuite ici, pour ne compter que la plateforme.
  await prix({ photocopie: '0' });
});

afterAll(async () => {
  await owner?.end();
});

describe('les frais de plateforme : mensuels, d’office', () => {
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
    ).rejects.toThrow(/Le prix de « Frais de plateforme » n'est pas défini pour 2025-2026 — bouton « Frais »/);
    const { rows } = await owner.query(`SELECT 1 FROM enrollments WHERE student_id = $1`, [studentId]);
    expect(rows).toHaveLength(0);
  });

  it('prix 0 : rien d’écrit (comme une inscription gratuite)', async () => {
    await prix({ plateforme: '0' });
    const studentId = await inscrire();
    expect((await abonnementsDe(studentId)).map((a) => a.service)).toEqual(['inscription']);
  });

  it('⚠ d’office, sans être cochée : chaque mois dû de l’année, au prix de l’école', async () => {
    await prix({ plateforme: '200' });
    const studentId = await inscrire();
    const p = (await de(studentId, 'plateforme'))!;
    expect(p).toMatchObject({ periodicite: 'mensuel', amount: '200.00', remise: '0.00', arretable: false, famille: 'plateforme' });
    expect(p.months.map((m) => [m.month, m.year, m.due])).toEqual([
      [10, 2025, '200.00'], [11, 2025, '200.00'], [12, 2025, '200.00'],
      [1, 2026, '200.00'], [2, 2026, '200.00'], [3, 2026, '200.00'],
      [4, 2026, '200.00'], [5, 2026, '200.00'], [6, 2026, '200.00'],
    ]);
  });

  it('une entrée en cours d’année : à partir du premier mois dû de la scolarité (règle du 25)', async () => {
    const studentId = await inscrire([], null, '2026-01-27');
    const p = (await de(studentId, 'plateforme'))!;
    expect(p.months.map((m) => m.month)).toEqual([2, 3, 4, 5, 6]);
  });

  it('cochée par un ancien écran : acceptée, souscrite une seule fois', async () => {
    const studentId = await inscrire(['plateforme']);
    expect((await abonnementsDe(studentId)).filter((a) => a.service === 'plateforme')).toHaveLength(1);
  });

  it('⚠ ne s’arrête pas — elle s’exempte', async () => {
    const studentId = await inscrire();
    const p = (await de(studentId, 'plateforme'))!;
    await expect(inS(() => abonnements.stop(p.id, {}, ACTOR))).rejects.toThrow(/obligatoire, il ne s'arrête pas : exemptez-le/);
    const r = await inS(() => abonnements.setExempt(p.id, { exempt: true }, ACTOR));
    expect(r.changed).toBe(true);
  });

  it('se remise par mois (20 % de 200 = 40) : les mois sans paiement passent à 160', async () => {
    const studentId = await inscrire();
    const p = (await de(studentId, 'plateforme'))!;
    const r = await inS(() => abonnements.setRemise(p.id, { remise: '40' }, ACTOR));
    expect(r).toMatchObject({ remise: '40.00', monthsChanged: 9, changed: true });
    expect((await de(studentId, 'plateforme'))!.months.every((m) => m.due === '160.00')).toBe(true);
  });

  it('s’encaisse dans le reçu groupé, et la dette la compte', async () => {
    const guardianId = await parent();
    const studentId = await inscrire([], guardianId);
    const p = (await de(studentId, 'plateforme'))!;
    const recu = await inS(() =>
      collection.encaisserGroupe(
        {
          studentId,
          academicYearId: yearS,
          mois: [],
          services: [{ studentServiceId: p.id, mois: 10, annee: 2025 }],
          tender: [{ paymentMethodId: especes, amount: '200' }],
        },
        ACTOR,
      ),
    );
    expect(JSON.stringify(recu)).toContain('200.00');
    const apres = (await de(studentId, 'plateforme'))!;
    expect(apres.months.find((m) => m.month === 10)!.state).toBe('paid');
    const fiche = JSON.stringify(await inS(() => debts.familyLedger(guardianId, yearS)));
    expect(fiche).toContain('"service":"plateforme"');
  });

  it('un élève inscrit AVANT (sans plateforme) la reçoit depuis la fiche — jamais d’office rétroactivement', async () => {
    await prix({ plateforme: '0' });
    const studentId = await inscrire();
    await prix({ plateforme: '200' });
    expect((await abonnementsDe(studentId)).map((a) => a.service)).toEqual(['inscription']);
    const ajout = await inS(() =>
      abonnements.subscribe({ studentId, academicYearId: yearS, service: 'plateforme' }, ACTOR, new Date('2025-11-03T09:00:00Z')),
    );
    expect(ajout).toMatchObject({ created: true, service: 'plateforme', amount: '200.00', startMonth: 11, startYear: 2025 });
    expect((await de(studentId, 'plateforme'))!.months).toHaveLength(8);
  });
});

describe('les frais de fourniture : annuels, au choix', () => {
  it('prix non défini et cochées : refusé, avec son nom ; non cochées : rien', async () => {
    await expect(inscrire(['fourniture'])).rejects.toThrow(/Le prix de « Frais de fourniture » n'est pas défini pour 2025-2026/);
    const sans = await inscrire();
    expect(await de(sans, 'fourniture')).toBeUndefined();
  });

  it('cochées : UNE ligne au mois de départ, au prix de l’école', async () => {
    await prix({ fourniture: '1500' });
    const studentId = await inscrire(['fourniture']);
    const f = (await de(studentId, 'fourniture'))!;
    expect(f).toMatchObject({ periodicite: 'annuel', amount: '1500.00', arretable: true, famille: 'fourniture' });
    expect(f.months.map((m) => [m.month, m.year, m.due])).toEqual([[10, 2025, '1500.00']]);
  });

  it('ne se remisent pas (annuelles) : elles s’exemptent', async () => {
    const studentId = await inscrire(['fourniture']);
    const f = (await de(studentId, 'fourniture'))!;
    await expect(inS(() => abonnements.setRemise(f.id, { remise: '100' }, ACTOR))).rejects.toThrow(
      /se paie une fois l'an : il ne se remise pas/,
    );
    expect((await inS(() => abonnements.setExempt(f.id, { exempt: true }, ACTOR))).changed).toBe(true);
  });

  it('⚠ se retirent tant qu’elles ne sont pas réglées ; réglées, le retrait est refusé', async () => {
    const studentId = await inscrire(['fourniture']);
    const f = (await de(studentId, 'fourniture'))!;
    // Le mois d'arrêt par défaut (le mois suivant) n'importe pas : la ligne annuelle part.
    const r = await inS(() => abonnements.stop(f.id, {}, ACTOR, new Date('2026-03-10T09:00:00Z')));
    expect(r.monthsRemoved).toBe(1);
    const apres = (await de(studentId, 'fourniture'))!;
    expect(apres.endedAt).not.toBeNull();
    expect(apres.months).toHaveLength(0);

    const guardianId = await parent();
    const s2 = await inscrire(['fourniture'], guardianId);
    const f2 = (await de(s2, 'fourniture'))!;
    await inS(() =>
      collection.encaisserGroupe(
        {
          studentId: s2,
          academicYearId: yearS,
          mois: [],
          services: [{ studentServiceId: f2.id }],
          tender: [{ paymentMethodId: especes, amount: '1500' }],
        },
        ACTOR,
      ),
    );
    await expect(inS(() => abonnements.stop(f2.id, {}, ACTOR))).rejects.toThrow(
      /« Frais de fourniture » est déjà réglé : annulez d'abord le paiement/,
    );
  });

  it('s’ajoutent depuis la fiche après l’inscription', async () => {
    const studentId = await inscrire();
    const ajout = await inS(() =>
      abonnements.subscribe({ studentId, academicYearId: yearS, service: 'fourniture' }, ACTOR, new Date('2025-12-03T09:00:00Z')),
    );
    expect(ajout).toMatchObject({ created: true, service: 'fourniture', amount: '1500.00', startMonth: 12, startYear: 2025 });
    expect((await de(studentId, 'fourniture'))!.months.map((m) => [m.month, m.due])).toEqual([[12, '1500.00']]);
  });
});

describe('les rapports et les documents', () => {
  it('« Par origine » et le journal nomment la plateforme, les fournitures — et le transport', async () => {
    await prix({ transport: '1200' });
    const guardianId = await parent();
    const studentId = await inscrire(['fourniture', 'transport'], guardianId);
    const subs = await abonnementsDe(studentId);
    const id = (s: string) => subs.find((a) => a.service === s)!.id;
    await inS(() =>
      collection.encaisserGroupe(
        {
          studentId,
          academicYearId: yearS,
          mois: [],
          services: [
            { studentServiceId: id('fourniture') },
            { studentServiceId: id('plateforme'), mois: 10, annee: 2025 },
            { studentServiceId: id('transport'), mois: 10, annee: 2025 },
          ],
          tender: [{ paymentMethodId: especes, amount: '2900' }],
        },
        ACTOR,
      ),
    );
    const jour = new Date().toISOString().slice(0, 10);
    const t = await inS(() => reports.transactions({ day: jour }));
    const textes = JSON.stringify(t);
    expect(textes).toMatch(/Frais de fourniture : pf-\d+ Pf/);
    expect(textes).toMatch(/Frais de plateforme : pf-\d+ Pf \(Octobre 2025\)/);
    // ⚠ Le transport tombait dans le cas par défaut : « Service_transport ».
    expect(textes).toMatch(/Transport : pf-\d+ Pf \(Octobre 2025\)/);
    expect(textes).not.toContain('Service_');
  });

  it('les fournitures ont une pièce signée ; la plateforme non', async () => {
    const guardianId = await parent();
    const studentId = await inscrire(['fourniture'], guardianId);
    const f = await inS(() => documents.famille(guardianId, yearS));
    const enfant = (f as unknown as { enfants: { id: string; pieces: { piece: string; souscrit: boolean }[] }[] }).enfants.find(
      (e) => e.id === studentId,
    )!;
    const pieces = enfant.pieces.map((p) => p.piece);
    expect(pieces).toContain('fourniture');
    expect(pieces).not.toContain('plateforme');
    expect(enfant.pieces.find((p) => p.piece === 'fourniture')!.souscrit).toBe(true);
  });
});

/**
 * « ADD THE PLATEFORME FEE TO EVERY ENROLLED STUDENT AUTOMATICALLY »
 * (06/10/2026) : poser le prix de la plateforme l'ajoute à CHAQUE élève inscrit
 * de l'année qui ne l'a pas — à partir du mois en cours (règle du 25), jamais
 * avant son propre premier mois dû ; jamais deux fois ; jamais à une
 * inscription annulée ; rien à 0 (gratuit).
 */
describe('la plateforme pour tous les inscrits, dès que son prix est posé', () => {
  const plateformeDe = async (studentId: string) =>
    (await abonnementsDe(studentId)).filter((a) => a.service === 'plateforme');

  it('⚠ chaque inscrit sans plateforme la reçoit, à partir du mois en cours ; une inscription annulée non', async () => {
    await prix({ plateforme: '0' });
    const a = await inscrire();
    const b = await inscrire();
    const tard = await inscrire([], null, '2026-03-02');
    const annule = await inscrire();
    await owner.query(`UPDATE enrollments SET status = 'cancelled' WHERE student_id = $1`, [annule]);
    for (const s of [a, b, tard, annule]) expect(await plateformeDe(s)).toHaveLength(0);

    await prix({ plateforme: '200' });
    const r = await inS(() =>
      abonnements.appliquerATousLesInscrits({ academicYearId: yearS, service: 'plateforme' }, ACTOR, new Date('2025-11-03T09:00:00Z')),
    );
    expect(r.service).toBe('plateforme');
    expect(r.montant).toBe('200.00');
    expect(r.eleves).toBeGreaterThanOrEqual(3);
    expect(r.depuis).toEqual({ month: 11, year: 2025 });

    for (const s of [a, b]) {
      const p = await plateformeDe(s);
      expect(p).toHaveLength(1);
      // Novembre → juin : octobre est passé, il n'est pas facturé après coup.
      expect(p[0]!.months.map((m) => [m.month, m.due])).toEqual([
        [11, '200.00'], [12, '200.00'], [1, '200.00'], [2, '200.00'],
        [3, '200.00'], [4, '200.00'], [5, '200.00'], [6, '200.00'],
      ]);
    }
    // Entré en mars : à partir de SON premier mois dû.
    expect((await plateformeDe(tard))[0]!.months.map((m) => m.month)).toEqual([3, 4, 5, 6]);
    expect(await plateformeDe(annule)).toHaveLength(0);
  });

  it('jamais deux fois : un second passage n’ajoute rien, un prix changé ne touche pas les abonnements pris', async () => {
    await prix({ plateforme: '250' });
    const r = await inS(() =>
      abonnements.appliquerATousLesInscrits({ academicYearId: yearS, service: 'plateforme' }, ACTOR, new Date('2025-11-03T09:00:00Z')),
    );
    expect(r.eleves).toBe(0);
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM student_services ss
        WHERE ss.academic_year_id = $1 AND ss.service = 'plateforme' AND ss.amount = 250`,
      [yearS],
    );
    expect(rows[0]!.n).toBe('0');
    await prix({ plateforme: '200' });
  });

  it('une plateforme exemptée n’est pas recréée ; à 0 (gratuit), rien n’est ajouté', async () => {
    await prix({ plateforme: '0' });
    const ex = await inscrire();
    const libre = await inscrire();
    await prix({ plateforme: '200' });
    await inS(() => abonnements.appliquerATousLesInscrits({ academicYearId: yearS, service: 'plateforme' }, ACTOR, new Date('2025-11-03T09:00:00Z')));
    const p = (await plateformeDe(ex))[0]!;
    await inS(() => abonnements.setExempt(p.id, { exempt: true }, ACTOR));
    await inS(() => abonnements.appliquerATousLesInscrits({ academicYearId: yearS, service: 'plateforme' }, ACTOR, new Date('2025-11-03T09:00:00Z')));
    expect(await plateformeDe(ex)).toHaveLength(1);
    expect(await plateformeDe(libre)).toHaveLength(1);

    await prix({ plateforme: '0' });
    const zero = await inscrire();
    const r = await inS(() =>
      abonnements.appliquerATousLesInscrits({ academicYearId: yearS, service: 'plateforme' }, ACTOR, new Date('2025-11-03T09:00:00Z')),
    );
    expect(r).toMatchObject({ eleves: 0, montant: '0.00' });
    expect(await plateformeDe(zero)).toHaveLength(0);
  });

  it('⚠ la page « Frais » (POST /finance/tarifs/services) le fait d’elle-même, et le dit', async () => {
    await prix({ plateforme: '0' });
    const s = await inscrire();
    const req = { auth: { userId: ACTOR, schoolId: S.schoolId, roles: ['super_admin'], permissions: ['scolarite.niveaux'] } };
    // Le 3 novembre 2025, dans l'année : la page n'a pas de date à passer, c'est aujourd'hui.
    vi.setSystemTime(new Date('2025-11-03T09:00:00Z'));
    let r: Awaited<ReturnType<FacturationController['setServicePrices']>>;
    try {
      r = await inS(() =>
        facturation.setServicePrices({ academicYearId: yearS, prix: { plateforme: '200' } }, req as never),
      );
    } finally {
      vi.useRealTimers();
    }
    expect(r.services.find((x) => x.code === 'plateforme')!.prix).toBe('200.00');
    expect(r.appliques).toMatchObject({ service: 'plateforme', montant: '200.00' });
    expect(r.appliques!.eleves).toBeGreaterThanOrEqual(1);
    expect(await plateformeDe(s)).toHaveLength(1);
    // Un autre prix (le docteur) n'ajoute rien à personne.
    const autre = await inS(() => facturation.setServicePrices({ academicYearId: yearS, prix: { docteur: '300' } }, req as never));
    expect(autre.appliques).toBeNull();
  });
});

