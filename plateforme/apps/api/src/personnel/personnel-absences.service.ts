import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Queryable } from '@elourwa/db';
import {
  creneau,
  heureCourte,
  jourIso,
  libelleJour,
  minutesDuJour,
  minutesEntre,
} from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AcademicYearService, type AcademicYear } from '../academic/academic-year.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * LES ABSENCES DU PERSONNEL — professeurs et agents, d'après leur emploi du
 * temps. ADR-0074, migration 0043.
 *
 * Demande du propriétaire (29/09/2026) : « add absence for staff and professors
 * based on their emplois du temps ». Sans équivalent dans El Ourwa.
 *
 *   - UN PROFESSEUR manque une SÉANCE : une case de son emploi du temps
 *     (`timetable_slots`) — un jour, un créneau, une classe, une matière. On ne
 *     peut déclarer absent un professeur qu'à une séance que la grille lui
 *     donne ce jour-là.
 *   - UN AGENT manque une PÉRIODE de ses horaires (`staff_work_hours`), en
 *     entier ou en partie. Hors de ses horaires, il n'y a rien à manquer.
 *
 * ⚠ LA GRILLE EST UNIQUE, LES ENSEIGNEMENTS SONT PAR ANNÉE — la règle de
 * « Gérer l'absence » (ADR-0071), mot pour mot : une case compte pour l'année
 * de la date si son enseignement est de cette année, ou si la même matière
 * est enseignée à la classe cette année — et c'est alors le professeur de
 * CET enseignement-là qui est attendu. Une case d'une matière qui n'est plus
 * enseignée ne donne aucune séance.
 *
 * ⚠ AUCUN ARGENT. Rien ici ne touche la paie : les heures manquées sont une
 * information pour la direction (la synthèse du mois), jamais une retenue.
 */

/** Une absence peut être déclarée à l'avance (un congé prévu), pas au-delà. */
export const JOURS_D_AVANCE = 60;

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface AbsenceLue {
  id: string;
  justified: boolean;
  reason: string | null;
  minutes: number | null;
  debut: string | null;
  fin: string | null;
  recordedBy: string | null;
}

export interface SeanceDuJour {
  slot: number;
  creneau: string;
  debut: string | null;
  fin: string | null;
  minutes: number | null;
  groupId: string | null;
  groupe: string;
  matiere: string;
  teachingId: string | null;
  /** Vrai pour une absence enregistrée dont la séance n'est plus dans la grille. */
  horsGrille: boolean;
  absence: AbsenceLue | null;
}

export interface ProfesseurDuJour {
  teacherId: string;
  nom: string;
  seances: SeanceDuJour[];
}

export interface PeriodeDuJour {
  /** null : une absence enregistrée dont la période n'est plus dans les horaires. */
  workHoursId: string | null;
  debut: string;
  fin: string;
  minutes: number;
  absences: AbsenceLue[];
}

export interface AgentDuJour {
  staffId: string;
  nom: string;
  fonction: string;
  periodes: PeriodeDuJour[];
}

export interface Journee {
  date: string;
  jour: number;
  libelleJour: string;
  annee: { id: string; label: string } | null;
  professeurs: ProfesseurDuJour[];
  agents: AgentDuJour[];
  /** Les agents actifs sans aucun horaire : à configurer, sinon on ne peut rien leur déclarer. */
  agentsSansHoraires: { staffId: string; nom: string; fonction: string }[];
}

export interface LigneSynthese {
  kind: 'teacher' | 'staff';
  personId: string;
  nom: string;
  fonction: string;
  /** Séances (professeur) ou périodes (agent) manquées. */
  absences: number;
  justifiees: number;
  /** Minutes manquées, connues (une séance sans durée n'y entre pas). */
  minutes: number;
  minutesJustifiees: number;
  /** Séances dont la durée est inconnue (créneau au-delà du troisième). */
  sansDuree: number;
}

/** « 2026-09-29 », refusé s'il n'existe pas. */
function dateValide(date: string): string {
  try {
    jourIso(date);
  } catch {
    throw new BadRequestException(`Date invalide : « ${date} ».`);
  }
  return date;
}

function aujourdhuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function decaler(dateIso: string, jours: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

function estDirection(roles: readonly string[]): boolean {
  return roles.includes('super_admin') || roles.includes('admin');
}

@Injectable()
export class PersonnelAbsencesService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
  ) {}

  /**
   * L'ANNÉE À LAQUELLE UNE DATE APPARTIENT — sa période attribuée (ADR-0071 :
   * l'été et la rentrée qui précèdent, ouverte tant qu'aucune suivante n'est
   * ouverte) ; à défaut l'année active ; à défaut la plus récente.
   */
  async anneeDeLaDate(date: string): Promise<AcademicYear | null> {
    const annees = await this.years.list();
    const candidates: AcademicYear[] = [];
    for (const a of annees) {
      const [debut, fin] = await this.years.periodeAttribuee(a);
      if (date >= debut && (fin === 'infinity' || date <= fin)) candidates.push(a);
    }
    // ⚠ Une année seulement CRÉÉE (« à venir ») ne prend rien à l'année
    // ouverte : l'école prépare 2026-2027 en juin et travaille encore sous
    // 2025-2026 en octobre (ADR-0071). Sa période commence pourtant en juillet
    // et chevauche celle de l'année active — sans cette préférence, la journée
    // du 5 octobre lisait la grille de l'année à venir, vide.
    const ouvertes = candidates.filter((a) => a.status !== 'future');
    const choix = (ouvertes.length > 0 ? ouvertes : candidates).sort((a, b) => b.start_year - a.start_year)[0];
    return choix ?? annees.find((a) => a.status === 'active') ?? annees[0] ?? null;
  }

  /**
   * LES SÉANCES D'UNE JOURNÉE, PROFESSEUR PAR PROFESSEUR — la grille de chaque
   * classe pour ce jour de la semaine, chaque case rendue au professeur de
   * l'enseignement de l'année (voir l'en-tête).
   */
  private async seancesDuJour(
    tx: Queryable,
    dayOfWeek: number,
    academicYearId: string,
    teacherId: string | null,
  ) {
    const { rows } = await tx.query<{
      teacher_id: string;
      first_name: string;
      last_name: string;
      slot: number;
      group_id: string;
      group_name: string;
      level_name: string | null;
      subject: string;
      teaching_id: string;
    }>(
      `SELECT COALESCE(cette.teacher_id, en.teacher_id) AS teacher_id,
              p.first_name, p.last_name, ts.slot, g.id AS group_id, g.name AS group_name,
              l.name AS level_name, m.name AS subject,
              COALESCE(cette.id, en.id) AS teaching_id
         FROM timetable_slots ts
         JOIN teachings en ON en.id = ts.teaching_id
         JOIN subjects m ON m.id = en.subject_id
         JOIN groups g ON g.id = ts.group_id
         LEFT JOIN levels l ON l.id = g.level_id
         LEFT JOIN LATERAL (
           SELECT t.id, t.teacher_id FROM teachings t
            WHERE t.group_id = ts.group_id AND t.subject_id = en.subject_id
              AND t.academic_year_id = $2 AND t.id <> en.id
            ORDER BY t.id DESC LIMIT 1
         ) cette ON en.academic_year_id <> $2
         JOIN teachers p ON p.id = COALESCE(cette.teacher_id, en.teacher_id)
        WHERE ts.day_of_week = $1
          AND (en.academic_year_id = $2 OR cette.id IS NOT NULL)
          AND ($3::uuid IS NULL OR COALESCE(cette.teacher_id, en.teacher_id) = $3::uuid)
        ORDER BY p.last_name, p.first_name, ts.slot, g.name`,
      [dayOfWeek, academicYearId, teacherId],
    );
    return rows;
  }

  /** La feuille d'une journée : professeurs et agents, ce qu'ils devaient faire, ce qui est déclaré. */
  async journee(date: string): Promise<Journee> {
    dateValide(date);
    const jour = jourIso(date);
    const annee = await this.anneeDeLaDate(date);
    return this.db.query(async (tx) => {
      const seances = annee ? await this.seancesDuJour(tx, jour, annee.id, null) : [];
      const { rows: absences } = await tx.query<{
        id: string;
        person_kind: 'teacher' | 'staff';
        teacher_id: string | null;
        staff_id: string | null;
        slot: number | null;
        group_id: string | null;
        teaching_id: string | null;
        starts_at: string | null;
        ends_at: string | null;
        minutes: number | null;
        label: string;
        justified: boolean;
        reason: string | null;
        recorded_by: string | null;
        t_first: string | null;
        t_last: string | null;
      }>(
        `SELECT a.id, a.person_kind, a.teacher_id, a.staff_id, a.slot, a.group_id, a.teaching_id,
                a.starts_at::text, a.ends_at::text, a.minutes, a.label, a.justified, a.reason,
                u.full_name AS recorded_by, t.first_name AS t_first, t.last_name AS t_last
           FROM personnel_absences a
           LEFT JOIN users u ON u.id = a.recorded_by
           LEFT JOIN teachers t ON t.id = a.teacher_id
          WHERE a.absence_date = $1
          ORDER BY a.slot NULLS LAST, a.starts_at NULLS LAST`,
        [date],
      );
      const lue = (a: (typeof absences)[number]): AbsenceLue => ({
        id: a.id,
        justified: a.justified,
        reason: a.reason,
        minutes: a.minutes,
        debut: a.starts_at ? heureCourte(a.starts_at) : null,
        fin: a.ends_at ? heureCourte(a.ends_at) : null,
        recordedBy: a.recorded_by,
      });

      // ── Professeurs ──
      const profs = new Map<string, ProfesseurDuJour>();
      const utilisees = new Set<string>();
      for (const s of seances) {
        const c = creneau(s.slot);
        const p = profs.get(s.teacher_id) ?? { teacherId: s.teacher_id, nom: `${s.first_name} ${s.last_name}`.trim(), seances: [] };
        const a = absences.find(
          (x) => x.person_kind === 'teacher' && x.teacher_id === s.teacher_id && x.slot === s.slot && x.group_id === s.group_id,
        );
        if (a) utilisees.add(a.id);
        p.seances.push({
          slot: s.slot,
          creneau: c.libelle,
          debut: c.debut,
          fin: c.fin,
          minutes: c.minutes,
          groupId: s.group_id,
          groupe: s.level_name && !s.group_name.startsWith(s.level_name) ? `${s.level_name} — ${s.group_name}` : s.group_name,
          matiere: s.subject,
          teachingId: s.teaching_id,
          horsGrille: false,
          absence: a ? lue(a) : null,
        });
        profs.set(s.teacher_id, p);
      }
      // Une absence enregistrée dont la séance a quitté la grille reste visible.
      for (const a of absences) {
        if (a.person_kind !== 'teacher' || utilisees.has(a.id) || !a.teacher_id) continue;
        const c = creneau(a.slot!);
        const p = profs.get(a.teacher_id) ?? { teacherId: a.teacher_id, nom: `${a.t_first ?? ''} ${a.t_last ?? ''}`.trim(), seances: [] };
        const [groupe, ...reste] = a.label.split(' — ');
        p.seances.push({
          slot: a.slot!,
          creneau: c.libelle,
          debut: c.debut,
          fin: c.fin,
          minutes: a.minutes,
          groupId: a.group_id,
          groupe: groupe ?? a.label,
          matiere: reste.join(' — '),
          teachingId: a.teaching_id,
          horsGrille: true,
          absence: lue(a),
        });
        p.seances.sort((x, y) => x.slot - y.slot);
        profs.set(a.teacher_id, p);
      }

      // ── Agents ──
      const { rows: horaires } = await tx.query<{
        id: string;
        staff_id: string;
        first_name: string;
        last_name: string;
        role_title: string;
        starts_at: string;
        ends_at: string;
      }>(
        `SELECT h.id, h.staff_id, s.first_name, s.last_name, s.role_title, h.starts_at::text, h.ends_at::text
           FROM staff_work_hours h
           JOIN staff s ON s.id = h.staff_id
          WHERE h.day_of_week = $1 AND s.is_active
          ORDER BY s.last_name, s.first_name, h.starts_at`,
        [jour],
      );
      const agents = new Map<string, AgentDuJour>();
      const utiliseesAgent = new Set<string>();
      for (const h of horaires) {
        const ag = agents.get(h.staff_id) ?? {
          staffId: h.staff_id,
          nom: `${h.first_name} ${h.last_name}`.trim(),
          fonction: h.role_title,
          periodes: [],
        };
        const debut = heureCourte(h.starts_at);
        const fin = heureCourte(h.ends_at);
        const dedans = absences.filter(
          (a) =>
            a.person_kind === 'staff' && a.staff_id === h.staff_id &&
            heureCourte(a.starts_at!) >= debut && heureCourte(a.ends_at!) <= fin,
        );
        for (const a of dedans) utiliseesAgent.add(a.id);
        ag.periodes.push({ workHoursId: h.id, debut, fin, minutes: minutesEntre(debut, fin), absences: dedans.map(lue) });
        agents.set(h.staff_id, ag);
      }
      const orphelines = absences.filter((a) => a.person_kind === 'staff' && !utiliseesAgent.has(a.id));
      if (orphelines.length > 0) {
        const { rows: fiches } = await tx.query<{ id: string; first_name: string; last_name: string; role_title: string }>(
          'SELECT id, first_name, last_name, role_title FROM staff WHERE id = ANY($1::uuid[])',
          [orphelines.map((a) => a.staff_id)],
        );
        for (const a of orphelines) {
          const f = fiches.find((x) => x.id === a.staff_id);
          const ag = agents.get(a.staff_id!) ?? {
            staffId: a.staff_id!,
            nom: f ? `${f.first_name} ${f.last_name}`.trim() : a.label,
            fonction: f?.role_title ?? a.label,
            periodes: [],
          };
          const debut = heureCourte(a.starts_at!);
          const fin = heureCourte(a.ends_at!);
          ag.periodes.push({ workHoursId: null, debut, fin, minutes: minutesEntre(debut, fin), absences: [lue(a)] });
          ag.periodes.sort((x, y) => x.debut.localeCompare(y.debut));
          agents.set(a.staff_id!, ag);
        }
      }

      const { rows: sans } = await tx.query<{ id: string; first_name: string; last_name: string; role_title: string }>(
        `SELECT s.id, s.first_name, s.last_name, s.role_title
           FROM staff s
          WHERE s.is_active AND NOT EXISTS (SELECT 1 FROM staff_work_hours h WHERE h.staff_id = s.id)
          ORDER BY s.last_name, s.first_name`,
      );

      return {
        date,
        jour,
        libelleJour: libelleJour(jour),
        annee: annee ? { id: annee.id, label: annee.label } : null,
        professeurs: [...profs.values()],
        agents: [...agents.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
        agentsSansHoraires: sans.map((s) => ({ staffId: s.id, nom: `${s.first_name} ${s.last_name}`.trim(), fonction: s.role_title })),
      };
    });
  }

  /** La date d'une absence : valable, et pas plus de `JOURS_D_AVANCE` jours à l'avance. */
  private dateDeclarable(date: string): string {
    dateValide(date);
    if (date > decaler(aujourdhuiIso(), JOURS_D_AVANCE)) {
      throw new BadRequestException(
        `On ne déclare pas une absence plus de ${JOURS_D_AVANCE} jours à l'avance.`,
      );
    }
    return date;
  }

  /**
   * DÉCLARER UN PROFESSEUR ABSENT — à des séances de SON emploi du temps de ce
   * jour (ou à toutes : `touteLaJournee`). Une séance déjà déclarée n'est pas
   * recréée (idempotent) ; une séance qui n'est pas la sienne ce jour-là est
   * refusée, nommément.
   */
  async declarerProfesseur(
    input: {
      date: string;
      teacherId: string;
      seances?: { slot: number; groupId: string }[];
      touteLaJournee?: boolean;
      reason?: string | null;
    },
    actorId: string,
  ): Promise<{ creees: number; dejaDeclarees: number; ids: string[] }> {
    const date = this.dateDeclarable(input.date);
    const jour = jourIso(date);
    const annee = await this.anneeDeLaDate(date);
    if (!annee) throw new BadRequestException("Aucune année scolaire : l'emploi du temps est vide.");
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows: prof } = await tx.query<{ first_name: string; last_name: string }>(
        'SELECT first_name, last_name FROM teachers WHERE id = $1',
        [input.teacherId],
      );
      if (!prof[0]) throw new NotFoundException('Professeur introuvable.');
      const nom = `${prof[0].first_name} ${prof[0].last_name}`.trim();
      const siennes = await this.seancesDuJour(tx, jour, annee.id, input.teacherId);
      if (siennes.length === 0) {
        throw new BadRequestException(`${nom} n'a aucune séance le ${libelleJour(jour).toLowerCase()} dans l'emploi du temps.`);
      }
      const voulues = input.touteLaJournee
        ? siennes
        : (input.seances ?? []).map((v) => {
            const s = siennes.find((x) => x.slot === v.slot && x.group_id === v.groupId);
            if (!s) {
              throw new BadRequestException(
                `Le créneau ${creneau(v.slot).libelle} de cette classe n'est pas dans l'emploi du temps de ${nom} le ${libelleJour(jour).toLowerCase()}.`,
              );
            }
            return s;
          });
      if (voulues.length === 0) throw new BadRequestException('Cochez au moins une séance.');

      const ids: string[] = [];
      let deja = 0;
      for (const s of voulues) {
        const c = creneau(s.slot);
        const groupe = s.level_name && !s.group_name.startsWith(s.level_name) ? `${s.level_name} — ${s.group_name}` : s.group_name;
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO personnel_absences
             (school_id, person_kind, teacher_id, absence_date, slot, group_id, teaching_id,
              starts_at, ends_at, minutes, label, reason, recorded_by)
           VALUES ($1, 'teacher', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [schoolId, input.teacherId, date, s.slot, s.group_id, s.teaching_id, c.debut, c.fin, c.minutes,
           `${groupe} — ${s.subject}`, input.reason?.trim() || null, actorId],
        );
        if (rows[0]) ids.push(rows[0].id);
        else deja++;
      }
      await this.audit.record(
        {
          actorId, schoolId, action: 'personnel.absence.declarer', entity: 'teacher', entityId: input.teacherId,
          after: { date, seances: voulues.map((s) => ({ slot: s.slot, groupId: s.group_id })), creees: ids.length },
        },
        tx,
      );
      return { creees: ids.length, dejaDeclarees: deja, ids };
    });
  }

  /**
   * DÉCLARER UN AGENT ABSENT — sur une période de SES horaires de ce jour, en
   * entier ou en partie (`debut`/`fin` compris dans la période), ou sur toutes
   * (`touteLaJournee`). Deux absences d'un même agent ne se chevauchent pas.
   */
  async declarerAgent(
    input: {
      date: string;
      staffId: string;
      periodes?: { workHoursId: string; debut?: string; fin?: string }[];
      touteLaJournee?: boolean;
      reason?: string | null;
    },
    actorId: string,
  ): Promise<{ creees: number; dejaDeclarees: number; ids: string[] }> {
    const date = this.dateDeclarable(input.date);
    const jour = jourIso(date);
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows: agent } = await tx.query<{ first_name: string; last_name: string; role_title: string; is_active: boolean }>(
        'SELECT first_name, last_name, role_title, is_active FROM staff WHERE id = $1',
        [input.staffId],
      );
      if (!agent[0]) throw new NotFoundException('Agent introuvable.');
      const nom = `${agent[0].first_name} ${agent[0].last_name}`.trim();
      const { rows: horaires } = await tx.query<{ id: string; starts_at: string; ends_at: string }>(
        `SELECT id, starts_at::text, ends_at::text FROM staff_work_hours
          WHERE staff_id = $1 AND day_of_week = $2 ORDER BY starts_at`,
        [input.staffId, jour],
      );
      if (horaires.length === 0) {
        throw new BadRequestException(`${nom} ne travaille pas le ${libelleJour(jour).toLowerCase()} (horaires de l'agent).`);
      }
      const voulues = input.touteLaJournee
        ? horaires.map((h) => ({ debut: heureCourte(h.starts_at), fin: heureCourte(h.ends_at) }))
        : (input.periodes ?? []).map((p) => {
            const h = horaires.find((x) => x.id === p.workHoursId);
            if (!h) throw new BadRequestException(`Cette période n'est pas dans les horaires de ${nom} le ${libelleJour(jour).toLowerCase()}.`);
            const hDebut = heureCourte(h.starts_at);
            const hFin = heureCourte(h.ends_at);
            const debut = p.debut ?? hDebut;
            const fin = p.fin ?? hFin;
            if (!HEURE.test(debut) || !HEURE.test(fin)) throw new BadRequestException('Heure invalide (HH:MM).');
            if (fin <= debut) throw new BadRequestException("L'heure de fin doit suivre l'heure de début.");
            if (debut < hDebut || fin > hFin) {
              throw new BadRequestException(`${debut} – ${fin} sort de la période de travail ${hDebut} – ${hFin} de ${nom}.`);
            }
            return { debut, fin };
          });
      if (voulues.length === 0) throw new BadRequestException('Cochez au moins une période.');

      const { rows: existantes } = await tx.query<{ starts_at: string; ends_at: string }>(
        `SELECT starts_at::text, ends_at::text FROM personnel_absences
          WHERE person_kind = 'staff' AND staff_id = $1 AND absence_date = $2`,
        [input.staffId, date],
      );
      const ids: string[] = [];
      let deja = 0;
      for (const v of voulues) {
        const memes = existantes.some((e) => heureCourte(e.starts_at) === v.debut && heureCourte(e.ends_at) === v.fin);
        if (memes) {
          deja++;
          continue;
        }
        const chevauche = existantes.find((e) => heureCourte(e.starts_at) < v.fin && heureCourte(e.ends_at) > v.debut);
        if (chevauche) {
          throw new ConflictException(
            `${nom} est déjà déclaré absent de ${heureCourte(chevauche.starts_at)} à ${heureCourte(chevauche.ends_at)} ce jour-là.`,
          );
        }
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO personnel_absences
             (school_id, person_kind, staff_id, absence_date, starts_at, ends_at, minutes, label, reason, recorded_by)
           VALUES ($1, 'staff', $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [schoolId, input.staffId, date, v.debut, v.fin, minutesEntre(v.debut, v.fin), agent[0].role_title,
           input.reason?.trim() || null, actorId],
        );
        ids.push(rows[0]!.id);
        existantes.push({ starts_at: v.debut, ends_at: v.fin });
      }
      await this.audit.record(
        { actorId, schoolId, action: 'personnel.absence.declarer', entity: 'staff', entityId: input.staffId, after: { date, periodes: voulues } },
        tx,
      );
      return { creees: ids.length, dejaDeclarees: deja, ids };
    });
  }

  /** Justifier une absence, ou retirer la justification — la direction. */
  async justifier(id: string, input: { justified: boolean; reason?: string | null }, actorId: string) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ justified: boolean; reason: string | null }>(
        'SELECT justified, reason FROM personnel_absences WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!rows[0]) throw new NotFoundException('Absence introuvable.');
      const reason = input.reason === undefined ? rows[0].reason : input.reason?.trim() || null;
      await tx.query(
        `UPDATE personnel_absences
            SET justified = $2, reason = $3,
                justified_by = CASE WHEN $2 THEN $4::uuid ELSE NULL END,
                justified_at = CASE WHEN $2 THEN now() ELSE NULL END
          WHERE id = $1`,
        [id, input.justified, reason, actorId],
      );
      await this.audit.record(
        { actorId, schoolId, action: 'personnel.absence.justifier', entity: 'personnel_absence', entityId: id,
          before: rows[0], after: { justified: input.justified, reason } },
        tx,
      );
      return { ok: true as const, justified: input.justified };
    });
  }

  /**
   * RETIRER UNE ABSENCE — une erreur de saisie. Une absence déjà JUSTIFIÉE est
   * une décision de la direction : elle seule la retire.
   */
  async retirer(id: string, actorId: string, roles: readonly string[]) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<Record<string, unknown> & { justified: boolean }>(
        `SELECT person_kind, teacher_id, staff_id, absence_date::text, slot, starts_at::text, ends_at::text,
                label, justified, reason
           FROM personnel_absences WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException('Absence introuvable.');
      if (rows[0].justified && !estDirection(roles)) {
        throw new ForbiddenException('Cette absence est justifiée : seule la direction peut la retirer.');
      }
      await tx.query('DELETE FROM personnel_absences WHERE id = $1', [id]);
      await this.audit.record(
        { actorId, schoolId, action: 'personnel.absence.retirer', entity: 'personnel_absence', entityId: id, before: rows[0] },
        tx,
      );
      return { ok: true as const };
    });
  }

  /**
   * LA SYNTHÈSE D'UN MOIS — par personne : absences, justifiées, heures
   * manquées. Un professeur que la grille met dans deux classes au même
   * créneau manque deux séances, mais ses heures ne comptent qu'une fois.
   */
  async synthese(month: number, year: number): Promise<{ month: number; year: number; lignes: LigneSynthese[] }> {
    const debut = `${year}-${String(month).padStart(2, '0')}-01`;
    const fin = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        kind: 'teacher' | 'staff';
        person_id: string;
        nom: string;
        fonction: string;
        absences: number;
        justifiees: number;
        minutes: number;
        minutes_justifiees: number;
        sans_duree: number;
      }>(
        `WITH a AS (
           SELECT *, row_number() OVER (
                    PARTITION BY person_kind, teacher_id, absence_date, slot
                    ORDER BY justified DESC, id) AS rang
             FROM personnel_absences
            WHERE absence_date >= $1 AND absence_date < $2
         )
         SELECT a.person_kind AS kind,
                COALESCE(a.teacher_id, a.staff_id) AS person_id,
                COALESCE(TRIM(t.first_name || ' ' || t.last_name), TRIM(s.first_name || ' ' || s.last_name)) AS nom,
                CASE WHEN a.person_kind = 'teacher' THEN 'Professeur' ELSE s.role_title END AS fonction,
                count(*)::int AS absences,
                count(*) FILTER (WHERE a.justified)::int AS justifiees,
                COALESCE(SUM(a.minutes) FILTER (WHERE a.person_kind = 'staff' OR a.rang = 1), 0)::int AS minutes,
                COALESCE(SUM(a.minutes) FILTER (WHERE a.justified AND (a.person_kind = 'staff' OR a.rang = 1)), 0)::int
                  AS minutes_justifiees,
                count(*) FILTER (WHERE a.minutes IS NULL)::int AS sans_duree
           FROM a
           LEFT JOIN teachers t ON t.id = a.teacher_id
           LEFT JOIN staff s ON s.id = a.staff_id
          GROUP BY a.person_kind, COALESCE(a.teacher_id, a.staff_id), t.first_name, t.last_name,
                   s.first_name, s.last_name, s.role_title
          ORDER BY a.person_kind DESC, nom`,
        [debut, fin],
      );
      return {
        month,
        year,
        lignes: rows.map((r) => ({
          kind: r.kind,
          personId: r.person_id,
          nom: r.nom,
          fonction: r.fonction,
          absences: r.absences,
          justifiees: r.justifiees,
          minutes: r.minutes,
          minutesJustifiees: r.minutes_justifiees,
          sansDuree: r.sans_duree,
        })),
      };
    });
  }

  /** Les absences d'une période (au plus 93 jours), d'une personne ou de tous. */
  async liste(input: { from: string; to: string; kind?: 'teacher' | 'staff'; personId?: string }) {
    dateValide(input.from);
    dateValide(input.to);
    if (input.to < input.from) throw new BadRequestException('La fin précède le début.');
    if (input.to > decaler(input.from, 92)) throw new BadRequestException('Au plus trois mois à la fois.');
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT a.id, a.person_kind AS kind, COALESCE(a.teacher_id, a.staff_id) AS "personId",
                COALESCE(TRIM(t.first_name || ' ' || t.last_name), TRIM(s.first_name || ' ' || s.last_name)) AS nom,
                to_char(a.absence_date, 'YYYY-MM-DD') AS date, a.slot,
                to_char(a.starts_at, 'HH24:MI') AS debut, to_char(a.ends_at, 'HH24:MI') AS fin,
                a.minutes, a.label, a.justified, a.reason, u.full_name AS "recordedBy"
           FROM personnel_absences a
           LEFT JOIN teachers t ON t.id = a.teacher_id
           LEFT JOIN staff s ON s.id = a.staff_id
           LEFT JOIN users u ON u.id = a.recorded_by
          WHERE a.absence_date BETWEEN $1 AND $2
            AND ($3::payee_kind IS NULL OR a.person_kind = $3::payee_kind)
            AND ($4::uuid IS NULL OR a.teacher_id = $4::uuid OR a.staff_id = $4::uuid)
          ORDER BY a.absence_date DESC, nom, a.slot NULLS LAST, a.starts_at NULLS LAST`,
        [input.from, input.to, input.kind ?? null, input.personId ?? null],
      );
      return rows;
    });
  }

  // ── Les horaires des agents ───────────────────────────────────────────────

  /** Tous les agents et leurs horaires (actifs d'abord). */
  async horaires() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        first_name: string;
        last_name: string;
        role_title: string;
        is_active: boolean;
        periodes: { jour: number; debut: string; fin: string }[] | null;
      }>(
        `SELECT s.id, s.first_name, s.last_name, s.role_title, s.is_active,
                json_agg(json_build_object('jour', h.day_of_week,
                                           'debut', to_char(h.starts_at, 'HH24:MI'),
                                           'fin', to_char(h.ends_at, 'HH24:MI'))
                         ORDER BY h.day_of_week, h.starts_at)
                  FILTER (WHERE h.id IS NOT NULL) AS periodes
           FROM staff s
           LEFT JOIN staff_work_hours h ON h.staff_id = s.id
          GROUP BY s.id
          ORDER BY s.is_active DESC, s.last_name, s.first_name`,
      );
      return rows.map((r) => ({
        staffId: r.id,
        nom: `${r.first_name} ${r.last_name}`.trim(),
        fonction: r.role_title,
        actif: r.is_active,
        periodes: r.periodes ?? [],
      }));
    });
  }

  /**
   * FIXER LES HORAIRES D'UN AGENT — la semaine entière, remplacée d'un bloc.
   * Des heures HH:MM, la fin après le début, aucun chevauchement dans un jour.
   * Les absences déjà déclarées gardent leurs heures (elles sont recopiées).
   */
  async definirHoraires(
    staffId: string,
    periodes: { jour: number; debut: string; fin: string }[],
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    for (const p of periodes) {
      if (!Number.isInteger(p.jour) || p.jour < 1 || p.jour > 7) throw new BadRequestException('Jour invalide.');
      if (!HEURE.test(p.debut) || !HEURE.test(p.fin)) {
        throw new BadRequestException(`${libelleJour(p.jour)} : heure invalide (HH:MM).`);
      }
      if (minutesDuJour(p.fin) <= minutesDuJour(p.debut)) {
        throw new BadRequestException(`${libelleJour(p.jour)} : la fin (${p.fin}) doit suivre le début (${p.debut}).`);
      }
    }
    const tries = [...periodes].sort((a, b) => a.jour - b.jour || a.debut.localeCompare(b.debut));
    for (let i = 1; i < tries.length; i++) {
      const a = tries[i - 1]!;
      const b = tries[i]!;
      if (a.jour === b.jour && b.debut < a.fin) {
        throw new BadRequestException(`${libelleJour(a.jour)} : ${a.debut} – ${a.fin} et ${b.debut} – ${b.fin} se chevauchent.`);
      }
    }
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ first_name: string; last_name: string }>(
        'SELECT first_name, last_name FROM staff WHERE id = $1 FOR UPDATE',
        [staffId],
      );
      if (!rows[0]) throw new NotFoundException('Agent introuvable.');
      const { rows: avant } = await tx.query(
        `SELECT day_of_week AS jour, to_char(starts_at, 'HH24:MI') AS debut, to_char(ends_at, 'HH24:MI') AS fin
           FROM staff_work_hours WHERE staff_id = $1 ORDER BY day_of_week, starts_at`,
        [staffId],
      );
      await tx.query('DELETE FROM staff_work_hours WHERE staff_id = $1', [staffId]);
      for (const p of tries) {
        await tx.query(
          `INSERT INTO staff_work_hours (school_id, staff_id, day_of_week, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [schoolId, staffId, p.jour, p.debut, p.fin],
        );
      }
      await this.audit.record(
        { actorId, schoolId, action: 'personnel.horaires', entity: 'staff', entityId: staffId, before: avant, after: tries },
        tx,
      );
      return { ok: true as const, periodes: tries.length };
    });
  }
}
