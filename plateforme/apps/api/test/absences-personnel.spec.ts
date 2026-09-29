import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PersonnelAbsencesService, JOURS_D_AVANCE } from '../src/personnel/personnel-absences.service.js';
import { runInTenant } from '../src/tenant/tenant.context.js';

/**
 * LES ABSENCES DU PERSONNEL — ADR-0074, migration 0043.
 *
 * « add absence for staff and professors based on their emplois du temps » :
 * un professeur manque une séance de SA grille, un agent une période de SES
 * horaires. Ce fichier tient :
 *
 *   - la journée se lit dans l'emploi du temps, avec la règle d'ADR-0071 (une
 *     case d'une année passée compte si la matière est enseignée cette année,
 *     et c'est alors le professeur de cette année qui est attendu) ;
 *   - on ne déclare absent qu'à une séance / une période qui existe ce jour-là ;
 *   - une séance ne se déclare qu'une fois (idempotent), deux absences d'agent
 *     ne se chevauchent pas ;
 *   - une absence justifiée ne se retire que par la direction ;
 *   - la synthèse du mois compte les heures sans double compte ;
 *   - rien ne passe d'une école à l'autre ; les gardes des routes.
 */

let owner: pg.Pool;
let svc: PersonnelAbsencesService;

const A = { schoolId: '', slug: 'abp-a' };
const B = { schoolId: '', slug: 'abp-b' };
const inA = <T>(fn: () => Promise<T>) => runInTenant(A, fn);
const inB = <T>(fn: () => Promise<T>) => runInTenant(B, fn);

let ACTOR: string;
let T1: string; // Maths, 6ème A et B, créneau 1 du lundi (deux classes au même créneau)
let T2: string; // Français 6ème A (créneau 2), et Arabe 6ème B cette année
let T3: string; // Arabe 6ème B l'an dernier ; Sciences l'an dernier seulement
let G1: string;
let G2: string;
let S1: string; // un agent : lundi 07:30 – 12:00 et 14:00 – 17:00
let S1_MATIN: string;

/** Un lundi (2026-09-28 en est un). */
const LUNDI = '2026-10-05';
const MARDI = '2026-10-06';
const MERCREDI = '2026-10-07';

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  svc = moduleRef.get(PersonnelAbsencesService);

  const { rows: ecoles } = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('abp-a', 'Absences A', 'APA'), ('abp-b', 'Absences B', 'APB')
     RETURNING id`,
  );
  A.schoolId = ecoles[0]!.id;
  B.schoolId = ecoles[1]!.id;
  ACTOR = (await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('abp.dir@test', 'x', 'Direction') RETURNING id`,
  )).rows[0]!.id;

  const one = async (sql: string, params: unknown[]) => (await owner.query<{ id: string }>(sql, params)).rows[0]!.id;
  const s = A.schoolId;
  const passee = await one(
    `INSERT INTO academic_years (school_id, label, start_year, status, closed_at) VALUES ($1, '2024-2025', 2024, 'closed', '2025-07-01') RETURNING id`,
    [s],
  );
  const annee = await one(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2025-2026', 2025, 'active') RETURNING id`,
    [s],
  );
  // Une année à venir, déjà créée (la situation réelle de septembre) : elle ne
  // doit rien prendre à l'année ouverte.
  await one(
    `INSERT INTO academic_years (school_id, label, start_year, status) VALUES ($1, '2026-2027', 2026, 'future') RETURNING id`,
    [s],
  );
  const niveau = await one(`INSERT INTO levels (school_id, name, monthly_rate) VALUES ($1, '6ème', 1000) RETURNING id`, [s]);
  G1 = await one(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6ème A') RETURNING id`, [s, niveau]);
  G2 = await one(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, '6ème B') RETURNING id`, [s, niveau]);
  const matiere = (nom: string) =>
    one(`INSERT INTO subjects (school_id, level_id, name) VALUES ($1, $2, $3) RETURNING id`, [s, niveau, nom]);
  const maths = await matiere('Mathématiques');
  const francais = await matiere('Français');
  const arabe = await matiere('Arabe');
  const sciences = await matiere('Sciences');
  const prof = (prenom: string) =>
    one(`INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, $2, 'Prof') RETURNING id`, [s, prenom]);
  T1 = await prof('Ahmed');
  T2 = await prof('Fatimetou');
  T3 = await prof('Brahim');
  const ens = (year: string, t: string, g: string, m: string) =>
    one(
      `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id, hours_per_week)
       VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
      [s, year, t, g, m],
    );
  const case_ = (g: string, t: string, jour: number, slot: number) =>
    owner.query(
      `INSERT INTO timetable_slots (school_id, group_id, teaching_id, day_of_week, slot) VALUES ($1, $2, $3, $4, $5)`,
      [s, g, t, jour, slot],
    );
  await case_(G1, await ens(annee, T1, G1, maths), 1, 1);
  await case_(G2, await ens(annee, T1, G2, maths), 1, 1);
  await case_(G1, await ens(annee, T2, G1, francais), 1, 2);
  // Une case posée l'an dernier (T3), la matière enseignée cette année par T2.
  const arabeAncien = await ens(passee, T3, G2, arabe);
  await ens(annee, T2, G2, arabe);
  await case_(G2, arabeAncien, 1, 3);
  // Une case d'une matière qui n'est plus enseignée : aucune séance.
  await case_(G2, await ens(passee, T3, G2, sciences), 2, 1);

  S1 = await one(
    `INSERT INTO staff (school_id, first_name, last_name, role_title) VALUES ($1, 'Mariem', 'Agent', 'Surveillante') RETURNING id`,
    [s],
  );
  S1_MATIN = await one(
    `INSERT INTO staff_work_hours (school_id, staff_id, day_of_week, starts_at, ends_at) VALUES ($1, $2, 1, '07:30', '12:00') RETURNING id`,
    [s, S1],
  );
  await owner.query(
    `INSERT INTO staff_work_hours (school_id, staff_id, day_of_week, starts_at, ends_at) VALUES ($1, $2, 1, '14:00', '17:00')`,
    [s, S1],
  );
  // Un agent actif sans horaires : la journée doit le signaler.
  await owner.query(
    `INSERT INTO staff (school_id, first_name, last_name, role_title) VALUES ($1, 'Sidi', 'Sanshoraire', 'Gardien')`,
    [s],
  );
});

afterAll(async () => {
  await owner?.query('DELETE FROM schools WHERE id = ANY($1)', [[A.schoolId, B.schoolId]]);
  await owner?.query(`DELETE FROM users WHERE email = 'abp.dir@test'`);
  await owner?.end();
});

describe('la journée se lit dans l’emploi du temps', () => {
  it('le lundi : chaque professeur et ses séances, l’agent et ses périodes', async () => {
    const j = await inA(() => svc.journee(LUNDI));
    expect(j.jour).toBe(1);
    expect(j.libelleJour).toBe('Lundi');
    // ⚠ L'année ouverte, pas l'année à venir dont la période commence en juillet.
    expect(j.annee?.label).toBe('2025-2026');
    const parProf = Object.fromEntries(
      j.professeurs.map((p) => [p.teacherId, p.seances.map((x) => `${x.creneau} ${x.groupe} ${x.matiere}`)]),
    );
    expect(parProf[T1]).toEqual(['8h-9h45 6ème A Mathématiques', '8h-9h45 6ème B Mathématiques']);
    // ⚠ La case posée l'an dernier pour T3 revient à T2, qui enseigne l'arabe cette année.
    expect(parProf[T2]).toEqual(['10h-11h45 6ème A Français', '12h-14h 6ème B Arabe']);
    expect(parProf[T3]).toBeUndefined();
    const agent = j.agents.find((a) => a.staffId === S1)!;
    expect(agent.periodes.map((p) => `${p.debut}-${p.fin} ${p.minutes}`)).toEqual(['07:30-12:00 270', '14:00-17:00 180']);
    expect(j.agentsSansHoraires.map((a) => a.nom)).toEqual(['Sidi Sanshoraire']);
  });

  it('le mardi : la case d’une matière qui n’est plus enseignée ne donne aucune séance', async () => {
    const j = await inA(() => svc.journee(MARDI));
    expect(j.professeurs).toEqual([]);
    expect(j.agents).toEqual([]);
  });
});

describe('déclarer un professeur absent', () => {
  it('à une séance de sa grille : la durée du créneau, le libellé de la classe', async () => {
    const r = await inA(() => svc.declarerProfesseur({ date: LUNDI, teacherId: T2, seances: [{ slot: 2, groupId: G1 }] }, ACTOR));
    expect(r).toMatchObject({ creees: 1, dejaDeclarees: 0 });
    const { rows } = await owner.query('SELECT minutes, label, starts_at::text, ends_at::text FROM personnel_absences WHERE id = $1', [r.ids[0]]);
    expect(rows[0]).toEqual({ minutes: 105, label: '6ème A — Français', starts_at: '10:00:00', ends_at: '11:45:00' });
  });

  it('une seconde fois : rien de recréé (idempotent)', async () => {
    const r = await inA(() => svc.declarerProfesseur({ date: LUNDI, teacherId: T2, seances: [{ slot: 2, groupId: G1 }] }, ACTOR));
    expect(r).toMatchObject({ creees: 0, dejaDeclarees: 1 });
  });

  it('refuse une séance qui n’est pas la sienne ce jour-là', async () => {
    await expect(
      inA(() => svc.declarerProfesseur({ date: LUNDI, teacherId: T2, seances: [{ slot: 1, groupId: G1 }] }, ACTOR)),
    ).rejects.toThrow(/n'est pas dans l'emploi du temps de Fatimetou Prof/);
  });

  it('refuse un jour sans séance, et l’ancien professeur d’une case reprise', async () => {
    await expect(inA(() => svc.declarerProfesseur({ date: MERCREDI, teacherId: T1, touteLaJournee: true }, ACTOR))).rejects.toThrow(
      /aucune séance le mercredi/,
    );
    await expect(inA(() => svc.declarerProfesseur({ date: LUNDI, teacherId: T3, touteLaJournee: true }, ACTOR))).rejects.toThrow(
      /aucune séance le lundi/,
    );
  });

  it('toute la journée : chacune de ses séances', async () => {
    const r = await inA(() => svc.declarerProfesseur({ date: LUNDI, teacherId: T1, touteLaJournee: true, reason: 'Malade' }, ACTOR));
    expect(r.creees).toBe(2);
    const j = await inA(() => svc.journee(LUNDI));
    const seances = j.professeurs.find((p) => p.teacherId === T1)!.seances;
    expect(seances.every((x) => x.absence?.reason === 'Malade' && !x.absence.justified)).toBe(true);
  });

  it(`refuse plus de ${JOURS_D_AVANCE} jours à l’avance, et une date qui n’existe pas`, async () => {
    const loin = new Date(Date.now() + (JOURS_D_AVANCE + 7) * 86_400_000).toISOString().slice(0, 10);
    await expect(inA(() => svc.declarerProfesseur({ date: loin, teacherId: T1, touteLaJournee: true }, ACTOR))).rejects.toThrow(
      /à l'avance/,
    );
    await expect(inA(() => svc.journee('2026-02-30'))).rejects.toThrow(/Date invalide/);
  });
});

describe('déclarer un agent absent', () => {
  it('refuse un jour où il ne travaille pas', async () => {
    await expect(inA(() => svc.declarerAgent({ date: MARDI, staffId: S1, touteLaJournee: true }, ACTOR))).rejects.toThrow(
      /ne travaille pas le mardi/,
    );
  });

  it('en partie : arrivé à 10:00 au lieu de 07:30', async () => {
    const r = await inA(() =>
      svc.declarerAgent({ date: LUNDI, staffId: S1, periodes: [{ workHoursId: S1_MATIN, debut: '07:30', fin: '10:00' }] }, ACTOR),
    );
    expect(r.creees).toBe(1);
    const { rows } = await owner.query('SELECT minutes, label FROM personnel_absences WHERE id = $1', [r.ids[0]]);
    expect(rows[0]).toEqual({ minutes: 150, label: 'Surveillante' });
  });

  it('refuse ce qui sort de la période, et ce qui chevauche une absence déjà déclarée', async () => {
    await expect(
      inA(() => svc.declarerAgent({ date: LUNDI, staffId: S1, periodes: [{ workHoursId: S1_MATIN, debut: '07:00', fin: '08:00' }] }, ACTOR)),
    ).rejects.toThrow(/sort de la période de travail 07:30 – 12:00/);
    await expect(
      inA(() => svc.declarerAgent({ date: LUNDI, staffId: S1, periodes: [{ workHoursId: S1_MATIN, debut: '09:00', fin: '11:00' }] }, ACTOR)),
    ).rejects.toThrow(/déjà déclaré absent de 07:30 à 10:00/);
  });

  it('la journée montre l’absence dans sa période', async () => {
    const j = await inA(() => svc.journee(LUNDI));
    const matin = j.agents.find((a) => a.staffId === S1)!.periodes[0]!;
    expect(matin.absences.map((a) => `${a.debut}-${a.fin} ${a.minutes}`)).toEqual(['07:30-10:00 150']);
  });
});

describe('justifier, retirer', () => {
  it('une absence justifiée ne se retire que par la direction', async () => {
    const { ids } = await inA(() => svc.declarerProfesseur({ date: LUNDI, teacherId: T2, seances: [{ slot: 3, groupId: G2 }] }, ACTOR));
    await inA(() => svc.justifier(ids[0]!, { justified: true, reason: 'Convocation' }, ACTOR));
    const { rows } = await owner.query('SELECT justified, reason, justified_by FROM personnel_absences WHERE id = $1', [ids[0]]);
    expect(rows[0]).toEqual({ justified: true, reason: 'Convocation', justified_by: ACTOR });
    await expect(inA(() => svc.retirer(ids[0]!, ACTOR, ['collecteur_absence']))).rejects.toThrow(/seule la direction/);
    await inA(() => svc.retirer(ids[0]!, ACTOR, ['admin']));
    const apres = await owner.query('SELECT 1 FROM personnel_absences WHERE id = $1', [ids[0]]);
    expect(apres.rowCount).toBe(0);
  });

  it('une absence non justifiée se retire (erreur de saisie), et c’est journalisé', async () => {
    const { ids } = await inA(() => svc.declarerProfesseur({ date: LUNDI, teacherId: T2, seances: [{ slot: 3, groupId: G2 }] }, ACTOR));
    await inA(() => svc.retirer(ids[0]!, ACTOR, ['collecteur_absence']));
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'personnel.absence.retirer' AND entity_id = $1`,
      [ids[0]],
    );
    expect(rows[0]!.n).toBe(1);
  });
});

describe('la synthèse du mois', () => {
  it('compte séances et heures, sans compter deux fois un créneau tenu dans deux classes', async () => {
    const { lignes } = await inA(() => svc.synthese(10, 2026));
    const t1 = lignes.find((l) => l.personId === T1)!;
    // Deux séances manquées (6ème A et B au créneau 1), 105 minutes, pas 210.
    expect(t1).toMatchObject({ kind: 'teacher', absences: 2, minutes: 105, justifiees: 0, sansDuree: 0 });
    const t2 = lignes.find((l) => l.personId === T2)!;
    expect(t2).toMatchObject({ absences: 1, minutes: 105 });
    const s1 = lignes.find((l) => l.personId === S1)!;
    expect(s1).toMatchObject({ kind: 'staff', fonction: 'Surveillante', absences: 1, minutes: 150 });
    // Un autre mois : rien.
    expect((await inA(() => svc.synthese(11, 2026))).lignes).toEqual([]);
  });
});

describe('les horaires des agents', () => {
  it('refusent un chevauchement dans un jour et une fin avant le début', async () => {
    await expect(
      inA(() => svc.definirHoraires(S1, [{ jour: 1, debut: '07:30', fin: '12:00' }, { jour: 1, debut: '11:00', fin: '15:00' }], ACTOR)),
    ).rejects.toThrow(/se chevauchent/);
    await expect(inA(() => svc.definirHoraires(S1, [{ jour: 2, debut: '12:00', fin: '08:00' }], ACTOR))).rejects.toThrow(
      /doit suivre le début/,
    );
  });

  it('se remplacent d’un bloc ; les absences déjà déclarées gardent leurs heures', async () => {
    await inA(() => svc.definirHoraires(S1, [{ jour: 2, debut: '08:00', fin: '16:00' }], ACTOR));
    const h = await inA(() => svc.horaires());
    expect(h.find((x) => x.staffId === S1)!.periodes).toEqual([{ jour: 2, debut: '08:00', fin: '16:00' }]);
    // Le lundi n'est plus travaillé, mais l'absence du 5 octobre reste lisible.
    const j = await inA(() => svc.journee(LUNDI));
    const ag = j.agents.find((a) => a.staffId === S1)!;
    expect(ag.periodes).toMatchObject([{ workHoursId: null, debut: '07:30', fin: '10:00' }]);
  });
});

describe('isolation', () => {
  it('une autre école ne voit rien et ne peut déclarer personne de A', async () => {
    const j = await inB(() => svc.journee(LUNDI));
    expect(j.professeurs).toEqual([]);
    expect(j.agents).toEqual([]);
    expect((await inB(() => svc.synthese(10, 2026))).lignes).toEqual([]);
    await expect(inB(() => svc.declarerProfesseur({ date: LUNDI, teacherId: T1, touteLaJournee: true }, ACTOR))).rejects.toThrow();
    await expect(inB(() => svc.declarerAgent({ date: MARDI, staffId: S1, touteLaJournee: true }, ACTOR))).rejects.toThrow(
      /Agent introuvable/,
    );
    await expect(inB(() => svc.definirHoraires(S1, [], ACTOR))).rejects.toThrow(/Agent introuvable/);
  });
});

describe('les gardes des routes', () => {
  const ici = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(ici, '..', 'src', 'personnel', 'personnel-absences.controller.ts'), 'utf8');
  const garde = (route: string) => {
    const i = source.indexOf(route);
    expect(i, route).toBeGreaterThan(-1);
    // Les décorateurs d'une route suivent sa ligne, avant sa méthode.
    return source.slice(i, source.indexOf('(@', i));
  };

  it('un professeur (absences.consulter seulement) ne lit rien', () => {
    for (const r of ["@Get('absences/journee')", "@Get('absences/synthese')", "@Get('absences')"]) {
      expect(garde(r)).toContain("@RequirePermission('absences.saisir', 'finance.salaires')");
    }
  });

  it('justifier : la direction', () => {
    expect(garde("@Post('absences/:id/justifier')")).toContain("@RequireRole('super_admin', 'admin')");
  });

  it('fixer les horaires : qui embauche (comptes.staff)', () => {
    expect(garde("@Put('horaires/:staffId')")).toContain("@RequirePermission('comptes.staff')");
  });
});
