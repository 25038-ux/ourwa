import { Body, Controller, Delete, ForbiddenException, Get, Inject, Param, Post, Query, Res, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { BULLETIN_CSS, esc, renderBulletinDocument, type BulletinCard } from '@elourwa/shared';
import { z } from 'zod';
import { NOTE_ABSENT } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { DebtService } from '../finance/debt.service.js';
import { ExamAccessService } from '../exams/exam-access.service.js';
import { AcademicYearService } from '../academic/academic-year.service.js';
import { CommsService } from '../comms/comms.service.js';
import { NotificationsService } from './notifications.service.js';
import { PushService } from '../push/push.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { envoyer } from '../documents/documents.controller.js';
// ⚠ ONE bulletin, shared (`reportCardFor`). The parent space had its own copy
// of the calculation and the two were already one correction apart — the
// drift El Ourwa's own `bulletin.php` records and cured the same way.
import { GradesService } from '../grades/grades.service.js';
import { RequireRole, type AuthenticatedRequest } from '../auth/permissions.guard.js';
import { Req } from '@nestjs/common';
import { currentTenant, runInTenant } from '../tenant/tenant.context.js';
import { money, toStorage } from '@elourwa/shared';

/** Une école d'une famille — libellée pour l'application. */
interface Ecole {
  id: string;
  slug: string;
  name: string;
  nameAr: string | null;
}
const etiquette = (e: Ecole) => ({ slug: e.slug, name: e.name, nameAr: e.nameAr });
const parDate = (cle: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
  new Date(String(b[cle] ?? 0)).getTime() - new Date(String(a[cle] ?? 0)).getTime();

const uuid = z.string().uuid();

/**
 * The parent surface — what the mobile app reads.
 *
 * ⚠ EVERY handler re-checks that the child belongs to the caller. Scoping by
 * `guardian_id` in the query is not enough on its own: a guardian who guesses
 * another child's id must be refused, not merely return nothing. RLS keeps other
 * SCHOOLS out; this keeps other FAMILIES out within a school.
 */
/**
 * ⚠ EVERY ENDPOINT HERE IS SCOPED TO THE ACTIVE YEAR, never to `defaultView()`.
 *
 * `defaultView()` falls back to the most recent year that HAS enrolments. For
 * the office that is right; for a family it is a lie by omission — in the gap
 * between one year closing and the next opening it would present June's marks
 * and June's absences as the current term, with nothing on screen to say
 * otherwise. El Ourwa's own emphasis: "page vide, et SURTOUT sans se rabattre
 * sur l'annee precedente."
 *
 * When no year is active these return empty, and the app shows its empty state.
 * That is the correct answer, not a failure.
 */
/**
 * ⚠ L'ESPACE PARENT EST RÉSERVÉ AUX PARENTS. Chez El Ourwa c'est une session à
 * part (`parent_auth.php`) : un compte du personnel n'y entre pas. Ici chaque
 * route se borne déjà aux enfants du compte appelant — un directeur y voyait une
 * liste vide, rien de plus — mais « rien de plus » n'est pas « rien » : il y
 * lisait l'année en cours et son propre nom sous un libellé « correspondant ».
 * Le rôle est exigé sur toute la classe.
 */
@RequireRole('parent')
@Controller('parent')
export class ParentController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(DebtService) private readonly debts: DebtService,
    @Inject(ExamAccessService) private readonly examAccess: ExamAccessService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(CommsService) private readonly comms: CommsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(GradesService) private readonly gradesService: GradesService,
      @Inject(PushService) private readonly push: PushService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
) {}

  /** La langue du compte (`parents.langue` chez lui) : ses avis sont bilingues. */
  private async localeOf(userId: string): Promise<string> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ locale: string }>('SELECT locale FROM users WHERE id = $1', [userId]);
      return rows[0]?.locale ?? 'fr';
    });
  }

  private async assertOwnChild(guardianId: string, studentId: string): Promise<void> {
    const owns = await this.db.query(async (tx) => {
      const { rows } = await tx.query(
        'SELECT 1 FROM students WHERE id = $1 AND guardian_id = $2',
        [studentId, guardianId],
      );
      return rows.length > 0;
    });
    if (!owns) throw new ForbiddenException('Cet élève n’est pas votre enfant.');
  }

  /**
   * LES ENFANTS DU CORRESPONDANT — the cards its dashboard is made of.
   *
   * ⚠ EACH CARD CARRIES A MOYENNE AND AN ABSENCE COUNT, which is the whole of
   * what El Ourwa shows a family up front. We were returning names and fees and
   * nothing to put on a card.
   *
   * ⚠ AND THE MOYENNE IS WITHHELD WHEN THE FAMILY IS IN DEBT. Its comment is one
   * line and settles it: "Moyenne masquee en cas de dette : elle EST la note
   * d'examen." The ratchet does not only guard the bulletin — the average on the
   * dashboard IS the exam result, so showing it there would hand back exactly
   * what the bulletin is withholding.
   *
   * ⚠ BOUNDED TO THE ACTIVE YEAR, INCLUDING THE COUNTS. Another bug it records:
   * the dashboard "listait tous les enfants du parent, toutes annees
   * confondues", so a child who left two years ago still appeared beside their
   * siblings, and the counters covered every year at once.
   */
  private async childrenDansEcole(@Req() request: AuthenticatedRequest) {
    const guardianId = request.auth!.userId;
    const year = await this.years.activeForParent();

    // Nothing is running: the app shows its own empty state rather than a year
    // that has ended (see the note on this controller).
    if (!year) {
      return { academicYear: null, guardianName: null, children: [] };
    }

    // ⚠ null student, null term: the card's average spans the whole year, so
    // the question is whether this family may see exam results AT ALL — the
    // same question `parent_peut_voir_examens($db, $pid, null, $an, null)` asks.
    const seesExams = await this.examAccess.canSeeExams(guardianId, null, year.id, null);
    // ⚠ Les dates que l'année POSSÈDE (rentrée comprise), pas ses mois nominaux.
    const periode = await this.years.periodeAttribuee(year);

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.first_name, s.last_name, s.sex, s.date_of_birth,
                g.name AS group_name, l.name AS level_name,
                e.is_free, e.monthly_fee, e.status,
                -- ⚠ attendance HAS NO academic_year_id. This said
                -- a.academic_year_id = $2 and Postgres answered "column
                -- a.academic_year_id does not exist" — so the parent app's HOME
                -- SCREEN returned 500. Nothing caught it because nothing called
                -- this handler: the suites exercise services, and this query is
                -- inline.
                --
                -- ⚠ AND NOT THROUGH teachings EITHER. teaching_id is nullable —
                -- an absence recorded outside a lesson has none — so joining to
                -- reach the year would drop those rows silently and tell a
                -- family their child had fewer absences than the school
                -- recorded. The school year's own dates bound it instead, which
                -- is a fact about the absence rather than about how it was
                -- entered.
                -- ⚠ ABSENCES **ET** RETARDS. El Ourwa compte
                -- statut IN ("absent","retard"), sur son tableau de bord
                -- comme sur la fiche de l'enfant. Nous ne comptions que les
                -- absences : un enfant huit fois en retard s'affichait à zéro
                -- chez nous et à huit chez lui, sur le chiffre même qu'un
                -- parent regarde en premier.
                (SELECT count(*) FROM attendance a
                  WHERE a.student_id = s.id
                    AND a.on_date >= $4::date AND a.on_date <= $5::date
                    AND a.status IN ('absent', 'late')) AS absences,
                -- ⚠ SON « MATRICULE » — le rang de l'enfant dans sa classe, par
                -- ordre de nom. enfant.php l'affiche sous la classe, en
                -- N°7. C'est le numéro que la famille cite au secrétariat.
                (SELECT count(*) FROM enrollments e2
                   JOIN students s2 ON s2.id = e2.student_id
                  WHERE e2.group_id = e.group_id
                    AND e2.academic_year_id = e.academic_year_id
                    AND e2.status <> 'cancelled'
                    AND (s2.last_name, s2.first_name, s2.id)
                        <= (s.last_name, s.first_name, s.id)) AS class_rank,
                (SELECT avg(gr.score) FROM grades gr
                  WHERE gr.student_id = s.id
                    AND gr.academic_year_id = $2
                    AND gr.score <> $3) AS average
           FROM students s
           LEFT JOIN enrollments e
             ON e.student_id = s.id AND e.academic_year_id = $2
           LEFT JOIN groups g ON g.id = e.group_id
           LEFT JOIN levels l ON l.id = e.level_id
          WHERE s.guardian_id = $1
            AND e.id IS NOT NULL
            AND e.status <> 'cancelled'
          -- Son parent_enfants() : ORDER BY e.nom, e.prenom.
          ORDER BY s.last_name, s.first_name`,
        [guardianId, year.id, NOTE_ABSENT, ...periode],
      );
      // ⚠ The family's OWN name, for the greeting: "Bonsoir, Sidi Bilal 👋".
      // Its dashboard opens with it, in the accent colour.
      const { rows: me } = await tx.query<{ full_name: string }>(
        'SELECT full_name FROM users WHERE id = $1',
        [guardianId],
      );
      return {
        academicYear: year.label,
        guardianName: me[0]?.full_name ?? '',
        children: rows.map((r) => ({
          ...r,
          absences: Number(r.absences ?? 0),
          classRank: Number(r.class_rank ?? 0),
          /**
           * ⚠ NULL WHEN THE FAMILY IS IN DEBT, not zero and not hidden client
           * side. "Moyenne masquee en cas de dette : elle EST la note
           * d'examen." Sending it and letting the app decide would put the mark
           * on the wire, where anyone reading the response has it.
           */
          average: seesExams && r.average != null ? Number(r.average).toFixed(2) : null,
          examsWithheld: !seesExams,
        })),
      };
    });
  }

  /**
   * Messages the school has sent this family.
   *
   * No permission is required beyond being the guardian: the guardian id comes
   * from the token, and the query is scoped to it. A parent role holds no
   * permissions at all by design (PROJECT.md §2.2) — what they may see is
   * defined by whose child it is, not by a grant.
   */
  /**
   * LES MESSAGES — and ⚠ OPENING THE LIST MARKS THEM ALL READ.
   *
   * Its `messages.php` does it in one statement on page load, before it reads
   * anything: `UPDATE messages SET lu = 1 WHERE parent_id = :p`. Not per
   * message, not on tap.
   *
   * That is the behaviour the badge implies. A parent sees "4", opens Messages,
   * and expects the 4 to be gone; per-message read state leaves the badge
   * standing until they have tapped each one, which reads as broken. The unread
   * count returned here is the count BEFORE the update, so the list can still
   * mark which ones were new when it was opened.
   */
  private async messagesDansEcole(@Req() request: AuthenticatedRequest) {
    const guardianId = request.auth!.userId;
    const [messages, unread] = await Promise.all([
      this.comms.messagesFor(guardianId),
      this.comms.unreadCount(guardianId),
    ]);
    await this.comms.markAllRead(guardianId);
    return { unread, messages };
  }

  /**
   * The unread badge on the Messages tab.
   *
   * ⚠ Its header carries this count, and a parent app without it is a parent
   * who does not know a message arrived. The service already computed it and
   * nothing exposed it.
   */
  private async unreadDansEcole(@Req() request: AuthenticatedRequest) {
    return { count: await this.comms.unreadCount(request.auth!.userId) };
  }

  /**
   * LE FLUX DE NOTIFICATIONS — `api/parent/notifications.php`.
   *
   * ⚠ THE TABLE WAS WRITE-ONLY. Rows have been inserted since homework shipped
   * and nothing ever read one back, so a school sent an exercise to thirty
   * families and none were told. Different from `messages`, which is the
   * messagerie: this is the event stream — an absence, a mark, an exercise, a
   * timetable published.
   *
   * ⚠ AND `grade` NOTIFICATIONS ARE WITHHELD FROM A FAMILY IN DEBT, because
   * withholding results is how the school gets paid and an announcement
   * carrying a mark defeats that as completely as the bulletin would.
   */
  private async notificationListDansEcole(@Req() request: AuthenticatedRequest) {
    const year = await this.years.active();
    if (!year) return { items: [], unread: 0 };
    return this.notifications.forGuardian(request.auth!.userId, year.id);
  }

  private async notificationsUnreadDansEcole(@Req() request: AuthenticatedRequest) {
    const year = await this.years.active();
    if (!year) return { count: 0 };
    return { count: await this.notifications.unreadCount(request.auth!.userId, year.id) };
  }

  private async notificationReadDansEcole(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const read = await this.notifications.markRead(uuid.parse(id), request.auth!.userId);
    return { read };
  }

  /**
   * L'appareil se déclare — après la connexion, et à chaque rotation du jeton
   * FCM. `locale` est la langue de l'application à ce moment-là : c'est dans
   * celle-là que le téléphone lira ce qu'on lui pousse.
   */
  private async registerDeviceDansEcole(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = z
      .object({
        platform: z.enum(['android', 'ios', 'web']),
        token: z.string().min(20).max(4096),
        locale: z.enum(['fr', 'ar']).default('fr'),
      })
      .parse(body);
    await this.push.registerDevice(request.auth!.userId, input.platform, input.token, input.locale);
    return { registered: true };
  }

  /** À la déconnexion : ce téléphone ne reçoit plus rien pour ce compte. */
  private async unregisterDeviceDansEcole(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const { token } = z.object({ token: z.string().min(20).max(4096) }).parse(body);
    await this.push.unregisterDevice(request.auth!.userId, token);
    return { registered: false };
  }

  private async notificationsReadAllDansEcole(@Req() request: AuthenticatedRequest) {
    const year = await this.years.active();
    if (!year) return { marked: 0 };
    return this.notifications.markAllRead(request.auth!.userId, year.id);
  }

  private async markReadDansEcole(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.comms.markRead(uuid.parse(id), request.auth!.userId);
  }

  /**
   * A child's absences.
   *
   * Excused and unexcused are reported as the different things they are. A
   * parent who has already sent a note and still sees "absence" beside their
   * child's name will call the school, and they will be right to.
   */
  /**
   * LES ABSENCES D'UN ENFANT — l'onglet « 📅 Absences » de `enfant.php`.
   *
   * ⚠ CETTE LECTURE N'ÉTAIT BORNÉE PAR AUCUNE ANNÉE. Elle disait
   * `WHERE a.student_id = $1`, sans plus : un enfant scolarisé depuis quatre ans
   * cumulait quatre années d'absences sur une page qui annonce l'année en cours,
   * et le grand chiffre rouge de l'en-tête est justement ce qu'un parent regarde
   * en premier. El Ourwa borne la sienne — `AND en.annee_id = :an`.
   *
   * ⚠ ET SON TOTAL COMPTE LES RETARDS. `statut IN ("absent","retard")`, sur le
   * tableau de bord comme sur la fiche. Le détail reste ventilé ici — absences,
   * justifiées, retards — mais `total` porte le nombre qu'il affiche, pour que
   * l'application n'ait pas à refaire l'addition et à s'en écarter.
   *
   * ⚠ ET SES 50 LIGNES, pas 100 : `ORDER BY date DESC LIMIT 50`.
   */
  private async attendanceDansEcole(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const studentId = uuid.parse(id);
    await this.assertOwnChild(request.auth!.userId, studentId);

    const year = await this.years.activeForParent();
    if (!year) {
      return { absences: 0, excused: 0, late: 0, total: 0, entries: [] };
    }
    const bounds = await this.years.periodeAttribuee(year);

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT a.on_date, a.status::text, a.is_excused, a.note,
                sub.name AS subject
           FROM attendance a
           LEFT JOIN teachings t ON t.id = a.teaching_id
           LEFT JOIN subjects sub ON sub.id = t.subject_id
          WHERE a.student_id = $1 AND a.status <> 'present'
            AND a.on_date >= $2::date AND a.on_date <= $3::date
          ORDER BY a.on_date DESC
          LIMIT 50`,
        [studentId, ...bounds],
      );
      const { rows: totals } = await tx.query<{
        absences: string;
        excused: string;
        late: string;
      }>(
        `SELECT count(*) FILTER (WHERE status = 'absent')::text AS absences,
                count(*) FILTER (WHERE status = 'absent' AND is_excused)::text AS excused,
                count(*) FILTER (WHERE status = 'late')::text AS late
           FROM attendance
          WHERE student_id = $1
            AND on_date >= $2::date AND on_date <= $3::date`,
        [studentId, ...bounds],
      );
      const absences = Number(totals[0]!.absences);
      const late = Number(totals[0]!.late);
      return {
        absences,
        excused: Number(totals[0]!.excused),
        late,
        total: absences + late,
        entries: rows,
      };
    });
  }

  /**
   * RÉSULTATS — every mark for the whole family, newest first.
   *
   * ⚠ ITS RÉSULTATS PAGE IS A CHRONOLOGICAL FEED ACROSS ALL THE CHILDREN, not a
   * bulletin and not a term picker. "Toutes les notes saisies par les
   * enseignants, du plus récent au plus ancien." Ours offered three trimester
   * tiles leading to a report card, which answers a different question: a parent
   * opening this wants to know what came in since they last looked, and with
   * four children they want it in one list.
   *
   * ⚠ EXAM MARKS ARE FILTERED OUT WHEN THE FAMILY IS IN DEBT — but only the
   * exam marks. Its query keeps `type_note <> 'examen'` alongside the terms
   * already earned, so devoirs and contrôles keep flowing. Withholding a child's
   * homework marks over a family's arrears would punish the wrong thing.
   */
  private async familyGradesDansEcole(@Req() request: AuthenticatedRequest) {
    const guardianId = request.auth!.userId;
    const year = await this.years.activeForParent();
    if (!year) return { grades: [], examsWithheld: false };

    const visibleTerms = await this.examAccess.visibleTerms(guardianId, year.id);
    // Son resultats.php : `$voit_examens = count($trimestres_examens) === 3` —
    // la question posée trimestre par trimestre, si bien qu'un trimestre
    // refermé par la direction reste retenu même quand la famille ne doit rien
    // (la question globale, sans trimestre, ignorait la fermeture).
    const seesAllExams = visibleTerms.length === 3;

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT g.id,
                (s.first_name || ' ' || s.last_name) AS student_name,
                sub.name  AS subject,
                sub.name_ar AS subject_ar,
                g.score::text,
                sub.max_score::text,
                g.kind::text  AS kind,
                g.term,
                g.recorded_at
           FROM grades g
           JOIN students s   ON s.id = g.student_id
           JOIN teachings te ON te.id = g.teaching_id
           JOIN subjects sub ON sub.id = te.subject_id
          WHERE s.guardian_id = $1
            AND g.academic_year_id = $2
            AND g.score <> $3
            -- Its own predicate: exams are dropped unless the family may see
            -- them, or unless the term itself has already been earned.
            AND ($4::boolean OR g.kind <> 'exam' OR g.term = ANY($5::int[]))
          ORDER BY g.recorded_at DESC, g.id DESC
          LIMIT 300`,
        [guardianId, year.id, NOTE_ABSENT, seesAllExams, visibleTerms],
      );

      return {
        grades: rows.map((r) => ({
          id: r.id,
          studentName: r.student_name,
          subject: r.subject,
          subjectAr: r.subject_ar,
          score: r.score,
          maxScore: r.max_score,
          kind: r.kind,
          term: r.term,
          recordedAt: r.recorded_at,
        })),
        // The app tells the parent WHY the list is shorter than they expect.
        examsWithheld: !seesAllExams,
      };
    });
  }

  /**
   * ⚠ ABSENCES, EXERCICES AND REMARQUES ARE ALL FAMILY-WIDE IN EL OURWA, and all
   * three of ours had a child selector on top. Its queries all read
   * `WHERE e.parent_id = :p` — every child, one list.
   *
   * The selector was my invention and it is the wrong shape for the job. A
   * parent with four children opening "Absences" wants to know whether anyone
   * was absent, not to interrogate each child in turn; the answer they want is
   * usually "no one", and a picker makes that four taps instead of none.
   */

  /** ABSENCES — the whole family, most recent first. */
  private async familyAttendanceDansEcole(@Req() request: AuthenticatedRequest) {
    const guardianId = request.auth!.userId;
    const year = await this.years.activeForParent();
    if (!year) return { entries: [] };
    const periode = await this.years.periodeAttribuee(year);

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT a.id,
                (s.first_name || ' ' || s.last_name) AS student_name,
                a.on_date, a.status::text, a.is_excused AS excused,
                sub.name AS subject
           FROM attendance a
           JOIN students s ON s.id = a.student_id
           -- ⚠ LEFT JOIN : une absence de journée entière n'a pas de cours
           -- (teaching_id nul) — l'INNER JOIN la faisait disparaître du fil de
           -- la famille alors que la fiche de l'enfant la montrait. Bornée aux
           -- dates de l'année, comme la fiche.
           LEFT JOIN teachings te ON te.id = a.teaching_id
           LEFT JOIN subjects sub ON sub.id = te.subject_id
          WHERE s.guardian_id = $1
            AND a.on_date >= $2::date AND a.on_date <= $3::date
            AND a.status <> 'present'
          ORDER BY a.on_date DESC, s.first_name
          LIMIT 300`,
        [guardianId, ...periode],
      );
      return { entries: rows };
    });
  }

  /** EXERCICES — every class the family's children are in. */
  private async familyHomeworkDansEcole(@Req() request: AuthenticatedRequest) {
    const guardianId = request.auth!.userId;
    const year = await this.years.activeForParent();
    if (!year) return { homework: [] };

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT DISTINCT h.id, h.title, h.body, h.due_on, h.sent_at,
                sub.name AS subject, g.name AS group_name,
                -- ⚠ SES PIÈCES JOINTES. exercices.php les rend sous chaque
                -- exercice — vignette pour une image, carte nommée pour un PDF.
                -- Nous ne les envoyions pas du tout : un professeur pouvait
                -- joindre le sujet, et la famille ne le voyait jamais. Le
                -- téléchargement lui-même est déjà gardé (/attachments/:id
                -- vérifie que le demandeur est bien le parent d'un inscrit),
                -- donc seuls les métadonnées voyagent ici.
                -- ⚠ jsonb, PAS json : DISTINCT compare chaque colonne, et json
                -- n'a pas d'opérateur d'égalité — « could not identify an equality
                -- operator for type json », un 500 que l'application montrait
                -- comme « aucun exercice ». Trouvé en ouvrant l'onglet.
                COALESCE(pj.fichiers, '[]'::jsonb) AS attachments
           FROM homework h
           JOIN teachings te ON te.id = h.teaching_id
           JOIN subjects sub ON sub.id = te.subject_id
           JOIN groups g ON g.id = te.group_id
           JOIN enrollments e ON e.group_id = g.id
                             AND e.academic_year_id = $2
                             AND e.status <> 'cancelled'
           JOIN students s ON s.id = e.student_id
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
                      jsonb_build_object(
                        'id', a.id, 'name', a.display_name,
                        'mime', a.mime, 'bytes', a.bytes
                      ) ORDER BY a.created_at
                    ) AS fichiers
               FROM attachments a
              WHERE a.homework_id = h.id
           ) pj ON true
          WHERE s.guardian_id = $1
            AND te.academic_year_id = $2
          ORDER BY h.sent_at DESC
          LIMIT 200`,
        [guardianId, year.id],
      );
      return { homework: rows };
    });
  }

  /**
   * REMARQUES — the whole family, most recent first — `pages/parent/remarques.php`.
   *
   * « `remarques` ne porte AUCUNE colonne d'année : le seul rattachement
   * possible est la date. On borne donc à la période de l'année scolaire
   * consultée, et aux enfants inscrits cette année-là. » Sa période : du 1er
   * du mois d'ouverture au 1er du mois qui suit la clôture.
   */
  private async familyRemarksDansEcole(@Req() request: AuthenticatedRequest) {
    const guardianId = request.auth!.userId;
    const year = await this.years.activeForParent();
    if (!year) return { remarks: [] };
    // ⚠ Les dates que l'année possède, rentrée comprise (voir periodeAttribuee) :
    // bornées à ses mois nominaux, les remarques de septembre disparaissaient.
    const [debut, fin] = await this.years.periodeAttribuee(year);

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT r.id,
                (s.first_name || ' ' || s.last_name) AS student_name,
                r.author_name, r.body, r.severity::text, r.created_at
           FROM remarks r
           JOIN students s ON s.id = r.student_id
          WHERE s.guardian_id = $1
            AND r.created_at >= $3::date
            AND r.created_at <  ($4::date + INTERVAL '1 day')
            AND EXISTS (SELECT 1 FROM enrollments i
                         WHERE i.student_id = s.id AND i.academic_year_id = $2
                           AND i.status <> 'cancelled')
          ORDER BY r.created_at DESC
          LIMIT 200`,
        [guardianId, year.id, debut, fin],
      );
      return { remarks: rows };
    });
  }

  /**
   * L'EMPLOI DU TEMPS DE LA CLASSE — `enfant.php`'s fourth tab.
   *
   * ⚠ A TAB THE PARENT APP DID NOT HAVE AT ALL. Its child view is four sections
   * — Bulletin, Absences, Remarques, Emploi du temps — and we had the first
   * three. A family wanting to know when their child has Arabic on a Tuesday had
   * nowhere to look.
   *
   * ⚠ SEVEN DAYS. Its own recorded bug, and the reason its query has no day
   * filter: "Dimanche manquait [...] un cours place le dimanche restait
   * invisible pour les parents."
   *
   * Scoped through the child's own enrolment: a parent reads THEIR class's
   * timetable and no other.
   */
  private async childTimetableDansEcole(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const studentId = uuid.parse(id);
    await this.assertOwnChild(request.auth!.userId, studentId);

    const year = await this.years.activeForParent();
    if (!year) return { slots: [] };

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT ts.day_of_week, ts.slot,
                sub.name AS subject,
                (t.first_name || ' ' || t.last_name) AS teacher
           FROM timetable_slots ts
           JOIN teachings te ON te.id = ts.teaching_id
           JOIN subjects sub ON sub.id = te.subject_id
           LEFT JOIN teachers t ON t.id = te.teacher_id
           JOIN enrollments e ON e.group_id = ts.group_id
                             AND e.academic_year_id = $2
                             AND e.status <> 'cancelled'
          -- ⚠ SANS FILTRE SUR L'ANNÉE DE L'ENSEIGNEMENT. La grille d'un groupe
          -- est unique (une case = un enseignement, toutes années) et son
          -- enfant.php la lit telle quelle (WHERE edt.groupe_id = :g). Nous
          -- exigions un enseignement de l'année active — à la rentrée, avant
          -- que les affectations soient refaites, l'onglet était vide alors
          -- que l'école venait de publier l'emploi du temps (démo, 23/09).
          WHERE e.student_id = $1
          ORDER BY ts.day_of_week, ts.slot`,
        [studentId, year.id],
      );
      return { slots: rows };
    });
  }

  /** Remarks left about a child, most recent first. */
  private async remarksDansEcole(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const studentId = uuid.parse(id);
    await this.assertOwnChild(request.auth!.userId, studentId);

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT id, author_name, body, severity::text, created_at
           FROM remarks WHERE student_id = $1
          ORDER BY created_at DESC LIMIT 100`,
        [studentId],
      );
      return { remarks: rows };
    });
  }

  /**
   * Homework for a child's class.
   *
   * Scoped through the child's own enrolment: homework belongs to a teaching,
   * a teaching to a group, and a group to the child. A parent must not be able
   * to read another class's work by asking for it.
   */
  private async homeworkDansEcole(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const studentId = uuid.parse(id);
    await this.assertOwnChild(request.auth!.userId, studentId);
    const year = await this.years.activeForParent();
    // La règle de tout le contrôleur : sans année active, rien — pas toutes les années.
    if (!year) return { homework: [] };

    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        // Les pièces jointes viennent de la table `attachments` (comme le fil de
        // la famille) : la colonne `homework.attachments` est un vestige que
        // rien n'écrit.
        `SELECT h.id, h.title, h.body, h.due_on, h.sent_at,
                sub.name AS subject,
                COALESCE(pj.fichiers, '[]'::jsonb) AS attachments
           FROM homework h
           JOIN teachings t ON t.id = h.teaching_id
           JOIN enrollments e ON e.group_id = t.group_id
            AND e.academic_year_id = t.academic_year_id
           LEFT JOIN subjects sub ON sub.id = t.subject_id
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
                      jsonb_build_object('id', a.id, 'name', a.display_name, 'mime', a.mime, 'bytes', a.bytes)
                      ORDER BY a.created_at
                    ) AS fichiers
               FROM attachments a
              WHERE a.homework_id = h.id
           ) pj ON true
          WHERE e.student_id = $1
            AND e.academic_year_id = $2
            AND e.status <> 'cancelled'
          ORDER BY COALESCE(h.due_on, h.sent_at::date) DESC, h.sent_at DESC
          LIMIT 100`,
        [studentId, year.id],
      );
      return { homework: rows };
    });
  }

  /** What the family owes, itemised. Never a bare total. */
  /**
   * LE SOLDE D'UNE FAMILLE, TOUTES ANNÉES — son `obtenir_dette_parent_detaillee($pid)`
   * sans année. ⚠ Borné à l'année active, il disait « 0 » dès que l'école
   * ouvrait l'année suivante et avant les réinscriptions (aucun mois dans la
   * nouvelle année) alors que la famille devait encore ses mois de l'année
   * passée — c'est le défaut de dette vu sur la démonstration le 20/09.
   * `detailAcrossYears()` porte les mois échus de l'année réellement
   * scolarisée, les frais annuels, les créances et les remises.
   */
  private async balanceDansEcole(@Req() request: AuthenticatedRequest) {
    const d = await this.debts.detailAcrossYears(request.auth!.userId);
    return {
      total: toStorage(d.total),
      tuition: d.tuition,
      annualFees: d.annualFees,
      misc: d.misc,
      // École « services » (§6) : compris dans `total` ; [] dans une école « famille ».
      services: d.services,
      beforeWriteOffs: d.beforeWriteOffs,
      writtenOff: d.writtenOff,
    };
  }

  private async gradesDansEcole(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('term') term = '1',
  ) {
    const studentId = uuid.parse(id);
    await this.assertOwnChild(request.auth!.userId, studentId);
    const year = await this.years.activeForParent();
    if (!year) return { subjects: [] };
    // Son `$trimestre` : 1 à 3, sinon 1 — un « ?term=abc » partait en SQL et répondait 500.
    const trimestre = [1, 2, 3].includes(Number(term)) ? Number(term) : 1;

    const seesExams = await this.examAccess.canSeeExams(
      request.auth!.userId,
      studentId,
      year.id,
      trimestre,
    );

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ kind: string }>(
        `SELECT sub.name AS subject, sub.name_ar, sub.coefficient, sub.max_score,
                gr.kind, gr.sequence_no, gr.score
           FROM grades gr
           JOIN teachings t ON t.id = gr.teaching_id
           JOIN subjects sub ON sub.id = t.subject_id
          WHERE gr.student_id = $1 AND gr.academic_year_id = $2 AND gr.term = $3
          ORDER BY sub.name, gr.kind, gr.sequence_no`,
        [studentId, year.id, trimestre],
      );
      // ⚠ EXAM marks are withheld from families in debt (ADR-0015). Coursework
      // is never withheld: the block is a recovery lever over results, not a
      // way to hide a child's day-to-day work from their parents.
      const visible = seesExams ? rows : rows.filter((r) => r.kind !== 'exam');

      return {
        term: trimestre,
        academicYear: year.label,
        grades: visible,
        examsWithheld: !seesExams && rows.some((r) => r.kind === 'exam'),
      };
    });
  }

  /**
   * LE BULLETIN DE L'ENFANT — `pages/parent/bulletin.php` : « LE BULLETIN EST
   * LE MÊME DOCUMENT DES DEUX CÔTÉS ». Sa page charge `bulletin_donnees()` et
   * la vue de « Notes & Bulletins » ; « il ne reste ici que le contrôle
   * d'accès et le choix de la période ». Ici de même : `reportCardFor()`, le
   * calcul de la direction, sur l'année visible des familles.
   *
   * ⚠ LA PORTE, À SA MANIÈRE. « Il ne suffit PAS de retirer les lignes
   * d'examen » : la moyenne d'une matière EST la note d'examen. Sans accès,
   * les lignes gardent les devoirs et perdent l'examen ET la moyenne ; « les
   * agrégats : tout ce qui se déduit d'un examen disparaît » — moyenne
   * générale, appréciation, verdict, récapitulatifs.
   */
  private async reportCardDansEcole(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('term') term = '1',
  ) {
    const studentId = uuid.parse(id);
    await this.assertOwnChild(request.auth!.userId, studentId);
    const year = await this.years.activeForParent();
    if (!year) return { subjects: [], average: null };
    // Son `$trimestre` : 1 à 3, sinon 1.
    const trimestre = [1, 2, 3].includes(Number(term)) ? Number(term) : 1;

    const seesExams = await this.examAccess.canSeeExams(
      request.auth!.userId,
      studentId,
      year.id,
      trimestre,
    );

    const bulletin = await this.gradesService.reportCardFor(studentId, trimestre, {
      academicYearId: year.id,
    });
    if (seesExams) return { ...bulletin, withheld: false, reason: null };

    return {
      ...bulletin,
      // ⚠ ET LE TOTAL AVEC : total ÷ coefficient rendait la note retenue à deux
      // décimales — « tout ce qui se déduit d'un examen disparaît » (son
      // bulletin_vue.php : $total_mat = null quand $moy est null).
      subjects: bulletin.subjects.map((s) => ({ ...s, exam: null, mark: null, markOutOf20: null, total: null })),
      average: null,
      band: null,
      points: null,
      outOf: null,
      annualAverage: null,
      annualFondamental: null,
      verdict: null,
      annualVerdict: null,
      termRecap: [],
      termRecapFondamental: [],
      withheld: true,
      // Son `parent_avis_examens_bloques()` — dans la langue du compte.
      reason:
        (await this.localeOf(request.auth!.userId)) === 'ar'
          ? 'تظهر نتائج الامتحانات والمعدلات بعد تسوية المستحقات. يرجى التقرب من إدارة المدرسة.'
          : 'Les notes d’examen et les moyennes s’affichent une fois la situation financière régularisée. Rapprochez-vous du secrétariat de l’école.',
    };
  }

  // ── UNE APPLICATION POUR TOUTES LES BRANCHES ──────────────────────────
  //
  // Décision du propriétaire (2026-09-14) : les familles n'ont qu'une
  // application, quelle que soit la branche ; un parent avec un enfant à Nour
  // et un autre à Rissala se connecte avec un seul numéro et voit les deux.
  // Une session de famille ne porte pas d'école : chaque route parcourt les
  // écoles du compte, chacune sous SON contexte (`runInTenant`) — RLS
  // s'applique école par école et n'est jamais contournée. Les gestionnaires
  // d'origine, écrits pour une école, sont conservés tels quels et appelés
  // dans chacune ; ce qui suit ne fait qu'assembler.

  /** Les écoles de la session : celles de la famille, sinon celle de la requête. */
  private ecolesDe(request: AuthenticatedRequest): Ecole[] {
    if (request.auth?.ecolesFamille) return request.auth.ecolesFamille;
    const { schoolId, slug } = currentTenant();
    return [{ id: schoolId, slug, name: slug, nameAr: null }];
  }

  private async dansChaqueEcole<T>(
    request: AuthenticatedRequest,
    fn: (ecole: Ecole) => Promise<T>,
  ): Promise<{ ecole: Ecole; valeur: T }[]> {
    const out: { ecole: Ecole; valeur: T }[] = [];
    for (const ecole of this.ecolesDe(request)) {
      out.push({ ecole, valeur: await runInTenant({ schoolId: ecole.id, slug: ecole.slug }, () => fn(ecole)) });
    }
    return out;
  }

  /**
   * L'école de CET enfant — la première où il est l'enfant du compte. Un
   * identifiant qui n'est celui d'aucun enfant, dans aucune école, est refusé
   * comme avant : rien ne dit s'il existe ailleurs.
   */
  private async ecoleDeLEnfant(request: AuthenticatedRequest, studentId: string): Promise<Ecole> {
    for (const ecole of this.ecolesDe(request)) {
      const mien = await runInTenant({ schoolId: ecole.id, slug: ecole.slug }, () =>
        this.db.query(async (tx) => {
          const { rows } = await tx.query('SELECT 1 FROM students WHERE id = $1 AND guardian_id = $2', [
            studentId,
            request.auth!.userId,
          ]);
          return rows.length > 0;
        }),
      );
      if (mien) return ecole;
    }
    throw new ForbiddenException('Cet élève n’est pas votre enfant.');
  }

  private async dansLEcoleDe<T>(request: AuthenticatedRequest, id: string, fn: () => Promise<T>): Promise<T> {
    const ecole = await this.ecoleDeLEnfant(request, uuid.parse(id));
    return runInTenant({ schoolId: ecole.id, slug: ecole.slug }, fn);
  }

  @Get('children')
  async children(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.childrenDansEcole(request));
    const avecAnnee = parts.filter((p) => p.valeur.academicYear !== null);
    return {
      academicYear: avecAnnee[0]?.valeur.academicYear ?? null,
      guardianName: parts.find((p) => p.valeur.guardianName)?.valeur.guardianName ?? null,
      ecoles: this.ecolesDe(request).map(etiquette),
      children: parts.flatMap((p) =>
        p.valeur.children.map((c) => ({ ...c, school: etiquette(p.ecole), academicYear: p.valeur.academicYear })),
      ),
    };
  }

  @Get('messages')
  async messages(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.messagesDansEcole(request));
    return {
      unread: parts.reduce((n, p) => n + p.valeur.unread, 0),
      messages: parts
        .flatMap((p) => (p.valeur.messages as Record<string, unknown>[]).map((m) => ({ ...m, school: etiquette(p.ecole) })))
        .sort(parDate('sent_at')),
    };
  }

  @Get('messages/unread')
  async unread(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.unreadDansEcole(request));
    return { count: parts.reduce((n, p) => n + p.valeur.count, 0) };
  }

  @Get('notifications')
  async notificationList(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.notificationListDansEcole(request));
    return {
      unread: parts.reduce((n, p) => n + p.valeur.unread, 0),
      items: parts
        .flatMap((p) => p.valeur.items.map((i) => ({ ...i, school: etiquette(p.ecole) })))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    };
  }

  @Get('notifications/unread')
  async notificationsUnread(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.notificationsUnreadDansEcole(request));
    return { count: parts.reduce((n, p) => n + p.valeur.count, 0) };
  }

  @Post('notifications/:id/read')
  async notificationRead(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    // L'identifiant n'appartient qu'à une école ; les autres ne trouvent rien —
    // et « rien » n'est pas un refus : seule l'absence PARTOUT en est un.
    const parts = await this.dansChaqueEcole(request, () => this.notificationReadDansEcole(id, request));
    if (!parts.some((p) => p.valeur.read)) throw new NotFoundException('Notification introuvable.');
    return { read: true };
  }

  /** L'appareil est enregistré dans CHAQUE école : chacune pousse ses propres notifications. */
  @Post('devices')
  async registerDevice(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    await this.dansChaqueEcole(request, () => this.registerDeviceDansEcole(body, request));
    // ⚠ LE MODE, PAS SEULEMENT « ENREGISTRÉ ». Le téléphone coupait ses deux
    // sondages dès que le jeton était accepté — et le serveur sans clé Firebase
    // ne poussait rien : plus aucune notification, ouverte ou fermée.
    return { registered: true, push: PushService.configured() ? 'firebase' : 'sondage' };
  }

  @Delete('devices')
  async unregisterDevice(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    await this.dansChaqueEcole(request, () => this.unregisterDeviceDansEcole(body, request));
    return { registered: false };
  }

  /**
   * L'ÉTAT DE CE TÉLÉPHONE — profil → « Notifications ». « Notifications are
   * far from instant » (23/09) n'avait aucune réponse mesurable depuis le
   * téléphone : le serveur pousse-t-il (clé Firebase posée), et ce jeton
   * est-il connu ? Les deux se lisent ici, sans rien deviner. En POST : le
   * jeton est une clé, il ne voyage pas dans une URL (journaux, mandataires).
   */
  @Post('devices/status')
  async deviceStatus(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const { token } = z.object({ token: z.string().max(4096).optional() }).parse(body ?? {});
    const jeton = (token ?? '').trim();
    const parts = jeton.length >= 20
      ? await this.dansChaqueEcole(request, () => this.push.hasDevice(request.auth!.userId, jeton))
      : [];
    return {
      push: PushService.configured() ? 'firebase' : 'sondage',
      registered: parts.some((p) => p.valeur),
    };
  }

  /**
   * UNE NOTIFICATION DE TEST, POUSSÉE PAR LE SERVEUR. Le bouton « Tester la
   * sonnerie » vérifie le canal du téléphone ; celui-ci vérifie TOUTE la
   * chaîne — jeton déclaré, clé de service, Firebase, canal, son, vibration —
   * depuis le téléphone, sans passer par le site. Une fois, dans la première
   * école du compte : le téléphone est le même partout.
   */
  @Post('devices/test')
  async testPush(@Req() request: AuthenticatedRequest) {
    const [premiere] = this.ecolesDe(request);
    if (!premiere) throw new NotFoundException('Aucune école.');
    const appareils = await this.dansChaqueEcole(request, () => this.push.countDevices(request.auth!.userId));
    await runInTenant({ schoolId: premiere.id, slug: premiere.slug }, () =>
      this.push.enqueue(request.auth!.userId, 'notif_test', {}, 'profil'),
    );
    return {
      queued: true,
      push: PushService.configured() ? 'firebase' : 'sondage',
      // Zéro : rien n'arrivera, et l'application le dit au lieu de promettre.
      devices: Math.max(0, ...appareils.map((p) => p.valeur)),
    };
  }

  @Post('notifications/read-all')
  async notificationsReadAll(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.notificationsReadAllDansEcole(request));
    return { marked: parts.reduce((n, p) => n + (p.valeur.marked ?? 0), 0) };
  }

  @Post('messages/:id/read')
  async markRead(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.markReadDansEcole(id, request));
    // Une seule école porte le message ; « marqué » si l'une l'a marqué.
    return { read: parts.some((p) => Boolean((p.valeur as { read?: boolean }).read)) };
  }

  @Get('children/:id/attendance')
  attendance(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.dansLEcoleDe(request, id, () => this.attendanceDansEcole(id, request));
  }

  @Get('grades')
  async familyGrades(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.familyGradesDansEcole(request));
    return {
      grades: parts
        .flatMap((p) => p.valeur.grades.map((g) => ({ ...g, school: etiquette(p.ecole) })))
        .sort((a, b) => new Date(String(b.recordedAt)).getTime() - new Date(String(a.recordedAt)).getTime()),
      examsWithheld: parts.some((p) => p.valeur.examsWithheld),
      // ⚠ QUELLES écoles retiennent. Une famille de plusieurs écoles lisait
      // « résultats indisponibles » pour toutes alors qu'une seule avait une
      // dette : l'application nomme désormais celles qui sont concernées.
      withheldSchools: parts.filter((p) => p.valeur.examsWithheld).map((p) => etiquette(p.ecole)),
    };
  }

  @Get('attendance')
  async familyAttendance(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.familyAttendanceDansEcole(request));
    return {
      entries: parts
        .flatMap((p) => (p.valeur.entries as Record<string, unknown>[]).map((e) => ({ ...e, school: etiquette(p.ecole) })))
        .sort(parDate('on_date')),
    };
  }

  @Get('homework')
  async familyHomework(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.familyHomeworkDansEcole(request));
    return {
      homework: parts
        .flatMap((p) => (p.valeur.homework as Record<string, unknown>[]).map((h) => ({ ...h, school: etiquette(p.ecole) })))
        .sort(parDate('sent_at')),
    };
  }

  @Get('remarks')
  async familyRemarks(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.familyRemarksDansEcole(request));
    return {
      remarks: parts
        .flatMap((p) => (p.valeur.remarks as Record<string, unknown>[]).map((r) => ({ ...r, school: etiquette(p.ecole) })))
        .sort(parDate('created_at')),
    };
  }

  @Get('children/:id/timetable')
  childTimetable(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.dansLEcoleDe(request, id, () => this.childTimetableDansEcole(id, request));
  }

  @Get('children/:id/remarks')
  remarks(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.dansLEcoleDe(request, id, () => this.remarksDansEcole(id, request));
  }

  @Get('children/:id/homework')
  homework(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.dansLEcoleDe(request, id, () => this.homeworkDansEcole(id, request));
  }

  /**
   * LE SOLDE — par école, et le total quand toutes comptent dans la même
   * monnaie (la monnaie est PAR ÉCOLE, règle 9 : deux monnaies ne s'ajoutent
   * pas, et le total est alors nul plutôt que faux).
   */
  @Get('balance')
  async balance(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, async () => ({
      solde: await this.balanceDansEcole(request),
      currency: await this.db.query(async (tx) => {
        const { rows } = await tx.query<{ currency: string }>('SELECT currency FROM schools WHERE id = $1', [
          currentTenant().schoolId,
        ]);
        return rows[0]?.currency ?? 'MRU';
      }),
    }));
    const monnaies = new Set(parts.map((p) => p.valeur.currency));
    const total = monnaies.size <= 1
      ? toStorage(parts.reduce((s, p) => s.plus(money(p.valeur.solde.total)), money('0')))
      : null;
    return {
      total,
      currency: monnaies.size === 1 ? [...monnaies][0] : null,
      tuition: parts.flatMap((p) =>
        ((p.valeur.solde.tuition ?? []) as Record<string, unknown>[]).map((l) => ({ ...l, school: etiquette(p.ecole) })),
      ),
      annualFees: parts.flatMap((p) =>
        ((p.valeur.solde.annualFees ?? []) as Record<string, unknown>[]).map((l) => ({ ...l, school: etiquette(p.ecole) })),
      ),
      // Les créances (arriérés, factures reprises) : la famille les doit aussi.
      misc: parts.flatMap((p) =>
        ((p.valeur.solde.misc ?? []) as Record<string, unknown>[]).map((l) => ({ ...l, school: etiquette(p.ecole) })),
      ),
      // Les services d'une école « services » (§6) : compris dans `total`.
      services: parts.flatMap((p) =>
        ((p.valeur.solde.services ?? []) as unknown as Record<string, unknown>[]).map((l) => ({
          ...l,
          school: etiquette(p.ecole),
        })),
      ),
      parEcole: parts.map((p) => ({ school: etiquette(p.ecole), currency: p.valeur.currency, ...p.valeur.solde })),
    };
  }

  @Get('children/:id/grades')
  grades(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Query('term') term = '1') {
    return this.dansLEcoleDe(request, id, () => this.gradesDansEcole(request, id, term));
  }

  @Get('children/:id/report-card')
  reportCard(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Query('term') term = '1') {
    return this.dansLEcoleDe(request, id, () => this.reportCardDansEcole(request, id, term));
  }

  /**
   * LE BULLETIN OFFICIEL, LE MÊME DOCUMENT QUE LE SITE — en HTML autonome.
   * L'application l'affiche tel quel et en tire le PDF ; le site du personnel
   * rend la même chaîne (`renderBulletinOfficiel`, `@elourwa/shared`). Ce que
   * la famille ne doit pas voir (examens retenus pour dette) est retiré ICI,
   * par `reportCardDansEcole()`, avant le rendu — le document porte alors la
   * raison, dans la langue du compte, à la place des moyennes.
   */
  @Get('children/:id/report-card/document')
  async reportCardDocument(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Param('id') id: string,
    @Query('term') term = '1',
    @Query('lang') lang = 'fr',
  ) {
    const ecole = await this.ecoleDeLEnfant(request, uuid.parse(id));
    const html = await runInTenant({ schoolId: ecole.id, slug: ecole.slug }, async () => {
      const r = (await this.reportCardDansEcole(request, id, term)) as Record<string, unknown> & {
        student?: { first_name: string; last_name: string; rim: string; matricule: string | null; sex: string | null; group_name: string | null; level_name: string | null; guardian_name: string | null } | null;
        withheld?: boolean;
        reason?: string | null;
      };
      if (!r.student) return null;
      const { student, withheld, reason, ...reste } = r;
      const card = {
        ...(reste as Omit<BulletinCard, 'firstName' | 'lastName' | 'rim' | 'matricule' | 'sex' | 'groupName' | 'levelName' | 'guardianName'>),
        firstName: student.first_name,
        lastName: student.last_name,
        rim: student.rim,
        matricule: student.matricule,
        sex: student.sex,
        groupName: student.group_name,
        levelName: student.level_name,
        guardianName: student.guardian_name,
        // Retenu pour dette : ni appréciation ni décision, et un verdict neutre.
        verdict: (reste.verdict as BulletinCard['verdict'] | null) ?? { status: 'non_evalue', label: 'Non évalué', labelAr: 'غير مقيَّم', cssClass: '' },
        verdictHidden: withheld === true,
      } as BulletinCard;
      const langue = lang === 'ar' ? 'ar' : 'fr';
      const nom = langue === 'ar' && ecole.nameAr ? ecole.nameAr : ecole.name;
      let doc = renderBulletinDocument(card, nom, BULLETIN_CSS, { lang: langue });
      if (withheld && reason) {
        // Son `parent_avis_examens_bloques()`, au-dessus du document.
        doc = doc.replace('<body>', `<body><div dir="${langue === 'ar' ? 'rtl' : 'ltr'}" style="margin:0 0 10px;padding:10px 12px;border:1px solid #f0dcb8;background:#fdf3e3;color:#8a5300;border-radius:8px;font:600 .9rem system-ui,sans-serif">${esc(reason)}</div>`);
      }
      return doc;
    });
    if (html === null) {
      res.status(404);
      return { message: 'Enfant introuvable.' };
    }
    res.header('content-type', 'text/html; charset=utf-8');
    res.header('cache-control', 'no-store');
    return html;
  }

  /**
   * LES DOCUMENTS SIGNÉS DE LA FAMILLE (ADR-0080) — par enfant, chaque pièce
   * (inscription, photocopie, chaque service souscrit) avec son document ou
   * « en attente ». LECTURE SEULE : il n'existe aucune route d'écriture ici,
   * et l'école seule dépose, remplace et supprime.
   */
  @Get('documents')
  async documentsFamille(@Req() request: AuthenticatedRequest) {
    const parts = await this.dansChaqueEcole(request, () => this.documents.pourFamille(request.auth!.userId));
    const avecAnnee = parts.filter((p) => p.valeur.annee !== null);
    return {
      annee: avecAnnee[0]?.valeur.annee ?? null,
      enfants: parts.flatMap((p) => p.valeur.enfants.map((e) => ({ ...e, school: etiquette(p.ecole) }))),
    };
  }

  /** Le fichier d'un document — celui d'un enfant du compte, dans l'une de ses écoles. */
  @Get('documents/:id')
  async documentFichier(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('voir') voir: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const docId = uuid.parse(id);
    for (const ecole of this.ecolesDe(request)) {
      try {
        const f = await runInTenant({ schoolId: ecole.id, slug: ecole.slug }, () =>
          this.documents.fichierPourFamille(docId, request.auth!.userId),
        );
        return envoyer(reply, f, voir === '1');
      } catch (e) {
        if (e instanceof NotFoundException) continue;
        throw e;
      }
    }
    throw new NotFoundException('Document introuvable.');
  }
}
