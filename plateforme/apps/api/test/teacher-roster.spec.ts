import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ReferenceService } from '../src/academic/reference.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LA LISTE DES ÉLÈVES D'UNE CLASSE, VUE PAR SON PROFESSEUR —
 * `pages/professeur/mes_classes.php`.
 *
 * ⚠ UN PROFESSEUR NE POUVAIT PAS VOIR QUI EST DANS SA CLASSE. Sa page porte,
 * sur chaque groupe, un bouton « Voir les étudiants » qui déplie la liste
 * (#, Identifiant, Nom complet). Le nôtre offrait à la place un lien « Notes → »
 * vers l'écran d'administration — une capacité qu'El Ourwa a justement RETIRÉE
 * aux professeurs (`saisir_notes.php` n'est plus qu'une redirection) — et aucun
 * moyen de consulter un effectif.
 *
 * ⚠ ET C'EST UNE FRONTIÈRE, PAS UN FILTRE D'AFFICHAGE. Le groupe arrive par
 * l'URL ; sans vérification côté serveur, changer le numéro suffit à lire la
 * classe d'un collègue. El Ourwa pose la même garde avant d'afficher :
 * `SELECT COUNT(*) FROM enseignements WHERE professeur_id = :pid AND groupe_id = :gid`.
 */

let owner: pg.Pool;
let reference: ReferenceService;

let schoolId: string;
let yearId: string;
let userMien: string;
let userAutre: string;
let groupeMien: string;
let groupeAutre: string;

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenant({ schoolId, slug: 'listeprof' }, fn);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const school = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('listeprof', 'Liste', 'LIS')
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
  const sub = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Calcul', 2) RETURNING id`,
    [schoolId],
  );
  const sub2 = await owner.query<{ id: string }>(
    `INSERT INTO subjects (school_id, name, coefficient) VALUES ($1, 'Arabe', 2) RETURNING id`,
    [schoolId],
  );

  // Deux groupes, deux professeurs : chacun le sien.
  const [gm, ga] = await Promise.all(
    ['6A', '6B'].map((nom) =>
      owner.query<{ id: string }>(
        `INSERT INTO groups (school_id, level_id, name, capacity)
         VALUES ($1, $2, $3, 30) RETURNING id`,
        [schoolId, l.rows[0]!.id, nom],
      ),
    ),
  );
  groupeMien = gm.rows[0]!.id;
  groupeAutre = ga.rows[0]!.id;

  for (const [tag, groupId, matiere] of [
    ['mien', groupeMien, sub.rows[0]!.id],
    ['autre', groupeAutre, sub.rows[0]!.id],
  ] as const) {
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
      [`listeprof.${tag}@test`, `Prof ${tag}`],
    );
    const t = await owner.query<{ id: string }>(
      `INSERT INTO teachers (school_id, user_id, first_name, last_name, employment, salary)
       VALUES ($1, $2, 'Prof', $3, 'permanent', 1000) RETURNING id`,
      [schoolId, u.rows[0]!.id, tag],
    );
    await owner.query(
      `INSERT INTO teachings
         (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
       VALUES ($1, $2, $3, $4, $5, 4)`,
      [schoolId, yearId, groupId, matiere, t.rows[0]!.id],
    );
    if (tag === 'mien') {
      userMien = u.rows[0]!.id;
      // Le même professeur prend AUSSI la seconde matière dans le même groupe.
      await owner.query(
        `INSERT INTO teachings
           (school_id, academic_year_id, group_id, subject_id, teacher_id, hours_per_week)
         VALUES ($1, $2, $3, $4, $5, 2)`,
        [schoolId, yearId, groupId, sub2.rows[0]!.id, t.rows[0]!.id],
      );
    } else userAutre = u.rows[0]!.id;
  }

  // Deux élèves dans 6A, un dans 6B, plus une inscription annulée.
  for (const [rim, nom, groupId, statut] of [
    ['R1', 'Ba', groupeMien, 'enrolled'],
    ['R2', 'Aw', groupeMien, 'enrolled'],
    ['R3', 'Ka', groupeAutre, 'enrolled'],
    ['R4', 'Zz', groupeMien, 'cancelled'],
  ] as const) {
    const s = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, $2, 'E', $3) RETURNING id`,
      [schoolId, rim, nom],
    );
    await owner.query(
      `INSERT INTO enrollments (school_id, student_id, group_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [schoolId, s.rows[0]!.id, groupId, yearId, statut],
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  reference = moduleRef.get(ReferenceService);
});

afterAll(async () => {
  await owner?.end();
});

describe('un professeur voit la liste de SES classes', () => {
  it('⚠ la liste est par GROUPE, pas par enseignement', async () => {
    // Le même professeur prend 6A pour deux matières. El Ourwa fait
    // `DISTINCT g.id` et concatène les matières : le groupe apparaît UNE fois.
    // Une ligne par enseignement afficherait « 6A » deux fois, ce qui se lit
    // comme deux classes.
    const rows = await inTenant(() => reference.classesForTeacher(userMien, yearId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.group_name).toBe('6A');
    expect(rows[0]!.subjects).toBe('Arabe, Calcul');
  });

  it('⚠ elle porte l’effectif et la capacité, comme sa colonne « Étudiants »', async () => {
    const rows = await inTenant(() => reference.classesForTeacher(userMien, yearId));
    // L'inscription annulée ne compte pas.
    expect(rows[0]!.headcount).toBe(2);
    expect(rows[0]!.capacity).toBe(30);
  });

  it('la liste d’un groupe rend ses élèves, triés par nom', async () => {
    const { groupe, etudiants } = await inTenant(() => reference.rosterForTeacher(userMien, groupeMien, yearId));
    expect(groupe.name).toBe('6A');
    expect(etudiants.map((e) => e.last_name)).toEqual(['Aw', 'Ba']);
  });

  it('⚠ un professeur NE PEUT PAS lire la classe d’un collègue', async () => {
    // La frontière. Sans elle, changer le numéro dans l'URL suffit.
    await expect(
      inTenant(() => reference.rosterForTeacher(userMien, groupeAutre, yearId)),
    ).rejects.toThrow();
  });

  it('⚠ un compte sans fiche enseignant ne lit aucune classe', async () => {
    const u = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('listeprof.sansfiche@test', 'x', 'Sans fiche') RETURNING id`,
    );
    expect(await inTenant(() => reference.classesForTeacher(u.rows[0]!.id, yearId))).toEqual([]);
    await expect(
      inTenant(() => reference.rosterForTeacher(u.rows[0]!.id, groupeMien, yearId)),
    ).rejects.toThrow();
  });
});
