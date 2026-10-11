import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * « COMPTES DES PARENTS » — LES FAMILLES D'UNE ANNÉE, ET CELLES SANS NUMÉRO.
 *
 * Demande du propriétaire (07/10/2026) : il saisira lui-même un numéro de
 * téléphone pour chaque famille, et veut pour cela ne voir que les familles
 * ACTIVES d'une année. Sur 1 372 familles reprises, 1 073 n'ont pas de vrai
 * numéro (« SANSTEL-… ») — et seules celles qui ont un enfant inscrit cette
 * année comptent pour lui.
 *
 * « Active une année » : au moins un enfant dont l'inscription de cette année
 * n'est pas annulée. « Sans numéro » : l'identifiant du compte n'est pas un
 * numéro à huit chiffres et aucun numéro supplémentaire n'est enregistré.
 */

let owner: pg.Pool;
let accounts: AccountsService;
let schoolId: string;
let autreEcole: string;
let annee2025: string;
let annee2026: string;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant({ schoolId, slug: 'cpan' }, fn);

async function famille(nom: string, telephone: string | null): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO users (phone, email, password_hash, full_name)
     VALUES ($1, $2, 'x', $3) RETURNING id`,
    [telephone, telephone ? null : `${nom.toLowerCase().replace(/\s+/g, '.')}@cpan.test`, nom],
  );
  return rows[0]!.id;
}

async function eleve(ecole: string, tuteur: string, prenom: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO students (school_id, guardian_id, first_name, last_name, rim, national_id)
     VALUES ($1, $2, $3, 'Essai', $4, $5) RETURNING id`,
    [ecole, tuteur, prenom, `RIM-${prenom}`, `NNI-${prenom}`],
  );
  return rows[0]!.id;
}

async function inscrire(ecole: string, eleveId: string, annee: string, statut = 'enrolled') {
  await owner.query(
    `INSERT INTO enrollments (school_id, student_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4::enrollment_status)`,
    [ecole, eleveId, annee, statut],
  );
}

const noms = (r: { rows: { full_name: string }[] }) => r.rows.map((x) => x.full_name);

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const s = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('cpan', 'École Nour', 'CPA'), ('cpan-b', 'École Rissala', 'CPB') RETURNING id`,
  );
  schoolId = s.rows[0]!.id;
  autreEcole = s.rows[1]!.id;
  const a = await owner.query<{ id: string }>(
    `INSERT INTO academic_years (school_id, label, start_year, status)
     VALUES ($1, '2025-2026', 2025, 'closed'), ($1, '2026-2027', 2026, 'active') RETURNING id`,
    [schoolId],
  );
  annee2025 = a.rows[0]!.id;
  annee2026 = a.rows[1]!.id;
  const autreAnnee = (
    await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2026-2027', 2026, 'active') RETURNING id`,
      [autreEcole],
    )
  ).rows[0]!.id;

  // A : inscrite les deux années, vrai numéro.
  const fa = await famille('Famille A', '22123456');
  const ea = await eleve(schoolId, fa, 'Aicha');
  await inscrire(schoolId, ea, annee2025, 'archived');
  await inscrire(schoolId, ea, annee2026);
  // B : 2025 seulement, sans numéro.
  const fb = await famille('Famille B', 'SANSTEL-9001');
  await inscrire(schoolId, await eleve(schoolId, fb, 'Bilal'), annee2025, 'archived');
  // C : 2026, sans numéro, deux enfants dont un seul inscrit en 2026.
  const fc = await famille('Famille C', 'SANSTEL-9002');
  await inscrire(schoolId, await eleve(schoolId, fc, 'Cheikh'), annee2026);
  await inscrire(schoolId, await eleve(schoolId, fc, 'Coumba'), annee2025, 'archived');
  // D : 2026 mais inscription ANNULÉE — pas active cette année-là.
  const fd = await famille('Famille D', 'SANSTEL-9003');
  await inscrire(schoolId, await eleve(schoolId, fd, 'Demba'), annee2026, 'cancelled');
  // E : identifiant sans numéro, mais un numéro supplémentaire enregistré.
  const fe = await famille('Famille E', 'SANSTEL-9004');
  await inscrire(schoolId, await eleve(schoolId, fe, 'Eby'), annee2026);
  await owner.query(`INSERT INTO user_phones (user_id, phone, label) VALUES ($1, '33445566', 'mère')`, [fe]);
  // F : une famille de l'AUTRE école, inscrite en 2026 là-bas — jamais visible ici.
  const ff = await famille('Famille F', 'SANSTEL-9005');
  await inscrire(autreEcole, await eleve(autreEcole, ff, 'Fatou'), autreAnnee);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  accounts = moduleRef.get(AccountsService);
});

afterAll(async () => {
  await owner?.end();
});

describe('listParents — sans filtre, rien ne change', () => {
  it('toutes les familles de l’école, pas celles d’une autre', async () => {
    const r = await inTenant(() => accounts.listParents({}));
    expect(noms(r)).toEqual(['Famille A', 'Famille B', 'Famille C', 'Famille D', 'Famille E']);
  });
});

describe('listParents — les familles actives d’une année', () => {
  it('2026-2027 : un enfant inscrit, inscription non annulée', async () => {
    const r = await inTenant(() => accounts.listParents({ academicYearId: annee2026 }));
    expect(noms(r)).toEqual(['Famille A', 'Famille C', 'Famille E']);
  });

  it('2025-2026 : les familles de l’an passé, archivées comprises', async () => {
    const r = await inTenant(() => accounts.listParents({ academicYearId: annee2025 }));
    expect(noms(r)).toEqual(['Famille A', 'Famille B', 'Famille C']);
  });

  it('le nombre d’enfants de l’année est donné à côté du total', async () => {
    const r = await inTenant(() => accounts.listParents({ academicYearId: annee2026 }));
    const c = (r.rows as { full_name: string; children: number; children_in_year: number | null }[]).find((x) => x.full_name === 'Famille C')!;
    expect(c.children).toBe(2);
    expect(c.children_in_year).toBe(1);
    const sans = await inTenant(() => accounts.listParents({}));
    expect((sans.rows[0] as { children_in_year: number | null }).children_in_year).toBeNull();
  });

  it('⚠ l’année d’une AUTRE école ne montre rien (RLS, pas une fuite)', async () => {
    const { rows } = await owner.query<{ id: string }>('SELECT id FROM academic_years WHERE school_id = $1', [autreEcole]);
    const r = await inTenant(() => accounts.listParents({ academicYearId: rows[0]!.id }));
    expect(r.rows).toEqual([]);
  });

  it('une année illisible est refusée proprement (400), pas un 500', async () => {
    await expect(inTenant(() => accounts.listParents({ academicYearId: 'abc' }))).rejects.toMatchObject({ status: 400 });
  });
});

describe('listParents — les familles sans numéro', () => {
  it('ni identifiant à huit chiffres, ni numéro supplémentaire', async () => {
    const r = await inTenant(() => accounts.listParents({ sansNumero: true }));
    expect(noms(r)).toEqual(['Famille B', 'Famille C', 'Famille D']);
  });

  it('combiné à l’année : celles qu’il reste à appeler cette année', async () => {
    const r = await inTenant(() => accounts.listParents({ academicYearId: annee2026, sansNumero: true }));
    expect(noms(r)).toEqual(['Famille C']);
  });

  it('la recherche et le curseur tiennent avec les filtres', async () => {
    const page1 = await inTenant(() => accounts.listParents({ academicYearId: annee2026, limit: 2 }));
    expect(noms(page1)).toEqual(['Famille A', 'Famille C']);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await inTenant(() => accounts.listParents({ academicYearId: annee2026, limit: 2, cursor: page1.nextCursor! }));
    expect(noms(page2)).toEqual(['Famille E']);
    const cherche = await inTenant(() => accounts.listParents({ academicYearId: annee2026, q: 'famille c' }));
    expect(noms(cherche)).toEqual(['Famille C']);
  });
});
