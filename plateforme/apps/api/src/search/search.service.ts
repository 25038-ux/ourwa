import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';

/**
 * Global search — El Ourwa's `recherche.php`.
 *
 * `recherche.globale` has been granted to two roles since the permission
 * catalogue was seeded and did nothing at all. "Global" means across the kinds
 * of record a school holds, NOT across schools: every query below runs inside
 * the tenant transaction and RLS scopes it to one branch. A search that reached
 * another school would be the single worst bug this system could have.
 */
@Injectable()
export class SearchService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Ses deux requêtes : les étudiants (nom, prénom, matricule, nom du
   * correspondant, téléphone du correspondant en chiffres — `LIMIT 50`, par nom
   * puis prénom) et les professeurs (nom, prénom, identifiant de connexion —
   * `LIMIT 50`). La classe est la dernière inscription non annulée.
   */
  async search(q: string, limit = 50) {
    const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/\D/g, '');

    return this.db.query(async (tx) => {
      const [students, teachers] = await Promise.all([
        tx.query(
          `SELECT s.id, s.first_name, s.last_name, s.matricule, s.rim, s.national_id,
                  g.name AS group_name, l.name AS level_name, s.has_left
             FROM students s
             LEFT JOIN users u ON u.id = s.guardian_id
             LEFT JOIN LATERAL (
               SELECT en.group_id, en.level_id
                 FROM enrollments en
                 JOIN academic_years y ON y.id = en.academic_year_id
                WHERE en.student_id = s.id AND en.status <> 'cancelled'
                ORDER BY y.start_year DESC
                LIMIT 1
             ) e ON true
             LEFT JOIN groups g ON g.id = e.group_id
             LEFT JOIN levels l ON l.id = COALESCE(e.level_id, g.level_id)
            WHERE s.last_name ILIKE $1 ESCAPE '\\'
               OR s.first_name ILIKE $1 ESCAPE '\\'
               OR s.matricule ILIKE $1 ESCAPE '\\'
               OR u.full_name ILIKE $1 ESCAPE '\\'
               OR ($3 <> '' AND replace(replace(replace(coalesce(u.phone, ''), ' ', ''), '-', ''), '+', '') LIKE '%' || $3 || '%')
            ORDER BY s.last_name, s.first_name
            LIMIT $2`,
          [term, limit, digits],
        ),
        tx.query(
          `SELECT t.id, t.first_name, t.last_name, t.phone, t.employment,
                  COALESCE(u.username, u.email, u.phone) AS identifiant,
                  (SELECT count(DISTINCT g.group_id)::int FROM teachings g WHERE g.teacher_id = t.id) AS nb_classes
             FROM teachers t
             LEFT JOIN users u ON u.id = t.user_id
            WHERE t.last_name ILIKE $1 ESCAPE '\\' OR t.first_name ILIKE $1 ESCAPE '\\'
               OR COALESCE(u.username, u.email, u.phone) ILIKE $1 ESCAPE '\\'
            ORDER BY t.last_name, t.first_name
            LIMIT $2`,
          [term, limit],
        ),
      ]);

      return {
        query: q,
        students: students.rows,
        teachers: teachers.rows,
        total: students.rows.length + teachers.rows.length,
      };
    });
  }

  /**
   * LA FICHE D'UN ÉTUDIANT — `recherche.php?type=etudiant&profil_id=…`.
   *
   * ⚠ SA RECHERCHE MÈNE QUELQUE PART. Sa colonne « Action » ouvre cette fiche :
   * neuf renseignements, le relevé des notes, et le bouton d'expulsion. La
   * nôtre rendait une liste morte, sans un lien.
   *
   * ⚠ `monthly_fee` VIENT DE L'INSCRIPTION, PAS DU NIVEAU. Sa page lit
   * `tarif_mensuel ?? frais_mensuel` — le tarif du niveau d'abord, celui de
   * l'élève ensuite. C'est l'inverse : une famille qui a obtenu une remise paie
   * ce que porte SON inscription, et afficher le tarif du niveau dirait à
   * l'accueil un chiffre que la famille ne reconnaîtra pas. Voir ADR-0040.
   *
   * Rien n'est filtré par `school_id` à la main : RLS le fait, et un test dit
   * qu'un identifiant de l'autre école rend `null` plutôt qu'une fiche.
   */
  async studentProfile(id: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        first_name: string;
        last_name: string;
        sex: string | null;
        rim: string;
        national_id: string;
        matricule: string | null;
        level_name: string | null;
        group_name: string | null;
        guardian_name: string | null;
        guardian_phone: string | null;
        monthly_fee: string | null;
        enrolled_at: string | null;
        has_left: boolean;
      }>(
        `SELECT s.id, s.first_name, s.last_name, s.sex, s.rim, s.national_id,
                s.matricule, s.has_left,
                l.name AS level_name, g.name AS group_name,
                u.full_name AS guardian_name, u.phone AS guardian_phone,
                e.monthly_fee::text,
                -- Son « Inscrit le » : etudiants.date_inscription (chez nous students.created_at, repris tel quel).
                s.created_at::date AS enrolled_at
           FROM students s
           LEFT JOIN users u ON u.id = s.guardian_id
           LEFT JOIN LATERAL (
             SELECT en.monthly_fee, en.level_id, en.group_id
               FROM enrollments en
               JOIN academic_years y ON y.id = en.academic_year_id
              WHERE en.student_id = s.id AND en.status <> 'cancelled'
              ORDER BY y.start_year DESC
              LIMIT 1
           ) e ON true
           LEFT JOIN levels l ON l.id = e.level_id
           LEFT JOIN groups g ON g.id = e.group_id
          WHERE s.id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Son relevé — Trimestre · Matière · Type · Note · Professeur.
   *
   * ⚠ LA NOTE SORT BRUTE, Y COMPRIS LE MARQUEUR D'ABSENCE. `-1` n'est pas une
   * note (règle 11) : rien n'est moyenné ici, et l'écran l'écrit « Absent ».
   * Une moyenne calculée ici serait fausse et le serait en silence.
   */
  async studentGrades(studentId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        term: number;
        subject: string;
        kind: string;
        score: string;
        teacher: string | null;
      }>(
        `SELECT gr.term, sub.name AS subject, gr.kind::text, gr.score::text,
                NULLIF(TRIM(CONCAT_WS(' ', t.first_name, t.last_name)), '') AS teacher
           FROM grades gr
           JOIN teachings te ON te.id = gr.teaching_id
           JOIN subjects sub ON sub.id = te.subject_id
           LEFT JOIN teachers t ON t.id = te.teacher_id
          WHERE gr.student_id = $1
          ORDER BY gr.term, sub.name, gr.kind, gr.sequence_no`,
        [studentId],
      );
      return rows;
    });
  }

  /**
   * LA FICHE D'UN PROFESSEUR — `recherche.php?type=professeur&profil_id=…`.
   *
   * « Classes » et « Heures/mois » se COMPTENT depuis les enseignements de
   * l'année en cours : ce ne sont pas des colonnes, et les stocker les ferait
   * mentir dès la première assignation ajoutée. Le mois vaut quatre semaines,
   * comme partout ailleurs dans la paie.
   */
  async teacherProfile(id: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        first_name: string;
        last_name: string;
        phone: string | null;
        employment: string | null;
        hourly_rate: string;
        salary: string;
        classes: number;
        hours_per_month: number;
        identifier: string | null;
        last_seen: string | null;
      }>(
        `SELECT t.id, t.first_name, t.last_name, t.phone, t.employment,
                t.hourly_rate::text, t.salary::text,
                -- Ses colonnes nb_classes et heures_par_mois (recalculer_salaire) :
                -- groupes distincts et heures × 4, sur TOUTES les affectations.
                COALESCE(a.classes, 0)::int AS classes,
                COALESCE(a.hours, 0)::int   AS hours_per_month,
                COALESCE(u.username, u.email, u.phone) AS identifier,
                u.last_login_at             AS last_seen
           FROM teachers t
           LEFT JOIN users u ON u.id = t.user_id
           LEFT JOIN LATERAL (
             SELECT count(DISTINCT te.group_id) AS classes, round(SUM(te.hours_per_week) * 4) AS hours
               FROM teachings te
              WHERE te.teacher_id = t.id
           ) a ON true
          WHERE t.id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
  }

  /** « Enseignements (par Niveau) » — son `SQL_ENS_COURANTS` (toutes années, une affectation par groupe et matière), son ordre : cycle, rang, niveau, groupe. */
  async teacherTeachings(teacherId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        level_name: string | null;
        group_name: string;
        subject_name: string;
      }>(
        `SELECT l.name AS level_name, g.name AS group_name, sub.name AS subject_name
           FROM (SELECT DISTINCT ON (t1.group_id, t1.subject_id) t1.*
                   FROM teachings t1
                  ORDER BY t1.group_id, t1.subject_id, (t1.legacy_id IS NULL) DESC, t1.legacy_id DESC, t1.id DESC) te
           JOIN groups g ON g.id = te.group_id
           JOIN subjects sub ON sub.id = te.subject_id
           LEFT JOIN levels l ON l.id = g.level_id
          WHERE te.teacher_id = $1
          ORDER BY l.cycle, l.sort_order, l.name, g.name`,
        [teacherId],
      );
      return rows;
    });
  }
}
