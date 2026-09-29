import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EnrollmentService } from '../academic/enrollment.service.js';
import { NotificationsService } from '../parent/notifications.service.js';
import { ExpulsionsService } from '../discipline/expulsions.service.js';
import { hashPassword } from '../auth/passwords.js';
import {
  validatePassword,
  telephoneMauritanien,
  TELEPHONE_MAURITANIEN_REFUS,
  type ModeEtude,
  type ServiceOptionnel,
} from '@elourwa/shared';
import type { AbonnementCree } from '../finance/student-services.service.js';
import { currentTenant } from '../tenant/tenant.context.js';

export interface NewGuardian {
  fullName: string;
  email?: string;
  phone?: string;
  locale?: 'fr' | 'ar';
  /**
   * LE MOT DE PASSE INITIAL, chosen by the office — its "Mot de passe initial *".
   *
   * ⚠ EL OURWA ASKS FOR IT AND WE DID NOT OFFER IT. Its own header says why:
   * "L'admin choisit le mot de passe initial du parent (changé ensuite par le
   * parent)." The clerk reads it aloud across the counter to a family who will
   * not write it down, and `Kx7_pQ2v` cannot be said out loud.
   *
   * Empty generates one instead of refusing — the only difference from its
   * screen, and one that can only make the password stronger.
   */
  initialPassword?: string;
}

export interface AdmitInput {
  firstName: string;
  lastName: string;
  /** Mauritanian identity numbers. Both unique WITHIN a school, never globally. */
  rim: string;
  nationalId: string;
  sex?: 'M' | 'F';
  dateOfBirth?: string;
  /** A moughataa of Nouakchott. An ADDRESS, never a branch. */
  placeOfBirth?: string;
  /** Attach to an existing family, or create one. Exactly one of the two. */
  guardianId?: string;
  newGuardian?: NewGuardian;
  /** Supplying these enrols in the same operation. */
  academicYearId?: string;
  groupId?: string;
  monthlyFee?: string;
  isFree?: boolean;
  entryDate?: string;
  /** École « services » (ADR-0073) : obligatoire dès qu'on inscrit. Refusé ailleurs. */
  studyMode?: ModeEtude;
  /** École « services » : les services cochés ; l'inscription est ajoutée d'office. */
  services?: ServiceOptionnel[];
}

/**
 * Admissions — creating a child, and the family that pays for them.
 *
 * Until this existed, only the seed could enrol anybody: the product could list
 * students and take their money but not bring one into being.
 */
/**
 * Son « Matricule auto » — `inscrire_etudiant.php` :
 * `'ET' . date('y') . str_pad(random_int(1, 99999), 5, '0', STR_PAD_LEFT)`.
 */
export function matriculeAuto(aujourdhui = new Date()): string {
  const yy = String(aujourdhui.getFullYear()).slice(-2);
  const n = randomInt(1, 100000);
  return `ET${yy}${String(n).padStart(5, '0')}`;
}

@Injectable()
export class AdmissionsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EnrollmentService) private readonly enrollments: EnrollmentService,
    @Inject(ExpulsionsService) private readonly expulsions: ExpulsionsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /**
   * Families already known to this school, for attaching a sibling.
   *
   * `users` is a platform table — a guardian is global — so this deliberately
   * searches only guardians who ALREADY have a child here. Offering every
   * parent on the platform would let one branch enumerate another's families.
   */
  /**
   * Admit a child.
   *
   * The child and the family are created together or not at all: a guardian
   * account with no child is an orphaned login nobody will ever clean up, and a
   * child with a dangling guardian id is a family that cannot be billed.
   *
   * Enrolment is a SEPARATE step on purpose. It builds a month schedule, applies
   * the rule of the 25th and can be refused by the progression rule — and it is
   * idempotent, so if it fails the child still exists and can simply be enrolled
   * again. Forcing it into this transaction would mean a refused progression
   * discarded a correctly-created student.
   */
  async admit(
    input: AdmitInput,
    actorId: string,
    permissions: string[],
    /** Voir `EnrollmentService.enrol` : le tarif obéit au rôle. */
    roles: string[] = [],
  ) {
    const { schoolId } = currentTenant();

    if (input.guardianId && input.newGuardian) {
      throw new BadRequestException(
        'Rattachez à une famille existante OU créez-en une — pas les deux.',
      );
    }
    if ((input.academicYearId && !input.groupId) || (!input.academicYearId && input.groupId)) {
      throw new BadRequestException(
        'Pour inscrire, indiquez l’année scolaire ET le groupe.',
      );
    }

    /**
     * ⚠ LA FACTURATION D'UNE ÉCOLE « SERVICES » EST VÉRIFIÉE ICI, AVANT QUE
     * L'ÉLÈVE EXISTE (ADR-0073). L'élève et sa famille sont créés dans une
     * transaction, l'inscription dans une autre (voir plus haut) : un mode
     * oublié ou un prix non défini, découvert seulement par `enrol`, laisserait
     * un élève créé sans inscription — et une seconde saisie buterait sur son
     * propre RIM. Une école « famille » n'a rien à vérifier (hormis qu'on ne
     * lui envoie ni mode ni service).
     */
    if (input.academicYearId && input.groupId) {
      await this.enrollments.verifierFacturation({
        academicYearId: input.academicYearId,
        groupId: input.groupId,
        studyMode: input.studyMode,
        services: input.services,
      });
    } else if (input.studyMode !== undefined || (input.services?.length ?? 0) > 0) {
      throw new BadRequestException(
        "Le mode d'étude et les services accompagnent une inscription : indiquez l’année scolaire et le groupe.",
      );
    }

    // ⚠ The expulsion register is checked BEFORE anything is written. Blocking
    // is by identity precisely so that deleting and re-creating a child does
    // not get past it, and a check that ran after the insert would defeat that.
    const blocked = await this.expulsions.blockFor(input.nationalId, input.rim);
    if (blocked) {
      // Sa phrase — `inscrire_etudiant.php`.
      throw new ForbiddenException(
        'Inscription refusée : ce NNI ou ce RIM appartient à un étudiant exclu/expulsé. ' +
          'Voir « Liste des expelled » pour débloquer.',
      );
    }

    const created = await this.db.query(async (tx) => {
      let guardianId = input.guardianId ?? null;
      let temporaryPassword: string | null = null;
      let parentDejaExistant = false;

      if (input.guardianId) {
        const { rows } = await tx.query<{ id: string }>(
          'SELECT id FROM users WHERE id = $1 AND active',
          [input.guardianId],
        );
        if (!rows[0]) throw new NotFoundException('Correspondant introuvable.');
      }

      if (input.newGuardian) {
        // Son `creer_compte_parent()`, dans son ordre : nom trop court, téléphone
        // invalide (moins de six chiffres), politique du mot de passe ; puis, si
        // le téléphone a déjà un compte, « Parent déjà existant — étudiant
        // rattaché » — il ne crée pas un second foyer.
        const g = input.newGuardian;
        if (g.fullName.trim().length < 3) throw new BadRequestException('Nom du parent trop court.');
        // ⚠ LE TÉLÉPHONE DU PARENT EST SON IDENTIFIANT DANS L'APPLICATION, et
        // l'application n'accepte qu'un numéro mauritanien (décision du
        // propriétaire, 2026-09-14) : la même règle s'applique à la saisie, et
        // le numéro est enregistré sous sa forme canonique — huit chiffres.
        const tel = telephoneMauritanien(g.phone);
        if (!tel) throw new BadRequestException(TELEPHONE_MAURITANIEN_REFUS);
        const chosen = g.initialPassword?.trim() ?? '';
        const complaint = validatePassword(chosen);
        if (complaint) throw new BadRequestException(complaint);

        // Le même foyer, quelle que soit la façon dont son numéro a été écrit —
        // et que le numéro soit son principal OU l'un de ses supplémentaires
        // (0041) : un numéro n'appartient qu'à un compte, et sans ce verrou une
        // admission et un ajout de numéro simultanés pouvaient le poser sur deux.
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tel:${tel}`]);
        const { rows: existant } = await tx.query<{ id: string }>(
          `SELECT id FROM users WHERE right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 8) = $1
           UNION ALL
           SELECT user_id AS id FROM user_phones WHERE phone = $1
           LIMIT 1`,
          [tel],
        );
        if (existant[0]) {
          guardianId = existant[0].id;
          parentDejaExistant = true;
        } else {
          temporaryPassword = chosen;
          const hash = await hashPassword(temporaryPassword);
          const inserted = await tx.query<{ id: string }>(
            `INSERT INTO users (email, phone, password_hash, full_name, locale,
                                must_change_password)
             VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [g.email ?? null, tel, hash, g.fullName.trim(), g.locale ?? 'fr'],
          );
          guardianId = inserted.rows[0]!.id;
        }
      }

      // A guardian is a GLOBAL user, so one who already exists at another branch
      // still needs the parent role HERE, or they cannot sign in to this school.
      //
      // ⚠ Checked, not assumed. `INSERT … SELECT` over a missing role inserts
      // nothing and reports success, which would hand the office a family
      // account that silently cannot log in.
      if (guardianId) {
        const granted = await tx.query(
          `INSERT INTO user_school_roles (user_id, school_id, role_id)
           SELECT $1, $2, r.id FROM roles r WHERE r.code = 'parent'
           ON CONFLICT DO NOTHING`,
          [guardianId, schoolId],
        );
        if ((granted.rowCount ?? 0) === 0) {
          const { rows: existing } = await tx.query(
            `SELECT 1 FROM user_school_roles usr
               JOIN roles r ON r.id = usr.role_id
              WHERE usr.user_id = $1 AND usr.school_id = $2 AND r.code = 'parent'`,
            [guardianId, schoolId],
          );
          if (existing.length === 0) {
            throw new BadRequestException(
              'Le rôle « parent » n’existe pas dans cette base : la famille ne ' +
                'pourrait pas se connecter. Chargez d’abord le catalogue des rôles.',
            );
          }
        }
      }

      // Le matricule est tiré au sort : une collision (unique par école) se
      // rejoue avec un autre tirage — ce n'est pas un doublon de RIM ni de NNI.
      let student: { rows: { id: string }[] } | null = null;
      let matricule = '';
      for (let essai = 0; student === null; essai += 1) {
        matricule = matriculeAuto();
        try {
          student = await tx.query<{ id: string }>(
            `INSERT INTO students
               (school_id, guardian_id, rim, national_id, first_name, last_name,
                sex, date_of_birth, place_of_birth, matricule)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
              schoolId,
              guardianId,
              input.rim.trim(),
              input.nationalId.trim(),
              input.firstName.trim(),
              input.lastName.trim(),
              input.sex ?? null,
              input.dateOfBirth ?? null,
              input.placeOfBirth?.trim() ?? null,
              matricule,
            ],
          );
        } catch (error) {
          const e = error as { code?: string; constraint?: string };
          if (e.code === '23505' && e.constraint === 'students_school_matricule_key' && essai < 5) {
            await tx.query('ROLLBACK TO SAVEPOINT matricule').catch(() => undefined);
            continue;
          }
          if (e.code === '23505') {
            // Sa phrase. Les uniques sont (school_id, …) : un doublon ICI.
            throw new ConflictException('Un étudiant avec ce RIM ou ce NNI existe déjà.');
          }
          throw error;
        }
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'student_admitted',
          entity: 'student',
          entityId: student.rows[0]!.id,
          after: {
            name: `${input.firstName} ${input.lastName}`.trim(),
            rim: input.rim,
            guardianCreated: Boolean(input.newGuardian),
          },
        },
        tx,
      );

      return { studentId: student.rows[0]!.id, guardianId, temporaryPassword, matricule, parentDejaExistant };
    });

    let enrolment: {
      id: string;
      monthlyFee?: string;
      feeRequested?: string;
      studyMode?: ModeEtude;
      services?: AbonnementCree[];
    } | null = null;
    if (input.academicYearId && input.groupId) {
      enrolment = await this.enrollments.enrol(
        {
          studentId: created.studentId,
          academicYearId: input.academicYearId,
          groupId: input.groupId,
          monthlyFee: input.monthlyFee,
          isFree: input.isFree,
          entryDate: input.entryDate,
          studyMode: input.studyMode,
          services: input.services,
        },
        actorId,
        permissions,
        roles,
      );
    }

    // Son `notifier_parent(…, 'Nouvelle inscription', …, 'inscription', ['eleve', 'groupe'])`.
    // ⚠ Il passe le MATRICULE dans `groupe` (« a été inscrit(e) en ET2510001 ») ;
    // ici le nom de la classe, ce que le gabarit annonce — noté dans l'audit.
    if (created.guardianId && enrolment) {
      await this.db.query(async (tx) => {
        const { rows } = await tx.query<{ groupe: string }>(
          `SELECT COALESCE(l.name || ' — ', '') || g.name AS groupe
             FROM groups g LEFT JOIN levels l ON l.id = g.level_id WHERE g.id = $1`,
          [input.groupId],
        );
        await this.notifications.notifier(tx, {
          guardianId: created.guardianId!,
          studentId: created.studentId,
          academicYearId: input.academicYearId ?? null,
          kind: 'info',
          souche: 'notif_inscription',
          params: { eleve: `${input.firstName.trim()} ${input.lastName.trim()}`, groupe: rows[0]?.groupe ?? '' },
          route: 'inscription',
        });
      });
    }

    return {
      studentId: created.studentId,
      guardianId: created.guardianId,
      // Shown ONCE, so the office can hand it over. It is not stored in clear
      // anywhere and cannot be read back.
      temporaryPassword: created.temporaryPassword,
      parentDejaExistant: created.parentDejaExistant,
      matricule: created.matricule,
      enrolmentId: enrolment?.id ?? null,
      monthlyFee: enrolment?.monthlyFee ?? null,
      feeRequested: enrolment?.feeRequested ?? null,
      // École « services » seulement : une école « famille » reçoit la réponse d'avant.
      ...(enrolment?.studyMode
        ? { studyMode: enrolment.studyMode, services: enrolment.services ?? [] }
        : {}),
    };
  }

  /** Move a student to another class group within the same year. */
  async moveToGroup(
    enrolmentId: string,
    groupId: string,
    actorId: string,
  ): Promise<{ id: string; group: string }> {
    const { schoolId } = currentTenant();

    return this.db.query(async (tx) => {
      const { rows: target } = await tx.query<{
        id: string;
        name: string;
        level_id: string | null;
      }>('SELECT id, name, level_id FROM groups WHERE id = $1', [groupId]);
      if (!target[0]) throw new NotFoundException('Groupe introuvable.');

      const { rows: current } = await tx.query<{ level_id: string | null; status: string }>(
        'SELECT level_id, status FROM enrollments WHERE id = $1',
        [enrolmentId],
      );
      if (!current[0]) throw new NotFoundException('Inscription introuvable.');

      // ⚠ Same level only. Moving between LEVELS is a progression decision with
      // its own rule and its own fee, and it is not what "change class" means.
      if (current[0].level_id !== target[0].level_id) {
        throw new BadRequestException(
          'Ce groupe appartient à un autre niveau. Changer de niveau est une ' +
            'réinscription, pas un changement de groupe — le tarif et la règle de ' +
            'progression s’appliquent tous les deux.',
        );
      }

      await tx.query('UPDATE enrollments SET group_id = $1 WHERE id = $2', [
        groupId,
        enrolmentId,
      ]);

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'enrolment_group_changed',
          entity: 'enrollment',
          entityId: enrolmentId,
          after: { group: target[0].name },
        },
        tx,
      );

      return { id: enrolmentId, group: target[0].name };
    });
  }
}
