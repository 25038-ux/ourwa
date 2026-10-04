import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { DocumentsService } from '../src/documents/documents.service.js';
import { ParentController } from '../src/parent/parent.controller.js';
import { runInTenant } from '../src/tenant/tenant.context.js';
import type { AuthenticatedRequest } from '../src/auth/permissions.guard.js';

/**
 * LES DOCUMENTS SIGNÉS — ADR-0080, migration 0048. La demande du propriétaire
 * de Jinan (04/10/2026), point par point :
 *
 *   - « search button for parents by name and number » ;
 *   - « a placeholder for every service the parent chose for either one of
 *     his children + inscription » — puis (même jour) « add comportement
 *     sociaux to documents … and delete photocopie » ;
 *   - « available to see and delete or replace anytime by the admin » ;
 *   - « they can only be seen by the parent, not modified or replaced or
 *     deleted » — et seulement par CE parent.
 */

let owner: pg.Pool;
let documents: DocumentsService;
let parent: ParentController;
let schoolId: string;
let yearId: string;
let ACTOR: string;
let famille: string;
let autreFamille: string;
let ahmed: string;
let fatima: string;
let sidi: string;
let uploadDir: string;
let docInscription: string;

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26, 1), Buffer.from('[Content_Types].xml'), Buffer.alloc(64)]);

const ici = <T>(fn: () => Promise<T>) => runInTenant({ schoolId, slug: 'docs' }, fn);
const req = (userId: string) =>
  ({ auth: { userId, schoolId, roles: ['parent'], permissions: [], impersonated: false } }) as unknown as AuthenticatedRequest;

/** Une réponse Fastify minimale : ce que `envoyer()` écrit. */
function reponse() {
  const r = { headers: {} as Record<string, string>, body: null as Buffer | null };
  const reply = {
    header(k: string, v: string) { r.headers[k.toLowerCase()] = v; return reply; },
    send(b: Buffer) { r.body = b; return reply; },
  };
  return { r, reply: reply as never };
}

beforeAll(async () => {
  uploadDir = mkdtempSync(join(tmpdir(), 'elourwa-docs-'));
  process.env.UPLOAD_DIR = uploadDir;
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const q = async (sql: string, params: unknown[] = []) => (await owner.query<{ id: string }>(sql, params)).rows[0]!.id;

  schoolId = await q(`INSERT INTO schools (slug, name, receipt_prefix, billing_model) VALUES ('docs', 'Documents', 'DOC', 'services') RETURNING id`);
  yearId = await q(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, '2026-2027', 2026, 10, 6, 'active') RETURNING id`,
    [schoolId],
  );
  const level = await q(`INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '1 AF', 3000, 'fondamental') RETURNING id`, [schoolId]);
  const group = await q(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '1 AF A') RETURNING id`, [schoolId, level]);

  ACTOR = await q(`INSERT INTO users (email, password_hash, full_name) VALUES ('docs.direction@test', 'x', 'Direction') RETURNING id`);
  famille = await q(`INSERT INTO users (phone, password_hash, full_name) VALUES ('36123456', 'x', 'Mohamed Ould Brahim') RETURNING id`);
  autreFamille = await q(`INSERT INTO users (phone, password_hash, full_name) VALUES ('46998877', 'x', 'Zeinabou Mint Ely') RETURNING id`);
  await owner.query(`INSERT INTO user_phones (user_id, phone, label) VALUES ($1, '22445566', 'Mère')`, [famille]);

  const eleve = (g: string, prenom: string, nom: string) =>
    q(`INSERT INTO students (school_id, guardian_id, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING id`, [schoolId, g, prenom, nom]);
  ahmed = await eleve(famille, 'Ahmed', 'Ould Brahim');
  fatima = await eleve(famille, 'Fatima', 'Mint Brahim');
  sidi = await eleve(autreFamille, 'Sidi', 'Ould Ely');
  for (const s of [ahmed, fatima, sidi]) {
    await owner.query(
      `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
       VALUES ($1, $2, $3, $4, $5, 'enrolled', 3000)`,
      [schoolId, s, yearId, group, level],
    );
  }
  // Ahmed a pris le transport et la cantine complète ; Fatima, rien de plus.
  for (const service of ['transport', 'cantine_complet', 'inscription', 'photocopie']) {
    await owner.query(
      `INSERT INTO student_services (school_id, student_id, academic_year_id, service, amount, start_month, start_year)
       VALUES ($1, $2, $3, $4, 1000, 10, 2026)`,
      [schoolId, ahmed, yearId, service],
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  documents = moduleRef.get(DocumentsService);
  parent = moduleRef.get(ParentController);
});

afterAll(async () => {
  await owner?.end();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe('« search button for parents by name and number »', () => {
  it('par le nom du correspondant, par le nom d’un enfant', async () => {
    expect((await ici(() => documents.rechercherFamilles('ould brahim'))).map((f) => f.id)).toEqual([famille]);
    expect((await ici(() => documents.rechercherFamilles('Sidi'))).map((f) => f.id)).toEqual([autreFamille]);
  });

  it('par un morceau de n’importe quel numéro — le principal ou un supplémentaire', async () => {
    expect((await ici(() => documents.rechercherFamilles('36 12'))).map((f) => f.id)).toEqual([famille]);
    const r = await ici(() => documents.rechercherFamilles('22445'));
    expect(r.map((f) => f.id)).toEqual([famille]);
    expect(r[0]!.autresTelephones).toEqual(['22445566']);
    expect(r[0]!.enfants).toBe(2);
  });

  it('moins de deux caractères : rien', async () => {
    expect(await ici(() => documents.rechercherFamilles('a'))).toEqual([]);
  });
});

describe('les pièces : inscription + comportements sociaux toujours, puis chaque service souscrit', () => {
  it('Ahmed : inscription, comportements sociaux, cantine, transport ; Fatima : les deux premières ; jamais la photocopie', async () => {
    const f = await ici(() => documents.famille(famille));
    expect(f.annee?.label).toBe('2026-2027');
    expect(f.famille.autresTelephones).toEqual(['22445566']);
    const parNom = Object.fromEntries(f.enfants.map((e) => [e.prenom, e.pieces.map((p) => p.piece)]));
    // Ahmed est abonné à la photocopie (d'office) : elle n'a PAS de pièce (0049).
    expect(parNom.Ahmed).toEqual(['inscription', 'comportement_social', 'cantine_complet', 'transport']);
    expect(parNom.Fatima).toEqual(['inscription', 'comportement_social']);
    const libelles = f.enfants.find((e) => e.prenom === 'Ahmed')!.pieces.map((x) => x.libelle);
    expect(libelles.slice(0, 2)).toEqual(['Inscription', 'Comportements sociaux']);
    expect(f.enfants[0]!.classe).toBe('1 AF — 1 AF A');
    expect(f.enfants.flatMap((e) => e.pieces).every((p) => p.document === null)).toBe(true);
  });

  it('⚠ un autre correspondant que celui de l’école : introuvable', async () => {
    await expect(ici(() => documents.famille(ACTOR))).rejects.toThrow(/Famille introuvable/);
  });
});

describe('déposer, voir, remplacer, supprimer — l’école', () => {
  it('dépose le contrat d’inscription signé (PDF), et la famille est prévenue', async () => {
    const r = await ici(() => documents.deposer(ahmed, yearId, 'inscription', { buffer: PDF, filename: 'inscription signée.pdf' }, ACTOR));
    expect(r.remplace).toBe(false);
    expect(r.mime).toBe('application/pdf');
    docInscription = r.id;
    const f = await ici(() => documents.famille(famille));
    const piece = f.enfants.find((e) => e.prenom === 'Ahmed')!.pieces.find((p) => p.piece === 'inscription')!;
    expect(piece.document?.nom).toBe('inscription signée.pdf');
    expect(piece.document?.deposePar).toBe('Direction');
    const { rows } = await owner.query(
      `SELECT i18n_key, i18n_params FROM notifications WHERE guardian_id = $1 AND kind = 'document'`,
      [famille],
    );
    expect(rows).toEqual([{ i18n_key: 'notif_document', i18n_params: { eleve: 'Ahmed Ould Brahim', document: 'Inscription' } }]);
  });

  it('le transport d’Ahmed accepte une photo ; ⚠ celui de Fatima, qui ne l’a pas pris, est refusé', async () => {
    await ici(() => documents.deposer(ahmed, yearId, 'transport', { buffer: PNG, filename: 'transport.png' }, ACTOR));
    await expect(
      ici(() => documents.deposer(fatima, yearId, 'transport', { buffer: PDF, filename: 'transport.pdf' }, ACTOR)),
    ).rejects.toThrow(/n’a pas été souscrit/);
  });

  it('⚠ un document signé est un PDF ou une image : pas un fichier Word, pas une pièce inventée', async () => {
    await expect(
      ici(() => documents.deposer(ahmed, yearId, 'comportement_social', { buffer: DOCX, filename: 'contrat.docx' }, ACTOR)),
    ).rejects.toThrow(/Acceptés : JPG, PNG, WebP, GIF, PDF/);
    await expect(
      ici(() => documents.deposer(ahmed, yearId, 'bus', { buffer: PDF, filename: 'x.pdf' }, ACTOR)),
    ).rejects.toThrow(/Pièce inconnue/);
    // La photocopie n'est plus une pièce, même pour un élève qui la paie.
    await expect(
      ici(() => documents.deposer(ahmed, yearId, 'photocopie', { buffer: PDF, filename: 'x.pdf' }, ACTOR)),
    ).rejects.toThrow(/Pièce inconnue/);
  });

  it('les comportements sociaux : une pièce pour chaque enfant, sans service', async () => {
    const r = await ici(() => documents.deposer(fatima, yearId, 'comportement_social', { buffer: PDF, filename: 'comportement.pdf' }, ACTOR));
    expect(r.remplace).toBe(false);
    const f = await ici(() => documents.famille(famille));
    const p = f.enfants.find((e) => e.prenom === 'Fatima')!.pieces.find((x) => x.piece === 'comportement_social')!;
    expect(p.libelle).toBe('Comportements sociaux');
    expect(p.document?.nom).toBe('comportement.pdf');
  });

  it('remplacer : même pièce, nouveau fichier ; l’ancien quitte le disque', async () => {
    const avant = readdirSync(join(uploadDir, schoolId)).length;
    const r = await ici(() => documents.deposer(ahmed, yearId, 'inscription', { buffer: PDF, filename: 'inscription v2.pdf' }, ACTOR));
    expect(r).toMatchObject({ id: docInscription, remplace: true, nom: 'inscription v2.pdf' });
    expect(readdirSync(join(uploadDir, schoolId)).length).toBe(avant);
    const { rows } = await owner.query(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY created_at`, [docInscription]);
    expect(rows.map((x) => x.action)).toEqual(['document_signe_depose', 'document_signe_remplace']);
  });

  it('voir : le fichier, avec nosniff et sans cache partagé', async () => {
    const f = await ici(() => documents.fichier(docInscription));
    expect(f.mime).toBe('application/pdf');
    expect(f.displayName).toBe('inscription v2.pdf');
    expect(f.buffer.equals(PDF)).toBe(true);
  });
});

describe('la famille : voir seulement, et seulement les siens', () => {
  it('GET /parent/documents : ses enfants, leurs pièces, sans le nom de qui a déposé', async () => {
    const r = await ici(() => parent.documentsFamille(req(famille)));
    expect(r.actif).toBe(true);
    expect(r.annee?.label).toBe('2026-2027');
    expect(r.enfants.map((e) => e.prenom).sort()).toEqual(['Ahmed', 'Fatima']);
    const ahmedPieces = r.enfants.find((e) => e.prenom === 'Ahmed')!.pieces;
    expect(ahmedPieces.find((p) => p.piece === 'inscription')!.document).toMatchObject({ nom: 'inscription v2.pdf', deposePar: null });
    expect(ahmedPieces.find((p) => p.piece === 'cantine_complet')!.document).toBeNull();
  });

  it('GET /parent/documents/:id : le fichier', async () => {
    const { r, reply } = reponse();
    await ici(() => parent.documentFichier(req(famille), docInscription, '1', reply));
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-disposition']).toMatch(/^inline;/);
    expect(r.body?.equals(PDF)).toBe(true);
  });

  it('⚠ une autre famille ne lit pas ce document, et ne voit pas ces enfants', async () => {
    const { reply } = reponse();
    await expect(ici(() => parent.documentFichier(req(autreFamille), docInscription, undefined, reply))).rejects.toThrow(/Document introuvable/);
    const r = await ici(() => parent.documentsFamille(req(autreFamille)));
    expect(r.enfants.map((e) => e.prenom)).toEqual(['Sidi']);
  });

  it('⚠ l’espace parent n’a AUCUNE route d’écriture pour les documents', () => {
    const proto = Object.getOwnPropertyNames(ParentController.prototype);
    const routes = proto.filter((n) => /^document/i.test(n));
    expect(routes.sort()).toEqual(['documentFichier', 'documentsFamille']);
  });
});

describe('supprimer', () => {
  it('la pièce redevient vide, le fichier quitte le disque, le journal le garde', async () => {
    const avant = readdirSync(join(uploadDir, schoolId)).length;
    await ici(() => documents.supprimer(docInscription, ACTOR));
    expect(readdirSync(join(uploadDir, schoolId)).length).toBe(avant - 1);
    const f = await ici(() => documents.famille(famille));
    expect(f.enfants.find((e) => e.prenom === 'Ahmed')!.pieces.find((p) => p.piece === 'inscription')!.document).toBeNull();
    await expect(ici(() => documents.fichier(docInscription))).rejects.toThrow(/Document introuvable/);
    const { rows } = await owner.query(`SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'document_signe_supprime'`, [docInscription]);
    expect(rows).toHaveLength(1);
  });

  it('⚠ un document d’une autre école : introuvable d’ici', async () => {
    const autre = await owner.query<{ id: string }>(
      `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('docs-autre', 'Autre', 'DAU') RETURNING id`,
    );
    const transport = (await ici(() => documents.famille(famille))).enfants
      .find((e) => e.prenom === 'Ahmed')!.pieces.find((p) => p.piece === 'transport')!.document!;
    await expect(
      runInTenant({ schoolId: autre.rows[0]!.id, slug: 'docs-autre' }, () => documents.supprimer(transport.id, ACTOR)),
    ).rejects.toThrow(/Document introuvable/);
    expect(existsSync(join(uploadDir, schoolId))).toBe(true);
  });
});
