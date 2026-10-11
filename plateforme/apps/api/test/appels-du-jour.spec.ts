import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { Queryable } from '@elourwa/db';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { hashPassword } from '../src/auth/passwords.js';
import { DbService } from '../src/db/db.service.js';

/**
 * LES APPELS DU JOUR — `GET /attendance/jour` (demande du propriétaire,
 * 07/10/2026 : « roll call is per lesson; it should fetch the emploi du temps
 * and call each class »).
 *
 * Le tableau de bord du collecteur d'absence : pour une date, TOUTES les
 * classes de l'année, leurs cours du jour lus dans l'emploi du temps, dans
 * l'ordre des créneaux, et pour chaque cours si l'appel est fait (présents,
 * absents, retards, par qui, quand) ou reste à faire.
 *
 * Deux écoles, des personnes inventées. Ce que ce fichier tient :
 *   - une école ne voit jamais les classes ni les appels de l'autre ;
 *   - deux cours de la même classe le même jour gardent chacun leur appel ;
 *   - un absent est signalé à sa famille comme le fait déjà la feuille ;
 *   - une inscription annulée n'est comptée nulle part ;
 *   - le nombre de requêtes ne dépend pas du nombre de classes.
 */

const MERCREDI = '2026-03-11'; // un mercredi de l'année 2025-2026
const MERCREDI_RENTREE = '2026-11-04'; // un mercredi de l'année 2026-2027
const PASSWORD = 'Appels-du-jour-2026';

let app: NestFastifyApplication;
let owner: pg.Pool;

interface Ecole {
  slug: string;
  schoolId: string;
  annee: string;
  niveau: string;
  classes: Record<string, string>;
  matieres: Record<string, string>;
  profs: Record<string, string>;
  enseignements: Record<string, string>;
  eleves: Record<string, string>;
  familles: Record<string, string>;
  jetons: Record<string, string>;
}

const nour = { slug: 'jour-nour' } as Ecole;
const rissala = { slug: 'jour-rissala' } as Ecole;
let annee2627: string;

const q = async (sql: string, params: unknown[] = []) =>
  (await owner.query<{ id: string }>(sql, params)).rows[0]!.id;

const entetes = (ecole: Ecole, jeton: string) => ({ authorization: `Bearer ${jeton}`, 'x-school-slug': ecole.slug });

interface Etat {
  fait: boolean;
  presents: number;
  absents: number;
  retards: number;
  par: string | null;
  le: string | null;
  le_local: string | null;
}
interface Cours extends Etat {
  rang: number;
  creneau: string;
  debut: string | null;
  fin: string | null;
  enseignement_id: string;
  matiere_nom: string;
  prof_prenom: string | null;
  prof_nom: string | null;
}
interface Classe {
  groupe_id: string;
  groupe_nom: string;
  niveau_id: string | null;
  niveau_nom: string | null;
  inscrits: number;
  cours: Cours[];
  journee: Etat;
  hors_grille: (Etat & { enseignement_id: string; matiere_nom: string | null })[];
}
interface Tableau {
  date: string;
  annee: { id: string; label: string };
  periode: [string, string];
  hors_annee: boolean;
  grille_vide: boolean;
  total: number;
  faits: number;
  classes: Classe[];
}

const jour = (ecole: Ecole, jeton: string, date: string, annee: string) =>
  app.inject({
    method: 'GET',
    url: `/attendance/jour?date=${date}&academicYearId=${annee}`,
    headers: entetes(ecole, jeton),
  });

const tableau = async (ecole: Ecole, date = MERCREDI, annee = ecole.annee): Promise<Tableau> => {
  const r = await jour(ecole, ecole.jetons.collecteur!, date, annee);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Tableau;
};

const classe = (t: Tableau, id: string) => t.classes.find((c) => c.groupe_id === id)!;

const appeler = (
  ecole: Ecole,
  groupe: string,
  enseignement: string | null,
  statuts: Record<string, 'present' | 'absent' | 'retard'>,
  date = MERCREDI,
) =>
  app.inject({
    method: 'POST',
    url: '/attendance/appel',
    headers: entetes(ecole, ecole.jetons.collecteur!),
    payload: {
      groupId: groupe,
      date,
      academicYearId: ecole.annee,
      teachingId: enseignement,
      statuts: Object.entries(statuts).map(([nom, statut]) => ({ studentId: ecole.eleves[nom]!, statut })),
    },
  });

/** Une école : un niveau, ses classes, ses matières, ses professeurs. */
async function fonder(ecole: Ecole, nom: string, prefixe: string): Promise<void> {
  ecole.schoolId = await q(`INSERT INTO schools (slug, name, receipt_prefix) VALUES ($1, $2, $3) RETURNING id`, [
    ecole.slug,
    nom,
    prefixe,
  ]);
  ecole.annee = await q(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, '2025-2026', 2025, 10, 6, 'active') RETURNING id`,
    [ecole.schoolId],
  );
  ecole.niveau = await q(
    `INSERT INTO levels (school_id, name, monthly_rate, cycle) VALUES ($1, '5eme', 5000, 'college') RETURNING id`,
    [ecole.schoolId],
  );
  ecole.classes = {};
  ecole.matieres = {};
  ecole.profs = {};
  ecole.enseignements = {};
  ecole.eleves = {};
  ecole.familles = {};
  ecole.jetons = {};
}

const creerClasse = async (ecole: Ecole, nom: string) => {
  ecole.classes[nom] = await q(`INSERT INTO groups (school_id, level_id, name) VALUES ($1, $2, $3) RETURNING id`, [
    ecole.schoolId,
    ecole.niveau,
    nom,
  ]);
};
const creerMatiere = async (ecole: Ecole, nom: string) => {
  ecole.matieres[nom] = await q(`INSERT INTO subjects (school_id, level_id, name) VALUES ($1, $2, $3) RETURNING id`, [
    ecole.schoolId,
    ecole.niveau,
    nom,
  ]);
};
const creerProf = async (ecole: Ecole, prenom: string, nom: string) => {
  ecole.profs[nom] = await q(
    `INSERT INTO teachers (school_id, first_name, last_name) VALUES ($1, $2, $3) RETURNING id`,
    [ecole.schoolId, prenom, nom],
  );
};
const enseigner = async (ecole: Ecole, cle: string, annee: string, prof: string, cl: string, matiere: string) => {
  ecole.enseignements[cle] = await q(
    `INSERT INTO teachings (school_id, academic_year_id, teacher_id, group_id, subject_id, hours_per_week)
     VALUES ($1, $2, $3, $4, $5, 4) RETURNING id`,
    [ecole.schoolId, annee, ecole.profs[prof], ecole.classes[cl], ecole.matieres[matiere]],
  );
};
const placer = (ecole: Ecole, cl: string, enseignement: string, jourSemaine: number, creneau: number) =>
  owner.query(
    `INSERT INTO timetable_slots (school_id, group_id, teaching_id, day_of_week, slot) VALUES ($1, $2, $3, $4, $5)`,
    [ecole.schoolId, ecole.classes[cl], ecole.enseignements[enseignement], jourSemaine, creneau],
  );
let rim = 0;
const inscrire = async (
  ecole: Ecole,
  prenom: string,
  cl: string,
  options: { famille?: boolean; statut?: string; annee?: string } = {},
) => {
  rim += 1;
  if (options.famille) {
    ecole.familles[prenom] = await q(
      `INSERT INTO users (phone, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
      [`+2224199${String(rim).padStart(4, '0')}`, `Famille de ${prenom}`],
    );
  }
  ecole.eleves[prenom] ??= await q(
    `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, 'Inventé') RETURNING id`,
    [ecole.schoolId, ecole.familles[prenom] ?? null, `RIM-JOUR-${rim}`, `NID-JOUR-${rim}`, prenom],
  );
  await owner.query(
    `INSERT INTO enrollments (school_id, student_id, academic_year_id, group_id, level_id, status, monthly_fee)
     VALUES ($1, $2, $3, $4, $5, $6, 5000)`,
    [ecole.schoolId, ecole.eleves[prenom], options.annee ?? ecole.annee, ecole.classes[cl], ecole.niveau, options.statut ?? 'enrolled'],
  );
};

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });

  // ── École Nour : trois classes de l'année, une quatrième oubliée ──────────
  await fonder(nour, 'École Nour (appels du jour)', 'JRN');
  for (const nom of ['5eme A', '5eme B', '5eme C', '5eme Ancienne']) await creerClasse(nour, nom);
  for (const nom of ['Maths', 'Arabe', 'Dessin']) await creerMatiere(nour, nom);
  await creerProf(nour, 'Sidi', 'Premier');
  await creerProf(nour, 'Mariem', 'Seconde');
  await enseigner(nour, 'A-maths', nour.annee, 'Premier', '5eme A', 'Maths');
  await enseigner(nour, 'A-arabe', nour.annee, 'Seconde', '5eme A', 'Arabe');
  await enseigner(nour, 'B-maths', nour.annee, 'Premier', '5eme B', 'Maths');
  await enseigner(nour, 'C-dessin', nour.annee, 'Seconde', '5eme C', 'Dessin');
  // Le mercredi (3) : la 5eme A a Arabe en 2e heure et Maths en 1re — placés
  // dans le désordre, le tableau les rend dans l'ordre des créneaux ; la
  // 5eme B a Maths en 2e heure ; la 5eme C n'a cours que le lundi.
  await placer(nour, '5eme A', 'A-arabe', 3, 2);
  await placer(nour, '5eme A', 'A-maths', 3, 1);
  await placer(nour, '5eme B', 'B-maths', 3, 2);
  await placer(nour, '5eme C', 'C-dessin', 1, 1);

  await inscrire(nour, 'Aïcha', '5eme A', { famille: true });
  await inscrire(nour, 'Brahim', '5eme A', { famille: true });
  await inscrire(nour, 'Cheikh', '5eme A');
  await inscrire(nour, 'Annulée', '5eme A', { statut: 'cancelled' });
  await inscrire(nour, 'Dah', '5eme B');
  await inscrire(nour, 'Emma', '5eme B');
  await inscrire(nour, 'Fatou', '5eme C');

  // Une année suivante, créée et pas encore ouverte : aucune affectation.
  annee2627 = await q(
    `INSERT INTO academic_years (school_id, label, start_year, start_month, end_month, status)
     VALUES ($1, '2026-2027', 2026, 10, 6, 'future') RETURNING id`,
    [nour.schoolId],
  );
  await inscrire(nour, 'Cheikh', '5eme A', { annee: annee2627 });

  // ── École Rissala : une classe DU MÊME NOM, un cours le même mercredi ─────
  await fonder(rissala, 'École Rissala (appels du jour)', 'JRR');
  await creerClasse(rissala, '5eme A');
  await creerMatiere(rissala, 'Maths');
  await creerProf(rissala, 'Autre', 'École');
  await enseigner(rissala, 'A-maths', rissala.annee, 'École', '5eme A', 'Maths');
  await placer(rissala, '5eme A', 'A-maths', 3, 1);
  await inscrire(rissala, 'Zeinab', '5eme A');
  await inscrire(rissala, 'Yahya', '5eme A');
  // Son appel du mercredi, écrit directement : deux absents.
  await owner.query(
    `INSERT INTO attendance (school_id, student_id, teaching_id, on_date, status)
     VALUES ($1, $2, $4, $5, 'absent'), ($1, $3, $4, $5, 'absent')`,
    [rissala.schoolId, rissala.eleves.Zeinab, rissala.eleves.Yahya, rissala.enseignements['A-maths'], MERCREDI],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // Le collecteur d'absence (ses deux permissions de la graine), un professeur
  // (il consulte), et un compte qui ne tient aucune des deux.
  const roles: Record<string, string[]> = {
    jour_collecteur: ['absences.consulter', 'absences.saisir'],
    jour_professeur: ['absences.consulter', 'notes.consulter'],
    jour_sans: ['notes.saisir'],
  };
  for (const [code, perms] of Object.entries(roles)) {
    const roleId = await q(`INSERT INTO roles (code, label, is_system) VALUES ($1, $1, true) RETURNING id`, [code]);
    for (const p of perms) await owner.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [roleId, p]);
  }
  const hash = await hashPassword(PASSWORD);
  const auth = app.get(AuthService);
  const compte = async (ecole: Ecole, cle: string, email: string, nom: string, role: string) => {
    const id = await q('INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id', [email, hash, nom]);
    await owner.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id) SELECT $1, $2, id FROM roles WHERE code = $3`,
      [id, ecole.schoolId, role],
    );
    const { accessToken } = await auth.login(email, PASSWORD, ecole.slug, { ip: '10.0.0.91', userAgent: 'vitest' });
    ecole.jetons[cle] = accessToken;
  };
  await compte(nour, 'collecteur', 'jour.collecteur@nour.test', 'Collecteur Nour', 'jour_collecteur');
  await compte(nour, 'professeur', 'jour.professeur@nour.test', 'Professeur Nour', 'jour_professeur');
  await compte(nour, 'sans', 'jour.sans@nour.test', 'Sans Permission', 'jour_sans');
  await compte(rissala, 'collecteur', 'jour.collecteur@rissala.test', 'Collecteur Rissala', 'jour_collecteur');
}, 180_000);

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

describe('le tableau du jour, avant tout appel', () => {
  it('liste chaque classe de l’année avec ses cours du jour, dans l’ordre des créneaux', async () => {
    const t = await tableau(nour);
    expect(t.date).toBe(MERCREDI);
    expect(t.annee).toEqual({ id: nour.annee, label: '2025-2026' });
    expect(t.hors_annee).toBe(false);
    expect(t.grille_vide).toBe(false);
    // La « 5eme Ancienne » n'a ni élève ni matière cette année : elle n'est pas de l'année.
    expect(t.classes.map((c) => c.groupe_nom)).toEqual(['5eme A', '5eme B', '5eme C']);

    const a = classe(t, nour.classes['5eme A']!);
    expect(a.niveau_nom).toBe('5eme');
    expect(a.cours.map((c) => [c.rang, c.creneau, c.debut, c.fin, c.matiere_nom, c.prof_prenom, c.prof_nom, c.enseignement_id])).toEqual([
      [1, '8h-9h45', '08:00', '09:45', 'Maths', 'Sidi', 'Premier', nour.enseignements['A-maths']],
      [2, '10h-11h45', '10:00', '11:45', 'Arabe', 'Mariem', 'Seconde', nour.enseignements['A-arabe']],
    ]);
    for (const c of a.cours) {
      expect(c).toMatchObject({ fait: false, presents: 0, absents: 0, retards: 0, par: null, le: null, le_local: null });
    }
    expect(classe(t, nour.classes['5eme B']!).cours.map((c) => [c.creneau, c.matiere_nom])).toEqual([['10h-11h45', 'Maths']]);
  });

  it('une classe sans cours ce jour-là est listée, sans cours, avec son appel de la journée à faire', async () => {
    const c = classe(await tableau(nour), nour.classes['5eme C']!);
    expect(c.cours).toEqual([]);
    expect(c.inscrits).toBe(1);
    expect(c.journee).toMatchObject({ fait: false, presents: 0, absents: 0, retards: 0 });
    expect(c.hors_grille).toEqual([]);
  });

  it('⚠ une inscription annulée n’est pas comptée parmi les inscrits', async () => {
    const t = await tableau(nour);
    expect(classe(t, nour.classes['5eme A']!).inscrits).toBe(3);
    expect(classe(t, nour.classes['5eme B']!).inscrits).toBe(2);
  });

  it('la ligne de progression : trois cours ce mercredi, aucun appelé', async () => {
    const t = await tableau(nour);
    expect([t.faits, t.total]).toEqual([0, 3]);
  });

  it('⚠ désigne les mêmes enseignements que la liste « Créneau / Matière » de la feuille', async () => {
    // Le lien du tableau ouvre la feuille existante ; elle ne retient un
    // enseignement que s'il est dans SA liste du jour.
    const t = await tableau(nour);
    for (const c of t.classes.filter((x) => x.cours.length > 0)) {
      const r = await app.inject({
        method: 'GET',
        url: `/attendance/creneaux?groupId=${c.groupe_id}&date=${MERCREDI}&academicYearId=${nour.annee}`,
        headers: entetes(nour, nour.jetons.collecteur!),
      });
      const liste = r.json() as { creneau: string; enseignement_id: string; matiere_nom: string }[];
      expect(c.cours.map((x) => [x.creneau, x.enseignement_id, x.matiere_nom])).toEqual(
        liste.map((x) => [x.creneau, x.enseignement_id, x.matiere_nom]),
      );
    }
  });
});

describe('cours après cours : chaque appel reste', () => {
  it('le premier cours appelé est marqué fait, avec ses comptes, par qui et quand', async () => {
    const r = await appeler(nour, nour.classes['5eme A']!, nour.enseignements['A-maths']!, {
      Aïcha: 'absent',
      Brahim: 'retard',
      Cheikh: 'present',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toEqual({ nbAbs: 2 });

    const t = await tableau(nour);
    const [maths, arabe] = classe(t, nour.classes['5eme A']!).cours;
    expect(maths).toMatchObject({ fait: true, presents: 1, absents: 1, retards: 1, par: 'Collecteur Nour' });
    expect(maths!.le).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(maths!.le_local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(arabe).toMatchObject({ fait: false, presents: 0, absents: 0, retards: 0, par: null });
    expect([t.faits, t.total]).toEqual([1, 3]);
  });

  it('⚠ le deuxième cours de la même classe, le même jour, n’efface pas le premier', async () => {
    const r = await appeler(nour, nour.classes['5eme A']!, nour.enseignements['A-arabe']!, {
      Aïcha: 'present',
      Brahim: 'absent',
      Cheikh: 'present',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toEqual({ nbAbs: 1 });

    const t = await tableau(nour);
    const [maths, arabe] = classe(t, nour.classes['5eme A']!).cours;
    expect(maths).toMatchObject({ fait: true, presents: 1, absents: 1, retards: 1 });
    expect(arabe).toMatchObject({ fait: true, presents: 2, absents: 1, retards: 0 });
    expect([t.faits, t.total]).toEqual([2, 3]);

    // Six lignes : trois élèves, deux cours.
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM attendance WHERE school_id = $1 AND on_date = $2`,
      [nour.schoolId, MERCREDI],
    );
    expect(rows[0]!.n).toBe('6');
    // Et la feuille de chaque cours relit le sien.
    const feuille = async (enseignement: string) =>
      (
        (
          await app.inject({
            method: 'GET',
            url: `/attendance/appel?groupId=${nour.classes['5eme A']}&date=${MERCREDI}&academicYearId=${nour.annee}&teachingId=${enseignement}`,
            headers: entetes(nour, nour.jetons.collecteur!),
          })
        ).json() as { etudiants: { prenom: string; statut: string | null }[] }
      ).etudiants.map((e) => [e.prenom, e.statut]);
    expect(await feuille(nour.enseignements['A-maths']!)).toEqual([['Aïcha', 'absent'], ['Brahim', 'late'], ['Cheikh', 'present']]);
    expect(await feuille(nour.enseignements['A-arabe']!)).toEqual([['Aïcha', 'present'], ['Brahim', 'absent'], ['Cheikh', 'present']]);
  });

  it('refaire l’appel d’un cours le remplace, sans toucher à l’autre', async () => {
    const r = await appeler(nour, nour.classes['5eme A']!, nour.enseignements['A-maths']!, {
      Aïcha: 'absent',
      Brahim: 'present',
      Cheikh: 'present',
    });
    expect(r.statusCode, r.body).toBe(201);
    const [maths, arabe] = classe(await tableau(nour), nour.classes['5eme A']!).cours;
    expect(maths).toMatchObject({ fait: true, presents: 2, absents: 1, retards: 0 });
    expect(arabe).toMatchObject({ fait: true, presents: 2, absents: 1, retards: 0 });
  });

  it('la famille de l’absent est prévenue comme la feuille le fait déjà : une notification par absence ou retard saisi', async () => {
    const fil = async (prenom: string) =>
      (
        await owner.query<{ i18n_key: string; kind: string; i18n_params: { eleve: string; date: string }; academic_year_id: string }>(
          `SELECT i18n_key, kind, i18n_params, academic_year_id FROM notifications
            WHERE school_id = $1 AND guardian_id = $2 ORDER BY created_at, id`,
          [nour.schoolId, nour.familles[prenom]],
        )
      ).rows;

    // Aïcha : absente en Maths (1er appel), présente en Arabe, absente en Maths (appel refait).
    const aicha = await fil('Aïcha');
    expect(aicha.map((n) => n.i18n_key)).toEqual(['notif_absence', 'notif_absence']);
    expect(aicha[0]).toMatchObject({
      kind: 'absence',
      i18n_params: { eleve: 'Aïcha Inventé', date: '11/03/2026' },
      academic_year_id: nour.annee,
    });
    // Brahim : en retard en Maths, absent en Arabe, présent à l'appel refait.
    expect((await fil('Brahim')).map((n) => n.i18n_key)).toEqual(['notif_retard', 'notif_absence']);
    // Une poussée par notification, dans la même transaction.
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM outbound_push WHERE user_id = ANY($1::uuid[])`,
      [[nour.familles.Aïcha, nour.familles.Brahim]],
    );
    expect(rows[0]!.n).toBe('4');
  });

  it('⚠ une ligne d’appel d’un élève à l’inscription annulée n’entre dans aucun compte', async () => {
    await owner.query(
      `INSERT INTO attendance (school_id, student_id, teaching_id, on_date, status) VALUES ($1, $2, $3, $4, 'absent')`,
      [nour.schoolId, nour.eleves.Annulée, nour.enseignements['A-maths'], MERCREDI],
    );
    const a = classe(await tableau(nour), nour.classes['5eme A']!);
    expect(a.inscrits).toBe(3);
    expect(a.cours[0]).toMatchObject({ presents: 2, absents: 1, retards: 0 });
  });

  it('l’appel « journée complète » d’une classe sans cours paraît à part, et ne compte pas parmi les cours', async () => {
    const r = await appeler(nour, nour.classes['5eme C']!, null, { Fatou: 'retard' });
    expect(r.statusCode, r.body).toBe(201);
    const t = await tableau(nour);
    const c = classe(t, nour.classes['5eme C']!);
    expect(c.journee).toMatchObject({ fait: true, presents: 0, absents: 0, retards: 1, par: 'Collecteur Nour' });
    expect(c.cours).toEqual([]);
    expect([t.faits, t.total]).toEqual([2, 3]);
    // Les autres classes n'ont pas d'appel de la journée.
    expect(classe(t, nour.classes['5eme A']!).journee.fait).toBe(false);
  });

  it('un appel saisi sur une matière hors emploi du temps du jour reste visible', async () => {
    // La 5eme C n'a pas cours le mercredi : sa liste propose alors toutes ses
    // matières de l'année, et le collecteur a pu appeler en Dessin.
    const r = await appeler(nour, nour.classes['5eme C']!, nour.enseignements['C-dessin']!, { Fatou: 'absent' });
    expect(r.statusCode, r.body).toBe(201);
    const c = classe(await tableau(nour), nour.classes['5eme C']!);
    expect(c.hors_grille).toHaveLength(1);
    expect(c.hors_grille[0]).toMatchObject({
      enseignement_id: nour.enseignements['C-dessin'],
      matiere_nom: 'Dessin',
      fait: true,
      absents: 1,
    });
    expect(c.cours).toEqual([]);
  });

  it('un autre jour repart de zéro', async () => {
    const t = await tableau(nour, '2026-03-18'); // le mercredi suivant
    expect([t.faits, t.total]).toEqual([0, 3]);
    expect(classe(t, nour.classes['5eme A']!).cours.every((c) => !c.fait)).toBe(true);
  });
});

describe('deux écoles', () => {
  it('⚠ l’école voisine voit SA classe et SON appel, jamais ceux de Nour', async () => {
    const t = await tableau(rissala);
    expect(t.classes.map((c) => c.groupe_id)).toEqual([rissala.classes['5eme A']]);
    expect(t.classes[0]!.inscrits).toBe(2);
    expect(t.classes[0]!.cours).toHaveLength(1);
    expect(t.classes[0]!.cours[0]).toMatchObject({
      enseignement_id: rissala.enseignements['A-maths'],
      fait: true,
      presents: 0,
      absents: 2,
      retards: 0,
      par: null,
    });
    expect([t.faits, t.total]).toEqual([1, 1]);
  });

  it('⚠ Nour ne voit ni la classe ni les deux absents de Rissala', async () => {
    const t = await tableau(nour);
    const ids = t.classes.map((c) => c.groupe_id);
    expect(ids).not.toContain(rissala.classes['5eme A']);
    expect(JSON.stringify(t)).not.toContain(rissala.enseignements['A-maths']);
    const absents = t.classes.flatMap((c) => c.cours).reduce((n, c) => n + c.absents, 0);
    expect(absents).toBe(2); // un en Maths, un en Arabe — ceux de Nour, pas quatre
  });

  it('demander l’année d’une autre école : « Année scolaire introuvable. »', async () => {
    const r = await jour(rissala, rissala.jetons.collecteur!, MERCREDI, nour.annee);
    expect(r.statusCode).toBe(404);
    expect((r.json() as { message: string }).message).toBe('Année scolaire introuvable.');
  });

  it('un jeton de Nour présenté sous l’adresse de Rissala n’ouvre rien', async () => {
    const r = await jour(rissala, nour.jetons.collecteur!, MERCREDI, rissala.annee);
    expect([401, 403]).toContain(r.statusCode);
  });
});

describe('les permissions sont celles des créneaux', () => {
  it('sans session : 401', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/attendance/jour?date=${MERCREDI}&academicYearId=${nour.annee}`,
      headers: { 'x-school-slug': nour.slug },
    });
    expect(r.statusCode).toBe(401);
  });

  it('un compte sans « absences.saisir » ni « absences.consulter » : 403', async () => {
    const r = await jour(nour, nour.jetons.sans!, MERCREDI, nour.annee);
    expect(r.statusCode).toBe(403);
  });

  it('un professeur (« absences.consulter ») le lit', async () => {
    const r = await jour(nour, nour.jetons.professeur!, MERCREDI, nour.annee);
    expect(r.statusCode).toBe(200);
  });

  it('une date ou une année mal formées sont refusées, pas servies', async () => {
    for (const url of [
      `/attendance/jour?date=11/03/2026&academicYearId=${nour.annee}`,
      `/attendance/jour?date=2026-02-31&academicYearId=${nour.annee}`,
      `/attendance/jour?date=${MERCREDI}&academicYearId=pas-un-uuid`,
      `/attendance/jour?date=${MERCREDI}`,
    ]) {
      const r = await app.inject({ method: 'GET', url, headers: entetes(nour, nour.jetons.collecteur!) });
      expect(r.statusCode, url).toBe(400);
    }
  });
});

describe('les dates et les années sans emploi du temps disent pourquoi', () => {
  it('une date hors de l’année consultée : le drapeau, la période, et aucune classe', async () => {
    const t = await tableau(nour, '2025-03-12'); // avant l'été qui précède la rentrée 2025
    expect(t.hors_annee).toBe(true);
    expect(t.periode[0]).toBe('2025-07-01');
    expect(t.classes).toEqual([]);
    expect([t.faits, t.total]).toEqual([0, 0]);
  });

  it('une année sans aucune affectation : « grille vide », la classe qui a un inscrit reste listée', async () => {
    const t = await tableau(nour, MERCREDI_RENTREE, annee2627);
    expect(t.hors_annee).toBe(false);
    expect(t.grille_vide).toBe(true);
    expect(t.classes.map((c) => [c.groupe_nom, c.inscrits, c.cours.length])).toEqual([['5eme A', 1, 0]]);
    expect([t.faits, t.total]).toEqual([0, 0]);
  });

  it('⚠ à la rentrée, la case de l’an dernier désigne l’enseignement de CETTE année dès que la matière est réaffectée', async () => {
    await enseigner(nour, 'A-maths-2627', annee2627, 'Seconde', '5eme A', 'Maths');
    const t = await tableau(nour, MERCREDI_RENTREE, annee2627);
    expect(t.grille_vide).toBe(false);
    const a = classe(t, nour.classes['5eme A']!);
    // Maths est réaffecté (à un autre professeur) ; l'Arabe ne l'est pas : il disparaît.
    expect(a.cours.map((c) => [c.creneau, c.matiere_nom, c.enseignement_id, c.prof_prenom])).toEqual([
      ['8h-9h45', 'Maths', nour.enseignements['A-maths-2627'], 'Mariem'],
    ]);
    expect([t.faits, t.total]).toEqual([0, 1]);
    // L'année 2025-2026, elle, garde ses deux cours tels quels.
    const avant = classe(await tableau(nour), nour.classes['5eme A']!);
    expect(avant.cours.map((c) => c.enseignement_id)).toEqual([nour.enseignements['A-maths'], nour.enseignements['A-arabe']]);
  });
});

describe('une seule série de requêtes pour toute l’école', () => {
  it('⚠ le nombre de requêtes ne dépend pas du nombre de classes (pas de N+1)', async () => {
    const db = app.get(DbService);
    const origine = db.query.bind(db);
    let requetes = 0;
    const espion = vi.spyOn(db, 'query').mockImplementation(((fn: (tx: Queryable) => Promise<unknown>) =>
      origine((tx) =>
        fn({
          query: ((...args: unknown[]) => {
            requetes += 1;
            return (tx as unknown as { query: (...a: unknown[]) => unknown }).query(...args);
          }) as Queryable['query'],
        }),
      )) as typeof db.query);

    try {
      const avant = await tableau(nour);
      const pourTrois = requetes;
      expect(avant.classes).toHaveLength(3);
      expect(pourTrois).toBeGreaterThan(0);

      // Cinq classes de plus, chacune avec un cours le mercredi et un élève.
      for (const nom of ['5eme D', '5eme E', '5eme F', '5eme G', '5eme H']) {
        await creerClasse(nour, nom);
        await enseigner(nour, `${nom}-maths`, nour.annee, 'Premier', nom, 'Maths');
        await placer(nour, nom, `${nom}-maths`, 3, 3);
        await inscrire(nour, `Élève ${nom}`, nom);
      }

      requetes = 0;
      const apres = await tableau(nour);
      expect(apres.classes).toHaveLength(8);
      expect([apres.faits, apres.total]).toEqual([2, 8]);
      expect(requetes).toBe(pourTrois);
    } finally {
      espion.mockRestore();
    }
  });
});

describe('une classe qui a des cours et aucun élève', () => {
  it('est listée avec ses cours, mais ne pèse pas dans la progression : personne à pointer', async () => {
    const avant = await tableau(nour);
    await creerClasse(nour, '5eme Vide');
    await enseigner(nour, 'vide-maths', nour.annee, 'Premier', '5eme Vide', 'Maths');
    await placer(nour, '5eme Vide', 'vide-maths', 3, 1);

    const t = await tableau(nour);
    const vide = classe(t, nour.classes['5eme Vide']!);
    expect(vide.inscrits).toBe(0);
    expect(vide.cours.map((c) => [c.creneau, c.matiere_nom, c.fait])).toEqual([['8h-9h45', 'Maths', false]]);
    expect([t.faits, t.total]).toEqual([avant.faits, avant.total]);
  });
});
