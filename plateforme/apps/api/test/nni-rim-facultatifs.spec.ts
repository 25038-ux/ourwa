import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AdmissionsService } from '../src/admissions/admissions.service.js';
import { ExpulsionsService } from '../src/discipline/expulsions.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LE NNI ET LE RIM FACULTATIFS — décision du propriétaire, 30/09/2026 :
 * « make the nni and rim optional ».
 *
 * El Ourwa les exigeait (« Le RIM est obligatoire. Le NNI est obligatoire. »).
 * Un enfant sans papiers s'inscrit désormais sans eux ; ils restent uniques
 * dans l'école quand on les donne. Absent = NULL, jamais '' : deux '' se
 * heurteraient à l'unique (school_id, rim), et surtout le registre des exclus
 * bloque par « NNI OU RIM » — un exclu sans NNI aurait bloqué tous les
 * enfants sans NNI.
 */

let owner: pg.Pool;
let admissions: AdmissionsService;
let expulsions: ExpulsionsService;
let schoolId: string;
let ACTOR: string;
const DIRECTION = ['scolarite.inscrire'];
let n = 0;

function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'nni-fac' }, fn);
}

function admettre(ident: { rim?: string; nationalId?: string }, prenom = `Enfant${++n}`) {
  return inTenant(() =>
    admissions.admit(
      {
        firstName: prenom,
        lastName: 'Sans Papiers',
        ...ident,
        newGuardian: { fullName: `Parent ${n}`, phone: `+2224710${String(n).padStart(4, '0')}`, initialPassword: 'Ecole-2026' },
      },
      ACTOR,
      DIRECTION,
    ),
  );
}

async function identite(studentId: string) {
  const { rows } = await owner.query<{ rim: string | null; national_id: string | null }>(
    'SELECT rim, national_id FROM students WHERE id = $1',
    [studentId],
  );
  return rows[0]!;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const s = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('nni-fac', 'NNI facultatif', 'NNF') RETURNING id`,
  );
  schoolId = s.rows[0]!.id;
  await owner.query(
    `INSERT INTO roles (code, label, is_system, sort_order)
     VALUES ('parent', 'Parent', true, 30) ON CONFLICT (code) DO NOTHING`,
  );
  const a = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('nni-fac.sec@test', 'x', 'Secrétaire') RETURNING id`,
  );
  ACTOR = a.rows[0]!.id;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  admissions = moduleRef.get(AdmissionsService);
  expulsions = moduleRef.get(ExpulsionsService);
});

afterAll(async () => {
  await owner?.end();
});

describe('inscrire sans NNI ni RIM', () => {
  it('inscrit un enfant sans NNI ni RIM — rangés NULL', async () => {
    const r = await admettre({});
    expect(await identite(r.studentId)).toEqual({ rim: null, national_id: null });
  });

  it('⚠ un deuxième, puis un troisième enfant sans papiers : aucun « existe déjà »', async () => {
    const a = await admettre({});
    const b = await admettre({ rim: '', nationalId: '' });
    expect(a.studentId).not.toBe(b.studentId);
    expect(await identite(b.studentId)).toEqual({ rim: null, national_id: null });
  });

  it('des blancs seuls valent « absent », pas un numéro', async () => {
    const r = await admettre({ rim: '   ', nationalId: '  ' });
    expect(await identite(r.studentId)).toEqual({ rim: null, national_id: null });
  });

  it("l'un sans l'autre", async () => {
    const r = await admettre({ nationalId: 'NNI-SEUL-1' });
    expect(await identite(r.studentId)).toEqual({ rim: null, national_id: 'NNI-SEUL-1' });
  });

  it('donnés, ils restent uniques dans l’école', async () => {
    await admettre({ rim: 'RIM-UNIQ-1' });
    await expect(admettre({ rim: 'RIM-UNIQ-1' })).rejects.toThrow(/RIM ou ce NNI existe déjà/);
    await admettre({ nationalId: 'NNI-UNIQ-1' });
    await expect(admettre({ nationalId: 'NNI-UNIQ-1' })).rejects.toThrow(/RIM ou ce NNI existe déjà/);
  });

  it('la base refuse une chaîne vide (NULL seulement) : l’unique ne peut pas se remplir de « »', async () => {
    await expect(
      owner.query(
        `INSERT INTO students (school_id, rim, national_id, first_name, last_name) VALUES ($1, '', NULL, 'X', 'Y')`,
        [schoolId],
      ),
    ).rejects.toThrow(/students_rim_non_vide/);
    await expect(
      owner.query(
        `INSERT INTO students (school_id, rim, national_id, first_name, last_name) VALUES ($1, NULL, ' ', 'X', 'Y')`,
        [schoolId],
      ),
    ).rejects.toThrow(/students_nni_non_vide/);
  });
});

describe('le registre des exclus, avec des identités incomplètes', () => {
  it('⚠ bloquer exige au moins le NNI ou le RIM — sinon le blocage ne bloquerait rien', async () => {
    await expect(
      inTenant(() => expulsions.expel({ firstName: 'Sans', lastName: 'Rien' }, ACTOR)),
    ).rejects.toThrow(/NNI ou le RIM/);
  });

  it('⚠ un exclu SANS RIM ne bloque pas tous les enfants sans RIM', async () => {
    await inTenant(() =>
      expulsions.expel({ nationalId: 'NNI-EXCLU-1', firstName: 'Exclu', lastName: 'Un' }, ACTOR),
    );
    // Sans NNI ni RIM : rien ne le relie à l'exclu.
    await expect(admettre({})).resolves.toBeTruthy();
    // Un autre NNI, sans RIM : pas lui non plus.
    await expect(admettre({ nationalId: 'NNI-AUTRE-2' })).resolves.toBeTruthy();
    // Son NNI : refusé, avant toute écriture.
    await expect(admettre({ nationalId: 'NNI-EXCLU-1' }, 'Revenant')).rejects.toThrow(/étudiant exclu\/expulsé/);
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM students WHERE school_id = $1 AND first_name = 'Revenant'`,
      [schoolId],
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('un exclu par son seul RIM est reconnu à son RIM', async () => {
    await inTenant(() => expulsions.expel({ rim: 'RIM-EXCLU-2', firstName: 'Exclu', lastName: 'Deux' }, ACTOR));
    await expect(admettre({ rim: 'RIM-EXCLU-2', nationalId: 'NNI-NEUF-3' })).rejects.toThrow(/étudiant exclu\/expulsé/);
    await expect(admettre({ rim: 'RIM-NEUF-3' })).resolves.toBeTruthy();
  });

  it('la même identité partielle ne se bloque pas deux fois', async () => {
    await expect(
      inTenant(() => expulsions.expel({ rim: 'RIM-EXCLU-2', firstName: 'Exclu', lastName: 'Deux' }, ACTOR)),
    ).rejects.toThrow(/déjà bloquée/);
  });
});
