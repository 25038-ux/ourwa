import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { withTenant, type Queryable } from '../src/client.js';

/**
 * LES DOCUMENTS SIGNÉS — CE QUE LA BASE GARANTIT D'ELLE-MÊME (0048, ADR-0080).
 *
 *   - une pièce, un document, par élève et par année ;
 *   - seulement les pièces connues (inscription, comportements sociaux, les
 *     services) — plus la photocopie depuis 0049 ;
 *   - seulement PDF et images, sous un nom tiré au hasard ;
 *   - une école ne voit, ni n'écrit, les documents d'une autre ;
 *
 * (La permission `documents.gerer` : `role-grants.spec.ts` côté API — la base
 * de test n'a pas encore ses rôles quand la migration passe.)
 *
 * Écrites sous `app_user`, dans `withTenant` : l'isolation joue pour de vrai.
 */

let owner: pg.Pool;
let app: pg.Pool;
let ecoleA: string;
let ecoleB: string;
let annee: string;
let eleve: string;

const A = <T>(fn: (tx: Queryable) => Promise<T>) => withTenant(ecoleA, fn, app);
const B = <T>(fn: (tx: Queryable) => Promise<T>) => withTenant(ecoleB, fn, app);

const NOM = () => `${Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')}.pdf`;

async function deposer(tx: Queryable, piece: string, extra: Partial<{ mime: string; stored: string; school: string }> = {}) {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO student_documents
       (school_id, student_id, academic_year_id, piece, stored_name, display_name, mime, bytes)
     VALUES ($1, $2, $3, $4, $5, 'contrat signé.pdf', $6, 1200) RETURNING id`,
    [extra.school ?? ecoleA, eleve, annee, piece, extra.stored ?? NOM(), extra.mime ?? 'application/pdf'],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  app = new pg.Pool({ connectionString: process.env.DATABASE_APP_URL });
  const s = await owner.query<{ id: string; slug: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix, billing_model) VALUES
       ('docs-a', 'Documents A', 'DCA', 'services'), ('docs-b', 'Documents B', 'DCB', 'services')
     RETURNING id, slug`,
  );
  ecoleA = s.rows.find((r) => r.slug === 'docs-a')!.id;
  ecoleB = s.rows.find((r) => r.slug === 'docs-b')!.id;
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('docs.parent@test', 'x', 'Famille Documents') RETURNING id`,
  );
  await A(async (tx) => {
    annee = (await tx.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2026-2027', 2026, 'active') RETURNING id`,
      [ecoleA],
    )).rows[0]!.id;
    eleve = (await tx.query<{ id: string }>(
      `INSERT INTO students (school_id, guardian_id, first_name, last_name) VALUES ($1, $2, 'Mariem', 'Documents') RETURNING id`,
      [ecoleA, g.rows[0]!.id],
    )).rows[0]!.id;
  });
});

afterAll(async () => {
  await owner?.end();
  await app?.end();
});

describe('student_documents (0048)', () => {
  it('une pièce reçoit un document ; une seconde ligne pour la même pièce est refusée', async () => {
    await A((tx) => deposer(tx, 'inscription'));
    await expect(A((tx) => deposer(tx, 'inscription'))).rejects.toThrow(/duplicate key|unique/i);
    // Une autre pièce du même élève, oui.
    await A((tx) => deposer(tx, 'transport'));
  });

  it('« comportements sociaux » est une pièce (0049)', async () => {
    await A((tx) => deposer(tx, 'comportement_social'));
  });

  it('⚠ refuse une pièce inconnue, un format modifiable et un nom de fichier fabriqué', async () => {
    await expect(A((tx) => deposer(tx, 'bus'))).rejects.toThrow(/check constraint/i);
    await expect(A((tx) => deposer(tx, 'photocopie'))).rejects.toThrow(/check constraint/i);
    await expect(
      A((tx) => deposer(tx, 'piscine', { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })),
    ).rejects.toThrow(/check constraint/i);
    await expect(A((tx) => deposer(tx, 'docteur', { stored: '../../etc/passwd' }))).rejects.toThrow(/check constraint/i);
  });

  it('⚠ une autre école ne voit rien et n’écrit rien ici', async () => {
    const vus = await B(async (tx) => (await tx.query('SELECT 1 FROM student_documents')).rows.length);
    expect(vus).toBe(0);
    await expect(B((tx) => deposer(tx, 'comportement_social', { school: ecoleA }))).rejects.toThrow(/row-level security/i);
  });

  it('⚠ et la clé composite interdit de rattacher l’élève d’une autre école', async () => {
    await expect(B((tx) => deposer(tx, 'comportement_social', { school: ecoleB }))).rejects.toThrow(/foreign key/i);
  });

  it('RLS activée ET forcée', async () => {
    const { rows } = await owner.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'student_documents'`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
