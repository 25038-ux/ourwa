import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { NotificationsService } from '../parent/notifications.service.js';

/**
 * Ses `$CRENEAUX` (`emploi_du_temps.php`) : `slot` 1 = 8h-9h45, 2 = 10h-11h45,
 * 3 = 12h-14h. Les horaires sont affichés, jamais stockés (voir `0008`).
 */
const CRENEAUX: readonly { libelle: string; debut: string; fin: string }[] = [
  { libelle: '8h-9h45', debut: '08:00', fin: '09:45' },
  { libelle: '10h-11h45', debut: '10:00', fin: '11:45' },
  { libelle: '12h-14h', debut: '12:00', fin: '14:00' },
];

/** L'état d'un appel sur le tableau du jour : fait (et ses comptes) ou à faire. */
export interface EtatAppel {
  fait: boolean;
  presents: number;
  absents: number;
  retards: number;
  /** Le nom du compte qui a saisi la dernière ligne ; `null` pour un appel repris. */
  par: string | null;
  /** L'instant de la dernière saisie, ISO 8601 UTC. */
  le: string | null;
  /** Le même instant à l'horloge de l'école, `AAAA-MM-JJ HH:MM`. */
  le_local: string | null;
}

export interface CoursDuJour extends EtatAppel {
  /** Le rang du créneau dans la journée (`timetable_slots.slot`). */
  rang: number;
  creneau: string;
  debut: string | null;
  fin: string | null;
  enseignement_id: string;
  matiere_nom: string;
  prof_prenom: string | null;
  prof_nom: string | null;
}

export interface ClasseDuJour {
  groupe_id: string;
  groupe_nom: string;
  niveau_id: string | null;
  niveau_nom: string | null;
  /** Les inscrits de l'année consultée, hors inscriptions annulées. */
  inscrits: number;
  cours: CoursDuJour[];
  /** L'appel « Général (journée complète) » de la feuille. */
  journee: EtatAppel;
  /** Les appels saisis ce jour-là sur une matière hors emploi du temps du jour. */
  hors_grille: (EtatAppel & { enseignement_id: string; matiere_nom: string | null })[];
}

@Injectable()
export class PedagogyService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  // ── L'appel — `gerer_absence.php` ─────────────────────────────────────────

  /**
   * LES CRÉNEAUX DU JOUR — ses `$creneaux_jour`.
   *
   * 1. Les cases de l'emploi du temps du groupe pour ce jour de la semaine,
   *    dont l'enseignement est de l'année consultée, dans l'ordre des
   *    créneaux ; 2. à défaut, TOUTES les matières enseignées à cette classe
   *    cette année, créneau « — », par nom de matière. « L'ANNÉE CONSULTÉE
   *    borne les deux requêtes : sans elle, on saisissait l'appel d'aujourd'hui
   *    sur des matières d'une année passée. »
   */
  async creneauxDuJour(groupId: string, date: string, academicYearId: string) {
    const jour = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = dimanche
    const dayOfWeek = jour === 0 ? 7 : jour;
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        creneau: string;
        enseignement_id: string;
        matiere_nom: string;
        prof_prenom: string | null;
        prof_nom: string | null;
      }>(
        // ⚠ LA GRILLE EST UNIQUE, LES ENSEIGNEMENTS SONT PAR ANNÉE. Une case
        // placée l'an dernier désigne l'enseignement de l'an dernier ; à la
        // rentrée, exiger `en.academic_year_id = année` vidait la liste et la
        // page disait « Pas d'emploi du temps » sous une grille pleine
        // (démo, 23/09). La case est retenue si l'enseignement placé est de
        // l'année, OU si la même matière est enseignée à ce groupe cette
        // année — et c'est alors CET enseignement-là que l'appel enregistre,
        // ce qui préserve sa règle : « sans elle, on saisissait l'appel
        // d'aujourd'hui sur des matières d'une année passée ».
        // ⚠ appelsDuJour porte LE JUMEAU de cette requête, pour toutes les
        // classes à la fois : toute retouche se reporte là-bas (un test
        // compare les deux listes).
        `SELECT (ARRAY['8h-9h45','10h-11h45','12h-14h'])[ts.slot] AS creneau,
                COALESCE(cette.id, en.id) AS enseignement_id, m.name AS matiere_nom,
                COALESCE(pc.first_name, p.first_name) AS prof_prenom,
                COALESCE(pc.last_name, p.last_name) AS prof_nom
           FROM timetable_slots ts
           JOIN teachings en ON en.id = ts.teaching_id
           JOIN subjects m ON m.id = en.subject_id
           LEFT JOIN teachers p ON p.id = en.teacher_id
           LEFT JOIN LATERAL (
             SELECT t.id, t.teacher_id FROM teachings t
              WHERE t.group_id = ts.group_id AND t.subject_id = en.subject_id
                AND t.academic_year_id = $3 AND t.id <> en.id
              ORDER BY t.id DESC LIMIT 1
           ) cette ON en.academic_year_id <> $3
           LEFT JOIN teachers pc ON pc.id = cette.teacher_id
          WHERE ts.group_id = $1 AND ts.day_of_week = $2
            AND (en.academic_year_id = $3 OR cette.id IS NOT NULL)
          ORDER BY ts.slot`,
        [groupId, dayOfWeek, academicYearId],
      );
      if (rows.length > 0) return rows;

      const { rows: toutes } = await tx.query<typeof rows[number]>(
        `SELECT '—' AS creneau, en.id AS enseignement_id, m.name AS matiere_nom,
                p.first_name AS prof_prenom, p.last_name AS prof_nom
           FROM teachings en
           JOIN subjects m ON m.id = en.subject_id
           LEFT JOIN teachers p ON p.id = en.teacher_id
          WHERE en.group_id = $1 AND en.academic_year_id = $2
          ORDER BY m.name`,
        [groupId, academicYearId],
      );
      return toutes;
    });
  }

  /**
   * LES APPELS DU JOUR — le tableau de bord du collecteur d'absence (demande
   * du propriétaire, 07/10/2026 : « roll call is per lesson; it should fetch
   * the emploi du temps and call each class »).
   *
   * Pour UNE date : toutes les classes de l'année consultée, leurs cours du
   * jour lus dans l'emploi du temps (dans l'ordre des créneaux), et pour
   * chaque cours si l'appel est fait — présents, absents, retards, par qui,
   * quand — ou reste à faire. `gerer_absence.php` n'a pas cet écran : il
   * appelle une classe à la fois ; celui-ci dit lesquelles restent.
   *
   * ⚠ UNE SÉRIE DE REQUÊTES POUR TOUTE L'ÉCOLE, jamais une par classe (38
   * classes) : les classes, les cases du jour, les appels du jour. Un test
   * compte les requêtes avec trois classes puis huit.
   *
   * ⚠ LES COURS SONT CEUX DE `creneauxDuJour`, À L'IDENTIQUE — même règle de
   * rentrée (la case de l'an dernier désigne l'enseignement de CETTE année
   * quand la matière est réaffectée au groupe). Le lien du tableau ouvre la
   * feuille existante, qui ne retient un enseignement que s'il figure dans sa
   * propre liste : si les deux requêtes divergeaient, le lien ouvrirait
   * « Général (journée complète) » à la place du cours. Un test les compare.
   *
   * Ce que le tableau NE fait PAS, exprès : le repli de la feuille sur
   * « toutes les matières de l'année » quand la classe n'a pas cours ce
   * jour-là. Une classe sans case dit « aucun cours », et son appel de la
   * journée (`teaching_id IS NULL`) est rendu à part, dans `journee`. Un appel
   * saisi par ce repli reste visible, dans `hors_grille`.
   *
   * « Classe de l'année » : au moins un inscrit non annulé, ou au moins une
   * matière affectée, pour l'année consultée — `groups` n'a pas d'année.
   * Les comptes sont ceux que la feuille affiche : les élèves inscrits dans
   * la classe cette année (hors annulés), sur un enseignement de la classe.
   */
  async appelsDuJour(date: string, academicYearId: string) {
    const annee = await this.years.byId(academicYearId);
    // Les dates que l'année possède — la même règle que les absences lues par
    // les familles : un appel saisi hors de cette période ne paraîtrait sous
    // cette année nulle part.
    const periode = await this.years.periodeAttribuee(annee);
    const base = {
      date,
      annee: { id: annee.id, label: annee.label },
      periode,
    };
    if (date < periode[0] || (periode[1] !== 'infinity' && date > periode[1])) {
      return { ...base, hors_annee: true, grille_vide: false, total: 0, faits: 0, classes: [] as ClasseDuJour[] };
    }

    const jour = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = dimanche
    const dayOfWeek = jour === 0 ? 7 : jour;

    return this.db.query(async (tx) => {
      const { rows: groupes } = await tx.query<{
        groupe_id: string;
        groupe_nom: string;
        niveau_id: string | null;
        niveau_nom: string | null;
        inscrits: number;
      }>(
        `SELECT g.id AS groupe_id, g.name AS groupe_nom, g.level_id AS niveau_id, l.name AS niveau_nom,
                COALESCE(i.n, 0)::int AS inscrits
           FROM groups g
           LEFT JOIN levels l ON l.id = g.level_id
           LEFT JOIN (
             SELECT e.group_id, count(*) AS n
               FROM enrollments e
              WHERE e.academic_year_id = $1 AND e.status <> 'cancelled' AND e.group_id IS NOT NULL
              GROUP BY e.group_id
           ) i ON i.group_id = g.id
          WHERE i.n > 0
             OR EXISTS (SELECT 1 FROM teachings t WHERE t.group_id = g.id AND t.academic_year_id = $1)
          ORDER BY l.cycle, l.sort_order, l.name, g.name`,
        [academicYearId],
      );

      // ⚠ LE JUMEAU de la requête de creneauxDuJour, sans le filtre de groupe.
      // Toute retouche de l'une se reporte sur l'autre.
      const { rows: cases } = await tx.query<{
        groupe_id: string;
        rang: number;
        enseignement_id: string;
        matiere_nom: string;
        prof_prenom: string | null;
        prof_nom: string | null;
      }>(
        `SELECT ts.group_id AS groupe_id, ts.slot::int AS rang,
                COALESCE(cette.id, en.id) AS enseignement_id, m.name AS matiere_nom,
                COALESCE(pc.first_name, p.first_name) AS prof_prenom,
                COALESCE(pc.last_name, p.last_name) AS prof_nom
           FROM timetable_slots ts
           JOIN teachings en ON en.id = ts.teaching_id
           JOIN subjects m ON m.id = en.subject_id
           LEFT JOIN teachers p ON p.id = en.teacher_id
           LEFT JOIN LATERAL (
             SELECT t.id, t.teacher_id FROM teachings t
              WHERE t.group_id = ts.group_id AND t.subject_id = en.subject_id
                AND t.academic_year_id = $2 AND t.id <> en.id
              ORDER BY t.id DESC LIMIT 1
           ) cette ON en.academic_year_id <> $2
           LEFT JOIN teachers pc ON pc.id = cette.teacher_id
          WHERE ts.day_of_week = $1
            AND (en.academic_year_id = $2 OR cette.id IS NOT NULL)
          ORDER BY ts.group_id, ts.slot`,
        [dayOfWeek, academicYearId],
      );

      // Les appels du jour, par classe et par enseignement (NULL = journée
      // complète). L'heure est rendue à l'horloge de l'école.
      const { rows: appels } = await tx.query<{
        groupe_id: string;
        enseignement_id: string | null;
        matiere_nom: string | null;
        presents: number;
        absents: number;
        retards: number;
        le: string;
        le_local: string;
        par: string | null;
      }>(
        `SELECT e.group_id AS groupe_id, a.teaching_id AS enseignement_id, m.name AS matiere_nom,
                count(*) FILTER (WHERE a.status = 'present')::int AS presents,
                count(*) FILTER (WHERE a.status = 'absent')::int AS absents,
                count(*) FILTER (WHERE a.status = 'late')::int AS retards,
                to_char(max(a.recorded_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS le,
                to_char(
                  max(a.recorded_at) AT TIME ZONE
                    COALESCE((SELECT s.timezone FROM schools s WHERE s.id = current_school_id()), 'UTC'),
                  'YYYY-MM-DD HH24:MI'
                ) AS le_local,
                (array_agg(u.full_name ORDER BY a.recorded_at DESC, a.id DESC))[1] AS par
           FROM attendance a
           JOIN enrollments e
             ON e.student_id = a.student_id AND e.academic_year_id = $2
            AND e.status <> 'cancelled' AND e.group_id IS NOT NULL
           LEFT JOIN teachings t ON t.id = a.teaching_id
           LEFT JOIN subjects m ON m.id = t.subject_id
           LEFT JOIN users u ON u.id = a.recorded_by
          WHERE a.on_date = $1
            AND (a.teaching_id IS NULL OR t.group_id = e.group_id)
          GROUP BY e.group_id, a.teaching_id, m.name`,
        [date, academicYearId],
      );

      // « Une année sans emploi du temps du tout » ne se demande que si le
      // jour est vide : un seul cours aujourd'hui prouve le contraire.
      let grilleVide = false;
      if (cases.length === 0) {
        const { rows } = await tx.query<{ existe: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM timetable_slots ts
               JOIN teachings en ON en.id = ts.teaching_id
              WHERE en.academic_year_id = $1
                 OR EXISTS (
                      SELECT 1 FROM teachings t
                       WHERE t.group_id = ts.group_id AND t.subject_id = en.subject_id
                         AND t.academic_year_id = $1
                    )
           ) AS existe`,
          [academicYearId],
        );
        grilleVide = !rows[0]!.existe;
      }

      const A_FAIRE: EtatAppel = { fait: false, presents: 0, absents: 0, retards: 0, par: null, le: null, le_local: null };
      const etat = (a: (typeof appels)[number] | undefined): EtatAppel =>
        a
          ? { fait: true, presents: a.presents, absents: a.absents, retards: a.retards, par: a.par, le: a.le, le_local: a.le_local }
          : { ...A_FAIRE };

      const appelsPar = new Map<string, (typeof appels)[number]>();
      for (const a of appels) appelsPar.set(`${a.groupe_id}|${a.enseignement_id ?? ''}`, a);
      const casesPar = new Map<string, typeof cases>();
      for (const c of cases) {
        const liste = casesPar.get(c.groupe_id);
        if (liste) liste.push(c);
        else casesPar.set(c.groupe_id, [c]);
      }

      let total = 0;
      let faits = 0;
      const classes: ClasseDuJour[] = groupes.map((g) => {
        const duJour = casesPar.get(g.groupe_id) ?? [];
        const cours: CoursDuJour[] = duJour.map((c) => ({
          rang: c.rang,
          creneau: CRENEAUX[c.rang - 1]?.libelle ?? `Créneau ${c.rang}`,
          debut: CRENEAUX[c.rang - 1]?.debut ?? null,
          fin: CRENEAUX[c.rang - 1]?.fin ?? null,
          enseignement_id: c.enseignement_id,
          matiere_nom: c.matiere_nom,
          prof_prenom: c.prof_prenom,
          prof_nom: c.prof_nom,
          ...etat(appelsPar.get(`${g.groupe_id}|${c.enseignement_id}`)),
        }));
        // La progression ne compte que ce qui peut être appelé : une classe
        // sans inscrit n'a personne à pointer, son cours ne serait jamais « fait ».
        if (g.inscrits > 0) {
          total += cours.length;
          faits += cours.filter((c) => c.fait).length;
        }
        const duJourIds = new Set(duJour.map((c) => c.enseignement_id));
        return {
          ...g,
          cours,
          journee: etat(appelsPar.get(`${g.groupe_id}|`)),
          hors_grille: appels
            .filter((a) => a.groupe_id === g.groupe_id && a.enseignement_id !== null && !duJourIds.has(a.enseignement_id))
            .sort((x, y) => (x.matiere_nom ?? '').localeCompare(y.matiere_nom ?? '', 'fr'))
            .map((a) => ({ enseignement_id: a.enseignement_id!, matiere_nom: a.matiere_nom, ...etat(a) })),
        };
      });

      return { ...base, hors_annee: false, grille_vide: grilleVide, total, faits, classes };
    });
  }

  /**
   * LA FEUILLE D'APPEL — ses `$etudiants` et `$deja` : les élèves inscrits
   * dans ce groupe l'année consultée (hors annulés), par nom puis prénom, et
   * le statut déjà saisi pour cette date et cet enseignement — ou pour la
   * journée complète (`enseignement_id IS NULL`). `null` = rien de saisi ;
   * l'écran coche alors « Présent », comme le sien.
   */
  async appel(groupId: string, date: string, academicYearId: string, teachingId: string | null) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        prenom: string;
        nom: string;
        matricule: string | null;
        statut: string | null;
      }>(
        `SELECT st.id, st.first_name AS prenom, st.last_name AS nom, st.rim AS matricule,
                a.status AS statut
           FROM enrollments e
           JOIN students st ON st.id = e.student_id
           LEFT JOIN attendance a
             ON a.student_id = st.id AND a.on_date = $3
            AND ($4::uuid IS NULL AND a.teaching_id IS NULL OR a.teaching_id = $4::uuid)
          WHERE e.group_id = $1 AND e.academic_year_id = $2 AND e.status <> 'cancelled'
          ORDER BY st.last_name, st.first_name`,
        [groupId, academicYearId, date, teachingId],
      );
      return { etudiants: rows };
    });
  }

  /**
   * ENREGISTRER L'APPEL — son POST : pour chaque élève, la ligne existante
   * (même élève, même date, même enseignement — ou journée complète) est
   * effacée puis réécrite ; un absent ou un retard prévient la famille
   * (`notifier_parent_de_etudiant`, `retard` | `absence`, `{eleve, date}`) ;
   * « Appel enregistré. N absence(s)/retard(s) signalé(s) aux parents. »
   */
  async enregistrerAppel(
    input: {
      groupId: string;
      date: string;
      academicYearId: string;
      teachingId: string | null;
      statuts: { studentId: string; statut: 'present' | 'absent' | 'retard' }[];
    },
    actorId: string,
  ): Promise<{ nbAbs: number }> {
    const { schoolId } = currentTenant();
    await this.years.assertWritable(input.academicYearId);

    return this.db.query(async (tx) => {
      if (input.teachingId) {
        const { rows } = await tx.query(
          'SELECT 1 FROM teachings WHERE id = $1 AND group_id = $2',
          [input.teachingId, input.groupId],
        );
        if (rows.length === 0) throw new BadRequestException('Enseignement introuvable.');
      }

      let nbAbs = 0;
      const [y, mo, d] = input.date.split('-');
      const dateFr = `${d}/${mo}/${y}`;
      for (const s of input.statuts) {
        const status = s.statut === 'retard' ? 'late' : s.statut;
        await tx.query(
          `DELETE FROM attendance
            WHERE student_id = $1 AND on_date = $2
              AND ($3::uuid IS NULL AND teaching_id IS NULL OR teaching_id = $3::uuid)`,
          [s.studentId, input.date, input.teachingId],
        );
        await tx.query(
          `INSERT INTO attendance
             (school_id, student_id, teaching_id, on_date, status, recorded_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [schoolId, s.studentId, input.teachingId, input.date, status, actorId],
        );

        if (status === 'absent' || status === 'late') {
          const { rows: et } = await tx.query<{ nom: string; guardian_id: string | null }>(
            `SELECT first_name || ' ' || last_name AS nom, guardian_id FROM students WHERE id = $1`,
            [s.studentId],
          );
          if (et[0]) {
            if (et[0].guardian_id) {
              await this.notifications.notifier(tx, {
                guardianId: et[0].guardian_id,
                studentId: s.studentId,
                academicYearId: input.academicYearId,
                kind: 'absence',
                souche: status === 'late' ? 'notif_retard' : 'notif_absence',
                params: { eleve: et[0].nom, date: dateFr },
                route: status === 'late' ? 'retard' : 'absence',
              });
            }
            nbAbs++;
          }
        }
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'attendance_recorded',
          entity: 'group',
          entityId: input.groupId,
          after: { onDate: input.date, teachingId: input.teachingId, count: input.statuts.length },
        },
        tx,
      );

      return { nbAbs };
    });
  }

  /** A child's absences, for the parent app and the student file. */
  async absencesFor(studentId: string, limit = 60) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT a.on_date, a.status, a.is_excused, a.note,
                s.name AS subject
           FROM attendance a
           LEFT JOIN teachings t ON t.id = a.teaching_id
           LEFT JOIN subjects s ON s.id = t.subject_id
          WHERE a.student_id = $1 AND a.status <> 'present'
          ORDER BY a.on_date DESC
          LIMIT $2`,
        [studentId, limit],
      );
      return rows;
    });
  }

  // ── Remarks ───────────────────────────────────────────────────────────────

  async addRemark(
    studentId: string,
    body: string,
    severity: 'info' | 'positive' | 'warning' | 'serious',
    actorId: string,
    authorName: string,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO remarks (school_id, student_id, author_id, author_name, body, severity)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [schoolId, studentId, actorId, authorName, body, severity],
      );
      // « Remarque enregistrée et envoyée au parent » — `remarques.php`.
      const { rows: e } = await tx.query<{ nom: string; guardian_id: string | null }>(
        `SELECT first_name || ' ' || last_name AS nom, guardian_id FROM students WHERE id = $1`,
        [studentId],
      );
      if (e[0]?.guardian_id) {
        const annee = await this.years.active().catch(() => null);
        await this.notifications.notifier(tx, {
          guardianId: e[0].guardian_id,
          studentId,
          academicYearId: annee?.id ?? null,
          kind: 'remarque',
          souche: 'notif_remarque',
          params: { eleve: e[0].nom },
          route: 'remarques',
        });
      }
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'remark_added',
          entity: 'student',
          entityId: studentId,
          after: { severity },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  async remarksFor(studentId: string, limit = 50) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, author_name, body, severity, created_at
           FROM remarks WHERE student_id = $1
          ORDER BY created_at DESC LIMIT $2`,
        [studentId, limit],
      );
      return rows;
    });
  }

  // ── Homework ──────────────────────────────────────────────────────────────

  /** L'enseignement existe-t-il dans CETTE école (RLS) ? */
  async teachingExists(teachingId: string): Promise<boolean> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query('SELECT 1 FROM teachings WHERE id = $1', [teachingId]);
      return rows.length > 0;
    });
  }

  async sendHomework(
    teachingId: string,
    input: { title: string; body: string; dueOn?: string },
    actorId: string,
    /**
     * L'ANNÉE CONSULTÉE — ses destinataires. Son commentaire : « `groupe_id`
     * est un cache d'affichage global, pas une appartenance de classe datée :
     * pour la classe « 7D 1 » il rend 333 élèves dont AUCUN n'est inscrit
     * cette année. » Il lit donc `etudiant_inscriptions` de l'année vue ; un
     * enseignement courant reporté d'une année sur l'autre porte encore
     * l'année d'origine, et ses inscrits d'alors ne sont pas la classe d'aujourd'hui.
     */
    academicYearId: string | null = null,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO homework (school_id, teaching_id, title, body, due_on, sent_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [schoolId, teachingId, input.title, input.body, input.dueOn ?? null, actorId],
      );

      // Notifying every family in the class is fan-out. It is recorded here as
      // one row per guardian, which is fine for a class; publishing to a whole
      // level belongs on a queue (standing rule 16) and is not done inline.
      // ⚠ ON COMPTE LES NOTIFICATIONS RÉELLEMENT ÉCRITES, et on le remonte.
      // El Ourwa annonce « Exercice envoyé. N parent(s) notifié(s) » — et son
      // commentaire dit pourquoi il a fallu compter les écritures plutôt que
      // les tours de boucle : le message annonçait N même quand l'écriture
      // avait échoué. Sans ce nombre, un envoi qui ne touche que 3 familles
      // sur 30 se lit exactement comme un envoi réussi.
      const envoi = await tx.query<{ guardian_id: string; i18n_params: Record<string, unknown> }>(
        `INSERT INTO notifications
           (school_id, guardian_id, student_id, academic_year_id, kind, i18n_key,
            i18n_params)
         -- Every placeholder is cast. In a SELECT list Postgres has no column to
         -- infer a parameter's type from and settles on text, which then will
         -- not go into a uuid column — so sending an exercise failed outright.
         SELECT DISTINCT $1::uuid, st.guardian_id, st.id, t.academic_year_id,
                -- THE STEM, NOT A KEY OF ITS OWN. The parent app resolves
                -- <stem>_titre and <stem>_corps out of one string table;
                -- inventing notif.homework here meant the app would have had to
                -- carry a second table mapping one naming scheme onto the
                -- other, and the two would drift.
                'homework', 'notif_exercice',
                -- ⚠ EVERY PLACEHOLDER THE TEMPLATE ASKS FOR. The strings read
                -- "Nouvel exercice : {matiere}" and "Exercice « {titre} » pour
                -- {eleve}.{limite}" — a parameter the sender omits is rendered
                -- as the literal {eleve}, deliberately, so the gap shows up the
                -- day it is introduced instead of six months later.
                --
                -- limite carries its own leading space and full sentence
                -- because it is optional: an exercise with no due date must not
                -- leave a dangling " À rendre avant le ." on a parent's screen.
                -- Ses paramètres : « eleve » = prénom nom, « limite » =
                -- ' (jj/mm/aaaa)' ou rien.
                jsonb_build_object(
                  'titre', $3::text,
                  'matiere', COALESCE(sub.name, ''),
                  'eleve', st.first_name || ' ' || st.last_name,
                  'limite', CASE WHEN $4::date IS NULL THEN ''
                                 ELSE ' (' || to_char($4::date, 'DD/MM/YYYY') || ')'
                            END
                )
           FROM teachings t
           -- ⚠ L'ANNÉE DE L'ENSEIGNEMENT, des deux côtés : les listes des
           -- familles filtrent sur elle. Une année consultée différente ne
           -- notifie personne — et le compte rendu le dit (0 notifié).
           JOIN enrollments e
             ON e.group_id = t.group_id
            AND e.academic_year_id = t.academic_year_id
            AND e.status <> 'cancelled'
           JOIN students st ON st.id = e.student_id
           LEFT JOIN subjects sub ON sub.id = t.subject_id
          WHERE t.id = $2 AND st.guardian_id IS NOT NULL
            AND ($5::uuid IS NULL OR $5::uuid = t.academic_year_id)
         RETURNING guardian_id, i18n_params`,
        [schoolId, teachingId, input.title, input.dueOn ?? null, academicYearId],
      );
      await this.notifications.pousser(
        tx,
        (envoi.rows as { guardian_id: string; i18n_params: Record<string, unknown> }[]).map((r) => ({
          guardianId: r.guardian_id,
          params: r.i18n_params,
        })),
        'notif_exercice',
        'exercices',
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'homework_sent',
          entity: 'teaching',
          entityId: teachingId,
          after: { title: input.title },
        },
        tx,
      );

      return { id: rows[0]!.id, notified: envoi.rowCount ?? 0 };
    });
  }

  async homeworkForStudent(studentId: string, limit = 30) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT h.id, h.title, h.body, h.due_on, h.sent_at, s.name AS subject
           FROM homework h
           JOIN teachings t ON t.id = h.teaching_id
           JOIN subjects s ON s.id = t.subject_id
           JOIN enrollments e
             ON e.group_id = t.group_id AND e.academic_year_id = t.academic_year_id
          WHERE e.student_id = $1 AND e.status <> 'cancelled'
          ORDER BY h.sent_at DESC LIMIT $2`,
        [studentId, limit],
      );
      return rows;
    });
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  async notificationsFor(guardianId: string, limit = 50) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, kind, i18n_key, i18n_params, read_at, created_at
           FROM notifications WHERE guardian_id = $1
          ORDER BY created_at DESC LIMIT $2`,
        [guardianId, limit],
      );
      return rows;
    });
  }

  async markNotificationsRead(guardianId: string): Promise<{ marked: number }> {
    return this.db.query(async (tx) => {
      const result = await tx.query(
        'UPDATE notifications SET read_at = now() WHERE guardian_id = $1 AND read_at IS NULL',
        [guardianId],
      );
      return { marked: result.rowCount ?? 0 };
    });
  }
}
