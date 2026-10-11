import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { SOURCES_SERVICES } from '@elourwa/shared';
import { AppModule } from '../src/app.module.js';
import { DbService } from '../src/db/db.service.js';
import { ligneRetenue } from '../src/finance/annulations.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * « CETTE LIGNE DE CAISSE COMPTE » — la règle des annulations, réécrite le
 * 10/10/2026 pour partir des annulations (rares) et non des lignes (toutes).
 *
 * Chaque rapport d'argent passe par elle : le jour, le mois, la période, la
 * caisse par moyen, la synthèse de l'année, la plateforme. Une ligne retenue à
 * tort, et un reçu annulé revient dans les totaux ; une ligne écartée à tort,
 * et de l'argent réellement encaissé disparaît. Donc (règle 15) :
 *
 *   1. l'ANCIENNE écriture est gardée ici mot pour mot, et les deux doivent
 *      rendre le même verdict sur chaque ligne, sous RLS, comme l'API ;
 *   2. et le verdict lui-même est écrit en clair, ligne par ligne — pour que
 *      le test dise la règle, pas seulement « comme avant ».
 *
 * Les six grands livres y sont, avec pour chacun : une écriture vive, une
 * écriture annulée, son annulation — et, pour ceux qui marquent l'originale
 * (`reversed`), une écriture marquée sans écriture d'annulation.
 */

/** L'écriture d'avant le 10/10/2026 (finance/annulations.ts, 0.7.10), telle quelle. */
const LIVRES_AVANT: { table: string; origines: readonly string[]; drapeau: boolean }[] = [
  { table: 'payments', origines: ['paiement'], drapeau: false },
  { table: 'service_payments', origines: SOURCES_SERVICES, drapeau: false },
  { table: 'evening_payments', origines: ['cours_soir'], drapeau: false },
  { table: 'evening_teacher_payments', origines: ['cours_soir_prof'], drapeau: true },
  { table: 'expenses', origines: ['depense'], drapeau: true },
  { table: 'salary_payments', origines: ['salaire_prof', 'salaire_staff', 'salaire'], drapeau: true },
];
const liste = (xs: readonly string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ');
function ligneRetenueAvant(alias: string): string {
  return LIVRES_AVANT.map(
    ({ table, origines, drapeau }) =>
      `NOT EXISTS (SELECT 1 FROM ${table} src WHERE ${alias}.source_type IN (${liste(origines)}) AND src.id = ${alias}.source_id` +
      ` AND (src.reverses_id IS NOT NULL${drapeau ? ' OR src.reversed' : ''}` +
      ` OR EXISTS (SELECT 1 FROM ${table} annul WHERE annul.reverses_id = src.id)))`,
  ).join('\n            AND ');
}

let owner: pg.Pool;
let db: DbService;
let ecoleA: string;
let ecoleB: string;
let moyenA: string;

/** Une ligne de caisse de l'école A, nommée par `reference` pour la retrouver. */
async function ligne(nom: string, origine: string, ecriture: string, sens: 'in' | 'out' = 'in'): Promise<void> {
  await owner.query(
    `INSERT INTO tender_lines (school_id, source_type, source_id, payment_method_id, amount, direction, reference)
     VALUES ($1, $2, $3, $4, 100, $5, $6)`,
    [ecoleA, origine, ecriture, moyenA, sens, nom],
  );
}

/** Insère une écriture et rend son identifiant. */
async function ecrire(sql: string, params: unknown[]): Promise<string> {
  return (await owner.query<{ id: string }>(`${sql} RETURNING id`, params)).rows[0]!.id;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  db = moduleRef.get(DbService);

  const ecole = async (slug: string) => {
    const id = await ecrire(`INSERT INTO schools (slug, name, receipt_prefix) VALUES ($1, $2, $3)`, [slug, slug, slug.toUpperCase()]);
    const annee = await ecrire(
      `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2025-2026', 2025, 'active')`,
      [id],
    );
    const parent = await ecrire(`INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Parent')`, [`${slug}.parent@test`]);
    const eleve = await ecrire(
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name) VALUES ($1, $2, $3, $4, 'E', 'Leve')`,
      [id, parent, `RIM-${slug}`, `NID-${slug}`],
    );
    const moyen = await ecrire(`INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Especes')`, [id]);
    return { id, annee, parent, eleve, moyen };
  };
  const A = await ecole('lra');
  const B = await ecole('lrb');
  ecoleA = A.id;
  ecoleB = B.id;
  moyenA = A.moyen;

  // ── 1. payments (« paiement ») ────────────────────────────────────────────
  const paiement = (e: typeof A, mois: number, montant: number, annule: string | null, numero: string) =>
    ecrire(
      `INSERT INTO payments (school_id, student_id, academic_year_id, calendar_month, calendar_year, amount, receipt_number, reverses_id)
       VALUES ($1, $2, $3, $4, 2025, $5, $6, $7)`,
      [e.id, e.eleve, e.annee, mois, montant, numero, annule],
    );
  const pVive = await paiement(A, 10, 100, null, 'P-1');
  const pAnnulee = await paiement(A, 11, 100, null, 'P-2');
  const pAnnulation = await paiement(A, 11, -100, pAnnulee, 'P-3');
  await ligne('paiement vif', 'paiement', pVive);
  await ligne('paiement annulé', 'paiement', pAnnulee);
  await ligne('paiement : son annulation', 'paiement', pAnnulation, 'out');

  // ── 2. service_payments (une origine par service) ─────────────────────────
  const abonnement = await ecrire(
    `INSERT INTO student_services (school_id, student_id, academic_year_id, service, amount, start_month, start_year)
     VALUES ($1, $2, $3, 'docteur', 100, 10, 2025)`,
    [A.id, A.eleve, A.annee],
  );
  const recu = await ecrire(
    `INSERT INTO receipts (school_id, academic_year_id, guardian_id, receipt_number, amount) VALUES ($1, $2, $3, 'R-1', 200)`,
    [A.id, A.annee, A.parent],
  );
  const service = (mois: number, montant: number, annule: string | null, numero: string) =>
    ecrire(
      `INSERT INTO service_payments
         (school_id, student_service_id, student_id, academic_year_id, calendar_month, calendar_year, amount, receipt_number, receipt_id, reverses_id)
       VALUES ($1, $2, $3, $4, $5, 2025, $6, $7, $8, $9)`,
      [A.id, abonnement, A.eleve, A.annee, mois, montant, numero, annule ? null : recu, annule],
    );
  const sVive = await service(10, 100, null, 'S-1');
  const sAnnulee = await service(11, 100, null, 'S-2');
  const sAnnulation = await service(11, -100, sAnnulee, 'S-3');
  // Chaque origine de service désigne le même grand livre : toutes sont éprouvées.
  for (const origine of SOURCES_SERVICES) {
    await ligne(`${origine} vif`, origine, sVive);
    await ligne(`${origine} annulé`, origine, sAnnulee);
    await ligne(`${origine} : son annulation`, origine, sAnnulation, 'out');
  }

  // ── 3. evening_payments (« cours_soir ») ──────────────────────────────────
  const groupeSoir = await ecrire(`INSERT INTO evening_groups (school_id, name) VALUES ($1, 'Soir')`, [A.id]);
  const inscritSoir = await ecrire(
    `INSERT INTO evening_enrolments (school_id, evening_group_id, student_id) VALUES ($1, $2, $3)`,
    [A.id, groupeSoir, A.eleve],
  );
  const soir = (mois: number, montant: number, annule: string | null, numero: string) =>
    ecrire(
      `INSERT INTO evening_payments (school_id, enrolment_id, calendar_month, calendar_year, amount, receipt_number, reverses_id)
       VALUES ($1, $2, $3, 2025, $4, $5, $6)`,
      [A.id, inscritSoir, mois, montant, numero, annule],
    );
  const csVive = await soir(10, 100, null, 'CS-1');
  const csAnnulee = await soir(11, 100, null, 'CS-2');
  const csAnnulation = await soir(11, -100, csAnnulee, 'CS-3');
  await ligne('cours_soir vif', 'cours_soir', csVive);
  await ligne('cours_soir annulé', 'cours_soir', csAnnulee);
  await ligne('cours_soir : son annulation', 'cours_soir', csAnnulation, 'out');

  // ── 4. evening_teacher_payments (« cours_soir_prof », avec drapeau) ───────
  const prof = await ecrire(`INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, 'Prof', 'Soir')`, [A.id]);
  const coursSoir = await ecrire(
    `INSERT INTO evening_teachings (school_id, evening_group_id, teacher_id, subject) VALUES ($1, $2, $3, 'Maths')`,
    [A.id, groupeSoir, prof],
  );
  const profSoir = (mois: number, montant: number, annule: string | null, marquee: boolean) =>
    ecrire(
      `INSERT INTO evening_teacher_payments (school_id, evening_teaching_id, calendar_month, calendar_year, amount, reverses_id, reversed)
       VALUES ($1, $2, $3, 2025, $4, $5, $6)`,
      [A.id, coursSoir, mois, montant, annule, marquee],
    );
  const cpVive = await profSoir(10, 100, null, false);
  const cpAnnulee = await profSoir(11, 100, null, false);
  const cpAnnulation = await profSoir(11, -100, cpAnnulee, false);
  const cpMarquee = await profSoir(12, 100, null, true);
  await ligne('cours_soir_prof vif', 'cours_soir_prof', cpVive, 'out');
  await ligne('cours_soir_prof annulé', 'cours_soir_prof', cpAnnulee, 'out');
  await ligne('cours_soir_prof : son annulation', 'cours_soir_prof', cpAnnulation);
  await ligne('cours_soir_prof marqué', 'cours_soir_prof', cpMarquee, 'out');

  // ── 5. expenses (« depense », avec drapeau) ───────────────────────────────
  const depense = (montant: number, annule: string | null, marquee: boolean) =>
    ecrire(
      `INSERT INTO expenses (school_id, amount, description, reverses_id, reversed) VALUES ($1, $2, 'Fournitures', $3, $4)`,
      [A.id, montant, annule, marquee],
    );
  const dVive = await depense(100, null, false);
  const dAnnulee = await depense(100, null, false);
  const dAnnulation = await depense(-100, dAnnulee, false);
  const dMarquee = await depense(100, null, true);
  await ligne('depense vive', 'depense', dVive, 'out');
  await ligne('depense annulée', 'depense', dAnnulee, 'out');
  await ligne('depense : son annulation', 'depense', dAnnulation);
  await ligne('depense marquée', 'depense', dMarquee, 'out');

  // ── 6. salary_payments (trois origines, avec drapeau) ─────────────────────
  const salaire = (mois: number, montant: number, annule: string | null, marquee: boolean) =>
    ecrire(
      `INSERT INTO salary_payments (school_id, payee_kind, payee_id, payee_name, calendar_month, calendar_year, gross, net, reverses_id, reversed)
       VALUES ($1, 'staff', gen_random_uuid(), 'Gardien', $2, 2025, $3, $3, $4, $5)`,
      [A.id, mois, montant, annule, marquee],
    );
  const salVif = await salaire(10, 100, null, false);
  const salAnnule = await salaire(11, 100, null, false);
  const salAnnulation = await salaire(11, -100, salAnnule, false);
  const salMarque = await salaire(12, 100, null, true);
  for (const origine of ['salaire_prof', 'salaire_staff', 'salaire']) {
    await ligne(`${origine} vif`, origine, salVif, 'out');
    await ligne(`${origine} annulé`, origine, salAnnule, 'out');
    await ligne(`${origine} : son annulation`, origine, salAnnulation);
    await ligne(`${origine} marqué`, origine, salMarque, 'out');
  }

  // ── Les pièges ────────────────────────────────────────────────────────────
  // Une origine SANS grand livre à annulation : toujours retenue.
  await ligne('dette (aucun grand livre)', 'dette', pAnnulee);
  // L'identifiant d'une écriture annulée, mais sous l'origine d'un AUTRE grand
  // livre : ce n'est pas elle que la ligne désigne.
  await ligne('piège : paiement annulé lu comme dépense', 'depense', pAnnulee, 'out');
  await ligne('piège : dépense annulée lue comme paiement', 'paiement', dAnnulee);
  await ligne('piège : dépense marquée lue comme salaire', 'salaire', dMarquee, 'out');
  // Une ligne orpheline : aucune écriture ne porte cet identifiant.
  await owner.query(
    `INSERT INTO tender_lines (school_id, source_type, source_id, payment_method_id, amount, direction, reference)
     VALUES ($1, 'paiement', gen_random_uuid(), $2, 100, 'in', 'orpheline')`,
    [ecoleA, moyenA],
  );
  // ⚠ L'école B a, elle aussi, un paiement annulé. Une ligne de l'école A qui
  // porterait son identifiant ne doit rien en savoir : RLS ne montre à A que
  // les annulations de A.
  const bAnnulee = await paiement(B, 11, 100, null, 'P-2');
  await paiement(B, 11, -100, bAnnulee, 'P-3');
  await ligne('piège : paiement annulé d’une AUTRE école', 'paiement', bAnnulee);
});

afterAll(async () => {
  await owner?.end();
});

/** Le verdict des deux écritures sur chaque ligne de l'école A, sous RLS, comme l'API. */
async function verdicts(): Promise<{ nom: string; avant: boolean; apres: boolean }[]> {
  return runInTenant({ schoolId: ecoleA, slug: 'lra' }, () =>
    db.query(async (tx) => {
      const { rows } = await tx.query<{ nom: string; avant: boolean; apres: boolean }>(
        `SELECT tl.reference AS nom,
                (${ligneRetenueAvant('tl')}) AS avant,
                (${ligneRetenue('tl')}) AS apres
           FROM tender_lines tl
          ORDER BY tl.reference`,
      );
      return rows;
    }),
  );
}

describe('ligneRetenue : la nouvelle écriture retient les mêmes lignes que l’ancienne', () => {
  it('⚠ même verdict sur chacune des lignes, sous RLS', async () => {
    const lignes = await verdicts();
    // 3 par origine de service, et 32 autres (paiement 3, cours du soir 3 + 4,
    // dépense 4, salaires 3 × 4, pièges 6).
    expect(lignes).toHaveLength(32 + 3 * SOURCES_SERVICES.length);
    expect(lignes.filter((l) => l.avant !== l.apres)).toEqual([]);
    // Et le filtre posé dans un WHERE compte les mêmes lignes.
    const comptes = await runInTenant({ schoolId: ecoleA, slug: 'lra' }, () =>
      db.query(async (tx) => {
        const { rows } = await tx.query<{ avant: string; apres: string }>(
          `SELECT (SELECT count(*) FROM tender_lines tl WHERE ${ligneRetenueAvant('tl')})::text AS avant,
                  (SELECT count(*) FROM tender_lines tl WHERE ${ligneRetenue('tl')})::text AS apres`,
        );
        return rows[0]!;
      }),
    );
    expect(comptes.apres).toBe(comptes.avant);
  });

  it('⚠ la règle, en clair : ni l’écriture annulée, ni son annulation, ni l’écriture marquée', async () => {
    const lignes = await verdicts();
    const retenues = lignes.filter((l) => l.apres).map((l) => l.nom).sort();
    const ecartees = lignes.filter((l) => !l.apres).map((l) => l.nom).sort();

    const services = [...SOURCES_SERVICES];
    const salaires = ['salaire_prof', 'salaire_staff', 'salaire'];
    expect(retenues).toEqual(
      [
        'paiement vif',
        ...services.map((o) => `${o} vif`),
        'cours_soir vif',
        'cours_soir_prof vif',
        'depense vive',
        ...salaires.map((o) => `${o} vif`),
        'dette (aucun grand livre)',
        'piège : paiement annulé lu comme dépense',
        'piège : dépense annulée lue comme paiement',
        'piège : dépense marquée lue comme salaire',
        'orpheline',
        'piège : paiement annulé d’une AUTRE école',
      ].sort(),
    );
    expect(ecartees).toEqual(
      [
        'paiement annulé',
        'paiement : son annulation',
        ...services.flatMap((o) => [`${o} annulé`, `${o} : son annulation`]),
        'cours_soir annulé',
        'cours_soir : son annulation',
        'cours_soir_prof annulé',
        'cours_soir_prof : son annulation',
        'cours_soir_prof marqué',
        'depense annulée',
        'depense : son annulation',
        'depense marquée',
        ...salaires.flatMap((o) => [`${o} annulé`, `${o} : son annulation`, `${o} marqué`]),
      ].sort(),
    );
  });

  it('⚠ cloisonnement : vue de l’école B, aucune des lignes de l’école A n’existe', async () => {
    const vuesDeB = await runInTenant({ schoolId: ecoleB, slug: 'lrb' }, () =>
      db.query(async (tx) => {
        const { rows } = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM tender_lines');
        return rows[0]!.n;
      }),
    );
    expect(vuesDeB).toBe('0');
  });

  it('refuse un alias qui ne serait pas un identifiant', () => {
    expect(() => ligneRetenue('tl; DROP TABLE payments')).toThrow('alias invalide');
  });
});
