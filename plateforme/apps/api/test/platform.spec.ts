import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Decimal } from 'decimal.js';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PlatformService } from '../src/platform/platform.service.js';
import { PedagogyService } from '../src/pedagogy/pedagogy.service.js';
import { verifyAccessToken } from '../src/auth/tokens.js';
import { getJwtKeys } from '../src/auth/keys.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * Phase 8 — the platform console, and the pedagogy surfaces.
 *
 * Impersonation is the one sanctioned way to cross a tenant boundary, so it
 * gets the strictest tests in the suite.
 */

let owner: pg.Pool;
let platform: PlatformService;
let pedagogy: PedagogyService;

let platformAdmin: string;
let branchAdmin: string;
let schoolA: string;
let schoolB: string;

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  const schools = await owner.query<{ id: string; slug: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES
       ('plat-a', 'Platform A', 'PLA'), ('plat-b', 'Platform B', 'PLB')
     RETURNING id, slug`,
  );
  schoolA = schools.rows.find((r) => r.slug === 'plat-a')!.id;
  schoolB = schools.rows.find((r) => r.slug === 'plat-b')!.id;

  const users = await owner.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, full_name, is_platform_admin) VALUES
       ('plat.owner@test', 'x', 'Platform Owner', true),
       ('plat.branch@test', 'x', 'Branch Admin', false)
     RETURNING id, email`,
  );
  platformAdmin = users.rows.find((r) => r.email === 'plat.owner@test')!.id;
  branchAdmin = users.rows.find((r) => r.email === 'plat.branch@test')!.id;

  // The branch admin is a FULL super-admin of school A — the strongest role a
  // branch has. It still must not let them enter school B.
  const role = await owner.query<{ id: string }>(
    "SELECT id FROM roles WHERE code = 'super_admin'",
  );
  if (role.rows[0]) {
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [branchAdmin, schoolA, role.rows[0].id],
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  platform = moduleRef.get(PlatformService);
  pedagogy = moduleRef.get(PedagogyService);
});

afterAll(async () => {
  await owner?.end();
});

describe('branch creation', () => {
  it('creates a branch that is live the moment the row exists', async () => {
    const branch = await platform.createBranch(
      { slug: 'plat-new', name: 'Platform New' },
      platformAdmin,
    );
    expect(branch.slug).toBe('plat-new');

    // No provisioning step: the hostname is registered with the row.
    const { rows } = await owner.query(
      'SELECT 1 FROM school_domains WHERE school_id = $1 AND hostname = $2',
      [branch.id, 'plat-new.localhost'],
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses a slug that would shadow the platform console', async () => {
    for (const slug of ['admin', 'www', 'api']) {
      await expect(
        platform.createBranch({ slug, name: 'Shadow' }, platformAdmin),
      ).rejects.toThrow(/réservé/i);
    }
  });

  it('refuses a malformed slug', async () => {
    await expect(
      platform.createBranch({ slug: 'Not A Slug!', name: 'Bad' }, platformAdmin),
    ).rejects.toThrow(/minuscules/i);
  });

  it('refuses a duplicate slug', async () => {
    await expect(
      platform.createBranch({ slug: 'plat-a', name: 'Clash' }, platformAdmin),
    ).rejects.toThrow(/utilise déjà/i);
  });

  it('⚠ refuses a branch admin, however senior, from creating branches', async () => {
    await expect(
      platform.createBranch({ slug: 'plat-x', name: 'Nope' }, branchAdmin),
    ).rejects.toThrow(/administrateurs de la plateforme/i);
  });
});

describe('impersonation', () => {
  it('mints a token scoped to exactly one branch', async () => {
    const result = await platform.enterBranch(schoolB, platformAdmin);
    const claims = await verifyAccessToken(result.accessToken, getJwtKeys().publicKey);

    expect(claims.schoolId).toBe(schoolB);
    expect(claims.impersonated).toBe(true);
    // Who this really is, so the audit trail and the UI banner can say so.
    expect(claims.actorId).toBe(platformAdmin);
    expect(claims.sub).toBe(platformAdmin);
  });

  it('is time-boxed to 30 minutes', async () => {
    const result = await platform.enterBranch(schoolB, platformAdmin);
    expect(result.expiresIn).toBe(1800);

    const claims = await verifyAccessToken(result.accessToken, getJwtKeys().publicKey);
    const life = claims.exp - claims.iat;
    expect(life).toBeLessThanOrEqual(1800);
  });

  it('grants a branch super-admin\'s permissions, not unlimited power', async () => {
    const result = await platform.enterBranch(schoolB, platformAdmin);
    const claims = await verifyAccessToken(result.accessToken, getJwtKeys().publicKey);

    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id WHERE r.code = 'super_admin'`,
    );
    // Presence in the branch, not extra authority inside it.
    expect(claims.permissions).toHaveLength(Number(rows[0]!.n));
  });

  it('⚠ cannot be initiated by a branch super-admin', async () => {
    // The single most important refusal here: the strongest role a branch has
    // must not be able to enter a different branch.
    await expect(platform.enterBranch(schoolA, branchAdmin)).rejects.toThrow(
      /administrateurs de la plateforme/i,
    );
    await expect(platform.enterBranch(schoolB, branchAdmin)).rejects.toThrow(
      /administrateurs de la plateforme/i,
    );
  });

  it('audits every entry, naming the actor and the branch', async () => {
    const before = await owner.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'impersonation_started'",
    );
    await platform.enterBranch(schoolB, platformAdmin);
    const after = await owner.query<{
      n: string;
    }>("SELECT count(*)::text AS n FROM audit_log WHERE action = 'impersonation_started'");
    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n) + 1);

    const { rows } = await owner.query<{
      actor_id: string;
      school_id: string;
      impersonated: boolean;
    }>(
      `SELECT actor_id, school_id, impersonated FROM audit_log
        WHERE action = 'impersonation_started' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(rows[0]!.actor_id).toBe(platformAdmin);
    expect(rows[0]!.school_id).toBe(schoolB);
    expect(rows[0]!.impersonated).toBe(true);
  });

  it('audits leaving too, so a session has both ends', async () => {
    await platform.leaveBranch(schoolB, platformAdmin);
    const { rows } = await owner.query(
      `SELECT 1 FROM audit_log WHERE action = 'impersonation_ended' AND school_id = $1`,
      [schoolB],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('refuses to enter a suspended branch', async () => {
    await owner.query('UPDATE schools SET active = false WHERE id = $1', [schoolB]);
    await expect(platform.enterBranch(schoolB, platformAdmin)).rejects.toThrow(/n’est pas activ/i);
    await owner.query('UPDATE schools SET active = true WHERE id = $1', [schoolB]);
  });
});

describe('combined reporting', () => {
  it('reads every branch without BYPASSRLS', async () => {
    const result = await platform.combinedFinance(platformAdmin);
    expect(result.branches.length).toBeGreaterThanOrEqual(2);
    for (const b of result.branches) {
      // NUMERIC arrives as a string, all the way to the report.
      expect(typeof b.collected).toBe('string');
    }
  });

  it('is refused to a branch admin', async () => {
    await expect(platform.combinedFinance(branchAdmin)).rejects.toThrow(
      /administrateurs de la plateforme/i,
    );
  });
});

describe('le tarif par élève', () => {
  /*
   * ⚠ LE SEUL HANDLER DE LA CONSOLE QUI NE VÉRIFIAIT AUCUNE AUTORITÉ.
   *
   * Le commentaire du contrôleur dit pourtant la règle : « Every handler asserts
   * platform-admin status inside the service. There is no permission decorator
   * here on purpose. » Il n'y a donc, sur ces routes, PAS d'autre garde que cet
   * appel — et `setPerStudentTariff` était le seul à ne pas le faire.
   *
   * N'importe quel compte connecté — un parent — pouvait donc changer le nombre
   * qui facture toutes les écoles. Le trou était d'autant plus silencieux que
   * l'action est auditée : elle laissait une trace propre au nom de son auteur.
   */
  it('⚠ est refusé à un administrateur de branche, si haut placé soit-il', async () => {
    await expect(platform.setPerStudentTariff('700.00', branchAdmin)).rejects.toThrow(
      /administrateurs de la plateforme/i,
    );
  });

  it("⚠ un refus ne doit RIEN avoir écrit", async () => {
    const avant = await platform.perStudentTariff();
    await expect(platform.setPerStudentTariff('999.00', branchAdmin)).rejects.toThrow();
    expect(await platform.perStudentTariff()).toBe(avant);
  });

  it("l'administrateur de la plateforme le change, et le relit", async () => {
    await platform.setPerStudentTariff('750.50', platformAdmin);
    // ⚠ UNE CHAÎNE, PAS UN `number`. C'est un montant : il multiplie un effectif
    // pour produire une facture, et un flottant s'y perd au centime (règle 6).
    const lu = await platform.perStudentTariff();
    expect(lu).toBe('750.50');
    expect(typeof lu).toBe('string');
  });

  it('refuse un montant négatif', async () => {
    await expect(platform.setPerStudentTariff('-1.00', platformAdmin)).rejects.toThrow(
      /positif/i,
    );
  });

  it("refuse ce qui n'est pas un montant", async () => {
    await expect(platform.setPerStudentTariff('beaucoup', platformAdmin)).rejects.toThrow();
  });
});

describe('quitter une branche', () => {
  it("⚠ n'inscrit pas une fin d'usurpation au nom de n'importe qui", async () => {
    // Elle n'écrivait qu'une ligne d'audit — mais avec l'identifiant d'école
    // FOURNI PAR L'APPELANT. Un compte quelconque pouvait donc fabriquer une
    // trace « impersonation_ended » sur l'école de son choix, et salir
    // précisément le journal qui sert à établir qui est entré où.
    await expect(platform.leaveBranch(schoolA, branchAdmin)).rejects.toThrow(
      /administrateurs de la plateforme/i,
    );
  });
});

describe('attendance', () => {
  let teachingId: string;
  let studentId: string;
  let actor: string;
  let yearId: string;
  let groupId: string;

  beforeAll(async () => {
    const year = await owner.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
      [schoolA],
    );
    yearId = year.rows[0]!.id;
    const level = await owner.query<{ id: string }>(
      `INSERT INTO levels (school_id, name, monthly_rate, cycle)
       VALUES ($1, 'Niveau', 1000, 'college') RETURNING id`,
      [schoolA],
    );
    const group = await owner.query<{ id: string }>(
      `INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, 'Classe') RETURNING id`,
      [schoolA, level.rows[0]!.id],
    );
    groupId = group.rows[0]!.id;
    const subject = await owner.query<{ id: string }>(
      `INSERT INTO subjects (school_id, level_id, name, max_score)
       VALUES ($1, $2, 'Matiere', 20) RETURNING id`,
      [schoolA, level.rows[0]!.id],
    );
    const user = await owner.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('plat.teacher@test', 'x', 'Teacher') RETURNING id`,
    );
    actor = user.rows[0]!.id;
    const teacher = await owner.query<{ id: string }>(
      `INSERT INTO teachers (school_id, user_id, first_name, last_name)
       VALUES ($1, $2, 'T', 'One') RETURNING id`,
      [schoolA, actor],
    );
    const teaching = await owner.query<{ id: string }>(
      `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [schoolA, year.rows[0]!.id, teacher.rows[0]!.id, group.rows[0]!.id, subject.rows[0]!.id],
    );
    teachingId = teaching.rows[0]!.id;

    const student = await owner.query<{ id: string }>(
      `INSERT INTO students (school_id, rim, national_id, first_name, last_name)
       VALUES ($1, 'RIM-P1', 'NID-P1', 'Eleve', 'Un') RETURNING id`,
      [schoolA],
    );
    studentId = student.rows[0]!.id;
    await owner.query(
      `INSERT INTO enrollments
         (school_id, student_id, academic_year_id, group_id, level_id, status)
       VALUES ($1, $2, $3, $4, $5, 'enrolled')`,
      [schoolA, studentId, year.rows[0]!.id, group.rows[0]!.id, level.rows[0]!.id],
    );
  });

  const inA = <T>(fn: () => Promise<T>) =>
    runInTenant({ schoolId: schoolA, slug: 'plat-a' }, fn);

  it('shows an untaken register as nothing recorded — the screen then ticks Présent, like his', async () => {
    const feuille = await inA(() => pedagogy.appel(groupId, '2025-11-10', yearId, teachingId));
    expect(feuille.etudiants).toHaveLength(1);
    expect(feuille.etudiants[0]!.statut).toBeNull();
  });

  it('records the register and reads it back', async () => {
    const r = await inA(() =>
      pedagogy.enregistrerAppel(
        { groupId, date: '2025-11-10', academicYearId: yearId, teachingId, statuts: [{ studentId, statut: 'absent' }] },
        actor,
      ),
    );
    expect(r.nbAbs).toBe(1);
    const feuille = await inA(() => pedagogy.appel(groupId, '2025-11-10', yearId, teachingId));
    expect(feuille.etudiants[0]!.statut).toBe('absent');
  });

  it('corrects rather than duplicating when the register is retaken — his DELETE then INSERT', async () => {
    await inA(() =>
      pedagogy.enregistrerAppel(
        { groupId, date: '2025-11-10', academicYearId: yearId, teachingId, statuts: [{ studentId, statut: 'retard' }] },
        actor,
      ),
    );
    const feuille = await inA(() => pedagogy.appel(groupId, '2025-11-10', yearId, teachingId));
    expect(feuille.etudiants[0]!.statut).toBe('late');

    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM attendance WHERE student_id = $1',
      [studentId],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('« Général (journée complète) » is its own register, kept apart from the lesson’s', async () => {
    await inA(() =>
      pedagogy.enregistrerAppel(
        { groupId, date: '2025-11-10', academicYearId: yearId, teachingId: null, statuts: [{ studentId, statut: 'absent' }] },
        actor,
      ),
    );
    await inA(() =>
      pedagogy.enregistrerAppel(
        { groupId, date: '2025-11-10', academicYearId: yearId, teachingId: null, statuts: [{ studentId, statut: 'present' }] },
        actor,
      ),
    );
    const journee = await inA(() => pedagogy.appel(groupId, '2025-11-10', yearId, null));
    expect(journee.etudiants[0]!.statut).toBe('present');
    const lecon = await inA(() => pedagogy.appel(groupId, '2025-11-10', yearId, teachingId));
    expect(lecon.etudiants[0]!.statut).toBe('late');
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM attendance WHERE student_id = $1',
      [studentId],
    );
    expect(rows[0]!.n).toBe('2');
  });

  it('offers the day’s timetable cells, else every subject of the year — his `$creneaux_jour`', async () => {
    // 2025-11-10 is a Monday; nothing is on the grid, so the fallback lists the year’s teachings.
    const repli = await inA(() => pedagogy.creneauxDuJour(groupId, '2025-11-10', yearId));
    expect(repli).toHaveLength(1);
    expect(repli[0]!.creneau).toBe('—');
    await owner.query(
      `INSERT INTO timetable_slots (school_id, group_id, day_of_week, slot, teaching_id) VALUES ($1, $2, 1, 2, $3)`,
      [schoolA, groupId, teachingId],
    );
    const lundi = await inA(() => pedagogy.creneauxDuJour(groupId, '2025-11-10', yearId));
    expect(lundi).toHaveLength(1);
    expect(lundi[0]!.creneau).toBe('10h-11h45');
    // A Sunday with nothing placed falls back too.
    const dimanche = await inA(() => pedagogy.creneauxDuJour(groupId, '2025-11-09', yearId));
    expect(dimanche[0]!.creneau).toBe('—');
  });

  it('lists absences without listing the days a child was present', async () => {
    await inA(() =>
      pedagogy.enregistrerAppel(
        { groupId, date: '2025-11-11', academicYearId: yearId, teachingId, statuts: [{ studentId, statut: 'present' }] },
        actor,
      ),
    );
    const absences = (await inA(() => pedagogy.absencesFor(studentId))) as {
      status: string;
    }[];
    expect(absences.every((a) => a.status !== 'present')).toBe(true);
  });
});

/**
 * SUSPENDRE UNE BRANCHE — la ligne 166 du registre, et la seule que l'audit du
 * 2026-09-07 a trouvée réellement absente dans la couche plateforme.
 *
 * ⚠ ET L'ÉCRAN AFFICHAIT DÉJÀ L'ÉTAT. `platform/page.tsx` rend
 * `b.active ? 'active' : 'suspendue'` sur chaque branche, et `schools.active`
 * existe depuis la migration 0001 — mais aucune route ne le changeait. Un état
 * qu'on montre sans pouvoir le poser est pire qu'un état absent : il laisse
 * croire qu'une commande existe quelque part.
 *
 * ⚠ SUSPENDRE N'EST PAS SUPPRIMER. Une branche suspendue garde ses élèves, ses
 * paiements et son historique ; elle cesse seulement d'ouvrir ses portes. C'est
 * réversible par construction, et rien n'en dépend en cascade.
 */
describe('suspendre une branche', () => {
  it('⚠ seul un administrateur plateforme peut le faire', async () => {
    await expect(
      platform.setBranchActive(schoolA, false, branchAdmin),
    ).rejects.toThrow();
  });

  it('suspend, puis réactive', async () => {
    const etat = async () => {
      const { rows } = await owner.query<{ active: boolean }>(
        'SELECT active FROM schools WHERE id = $1',
        [schoolA],
      );
      return rows[0]!.active;
    };
    expect(await etat()).toBe(true);

    await platform.setBranchActive(schoolA, false, platformAdmin);
    expect(await etat()).toBe(false);

    await platform.setBranchActive(schoolA, true, platformAdmin);
    expect(await etat()).toBe(true);
  });

  it('⚠ la suspension ne touche à rien d’autre — c’est une porte, pas une purge', async () => {
    const compte = async (table: string) => {
      const { rows } = await owner.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE school_id = $1`,
        [schoolA],
      );
      return rows[0]!.n;
    };
    const avant = [await compte('students'), await compte('academic_years')];
    await platform.setBranchActive(schoolA, false, platformAdmin);
    expect([await compte('students'), await compte('academic_years')]).toEqual(avant);
    await platform.setBranchActive(schoolA, true, platformAdmin);
  });

  it('le geste est journalisé, avec son auteur', async () => {
    await platform.setBranchActive(schoolA, false, platformAdmin);
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'branch_suspended' AND actor_id = $1`,
      [platformAdmin],
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
    await platform.setBranchActive(schoolA, true, platformAdmin);
  });
});

/**
 * LE TABLEAU DE BORD DE LA PLATEFORME — le cumul de toutes les branches
 * (décision du propriétaire, 2026-09-14) : ce que l'ensemble a encaissé
 * aujourd'hui et dépensé, le mois, l'année. Depuis la caisse (`tender_lines`)
 * de chaque branche, sous RLS, additionné en Decimal.
 */
describe('le tableau de bord de la plateforme', () => {
  beforeAll(async () => {
    const moyen = async (s: string) =>
      (await owner.query<{ id: string }>(`INSERT INTO payment_methods (school_id, name) VALUES ($1, 'Espèces') RETURNING id`, [s])).rows[0]!.id;
    const ligne = (s: string, m: string, direction: string, amount: string, debutAnnee = false) =>
      owner.query(
        `INSERT INTO tender_lines (school_id, payment_method_id, direction, amount, source_type, source_id, created_at)
         VALUES ($1, $2, $3, $4, 'scolarite', uuid_generate_v7(),
                 CASE WHEN $5::boolean THEN date_trunc('year', now()) ELSE now() END)`,
        [s, m, direction, amount, debutAnnee],
      );
    const ma = await moyen(schoolA);
    const mb = await moyen(schoolB);
    await ligne(schoolA, ma, 'in', '1000.50');
    await ligne(schoolB, mb, 'in', '2000.25');
    await ligne(schoolB, mb, 'out', '500.00');
    // Au premier jour de l'année : compte dans l'année, pas dans le mois (sauf en janvier).
    await ligne(schoolA, ma, 'in', '10.00', true);
  });

  it('⚠ additionne aujourd’hui, le mois et l’année de toutes les branches, en centimes exacts', async () => {
    const now = new Date();
    const tb = await platform.tableauBord(platformAdmin, now.getMonth() + 1, now.getFullYear());
    expect(tb.currency).toBe('MRU');
    // La base est partagée par toute la suite : d'autres écoles encaissent
    // aujourd'hui. Le cumul est donc vérifié comme la SOMME EXACTE des branches
    // (en Decimal, au centime), et les deux nôtres à la ligne près.
    const somme = (f: (b: (typeof tb.branches)[number]) => string) =>
      tb.branches.reduce((s, b) => s.plus(f(b)), new Decimal(0)).toFixed(2);
    expect(tb.cumul!.jour.entrees).toBe(somme((b) => b.jour.entrees));
    expect(tb.cumul!.jour.sorties).toBe(somme((b) => b.jour.sorties));
    expect(tb.cumul!.jour.net).toBe(somme((b) => b.jour.net));
    expect(tb.cumul!.annee.entrees).toBe(somme((b) => b.annee.entrees));
    const notres = tb.branches.filter((b) => ['plat-a', 'plat-b'].includes(b.slug));
    expect(notres.map((b) => [b.slug, b.jour.entrees, b.jour.sorties, b.jour.net]).sort()).toEqual([
      ['plat-a', '1000.50', '0.00', '1000.50'],
      ['plat-b', '2000.25', '500.00', '1500.25'],
    ]);
    expect(notres.map((b) => [b.slug, b.annee.entrees]).sort()).toEqual([
      ['plat-a', '1010.50'],
      ['plat-b', '2000.25'],
    ]);
    // Le rapport mensuel de l'année porte douze lignes, celle de ce mois comprise.
    expect(tb.cumul!.parMois).toHaveLength(12);
    const a = notres.find((b) => b.slug === 'plat-a')!;
    expect(a.annee.parMois.find((m) => m.mois === now.getMonth() + 1)!.entrees).toBe(
      now.getMonth() === 0 ? '1010.50' : '1000.50',
    );
  });

  it('est réservé aux administrateurs de la plateforme', async () => {
    await expect(platform.tableauBord(branchAdmin, 1, 2026)).rejects.toThrow(/plateforme/);
  });
});

/**
 * LES ADMINISTRATEURS DE LA PLATEFORME — l'administrateur de toutes les
 * branches en crée d'autres, avec les mêmes privilèges (décision du
 * propriétaire, 2026-09-14).
 */
describe('les administrateurs de la plateforme', () => {
  let cree: string;

  it('crée un administrateur avec les mêmes privilèges, qui devra changer son mot de passe', async () => {
    const r = await platform.createPlatformAdmin(
      { fullName: 'Second Admin', identifier: 'second.admin', password: 'Plateforme-2026' },
      platformAdmin,
    );
    cree = r.id;
    const { rows } = await owner.query<{ is_platform_admin: boolean; must_change_password: boolean; username: string }>(
      'SELECT is_platform_admin, must_change_password, username FROM users WHERE id = $1',
      [cree],
    );
    expect(rows[0]).toMatchObject({ is_platform_admin: true, must_change_password: true, username: 'second.admin' });
    // Et lui-même peut à son tour lire la console.
    await expect(platform.listPlatformAdmins(cree)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ identifier: 'second.admin' })]),
    );
  });

  it('refuse un identifiant pris, un mot de passe faible, et un appelant qui n’est pas de la plateforme', async () => {
    await expect(
      platform.createPlatformAdmin({ fullName: 'Doublon', identifier: 'second.admin', password: 'Plateforme-2026' }, platformAdmin),
    ).rejects.toThrow(/existe déjà/);
    await expect(
      platform.createPlatformAdmin({ fullName: 'Faible', identifier: 'faible.admin', password: 'aaaaaaaa' }, platformAdmin),
    ).rejects.toThrow(/3 types de caractères/);
    await expect(
      platform.createPlatformAdmin({ fullName: 'Intrus', identifier: 'intrus', password: 'Plateforme-2026' }, branchAdmin),
    ).rejects.toThrow(/plateforme/);
  });

  it('désactive un administrateur — jamais soi-même, jamais le dernier actif', async () => {
    await expect(platform.setPlatformAdminActive(platformAdmin, false, platformAdmin)).rejects.toThrow(/propre compte/);
    await platform.setPlatformAdminActive(cree, false, platformAdmin);
    const { rows } = await owner.query<{ active: boolean }>('SELECT active FROM users WHERE id = $1', [cree]);
    expect(rows[0]!.active).toBe(false);
    // Le désactivé ne lit plus rien.
    await expect(platform.listPlatformAdmins(cree)).rejects.toThrow(/plateforme/);
    await platform.setPlatformAdminActive(cree, true, platformAdmin);
    await owner.query('DELETE FROM users WHERE id = $1', [cree]);
  });
});
