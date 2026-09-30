import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { estCycle, money, toStorage } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * Reference data: levels, class groups, subjects, teachers, teachings.
 *
 * El Ourwa folded "create group" and "create subject" into the levels screen
 * (`creer_groupe.php` and `creer_matiere.php` are both redirects to
 * `gerer_niveaux.php`). The API keeps them as separate resources; the UI can
 * still present them together.
 */
@Injectable()
export class ReferenceService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Its "Niveaux existants" table.
   *
   * ⚠ ITS TWO COUNT COLUMNS ARE PART OF THE TABLE, not decoration: "Groupes"
   * and "Étudiants" are what decide whether the Supprimer button is rendered at
   * all. A level list without them cannot reproduce the screen, because there
   * is no way to tell an empty level from a full one.
   *
   * ⚠ AND THE CHILDREN ARE COUNTED FROM ENROLMENTS, not from a group pointer.
   * El Ourwa counts `etudiants` joined through `etudiants.groupe_id`, which its
   * own comment elsewhere calls "un CACHE d'affichage global reecrit a chaque
   * changement d'annee" — so its figure is whoever the cache points at today,
   * not who is enrolled. Ours asks the enrolments for the year being viewed.
   */
  async levels(academicYearId?: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT l.id, l.name, l.monthly_rate, l.cycle, l.is_fondamental,
                l.pass_mark, l.sort_order,
                (SELECT count(*)::int FROM groups g WHERE g.level_id = l.id) AS group_count,
                (SELECT count(*)::int FROM enrollments e
                   JOIN groups g2 ON g2.id = e.group_id
                  WHERE g2.level_id = l.id AND e.status <> 'cancelled'
                    AND ($1::uuid IS NULL OR e.academic_year_id = $1)) AS student_count
           FROM levels l ORDER BY l.cycle, l.sort_order`,
        [academicYearId ?? null],
      );
      return rows;
    });
  }

  async createLevel(input: {
    name: string;
    monthlyRate: string;
    cycle: string;
    isFondamental?: boolean;
    passMark?: string;
    sortOrder?: number;
  }) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      try {
        const { rows } = await tx.query(
          `INSERT INTO levels (school_id, name, monthly_rate, cycle, is_fondamental, pass_mark, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, name, monthly_rate, cycle, is_fondamental, pass_mark, sort_order`,
          [
            schoolId, input.name, input.monthlyRate, input.cycle,
            input.isFondamental ?? input.cycle === 'fondamental',
            input.passMark ?? '10.00', input.sortOrder ?? 0,
          ],
        );
        return rows[0];
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new ConflictException(`Le niveau « ${input.name} » existe déjà.`);
        }
        throw error;
      }
    });
  }

  /** Levels with their groups, and each group's headcount for a year. */
  async hierarchy(academicYearId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT l.id AS level_id, l.name AS level_name, l.cycle, l.sort_order,
                -- ⚠ Le tarif du niveau s'affiche À CÔTÉ DE SON NOM :
                -- « 3 AF (2 000 MRU/mois) ». C'est ce qui distingue deux niveaux
                -- qui se ressemblent, et l'écran des groupes est l'endroit où
                -- l'on vérifie qu'une classe est bien au bon tarif.
                l.monthly_rate::text AS monthly_rate,
                -- Et l'effectif DU NIVEAU, pas du groupe : son en-tête porte
                -- « N étudiant(s) » pour le niveau entier.
                (SELECT count(*)::int FROM enrollments le
                   JOIN groups lg ON lg.id = le.group_id
                  WHERE lg.level_id = l.id AND le.academic_year_id = $1
                    AND le.status <> 'cancelled') AS level_headcount,
                g.id AS group_id, g.name AS group_name, g.capacity,
                (SELECT count(*)::int FROM enrollments e
                  WHERE e.group_id = g.id AND e.academic_year_id = $1
                    AND e.status <> 'cancelled') AS headcount
           FROM levels l
           LEFT JOIN groups g ON g.level_id = l.id
          ORDER BY l.cycle, l.sort_order, g.name`,
        [academicYearId],
      );
      return rows;
    });
  }

  /**
   * The class list, with what its own `<option>` prints beside each name.
   *
   * ⚠ `inscrire_etudiant.php` RENDERS "6ème — 6ème A (28/30)" AND CARRIES THE
   * LEVEL'S RATE IN A `data-tarif` ATTRIBUTE. Neither is decoration: the clerk
   * choosing a class needs to see it is nearly full before putting a
   * twenty-ninth child in it, and the rate is what fills "Frais mensuel (MRU)"
   * the moment the class is picked — so the commonest admission needs no
   * arithmetic and no memory of thirteen different tuitions.
   */
  async groups(academicYearId?: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT g.id, g.name, g.capacity, g.level_id, l.name AS level_name,
                l.monthly_rate, l.cycle,
                (SELECT count(*)::int FROM enrollments e
                  WHERE e.group_id = g.id AND e.status <> 'cancelled'
                    AND ($1::uuid IS NULL OR e.academic_year_id = $1)) AS headcount
           FROM groups g LEFT JOIN levels l ON l.id = g.level_id
          -- CYCLE FIRST. sort_order alone is not unique across cycles: 3 AF
          -- and 6eme can both be 30, so ordering by it produced
          -- "6eme, 5eme, 3 AF, 4eme, 3eme", a class list in no order at all.
          -- Same key as levels() and hierarchy(), so every screen that shows
          -- classes shows them in the school's own order.
          ORDER BY l.cycle, l.sort_order, g.name`,
        [academicYearId ?? null],
      );
      return rows;
    });
  }

  async createGroup(input: { name: string; levelId: string; capacity?: number }) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO groups (school_id, level_id, name, capacity)
         VALUES ($1, $2, $3, $4) RETURNING id, name, capacity, level_id`,
        [schoolId, input.levelId, input.name, input.capacity ?? 40],
      );
      return rows[0];
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  LES ÉDITIONS EN LIGNE DE « GÉRER LES NIVEAUX »
  //
  //  Its levels table is not a read-only list. Every row carries three small
  //  forms — tarif mensuel, seuil d'admission, and a button that flips
  //  « fondamental » — each posting on its own and each answering with its own
  //  message. Ours displayed the three values and offered no way to change any
  //  of them, so a school could not correct a fee without a migration.
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * MODIFIER LE TARIF MENSUEL — action `modifier_tarif`.
   *
   * ⚠ THIS IS A DEFAULT FOR THE NEXT ADMISSION, NOT A RETROACTIVE EDIT. Its
   * UPDATE touches `niveaux` and nothing else: `etudiants.frais_mensuel` is
   * copied at admission and never chased afterwards, so a child admitted at
   * 12 000 keeps owing 12 000 when the level moves to 15 000. Doing otherwise
   * would silently rewrite what families already owe — and the receipts already
   * printed would stop matching the ledger.
   */
  async setLevelRate(levelId: string, monthlyRate: string, actorId: string) {
    const { schoolId } = currentTenant();
    // Compared as a decimal string, never parsed to a float (CLAUDE.md §6).
    if (!/^-?\d+(\.\d+)?$/.test(monthlyRate.trim())) {
      throw new BadRequestException('Le tarif mensuel doit être un montant.');
    }
    if (monthlyRate.trim().startsWith('-')) {
      throw new BadRequestException('Le tarif mensuel doit être positif.');
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ monthly_rate: string; name: string }>(
        'UPDATE levels SET monthly_rate = $1 WHERE id = $2 RETURNING monthly_rate, name',
        [monthlyRate.trim(), levelId],
      );
      if (rows.length === 0) throw new NotFoundException('Niveau introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'level_rate_changed',
          entity: 'level',
          entityId: levelId,
          after: { monthly_rate: rows[0]!.monthly_rate },
        },
        tx,
      );
      return { monthlyRate: rows[0]!.monthly_rate };
    });
  }

  /**
   * CLASSER UN NIVEAU — son cycle (maternelle, fondamentale, collège, lycée,
   * autre) et son rang dans le cycle. Demande du propriétaire de Jinan
   * (30/09/2026) ; sans équivalent chez El Ourwa, où le cycle n'était jamais
   * demandé. Toutes les listes suivent (`ORDER BY cycle, sort_order`) et la
   * progression d'un ajourné aussi (le cycle d'abord). Ni tarif, ni seuil, ni
   * « fondamental » (qui décide du bulletin) : ils ont leurs propres actions.
   */
  async setLevelClassification(levelId: string, cycle: string, sortOrder: number, actorId: string) {
    const { schoolId } = currentTenant();
    if (!estCycle(cycle)) {
      throw new BadRequestException('Cycle inconnu : choisissez Maternelle, Fondamentale, Collège, Lycée ou Autre.');
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
      throw new BadRequestException('Le rang du niveau dans son cycle doit être un entier entre 0 et 999.');
    }
    return this.db.query(async (tx) => {
      const { rows: avant } = await tx.query<{ cycle: string; sort_order: number }>(
        'SELECT cycle::text, sort_order FROM levels WHERE id = $1',
        [levelId],
      );
      if (!avant[0]) throw new NotFoundException('Niveau introuvable.');
      await tx.query('UPDATE levels SET cycle = $1::school_cycle, sort_order = $2 WHERE id = $3', [cycle, sortOrder, levelId]);
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'level_classification_changed',
          entity: 'level',
          entityId: levelId,
          before: avant[0],
          after: { cycle, sort_order: sortOrder },
        },
        tx,
      );
      return { cycle, sortOrder };
    });
  }

  /**
   * MODIFIER LE SEUIL D'ADMISSION — action `modifier_seuil`.
   *
   * ⚠ ALWAYS OUT OF 20, EVEN WHERE THE SUBJECTS ARE NOT. A fondamental level
   * marks each subject on its own scale — /50, /30 — and its label still reads
   * "Seuil d'admission (/20)", because the threshold is compared against the
   * general average, which is always rescaled. Accepting 50 here would pass a
   * whole level that failed.
   *
   * ⚠ AND AN EMPTY VALUE IS REFUSED, not read as "use the global default". Its
   * own message says so: "Indiquez un seuil entre 0 et 20 pour ce niveau." A
   * blank box saved silently is how a level ends up with a threshold nobody
   * chose.
   */
  async setLevelPassMark(levelId: string, passMark: string, actorId: string) {
    const { schoolId } = currentTenant();
    const raw = passMark.trim();
    if (raw === '') {
      throw new BadRequestException('Indiquez un seuil entre 0 et 20 pour ce niveau.');
    }
    if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) > 20) {
      throw new BadRequestException(
        'Le seuil doit être une note comprise entre 0 et 20.',
      );
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ pass_mark: string }>(
        'UPDATE levels SET pass_mark = $1 WHERE id = $2 RETURNING pass_mark',
        [raw, levelId],
      );
      if (rows.length === 0) throw new NotFoundException('Niveau introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'level_pass_mark_changed',
          entity: 'level',
          entityId: levelId,
          after: { pass_mark: rows[0]!.pass_mark },
        },
        tx,
      );
      return { passMark: rows[0]!.pass_mark };
    });
  }

  /**
   * BASCULER « FONDAMENTAL » — action `basculer_fondamental`.
   *
   * Its own tooltip is the definition: "Un niveau fondamental note chaque
   * matière sur son propre barème (/50, /30…)" — moyenne matière = (moy.
   * devoirs + examen) ÷ 2, total du trimestre = somme des moyennes ÷ somme des
   * barèmes. Flipping it changes which bulletin is printed, so it is recorded.
   */
  async toggleFondamental(levelId: string, actorId: string) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ is_fondamental: boolean }>(
        'UPDATE levels SET is_fondamental = NOT is_fondamental WHERE id = $1 RETURNING is_fondamental',
        [levelId],
      );
      if (rows.length === 0) throw new NotFoundException('Niveau introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'level_fondamental_toggled',
          entity: 'level',
          entityId: levelId,
          after: { is_fondamental: String(rows[0]!.is_fondamental) },
        },
        tx,
      );
      return { isFondamental: rows[0]!.is_fondamental };
    });
  }

  /**
   * MODIFIER LE BARÈME D'UNE MATIÈRE — action `modifier_note_sur`.
   *
   * Only offered on a fondamental level, where a subject really is marked on
   * /50 or /30. Its bounds are 1..99, and they are not decoration: a scale of 0
   * divides by zero in every average, and a scale above 99 does not fit the
   * column.
   */
  async setSubjectMaxScore(subjectId: string, maxScore: string, actorId: string) {
    const { schoolId } = currentTenant();
    const raw = maxScore.trim();
    if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) < 1 || Number(raw) > 99) {
      throw new BadRequestException('Barème invalide (entre 1 et 99).');
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ max_score: string }>(
        'UPDATE subjects SET max_score = $1 WHERE id = $2 RETURNING max_score',
        [raw, subjectId],
      );
      if (rows.length === 0) throw new NotFoundException('Matière introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'subject_max_score_changed',
          entity: 'subject',
          entityId: subjectId,
          after: { max_score: rows[0]!.max_score },
        },
        tx,
      );
      return { maxScore: rows[0]!.max_score };
    });
  }

  /**
   * SUPPRIMER UN NIVEAU — action `supprimer_niveau`.
   *
   * ⚠ ITS HANDLER DELETED THE CHILDREN. Read it: notes, then paiements, then
   * `etudiants`, then enseignements, then groupes, then matieres, then the
   * level — a seven-statement cascade that destroys a family's accounting
   * because someone tidied the class list.
   *
   * ⚠ BUT ITS BUTTON IS ONLY RENDERED WHEN `nb_etudiants == 0 && nb_groupes ==
   * 0`. Every reachable case therefore deletes an empty level, and the cascade
   * only fires on a forged POST. So the refusal below is not a behaviour change
   * for anyone using the screen — it is the same outcome for every path a user
   * can take, and a refusal instead of silent destruction for the one they
   * cannot.
   *
   * El Ourwa reached the same conclusion itself for classes: `supprimer_groupe`
   * carries a long comment stopping exactly this cascade. This applies its own
   * later judgement to the case it had not revisited.
   */
  async deleteLevel(levelId: string, actorId: string) {
    const { schoolId } = currentTenant();

    await this.db.query(async (tx) => {
      const { rows: counts } = await tx.query<{ groups: string; students: string }>(
        `SELECT (SELECT count(*)::text FROM groups g WHERE g.level_id = $1) AS groups,
                (SELECT count(*)::text FROM enrollments e WHERE e.level_id = $1) AS students`,
        [levelId],
      );
      const nbGroups = Number(counts[0]!.groups);
      const nbStudents = Number(counts[0]!.students);

      if (nbGroups > 0 || nbStudents > 0) {
        throw new ConflictException(
          `Ce niveau ne peut pas être supprimé : ${
            nbGroups > 0 ? `${nbGroups} groupe(s) y sont rattachés` : `${nbStudents} inscription(s) y figurent`
          }. Videz-le d’abord — supprimer le niveau effacerait les paiements, ` +
            'les notes et les absences de ses élèves, et ces écritures ne se ' +
            'reconstituent pas.',
        );
      }

      const { rows } = await tx.query<{ name: string }>(
        'DELETE FROM levels WHERE id = $1 RETURNING name',
        [levelId],
      );
      if (rows.length === 0) throw new NotFoundException('Niveau introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'level_deleted',
          entity: 'level',
          entityId: levelId,
          before: { name: rows[0]!.name },
        },
        tx,
      );
    });
  }

  /**
   * SUPPRIMER UNE CLASSE — action `supprimer_groupe`, refusal and all.
   *
   * Its comment is the specification, and it is worth keeping in full: the
   * action "supprimait la classe ET TOUS SES ELEVES, avec leurs notes, leurs
   * PAIEMENTS, leurs absences et leurs remarques. Irreversible." Worse, the
   * children were chosen by `etudiants.groupe_id`, a display cache rewritten at
   * each year change — so it could delete children who were not really in that
   * class at all, only pointed there that day.
   *
   * ⚠ ITS OWN CONFIRM DIALOGUE STILL SAYS IT DELETES THEM: "Supprimer le groupe
   * « X » ET ses N étudiant(s) ?". The prompt was never updated when the handler
   * was fixed, so the screen threatens something the server refuses. Ours asks
   * the true question.
   */
  async deleteGroup(groupId: string, actorId: string) {
    const { schoolId } = currentTenant();

    await this.db.query(async (tx) => {
      const { rows: counts } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM enrollments WHERE group_id = $1',
        [groupId],
      );
      const nb = Number(counts[0]!.n);
      if (nb > 0) {
        throw new ConflictException(
          // Sa phrase, accents compris — c'est-à-dire sans, là où il n'en met pas.
          `Cette classe ne peut pas être supprimée : ${nb} inscription(s) y sont rattachées. ` +
            "Reaffectez d'abord les eleves vers une autre classe. " +
            'Supprimer la classe effacerait leurs paiements, leurs notes et ' +
            'leurs absences — ces écritures ne se reconstituent pas.',
        );
      }

      // Empty of pupils — but its teaching assignments may still carry marks,
      // which 0025 refuses to cascade: say it, with the count, instead of a 500.
      const { rows: notes } = await tx.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM grades g JOIN teachings t ON t.id = g.teaching_id WHERE t.group_id = $1`,
        [groupId],
      );
      if (Number(notes[0]!.n) > 0) {
        throw new ConflictException(
          `Cette classe ne peut pas être supprimée : ${notes[0]!.n} note(s) sont rattachées à ses enseignements. ` +
            'Les notes ne s’effacent pas avec une classe.',
        );
      }
      await tx.query('DELETE FROM teachings WHERE group_id = $1', [groupId]);
      const { rows } = await tx.query<{ name: string }>(
        'DELETE FROM groups WHERE id = $1 RETURNING name',
        [groupId],
      );
      if (rows.length === 0) throw new NotFoundException('Classe introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'group_deleted',
          entity: 'group',
          entityId: groupId,
          before: { name: rows[0]!.name },
        },
        tx,
      );
    });
  }

  /**
   * LE DÉTAIL D'UN NIVEAU — everything below its `?niveau_id=` drill-down.
   *
   * Its classes, its subjects, and its "Statistiques — évolution des effectifs"
   * table comparing this year's headcount with last year's.
   *
   * ⚠ WITHOUT ITS SNAPSHOT TABLE, AND DELIBERATELY. El Ourwa keeps
   * `effectifs_annuels` and writes a row into it ON EVERY PAGE LOAD — an
   * `INSERT … ON DUPLICATE KEY UPDATE` inside the render path, so opening the
   * screen mutates data, and the "previous year" figure is whatever the table
   * happened to catch rather than what was true in June. We read last year's
   * headcount from the enrolments themselves, which is the fact rather than a
   * cache of it, and the page stays a read.
   *
   * ⚠ NULL IS NOT ZERO. A level with no prior year returns `previous: null` and
   * its screen prints "Pas de données N-1". Zero would read as "everyone left",
   * which is a different and much more alarming statement.
   */
  async levelDetail(levelId: string, academicYearId: string) {
    return this.db.query(async (tx) => {
      const { rows: level } = await tx.query<{
        id: string;
        name: string;
        monthly_rate: string;
        pass_mark: string;
        cycle: string;
        is_fondamental: boolean;
      }>(
        `SELECT id, name, monthly_rate, pass_mark, cycle, is_fondamental
           FROM levels WHERE id = $1`,
        [levelId],
      );
      if (level.length === 0) throw new NotFoundException('Niveau introuvable.');

      // The year immediately before the one being viewed, by start_year —
      // never "the row before this one", which breaks the moment a year is
      // created out of order.
      const { rows: prior } = await tx.query<{ id: string }>(
        `SELECT p.id FROM academic_years p, academic_years c
          WHERE c.id = $1 AND p.start_year = c.start_year - 1`,
        [academicYearId],
      );
      const priorYearId = prior[0]?.id ?? null;

      const { rows: groups } = await tx.query<{
        id: string;
        name: string;
        capacity: number;
        enrolment_count: number;
        headcount: number;
        previous: number | null;
      }>(
        `SELECT g.id, g.name, g.capacity,
                -- Every year, every status: what decides whether Supprimer is
                -- offered at all. Headcount alone would offer the button on a
                -- class that is empty THIS year and full of last year's
                -- payments, and the server would then refuse it.
                (SELECT count(*)::int FROM enrollments e
                  WHERE e.group_id = g.id) AS enrolment_count,
                (SELECT count(*)::int FROM enrollments e
                  WHERE e.group_id = g.id AND e.academic_year_id = $2
                    AND e.status <> 'cancelled') AS headcount,
                CASE WHEN $3::uuid IS NULL THEN NULL ELSE
                  (SELECT count(*)::int FROM enrollments e
                    WHERE e.group_id = g.id AND e.academic_year_id = $3
                      AND e.status <> 'cancelled')
                END AS previous
           FROM groups g
          WHERE g.level_id = $1
          ORDER BY g.name`,
        [levelId, academicYearId, priorYearId],
      );

      const { rows: subjects } = await tx.query<{
        id: string;
        name: string;
        name_ar: string | null;
        coefficient: number;
        max_score: string;
        teaching_count: number;
      }>(
        `SELECT s.id, s.name, s.name_ar, s.coefficient, s.max_score,
                (SELECT count(*)::int FROM teachings t WHERE t.subject_id = s.id)
                  AS teaching_count
           FROM subjects s WHERE s.level_id = $1 ORDER BY s.name`,
        [levelId],
      );

      return {
        level: level[0]!,
        hasPriorYear: priorYearId !== null,
        groups: groups.map((g) => ({
          ...g,
          delta: g.previous === null ? null : g.headcount - g.previous,
        })),
        subjects,
      };
    });
  }

  async subjects(levelId?: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.name, s.name_ar, s.coefficient, s.max_score, s.level_id,
                l.name AS level_name
           FROM subjects s LEFT JOIN levels l ON l.id = s.level_id
          WHERE ($1::uuid IS NULL OR s.level_id = $1)
          ORDER BY l.sort_order, s.name`,
        [levelId ?? null],
      );
      return rows;
    });
  }

  async createSubject(input: {
    name: string;
    nameAr?: string;
    levelId: string;
    coefficient?: number;
    maxScore?: string;
  }) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO subjects (school_id, level_id, name, name_ar, coefficient, max_score)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, name_ar, coefficient, max_score, level_id`,
        [
          schoolId, input.levelId, input.name, input.nameAr ?? null,
          input.coefficient ?? 1, input.maxScore ?? '20.00',
        ],
      );
      return rows[0];
    });
  }

  /**
   * The teaching staff.
   *
   * ⚠ THIS RETURNED EVERY TEACHER'S HOURLY RATE AND SALARY TO ANYBODY WITH A
   * TOKEN, parents included. `finance.salaires` exists precisely to keep those
   * figures narrow — the payroll controller's own words: "It is the one
   * permission that exposes what colleagues earn" — and this handed them out
   * beside the names.
   *
   * ⚠ THE PAY FIELDS ARE ABSENT, NOT ZEROED, for a caller without that right. A
   * zero salary is a statement about a colleague's pay, and a false one; a
   * missing field is the truth, which is that this caller was not told.
   *
   * The route is guarded as well. This is the second lock, not the only one:
   * a future caller that forgets the decorator still cannot leak the money.
   */
  async teachers(includePay = false) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        includePay
          ? `SELECT id, first_name, last_name, sex, phone, employment, hourly_rate, salary
               FROM teachers ORDER BY last_name, first_name`
          : `SELECT id, first_name, last_name, sex, phone, employment
               FROM teachers ORDER BY last_name, first_name`,
      );
      return rows;
    });
  }

  /** Teachings for a group: which teacher teaches which subject, that year. */
  async teachingsForGroup(groupId: string, academicYearId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT t.id, t.hours_per_week,
                s.id AS subject_id, s.name AS subject_name, s.coefficient, s.max_score,
                te.id AS teacher_id, te.first_name, te.last_name
           FROM teachings t
           JOIN subjects s ON s.id = t.subject_id
           JOIN teachers te ON te.id = t.teacher_id
          WHERE t.group_id = $1 AND t.academic_year_id = $2
          ORDER BY s.name`,
        [groupId, academicYearId],
      );
      return rows;
    });
  }

  /**
   * Change a subject's coefficient — `gerer_niveaux.php`, `modifier_coef`.
   *
   * ⚠ ITS RANGE IS 1 TO 10, not 1 to 20. A coefficient weights the subject in
   * the general average, so widening the range silently changes what a
   * coefficient of 15 would mean on a bulletin that has always topped out at 10.
   */
  async setSubjectCoefficient(subjectId: string, coefficient: number, actorId: string) {
    const { schoolId } = currentTenant();
    if (!Number.isInteger(coefficient) || coefficient < 1 || coefficient > 10) {
      throw new BadRequestException('Le coefficient doit être compris entre 1 et 10.');
    }

    await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ coefficient: number }>(
        'UPDATE subjects SET coefficient = $1 WHERE id = $2 RETURNING coefficient',
        [coefficient, subjectId],
      );
      if (rows.length === 0) throw new NotFoundException('Matière introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'subject_coefficient_changed',
          entity: 'subject',
          entityId: subjectId,
          after: { coefficient: String(coefficient) },
        },
        tx,
      );
    });
  }

  /**
   * Delete a subject.
   *
   * ⚠ REFUSED WHEN IT IS TAUGHT. El Ourwa catches the foreign-key violation and
   * says what it means: "Impossible de supprimer : cette matière est utilisée
   * dans des enseignements." Kept, and checked BEFORE the delete rather than
   * caught after, so the message is the reason rather than a translation of a
   * constraint name.
   *
   * The check matters more than it looks: our FK cascades, so without it
   * deleting a subject would silently delete every teaching of it — and with
   * them every mark, since grades hang off the teaching.
   */
  async deleteSubject(subjectId: string, actorId: string) {
    const { schoolId } = currentTenant();

    await this.db.query(async (tx) => {
      const { rows: used } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM teachings WHERE subject_id = $1',
        [subjectId],
      );
      if (Number(used[0]!.n) > 0) {
        throw new ConflictException(
          'Impossible de supprimer : cette matière est utilisée dans des enseignements.',
        );
      }

      const { rows } = await tx.query<{ name: string }>(
        'DELETE FROM subjects WHERE id = $1 RETURNING name',
        [subjectId],
      );
      if (rows.length === 0) throw new NotFoundException('Matière introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'subject_deleted',
          entity: 'subject',
          entityId: subjectId,
          before: { name: rows[0]!.name },
        },
        tx,
      );
    });
  }

  /**
   * ASSIGNER — a teacher to a group and a subject, for a year.
   *
   * `gerer_professeurs.php`, action `assigner`. There was no way to do this at
   * all: every teaching in the system came from the seed, so a school could not
   * have given a teacher a new class after go-live — and the timetable, the
   * mark sheet and the payroll all hang off these rows.
   *
   * ⚠ THE YEAR IS NOT OPTIONAL, and El Ourwa records why it learnt that:
   * shipped without it, "l'affectation naissait rattachée à aucune année", and
   * because the mark-entry screen filters strictly on the year being viewed —
   * deliberately, it is what stops a subject appearing twice — "une affectation
   * sans année restait donc invisible partout."
   *
   * ⚠ THE RATE IS PER ASSIGNMENT because it depends on the level taught. NULL
   * means "use the teacher's own rate"; it does not mean zero. A negative one is
   * treated as unset rather than stored, so nobody is ever paid a negative
   * salary by a slipped minus sign.
   */
  async assignTeaching(
    input: {
      teacherId: string;
      groupId: string;
      subjectId: string;
      academicYearId: string;
      hoursPerWeek: string;
      hourlyRate?: string;
    },
    actorId: string,
  ): Promise<{ id: string }> {
    const { schoolId } = currentTenant();

    const hours = Number(input.hoursPerWeek);
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 40) {
      throw new BadRequestException(
        "Le nombre d'heures par semaine doit être entre 0.5 et 40.",
      );
    }

    // Le tarif horaire est de l'argent : chaîne décimale validée, jamais un
    // nombre JS (règle 6). Vide ou illisible = « tarif du professeur ».
    const brut = (input.hourlyRate ?? '').trim();
    const rate = /^\d{1,12}([.,]\d{1,2})?$/.test(brut) ? toStorage(money(brut.replace(',', '.'))) : null;

    return this.db.query(async (tx) => {
      const existing = await tx.query(
        `SELECT 1 FROM teachings
          WHERE teacher_id = $1 AND group_id = $2 AND subject_id = $3
            AND academic_year_id = $4`,
        [input.teacherId, input.groupId, input.subjectId, input.academicYearId],
      );
      if (existing.rows.length > 0) {
        throw new BadRequestException('Cette assignation existe déjà.');
      }

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO teachings
           (school_id, academic_year_id, teacher_id, group_id, subject_id,
            hours_per_week, hourly_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          schoolId, input.academicYearId, input.teacherId, input.groupId,
          input.subjectId, hours, rate,
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'teaching_assigned',
          entity: 'teaching',
          entityId: rows[0]!.id,
          after: {
            hoursPerWeek: String(hours),
            hourlyRate: rate === null ? 'tarif du professeur' : String(rate),
          },
        },
        tx,
      );

      return { id: rows[0]!.id };
    });
  }

  /** Remove one assignment. The subject and the group are untouched. */
  /**
   * MODIFIER LES HEURES ET LE TAUX D'UNE ASSIGNATION — its `modifier_heures`.
   *
   * ⚠ AN ASSIGNMENT COULD BE CREATED AND DELETED AND NEVER CORRECTED. Nothing
   * could change the hours or the rate on an existing one, so a teacher given
   * 4 h/week by mistake had to be unassigned and reassigned — and between the
   * two the class has no teaching at all: the mark-entry screen offers nothing,
   * the timetable cells lose their subject, and the payroll counts zero.
   *
   * ⚠ `hoursPerWeek` IS MONEY. An intérimaire is paid hours × rate, so one
   * figure typed here decides a salary. Its own bounds are kept: greater than
   * zero, at most 40. Zero is not an assignment, it is a deletion in disguise —
   * it pays nothing while the class still looks staffed.
   *
   * ⚠ AND AN EMPTY RATE MEANS "THE TEACHER'S OWN", WHICH IS NOT ZERO. A
   * negative one is treated as unset rather than stored — El Ourwa's own
   * `if ($taux_ass !== null && $taux_ass < 0) $taux_ass = null;` — so nobody is
   * ever paid a negative salary by a slipped minus sign.
   */
  async updateTeaching(
    teachingId: string,
    input: { hoursPerWeek: string; hourlyRate?: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();

    const hours = input.hoursPerWeek.trim();
    if (!/^\d+(\.\d+)?$/.test(hours) || Number(hours) <= 0 || Number(hours) > 40) {
      throw new BadRequestException(
        "Les heures par semaine doivent être comprises entre 0 et 40.",
      );
    }

    // Empty, absent, unparseable or negative all mean the same thing: use the
    // teacher's own rate.
    const raw = input.hourlyRate?.trim() ?? '';
    const rate =
      raw !== '' && /^\d+(\.\d{1,2})?$/.test(raw) && Number(raw) >= 0 ? raw : null;

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ teacher_id: string }>(
        `UPDATE teachings SET hours_per_week = $1, hourly_rate = $2
          WHERE id = $3 RETURNING teacher_id`,
        [hours, rate, teachingId],
      );
      if (rows.length === 0) throw new NotFoundException('Assignation introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'teaching_updated',
          entity: 'teaching',
          entityId: teachingId,
          after: { hours_per_week: hours, hourly_rate: rate ?? '(tarif du professeur)' },
        },
        tx,
      );
      return { hoursPerWeek: hours, hourlyRate: rate };
    });
  }

  async removeTeaching(teachingId: string, actorId: string): Promise<void> {
    const { schoolId } = currentTenant();
    await this.db.query(async (tx) => {
      /*
       * ⚠ ELLE EFFAÇAIT LES NOTES, EN SILENCE.
       *
       * `grades.teaching_id` est en `ON DELETE CASCADE`. Retirer une assignation
       * saisie par erreur en octobre emportait tout un trimestre de notes, pour
       * toute la classe, sans que rien ne le dise — la confirmation du
       * navigateur ne parle que de l'assignation.
       *
       * ⚠ ET LE RAISONNEMENT ÉTAIT DÉJÀ ÉCRIT, DEUX FONCTIONS PLUS HAUT.
       * `deleteSubject` porte ceci : « our FK cascades, so without it deleting a
       * subject would silently delete every teaching of it — and with them every
       * mark, since grades hang off the teaching. » `deleteLevel` et
       * `deleteGroup` se gardent aussi, chacune avec sa phrase. Seule la porte
       * qui mène le plus DIRECTEMENT au dégât ne se gardait pas.
       *
       * Le refus dit combien de notes, parce que « impossible » sans chiffre
       * pousse à chercher un autre chemin plutôt qu'à comprendre.
       */
      const { rows: notes } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM grades WHERE teaching_id = $1',
        [teachingId],
      );
      const nb = Number(notes[0]!.n);
      if (nb > 0) {
        throw new ConflictException(
          `Cette assignation ne peut pas être supprimée : ${nb} note(s) y sont ` +
            'rattachées et seraient effacées avec elle. Corrigez plutôt ses heures ' +
            'ou son taux, ou changez le professeur de l’assignation — les notes ' +
            'appartiennent à la classe, pas à la personne qui les a saisies.',
        );
      }

      const { rows } = await tx.query<{ teacher_id: string }>(
        'DELETE FROM teachings WHERE id = $1 RETURNING teacher_id',
        [teachingId],
      );
      if (rows.length === 0) throw new NotFoundException('Assignation introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'teaching_removed',
          entity: 'teaching',
          entityId: teachingId,
          before: { teacherId: rows[0]!.teacher_id },
        },
        tx,
      );
    });
  }

  /**
   * REPORTER LES AFFECTATIONS — carry last year's teachings into a new one.
   *
   * ⚠ A NEW SCHOOL YEAR HAS NO ASSIGNMENTS, AND THAT IS CORRECT: they are
   * dated. But until they exist "Saisir les notes" has no subject to offer and
   * the screen simply looks broken, and rebuilding them for dozens of classes
   * by hand is not something anyone will do in September.
   *
   * ⚠ NO SUBJECT IS EVER DUPLICATED. Only the assignment rows are recreated,
   * reusing the same `subject_id` and `group_id`; the catalogue is global and
   * stays as it is. Duplicating it would leave a school with two "Maths" and
   * every mark split between them.
   *
   * Copies the hours AND the per-assignment rate: those are the terms agreed
   * with the teacher, not a detail of last year.
   *
   * Rerunnable. It skips what already exists rather than failing on the unique
   * key, because the obvious thing to do when it looks like it did not work is
   * to press it again.
   */
  async carryForwardTeachings(
    targetYearId: string,
    actorId: string,
  ): Promise<{ copied: number; skipped: number; from: string | null }> {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      // The most recent year that actually HAS assignments — not simply the
      // previous one, which may itself be empty.
      const { rows: source } = await tx.query<{ id: string; label: string }>(
        `SELECT y.id, y.label
           FROM academic_years y
           JOIN teachings t ON t.academic_year_id = y.id
          WHERE y.id <> $1
          GROUP BY y.id, y.label, y.start_year
          ORDER BY y.start_year DESC
          LIMIT 1`,
        [targetYearId],
      );
      if (!source[0]) return { copied: 0, skipped: 0, from: null };

      const { rows } = await tx.query<{ copied: string }>(
        `WITH inserted AS (
           INSERT INTO teachings
             (school_id, academic_year_id, teacher_id, group_id, subject_id,
              hours_per_week, hourly_rate)
           SELECT $1, $2, t.teacher_id, t.group_id, t.subject_id,
                  t.hours_per_week, t.hourly_rate
             FROM teachings t
            WHERE t.academic_year_id = $3
              AND NOT EXISTS (
                SELECT 1 FROM teachings x
                 WHERE x.academic_year_id = $2
                   AND x.teacher_id = t.teacher_id
                   AND x.group_id   = t.group_id
                   AND x.subject_id = t.subject_id
              )
           RETURNING 1
         )
         SELECT count(*)::text AS copied FROM inserted`,
        [schoolId, targetYearId, source[0].id],
      );
      const copied = Number(rows[0]!.copied);

      const { rows: total } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM teachings WHERE academic_year_id = $1',
        [source[0].id],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'teachings_carried_forward',
          entity: 'academic_year',
          entityId: targetYearId,
          after: { from: source[0].label, copied: String(copied) },
        },
        tx,
      );

      return { copied, skipped: Number(total[0]!.n) - copied, from: source[0].label };
    });
  }

  /**
   * EVERY TEACHING OF THE YEAR, for the Niveau → Groupe → Matière cascade.
   *
   * ⚠ FILTERED TO ONE YEAR, and that filter is the point. `teachings` carries a
   * row per (group, subject, YEAR). El Ourwa records what happened when the
   * year was not filtered: "chaque matière apparaissait donc DEUX FOIS dans la
   * liste — et rien ne permettait de distinguer laquelle choisir."
   *
   * One payload, because the cascade narrows in the browser. A school has a few
   * hundred teachings and the person marking changes class several times a
   * minute; a request per change would put the network in front of every one.
   */
  /**
   * ASSIGNATIONS EXISTANTES — its table under "Nouvelle assignation".
   *
   * ⚠ ONE COULD BE CREATED AND NOTHING LISTED IT. This returned an id, a group
   * and a subject name — enough for a chooser, and nothing else. Its own table
   * carries Professeur · Niveau · Groupe · Matière · Heures/sem · Taux · Coût
   * mensuel, and every one of those columns earns its place: an assignment IS an
   * intérimaire's salary line, so a school that cannot see them cannot see what
   * it is about to pay.
   *
   * ⚠ THE MONTHLY COST IS COMPUTED HERE, ONCE. hours × rate × 4 weeks, as
   * NUMERIC, with `COALESCE` to the teacher's own rate — because a NULL rate on
   * the assignment means "use the teacher's", not zero. Doing this arithmetic in
   * the browser would do it in JS floats, on a figure the school pays.
   */
  async teachingsForYear(academicYearId: string, includePay = false) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        group_id: string;
        subject: string;
        subject_id: string;
        teacher_id: string;
        teacher_name: string;
        employment: string | null;
        level_name: string | null;
        group_name: string | null;
        hours_per_week: string | null;
        hourly_rate: string | null;
        teacher_rate: string | null;
        monthly_cost: string;
      }>(
        `SELECT t.id, t.group_id, s.name AS subject, s.id AS subject_id,
                t.teacher_id,
                btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
                  AS teacher_name,
                p.employment,
                l.name AS level_name, g.name AS group_name,
                t.hours_per_week::text,
                t.hourly_rate::text,
                p.hourly_rate::text AS teacher_rate,
                (COALESCE(t.hours_per_week, 0)
                 * COALESCE(t.hourly_rate, p.hourly_rate, 0)
                 * 4)::numeric(14,2)::text AS monthly_cost
           FROM teachings t
           JOIN subjects s ON s.id = t.subject_id
           LEFT JOIN teachers p ON p.id = t.teacher_id
           LEFT JOIN groups g ON g.id = t.group_id
           LEFT JOIN levels l ON l.id = g.level_id
          WHERE t.academic_year_id = $1
          ORDER BY teacher_name, l.cycle, l.sort_order, g.name, s.name`,
        [academicYearId],
      );
      return rows.map((r) => ({
        id: r.id,
        groupId: r.group_id,
        subject: r.subject,
        subjectId: r.subject_id,
        teacherId: r.teacher_id,
        teacherName: r.teacher_name,
        employment: r.employment,
        levelName: r.level_name,
        groupName: r.group_name,
        // Hours are pedagogy as well as pay — they cap how often a subject may
        // appear in the timetable — so they stay whatever the caller is.
        hoursPerWeek: r.hours_per_week,
        // ⚠ The money is omitted, not zeroed, for a caller who may not see it.
        // NULL on `hourlyRate` already means "the teacher's own rate"; a zero
        // would be a third meaning and a false one.
        ...(includePay
          ? {
              hourlyRate: r.hourly_rate,
              teacherRate: r.teacher_rate,
              monthlyCost: r.monthly_cost,
            }
          : {}),
      }));
    });
  }

  /** The classes one teacher is responsible for — the teacher's own scope. */
  async teachingsForTeacher(teacherId: string, academicYearId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT t.id, g.id AS group_id, g.name AS group_name,
                l.name AS level_name, s.name AS subject_name, t.hours_per_week,
                (SELECT count(*)::int FROM enrollments e
                  WHERE e.group_id = g.id AND e.academic_year_id = $2
                    AND e.status <> 'cancelled') AS headcount
           FROM teachings t
           JOIN groups g ON g.id = t.group_id
           LEFT JOIN levels l ON l.id = g.level_id
           JOIN subjects s ON s.id = t.subject_id
          WHERE t.teacher_id = $1 AND t.academic_year_id = $2
          ORDER BY l.sort_order, g.name, s.name`,
        [teacherId, academicYearId],
      );
      return rows;
    });
  }

  /**
   * SES CLASSES, UNE LIGNE PAR GROUPE — `pages/professeur/mes_classes.php`.
   *
   * ⚠ PAR GROUPE, PAS PAR ENSEIGNEMENT. El Ourwa fait `DISTINCT g.id` et
   * concatène les matières dans une colonne « Matières enseignées ». Un
   * professeur qui prend 6A pour deux matières voit UNE ligne ; une ligne par
   * enseignement afficherait « 6A » deux fois, ce qui se lit comme deux classes.
   *
   * ⚠ ET SA COLONNE « Étudiants » EST `effectif / capacité`. C'est ce qui
   * permet à l'enseignant de voir qu'un groupe déborde sans demander.
   */
  async classesForTeacher(userId: string, academicYearId: string | null) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        group_id: string;
        group_name: string;
        level_name: string | null;
        subjects: string;
        headcount: number;
        capacity: number;
      }>(
        // Sa requête : `DISTINCT g.id … COUNT(DISTINCT et.id) … GROUP_CONCAT(DISTINCT
        // m.nom ORDER BY m.nom)` sur SQL_ENS_COURANTS ; ses `etudiants.groupe_id`
        // sont les inscrits de l'année consultée.
        `SELECT g.id AS group_id, g.name AS group_name, n.name AS level_name,
                g.capacity,
                string_agg(DISTINCT m.name, ', ' ORDER BY m.name) AS subjects,
                (SELECT count(DISTINCT et.id)::int FROM enrollments et
                  WHERE et.group_id = g.id AND et.status <> 'cancelled'
                    AND ($2::uuid IS NULL OR et.academic_year_id = $2)) AS headcount
           FROM (SELECT DISTINCT ON (t1.group_id, t1.subject_id) t1.*
                   FROM teachings t1
                  ORDER BY t1.group_id, t1.subject_id, (t1.legacy_id IS NULL) DESC, t1.legacy_id DESC, t1.id DESC) e
           JOIN teachers te ON te.id = e.teacher_id
           JOIN groups g ON e.group_id = g.id
           LEFT JOIN levels n ON g.level_id = n.id
           JOIN subjects m ON e.subject_id = m.id
          WHERE te.user_id = $1
          GROUP BY g.id, g.name, n.name, n.id, n.cycle, n.sort_order, g.capacity
          ORDER BY n.cycle, n.sort_order, n.name, g.name`,
        [userId, academicYearId],
      );
      return rows;
    });
  }

  /**
   * La liste des élèves d'UN de ses groupes — son bouton « Voir les étudiants ».
   *
   * ⚠ LE GROUPE ARRIVE PAR L'URL, donc c'est une frontière et non un filtre
   * d'affichage : sans la garde, changer le numéro suffit à lire la classe d'un
   * collègue. El Ourwa pose exactement la même avant d'afficher —
   * `SELECT COUNT(*) FROM enseignements WHERE professeur_id = :pid AND groupe_id = :gid`
   * — et n'affiche rien quand elle refuse.
   */
  async rosterForTeacher(userId: string, groupId: string, academicYearId: string | null) {
    return this.db.query(async (tx) => {
      const garde = await tx.query(
        `SELECT 1 FROM teachings t
           JOIN teachers te ON te.id = t.teacher_id
          WHERE te.user_id = $1 AND t.group_id = $2
          LIMIT 1`,
        [userId, groupId],
      );
      if (garde.rows.length === 0) {
        throw new ForbiddenException("Ce groupe ne fait pas partie de vos enseignements.");
      }
      const { rows: groupes } = await tx.query<{ name: string; level_name: string | null }>(
        `SELECT g.name, n.name AS level_name FROM groups g LEFT JOIN levels n ON g.level_id = n.id WHERE g.id = $1`,
        [groupId],
      );
      const groupe = groupes[0];
      if (!groupe) throw new NotFoundException('Groupe introuvable.');
      // Son `SELECT * FROM etudiants WHERE groupe_id = :gid ORDER BY nom, prenom`.
      const { rows } = await tx.query<{
        id: string;
        matricule: string | null;
        first_name: string;
        last_name: string;
      }>(
        `SELECT s.id, s.matricule, s.first_name, s.last_name
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
          WHERE e.group_id = $1 AND e.status <> 'cancelled'
            AND ($2::uuid IS NULL OR e.academic_year_id = $2)
          ORDER BY s.last_name, s.first_name`,
        [groupId, academicYearId],
      );
      return { groupe, etudiants: rows };
    });
  }

  /**
   * LA LISTE D'UN GROUPE — celle que `gestion_groupes.php` affiche sous chaque
   * classe, et depuis laquelle on retire un élève.
   *
   * Distincte de `rosterForTeacher` : celle-ci est administrative et ne demande
   * pas que l'appelant enseigne le groupe.
   */
  /**
   * LA LISTE D'UNE CLASSE — `gestion_groupes.php?groupe_id=` : ses colonnes
   * Matricule · Prénom · Nom · Sexe · Parent · Tél. Parent · NNI · RIM ·
   * Inscrit le (la date de création de la fiche), par nom puis prénom. Chez
   * lui `etudiants.groupe_id` ne connaît pas l'année ; ici l'inscription de
   * l'année consultée, ou de l'année ouverte.
   */
  async rosterForGroup(groupId: string, academicYearId?: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        matricule: string | null;
        rim: string;
        national_id: string;
        first_name: string;
        last_name: string;
        sex: string | null;
        guardian_name: string | null;
        guardian_phone: string | null;
        date_inscription: string;
      }>(
        `SELECT s.id, s.matricule, s.rim, s.national_id, s.first_name, s.last_name, s.sex,
                u.full_name AS guardian_name, u.phone AS guardian_phone,
                s.created_at::date::text AS date_inscription
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
           LEFT JOIN users u ON u.id = s.guardian_id
           JOIN academic_years y ON y.id = e.academic_year_id
            AND (($2::uuid IS NULL AND y.status = 'active') OR y.id = $2::uuid)
          WHERE e.group_id = $1 AND e.status <> 'cancelled'
          ORDER BY s.last_name, s.first_name`,
        [groupId, academicYearId ?? null],
      );
      return rows;
    });
  }

  /**
   * SUPPRIMER UN PROFESSEUR — le « Supprimer » de `gerer_professeurs.php`.
   *
   * ⚠ AUCUNE GARDE ÉCRITE ICI, ET C'EST VOULU : LE SCHÉMA LA PORTE.
   * `teachings → teachers` est en CASCADE, mais `grades → teachings` est en
   * NO ACTION depuis la migration 0025 (ADR-0042). Un professeur dont une classe
   * porte des notes ne peut donc pas partir : Postgres refuse l'ensemble en fin
   * d'instruction, et rien n'est fait à moitié.
   *
   * Une garde écrite en TypeScript ferait la même chose — moins bien, parce
   * qu'elle vivrait à côté de la vérité au lieu d'être dedans, et qu'un second
   * chemin d'appel l'oublierait. On traduit seulement le refus en français.
   */
  async deleteTeacher(teacherId: string, actorId: string) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows: avant } = await tx.query<{ first_name: string; last_name: string }>(
        'SELECT first_name, last_name FROM teachers WHERE id = $1',
        [teacherId],
      );
      if (!avant[0]) throw new NotFoundException('Professeur introuvable.');

      try {
        await tx.query('DELETE FROM teachers WHERE id = $1', [teacherId]);
      } catch {
        throw new ConflictException(
          "Ce professeur ne peut pas être supprimé : des notes ont été saisies " +
            'dans une de ses classes. Retirez-lui ses assignations, ou laissez sa ' +
            'fiche en place — elle porte l\u2019histoire de ces notes.',
        );
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'teacher_deleted',
          entity: 'teacher',
          entityId: teacherId,
          before: { name: `${avant[0].first_name} ${avant[0].last_name}`.trim() },
        },
        tx,
      );
      return { deleted: true, name: `${avant[0].first_name} ${avant[0].last_name}`.trim() };
    });
  }

  /**
   * LES ASSIGNATIONS EXISTANTES — `gerer_professeurs.php` lit `SQL_ENS_COURANTS`
   * SANS filtre d'année : une affectation par (groupe, matière), la plus récente,
   * toutes années confondues. Son ordre : professeur, niveau, groupe, matière.
   */
  async teachingsCourantes(includePay = false) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        group_id: string;
        subject: string;
        subject_id: string;
        teacher_id: string;
        teacher_name: string;
        employment: string | null;
        level_name: string | null;
        group_name: string | null;
        hours_per_week: string | null;
        hourly_rate: string | null;
        teacher_rate: string | null;
        monthly_cost: string;
      }>(
        `SELECT t.id, t.group_id, s.name AS subject, s.id AS subject_id,
                t.teacher_id,
                btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
                  AS teacher_name,
                p.employment,
                l.name AS level_name, g.name AS group_name,
                t.hours_per_week::text,
                t.hourly_rate::text,
                p.hourly_rate::text AS teacher_rate,
                (COALESCE(t.hours_per_week, 0)
                 * COALESCE(t.hourly_rate, p.hourly_rate, 0)
                 * 4)::numeric(14,2)::text AS monthly_cost
           FROM (SELECT DISTINCT ON (t1.group_id, t1.subject_id) t1.*
                   FROM teachings t1
                  ORDER BY t1.group_id, t1.subject_id, (t1.legacy_id IS NULL) DESC, t1.legacy_id DESC, t1.id DESC) t
           JOIN subjects s ON s.id = t.subject_id
           LEFT JOIN teachers p ON p.id = t.teacher_id
           LEFT JOIN groups g ON g.id = t.group_id
           LEFT JOIN levels l ON l.id = g.level_id
          ORDER BY p.last_name, p.first_name, l.name, g.name, s.name`,
      );
      return rows.map((r) => ({
        id: r.id,
        groupId: r.group_id,
        subject: r.subject,
        subjectId: r.subject_id,
        teacherId: r.teacher_id,
        teacherName: r.teacher_name,
        employment: r.employment,
        levelName: r.level_name,
        groupName: r.group_name,
        hoursPerWeek: r.hours_per_week,
        ...(includePay
          ? { hourlyRate: r.hourly_rate, teacherRate: r.teacher_rate, monthlyCost: r.monthly_cost }
          : {}),
      }));
    });
  }

  /** The teacher record belonging to a user account, if any. */
  /**
   * Every child in the classes this teacher actually teaches.
   *
   * DISTINCT because a teacher may take the same group for two subjects, and a
   * roster that listed a child twice would invite writing about them twice.
   */
  /**
   * « Élèves accessibles = élèves des groupes que le prof enseigne » —
   * `remarques.php` : `etudiants JOIN groupes JOIN enseignements WHERE
   * professeur_id`, c'est-à-dire les inscrits (de l'année consultée) des
   * groupes où il a UN enseignement, quelle qu'en soit l'année ; ordre
   * `g.nom, et.nom`.
   */
  async studentsTaughtBy(userId: string, academicYearId: string | null = null) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT DISTINCT s.id, s.first_name, s.last_name, g.name AS group_name
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
           JOIN groups g ON g.id = e.group_id
          WHERE e.status <> 'cancelled'
            AND ($2::uuid IS NULL OR e.academic_year_id = $2)
            AND EXISTS (SELECT 1 FROM teachings t JOIN teachers te ON te.id = t.teacher_id
                         WHERE t.group_id = g.id AND te.user_id = $1)
          ORDER BY g.name, s.last_name, s.first_name`,
        [userId, academicYearId],
      );
      return rows;
    });
  }

  /**
   * CE QUE LE PROFESSEUR CONNECTÉ GAGNE — son `tableau_bord.php`.
   *
   * ⚠ IL NE POUVAIT PAS VOIR SA PROPRE PAIE. Son tableau de bord porte
   * « Tarif horaire » et « Salaire mensuel » puis une carte « Détail de mon
   * salaire mensuel » ; le nôtre n'en disait rien, si bien que la seule façon
   * pour un enseignant de connaître son taux était de le demander.
   *
   * ⚠ RÉSOLU DEPUIS LE COMPTE, JAMAIS DEPUIS UN IDENTIFIANT FOURNI. La
   * signature est la garantie : on passe le porteur du jeton, donc un
   * professeur voit sa fiche et celle de personne d'autre. C'est la même règle
   * que `my-classes` et `my-timetable`, et elle compte davantage ici.
   *
   * ⚠ LA MÊME ARITHMÉTIQUE QUE LA PAIE, sans quoi les deux écrans donneraient
   * deux chiffres : un intérimaire est payé heures × 4 semaines × taux, un
   * permanent son salaire. C'est ce que `payrollMonth()` calcule, et rien ici ne
   * le recalcule autrement — les montants restent des chaînes (règle 6).
   */
  async ownPay(userId: string): Promise<{
    employment: string;
    salary: string;
    hourlyRate: string;
    hoursPerWeek: string;
    hoursPerMonth: number;
    monthlyPay: string;
    lines: { groupName: string; subjectName: string; hoursPerWeek: string }[];
  } | null> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        employment: string | null;
        salary: string;
        hourly_rate: string;
        hours: string;
        lines: { groupName: string; subjectName: string; hoursPerWeek: string }[] | null;
      }>(
        `SELECT COALESCE(t.employment, 'permanent') AS employment,
                t.salary::text, t.hourly_rate::text,
                COALESCE(a.hours, 0)::text AS hours,
                a.lines
           FROM teachers t
           LEFT JOIN LATERAL (
             SELECT SUM(te.hours_per_week) AS hours,
                    jsonb_agg(jsonb_build_object(
                      'groupName', g.name,
                      'subjectName', sub.name,
                      'hoursPerWeek', te.hours_per_week::text
                    ) ORDER BY g.name, sub.name) AS lines
               FROM teachings te
               JOIN academic_years y ON y.id = te.academic_year_id AND y.status = 'active'
               JOIN groups g   ON g.id = te.group_id
               JOIN subjects sub ON sub.id = te.subject_id
              WHERE te.teacher_id = t.id
           ) a ON true
          WHERE t.user_id = $1`,
        [userId],
      );

      const r = rows[0];
      if (!r) return null;

      const heures = money(r.hours);
      const parMois = heures.times(4);
      const interim = r.employment === 'interim';

      return {
        employment: r.employment ?? 'permanent',
        salary: toStorage(money(r.salary)),
        hourlyRate: toStorage(money(r.hourly_rate)),
        hoursPerWeek: heures.toFixed(1),
        hoursPerMonth: parMois.toNumber(),
        monthlyPay: interim
          ? toStorage(parMois.times(money(r.hourly_rate)))
          : toStorage(money(r.salary)),
        lines: r.lines ?? [],
      };
    });
  }

  /**
   * TABLEAU DE BORD DU PROFESSEUR — `pages/professeur/tableau_bord.php` :
   * sa fiche (`prenom`, `nom`, `nb_classes`, `prix_par_heure`) et ses
   * enseignements courants (`SQL_ENS_COURANTS`) avec, par enseignement, le
   * nombre d'élèves du groupe (ses `etudiants.groupe_id` : les inscrits de
   * l'année consultée) et le nombre de notes saisies ; ordre
   * `n.cycle, n.ordre, n.nom, g.nom, m.nom`.
   *
   * ⚠ Deux sous-requêtes corrélées plutôt que deux LEFT JOIN, comme chez lui :
   * joindre à la fois les élèves et les notes fait un produit cartésien.
   *
   * `nb_classes` est chez lui une colonne recalculée = COUNT(DISTINCT
   * groupe_id) sur TOUS ses enseignements (`recalculer_salaire`).
   */
  async tableauBord(userId: string, academicYearId: string | null) {
    return this.db.query(async (tx) => {
      const { rows: profs } = await tx.query<{
        id: string;
        prenom: string;
        nom: string;
        nb_classes: number;
        prix_par_heure: string;
      }>(
        `SELECT t.id, t.first_name AS prenom, t.last_name AS nom,
                (SELECT count(DISTINCT e.group_id)::int FROM teachings e WHERE e.teacher_id = t.id) AS nb_classes,
                t.hourly_rate::text AS prix_par_heure
           FROM teachers t WHERE t.user_id = $1`,
        [userId],
      );
      const prof = profs[0];
      if (!prof) return null;

      const { rows } = await tx.query<{
        id: string;
        heures_par_semaine: string;
        groupe_nom: string;
        niveau_nom: string | null;
        matiere_nom: string;
        nb_etudiants: number;
        nb_notes: number;
      }>(
        `SELECT e.id, e.hours_per_week::text AS heures_par_semaine,
                g.name AS groupe_nom,
                n.name AS niveau_nom,
                m.name AS matiere_nom,
                (SELECT count(*)::int FROM enrollments et
                  WHERE et.group_id = g.id AND et.status <> 'cancelled'
                    AND ($2::uuid IS NULL OR et.academic_year_id = $2)) AS nb_etudiants,
                (SELECT count(*)::int FROM grades no WHERE no.teaching_id = e.id) AS nb_notes
           FROM (SELECT DISTINCT ON (t1.group_id, t1.subject_id) t1.*
                   FROM teachings t1
                  ORDER BY t1.group_id, t1.subject_id, (t1.legacy_id IS NULL) DESC, t1.legacy_id DESC, t1.id DESC) e
           JOIN groups g      ON e.group_id = g.id
           LEFT JOIN levels n ON g.level_id = n.id
           JOIN subjects m    ON e.subject_id = m.id
          WHERE e.teacher_id = $1
          ORDER BY n.cycle, n.sort_order, n.name, g.name, m.name`,
        [prof.id, academicYearId],
      );
      return {
        prenom: prof.prenom,
        nom: prof.nom,
        nb_classes: prof.nb_classes,
        prix_par_heure: toStorage(money(prof.prix_par_heure)),
        enseignements: rows,
      };
    });
  }

  async teacherIdForUser(userId: string): Promise<string | null> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        'SELECT id FROM teachers WHERE user_id = $1',
        [userId],
      );
      return rows[0]?.id ?? null;
    });
  }
}
