import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { hashPassword } from '../auth/passwords.js';
import { telephoneMauritanien, TELEPHONE_MAURITANIEN_REFUS, validatePassword } from '@elourwa/shared';
import { currentTenant } from '../tenant/tenant.context.js';

/** The roles an account can be created with. `parent` is made by admission. */
export const ASSIGNABLE_ROLES = [
  /**
   * ⚠ ASSIGNABLE ONLY BY SOMEBODY WHO ALREADY HOLDS IT. See `create()`.
   *
   * El Ourwa's `champ-palier` makes "Administrateur" two roles behind one word:
   * `restreint` sees everything except finance, `complet` sees everything. The
   * form could previously make only the first, so a Super Administrateur could
   * not be created at all — but handing the tier out is exactly the escalation
   * an `admin` must not be able to perform on themselves.
   */
  'super_admin',
  'admin',
  'comptable',
  'secretaire',
  'collecteur_absence',
  'professeur',
] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * Roles that may be held IN ADDITION to a main one.
 *
 * El Ourwa's rule, kept with its reason: `admin` is excluded because it already
 * contains the others, and a teacher keeps a single role because their account
 * carries a `professeurs` record rather than a stack of administrative
 * functions (`creer_utilisateur.php`).
 */
const STACKABLE = ['comptable', 'secretaire', 'collecteur_absence'] as const;

export interface NewAccount {
  role: AssignableRole;
  firstName: string;
  lastName: string;
  sex?: 'M' | 'F';
  phone?: string;
  email?: string;
  /** Son « Identifiant * » : le nom de connexion (`utilisateurs.identifiant`). */
  username?: string;
  /** Son « Mot de passe * », tapé par l'administrateur (≥ 6 caractères). Sinon un provisoire est tiré. */
  password?: string;
  /** Additional roles. Ignored for a teacher. */
  extraRoles?: string[];
  /** Staff only: what it says on the door. Defaults from the role. */
  jobTitle?: string;
  salary?: string;
  hiredOn?: string;
  /** Teacher only. */
  employment?: 'permanent' | 'interim';
  hourlyRate?: string;
}

/**
 * Staff, teacher and parent accounts.
 *
 * El Ourwa's `creer_utilisateur.php` creates a login AND the personnel record
 * that goes with it, in one transaction, because an account with no record
 * cannot be paid and a record with no account cannot sign in. Same here.
 */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  private titleFor(role: AssignableRole): string {
    return {
      // El Ourwa's own two labels for the two tiers.
      super_admin: 'Super Administrateur',
      admin: 'Administrateur',
      comptable: 'Comptable',
      secretaire: 'Secrétaire',
      collecteur_absence: "Collecteur d'absence",
      professeur: 'Professeur',
    }[role];
  }

  /**
   * Create a login and the personnel record it belongs to.
   *
   * The password is generated, returned once and never stored in clear. An
   * office that chooses passwords chooses the same one every time.
   */
  async create(input: NewAccount, actorId: string) {
    const { schoolId } = currentTenant();
    if (!input.email && !input.phone && !input.username) {
      throw new BadRequestException('Un compte a besoin d’un identifiant, d’un email ou d’un numéro de téléphone.');
    }
    // Son `valider_identifiant()` : 3 à 100 caractères, lettres, chiffres, @ . - _.
    if (input.username !== undefined && !/^[A-Za-z0-9._@-]{3,100}$/.test(input.username)) {
      throw new BadRequestException('Identifiant invalide (3-100 caractères, lettres, chiffres, @, ., -, _).');
    }
    if (input.password !== undefined && input.password.length < 6) {
      throw new BadRequestException('Le mot de passe doit contenir au moins 6 caractères.');
    }

    /**
     * ⚠ ONLY A SUPER ADMINISTRATEUR MAY CREATE ONE.
     *
     * The `restreint` tier exists precisely so that an administrator cannot
     * reach finance. If they can mint a `super_admin`, they can sign in as it
     * and reach finance anyway, and the tier stops meaning anything — it
     * becomes a suggestion enforced only by nobody thinking of it.
     *
     * Checked against roles held IN THIS SCHOOL: holding the tier elsewhere
     * grants nothing here.
     *
     * The extra roles are checked too. A guard on the main field alone is one
     * field wide, and the stacked list posts to the same endpoint.
     */
    const wanted = [input.role, ...(input.extraRoles ?? [])];
    if (wanted.includes('super_admin' as never)) {
      const { rows } = await this.db.query((tx) =>
        tx.query(
          `SELECT 1 FROM user_school_roles usr
             JOIN roles r ON r.id = usr.role_id
            WHERE usr.user_id = $1 AND usr.school_id = $2 AND r.code = 'super_admin'
            LIMIT 1`,
          [actorId, schoolId],
        ),
      );
      if (rows.length === 0) {
        throw new ForbiddenException(
          'Créer un Super Administrateur est réservé à un Super Administrateur.',
        );
      }
    }

    const temporaryPassword = input.password ?? mdpProvisoire();
    const hash = await hashPassword(temporaryPassword);
    const fullName = `${input.firstName} ${input.lastName}`.trim();

    /*
     * « CET IDENTIFIANT EXISTE DÉJÀ » — SEULEMENT QUAND C'EST VRAI (décision du
     * propriétaire, 18/09). Les comptes sont globaux (une personne = un compte,
     * toutes branches), donc un identifiant pris par un agent d'une AUTRE école
     * n'est pas libre — mais il n'est pas non plus un conflit : c'est la même
     * personne qu'on nomme ici. Trois cas, dans l'ordre :
     *   1. l'identifiant est l'e-mail ou le téléphone d'un autre compte (parent,
     *      agent) → conflit réel, dit tel quel ;
     *   2. le compte existe et a déjà un rôle dans CETTE école (actif ou
     *      désactivé) → conflit réel : on le gère depuis « Comptes » ;
     *   3. le compte existe sans rôle ici → on le RATTACHE avec le rôle demandé
     *      (fiche personnel/professeur créée ici), sans toucher à son mot de
     *      passe — il le connaît déjà, et le mot de passe provisoire saisi n'est
     *      pas appliqué (la réponse le dit).
     */
    let rattache: { userId: string; fullName: string } | null = null;
    if (input.username) {
      const existant = await this.db.registry(async (tx) => {
        const { rows } = await tx.query<{
          id: string;
          full_name: string;
          meme_identifiant: boolean;
          ici: boolean;
          plateforme: boolean;
        }>(
          `SELECT u.id, u.full_name, u.is_platform_admin AS plateforme,
                  (lower(u.username) = lower($1)) AS meme_identifiant,
                  EXISTS (SELECT 1 FROM user_school_roles usr
                           WHERE usr.user_id = u.id AND usr.school_id = $2) AS ici
             FROM users u
            WHERE lower(u.username) = lower($1) OR lower(u.email) = lower($1) OR u.phone = $1
            ORDER BY (lower(u.username) = lower($1)) DESC
            LIMIT 1`,
          [input.username, schoolId],
        );
        return rows[0] ?? null;
      });
      if (existant) {
        if (!existant.meme_identifiant) {
          throw new ConflictException(
            'Cet identifiant est l’e-mail ou le téléphone d’un autre compte : choisissez-en un autre.',
          );
        }
        // ⚠ Un compte d'administration de la plateforme ne se rattache pas à
        // une école : rattaché, il devenait « d'ici », et « réinitialiser le
        // mot de passe » livrait la console entière à un administrateur de
        // branche.
        if (existant.plateforme) {
          throw new ConflictException(
            'Cet identifiant est celui d’un administrateur de la plateforme : il se gère depuis la console.',
          );
        }
        if (existant.ici) {
          throw new ConflictException(
            'Cet identifiant existe déjà dans cette école (compte actif ou désactivé) : gérez-le depuis « Comptes ».',
          );
        }
        rattache = { userId: existant.id, fullName: existant.full_name };
      }
    }

    // Le téléphone sous sa forme canonique (8 chiffres), comme à l'admission et
    // au changement d'identifiant — sinon deux comptes pouvaient partager un
    // numéro écrit différemment, et la connexion par téléphone tirait au sort.
    let telephone: string | null = null;
    if (input.phone) {
      telephone = telephoneMauritanien(input.phone);
      if (!telephone) throw new BadRequestException(TELEPHONE_MAURITANIEN_REFUS);
      const pris = await this.db.registry(async (tx) => {
        const { rows } = await tx.query(
          `SELECT 1 FROM users WHERE right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 8) = $1
           UNION ALL
           SELECT 1 FROM user_phones WHERE phone = $1
           LIMIT 1`,
          [telephone],
        );
        return rows.length > 0;
      });
      if (pris && !rattache) throw new ConflictException('Ce téléphone possède déjà un compte.');
    }

    return this.db.query(async (tx) => {
      let userId: string;
      if (rattache) {
        userId = rattache.userId;
      } else {
        if (telephone) {
          // Le verrou sur le numéro (voir ajouterTelephone), puis la vérification
          // refaite sous ce verrou : la première, hors transaction, ne fermait
          // pas la course avec un ajout de numéro simultané.
          await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tel:${telephone}`]);
          const { rows: deja } = await tx.query(
            `SELECT 1 FROM users WHERE right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 8) = $1
             UNION ALL
             SELECT 1 FROM user_phones WHERE phone = $1
             LIMIT 1`,
            [telephone],
          );
          if (deja.length > 0) throw new ConflictException('Ce téléphone possède déjà un compte.');
        }
        const created = await tx
          .query<{ id: string }>(
            `INSERT INTO users (email, phone, username, password_hash, full_name, must_change_password)
             VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
            [input.email ?? null, telephone, input.username ?? null, hash, fullName],
          )
          .catch((error: { code?: string }) => {
            if (error.code === '23505') {
              throw new ConflictException(
                input.username ? 'Cet identifiant existe déjà.' : 'Cet email ou ce téléphone possède déjà un compte.',
              );
            }
            throw error;
          });
        userId = created.rows[0]!.id;
      }

      // A teacher keeps ONE role: their account carries a teaching record, not a
      // stack of administrative functions. `admin` already contains the others.
      // `super_admin` contains every other role, exactly as `admin` does, so
      // there is nothing to stack onto it either.
      const roles =
        input.role === 'professeur'
          ? ['professeur']
          : [
              input.role,
              ...(input.extraRoles ?? []).filter(
                (r) => (STACKABLE as readonly string[]).includes(r) && r !== input.role,
              ),
            ];

      const granted = await tx.query(
        `INSERT INTO user_school_roles (user_id, school_id, role_id)
         SELECT $1, $2, r.id FROM roles r WHERE r.code = ANY($3::text[])
         ON CONFLICT DO NOTHING`,
        [userId, schoolId, roles],
      );
      if ((granted.rowCount ?? 0) === 0) {
        // `INSERT … SELECT` over missing roles inserts nothing and reports
        // success, which would hand the office a login that cannot do anything.
        throw new BadRequestException(
          'Aucun de ces rôles n’existe dans cette base. Chargez d’abord le catalogue des rôles.',
        );
      }

      let personnelId: string;
      if (input.role === 'professeur') {
        // El Ourwa zeroes whichever of salary / hourly rate does not apply, so
        // an interim teacher never carries a stale flat salary from a previous
        // contract — and `teacherReferencePay` branches on `employment` anyway.
        const employment = input.employment ?? 'permanent';
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO teachers
             (school_id, user_id, first_name, last_name, sex, phone,
              employment, salary, hourly_rate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            schoolId, userId, input.firstName.trim(), input.lastName.trim(),
            input.sex ?? null, input.phone ?? null, employment,
            employment === 'permanent' ? (input.salary ?? '0') : '0',
            employment === 'interim' ? (input.hourlyRate ?? '0') : '0',
          ],
        );
        personnelId = rows[0]!.id;
      } else {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO staff
             (school_id, user_id, first_name, last_name, sex, phone,
              role_title, salary, hired_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            schoolId, userId, input.firstName.trim(), input.lastName.trim(),
            input.sex ?? null, input.phone ?? null,
            input.jobTitle?.trim() || this.titleFor(input.role),
            input.salary ?? '0', input.hiredOn ?? null,
          ],
        );
        personnelId = rows[0]!.id;
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: rattache ? 'account_attached' : 'account_created',
          entity: input.role === 'professeur' ? 'teacher' : 'staff',
          entityId: personnelId,
          after: { name: fullName, roles, email: input.email ?? null },
        },
        tx,
      );

      // Un compte rattaché garde son mot de passe : aucun provisoire à remettre.
      return {
        userId,
        personnelId,
        roles,
        temporaryPassword: rattache ? null : temporaryPassword,
        attached: rattache !== null,
      };
    });
  }

  /** Staff on the books, with their account and roles. */
  async listStaff() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.first_name, s.last_name, s.sex, s.phone, s.role_title,
                s.salary::text, s.hired_on, s.is_active, s.paid_months,
                u.id AS user_id, u.email, u.active AS account_active,
                u.must_change_password, u.last_login_at,
                COALESCE(
                  array_agg(r.code ORDER BY r.sort_order)
                    FILTER (WHERE r.code IS NOT NULL), '{}'
                ) AS roles
           FROM staff s
           LEFT JOIN users u ON u.id = s.user_id
           LEFT JOIN user_school_roles usr
             ON usr.user_id = u.id AND usr.school_id = s.school_id
           LEFT JOIN roles r ON r.id = usr.role_id
          GROUP BY s.id, u.id
          ORDER BY s.is_active DESC, s.last_name, s.first_name`,
      );
      return rows;
    });
  }

  async listTeachers() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT t.id, t.first_name, t.last_name, t.sex, t.phone, t.employment,
                t.salary::text, t.hourly_rate::text,
                u.id AS user_id, u.email, u.active AS account_active,
                COALESCE(u.username, u.email, u.phone) AS identifiant,
                u.must_change_password, u.last_login_at,
                (SELECT count(*)::int FROM teachings g WHERE g.teacher_id = t.id)
                  AS assignments,
                -- Son nb_classes : COUNT(DISTINCT groupe_id), toutes années (recalculer_salaire).
                (SELECT count(DISTINCT g.group_id)::int FROM teachings g WHERE g.teacher_id = t.id)
                  AS nb_classes,
                -- Son total_h_sem : la somme sur SQL_ENS_COURANTS.
                (SELECT COALESCE(SUM(c.hours_per_week), 0)::text
                   FROM (SELECT DISTINCT ON (t1.group_id, t1.subject_id) t1.*
                           FROM teachings t1
                          WHERE t1.academic_year_id = (SELECT id FROM academic_years WHERE status = 'active' LIMIT 1)
                          ORDER BY t1.group_id, t1.subject_id, (t1.legacy_id IS NULL) DESC, t1.legacy_id DESC, t1.id DESC) c
                  WHERE c.teacher_id = t.id) AS heures_courantes,
                -- Les classes où il enseigne, nommées. Sa colonne « Classes ».
                (SELECT string_agg(DISTINCT gr.name, ', ' ORDER BY gr.name)
                   FROM teachings g JOIN groups gr ON gr.id = g.group_id
                  WHERE g.teacher_id = t.id) AS classes,
                -- Sa colonne « Heures/sem » : le total hebdomadaire.
                (SELECT COALESCE(SUM(g.hours_per_week), 0)::text
                   FROM teachings g WHERE g.teacher_id = t.id AND g.academic_year_id = (SELECT id FROM academic_years WHERE status = 'active' LIMIT 1)) AS hours_per_week,
                /*
                 * ⚠ SA COLONNE « SALAIRE MENSUEL », ET ELLE SE CALCULE.
                 * Pour un permanent c'est salary. Pour un intérimaire c'est la
                 * somme de ses assignations : heures/semaine × 4 × le taux de
                 * l'assignation, ou à défaut celui du professeur — la MÊME règle
                 * que paySalary, pour que la liste et le bulletin de paie ne
                 * puissent pas se contredire.
                 */
                CASE WHEN COALESCE(t.employment, 'permanent') = 'interim'
                     THEN COALESCE((SELECT SUM(g.hours_per_week * 4
                                      * COALESCE(g.hourly_rate, t.hourly_rate))
                                      -- l'année en cours seulement : la même règle que paySalary
                                      FROM teachings g WHERE g.teacher_id = t.id AND g.academic_year_id = (SELECT id FROM academic_years WHERE status = 'active' LIMIT 1)), 0)
                     ELSE t.salary END::numeric(14,2)::text AS monthly_pay
           FROM teachers t
           LEFT JOIN users u ON u.id = t.user_id
          ORDER BY t.last_name, t.first_name`,
      );
      return rows;
    });
  }

  /**
   * Families with an account here.
   *
   * Reached THROUGH their children, so one branch cannot enumerate another's
   * families — `users` is a platform table and would otherwise expose everyone.
   */
  /**
   * LES COMPTES PARENTS — `comptes_parents.php`.
   *
   * ⚠ IL Y A ~1 372 FAMILLES ET NOUS EN RENVOYIONS 500, SANS LE DIRE. Un
   * `LIMIT 500` nu, aucune recherche, aucune pagination : les familles dont le
   * nom vient après la 500e n'existaient pas pour cet écran, et rien à l'écran
   * ne laissait deviner qu'il en manquait. Sa page cherche et pagine par 50.
   *
   * ⚠ CURSEUR, PAS OFFSET (règle 17). Sa pagination numérote les pages avec un
   * OFFSET ; le nôtre avance sur `(full_name, id)`. Même service rendu, et une
   * famille renommée entre deux pages ne peut ni disparaître ni s'afficher deux
   * fois.
   */
  /**
   * AJOUTER UN MEMBRE DU PERSONNEL — `ajouter_staff.php`.
   *
   * ⚠ UNE FICHE, PAS UN COMPTE. Son INSERT ne touche que `staff` : le gardien,
   * la cuisinière, le chauffeur figurent à la paie sans avoir rien à consulter.
   * Leur donner un identifiant et un mot de passe provisoire à changer à la
   * première connexion, c'est créer des comptes que personne n'ouvrira jamais.
   *
   * Qui a besoin d'un accès passe par « Créer un utilisateur », qui crée les
   * deux — la fiche ET le login.
   */
  async addStaff(
    input: {
      firstName: string;
      lastName: string;
      jobTitle: string;
      sex?: 'M' | 'F';
      phone?: string;
      salary: string;
      hiredOn: string;
      paidMonths?: number[];
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    const nom = input.lastName.trim();
    const prenom = input.firstName.trim();
    const fonction = input.jobTitle.trim();
    if (!nom || !prenom || !fonction) {
      throw new BadRequestException('Le nom, le prénom et la fonction sont obligatoires.');
    }

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO staff
           (school_id, first_name, last_name, sex, phone, role_title, salary, hired_on, paid_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          schoolId,
          prenom,
          nom,
          input.sex ?? null,
          input.phone?.trim() || null,
          fonction,
          input.salary,
          input.hiredOn,
          moisPayes(input.paidMonths),
        ],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'staff_added',
          entity: 'staff',
          entityId: rows[0]!.id,
          after: { name: `${prenom} ${nom}`, role_title: fonction },
        },
        tx,
      );
      return { id: rows[0]!.id };
    });
  }

  /**
   * LE CATALOGUE DES RÔLES, avec la phrase qui explique chacun.
   *
   * ⚠ LU DANS LA BASE, PAS ÉCRIT DANS L'ÉCRAN. `comptes_staffs.php` lit sa table
   * `roles` — code, libellé, description — et les coche dans l'ordre de
   * `ordre`. Recopier la liste côté web en ferait une seconde vérité à tenir en
   * accord avec le seed, ce qui est exactement ce qui a produit les libellés
   * divergents ailleurs.
   *
   * ⚠ QUATRE, LES SIENS. `comptes_staffs.php` coche Administrateur, Comptable,
   * Secrétaire et Collecteur d'absence — et rien d'autre. Ni `super_admin` : on
   * ne se donne pas les pleins pouvoirs depuis l'écran des comptes du personnel.
   * Ni `professeur` : il a sa page, avec sa situation et sa rémunération. Ni
   * `parent`, qui n'est pas du personnel.
   */
  static readonly ASSIGNABLE_HERE = ['admin', 'comptable', 'secretaire', 'collecteur_absence'];

  async listRoles() {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ code: string; label: string; description: string | null }>(
        `SELECT code, label, description FROM roles
          WHERE code = ANY($1::text[])
          ORDER BY sort_order`,
        [AccountsService.ASSIGNABLE_HERE],
      );
      return rows;
    });
  }

  async listParents(input: { q?: string; cursor?: string; limit?: number } = {}) {
    const limit = Math.min(input.limit ?? 50, 200);
    const q = (input.q ?? '').trim();
    const cut = input.cursor ? input.cursor.lastIndexOf('~') : -1;
    const afterName = cut >= 0 ? input.cursor!.slice(0, cut) : null;
    const afterId = cut >= 0 ? input.cursor!.slice(cut + 1) : null;

    return this.db.query(async (tx) => {
      const pattern = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
      const digits = q.replace(/\D/g, '');

      const { rows } = await tx.query(
        `SELECT u.id AS user_id, u.full_name, u.email, u.phone, u.active,
                u.must_change_password, u.last_login_at,
                count(DISTINCT s.id)::int AS children,
                -- Les numéros supplémentaires (0041), dans l'ordre où ils ont été ajoutés.
                COALESCE((SELECT json_agg(json_build_object('phone', up.phone, 'label', up.label) ORDER BY up.created_at)
                            FROM user_phones up WHERE up.user_id = u.id), '[]'::json) AS phones
           FROM users u
           JOIN students s ON s.guardian_id = u.id
          WHERE ($1::text IS NULL
                 OR u.full_name ILIKE $1 ESCAPE '\\'
                 OR u.email ILIKE $1 ESCAPE '\\'
                 OR ($2 <> '' AND replace(replace(replace(
                      coalesce(u.phone, ''), ' ', ''), '-', ''), '+', '') LIKE '%' || $2 || '%')
                 OR ($2 <> '' AND EXISTS (SELECT 1 FROM user_phones up
                                           WHERE up.user_id = u.id AND up.phone LIKE '%' || $2 || '%')))
            AND ($3::text IS NULL OR (u.full_name, u.id::text) > ($3::text, $4::text))
          GROUP BY u.id
          ORDER BY u.full_name, u.id
          LIMIT $5`,
        [pattern, digits, afterName, afterId, limit + 1],
      );

      const more = rows.length > limit;
      const page = more ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1] as { full_name: string; user_id: string } | undefined;

      return {
        rows: page,
        nextCursor: more && last ? `${last.full_name}~${last.user_id}` : null,
      };
    });
  }

  /**
   * Reset somebody else's password — El Ourwa's `reinitialiser_mdp.php`.
   *
   * Every session is revoked. A reset is usually a response to a lost or shared
   * password, and leaving the old sessions alive defeats the point.
   *
   * ⚠ Only for accounts attached to THIS school. `users` is global, so without
   * that check an administrator of one branch could reset the password of
   * anyone on the platform.
   */
  async resetPassword(userId: string, actorId: string, explicit?: string) {
    const { schoolId } = currentTenant();

    const belongs = await this.appartientIci(userId);
    if (!belongs) {
      throw new NotFoundException('Compte introuvable dans cette école.');
    }
    await this.exigerCompteDIci(userId, 'la réinitialisation de son mot de passe');

    // Son `mdp_provisoire()` : « lisible mais non devinable, remis en main propre » —
    // ou, sur `comptes_parents.php`, le mot de passe que l'administrateur a tapé
    // (`valider_mot_de_passe()` : 8 caractères, 3 types).
    if (explicit !== undefined) {
      const refus = validatePassword(explicit);
      if (refus) throw new BadRequestException(refus);
    }
    const temporaryPassword = explicit ?? mdpProvisoire();
    const hash = await hashPassword(temporaryPassword);

    await this.db.registry((tx) =>
      tx.query(
        `UPDATE users SET password_hash = $2, must_change_password = true,
                          failed_logins = 0, locked_until = NULL
          WHERE id = $1`,
        [userId, hash],
      ),
    );
    await this.sessions.revokeAllForUser(userId, 'password_reset_by_admin');
    await this.audit.record({
      actorId,
      schoolId,
      action: 'password_reset_by_admin',
      entity: 'user',
      entityId: userId,
    });

    return { temporaryPassword };
  }

  /**
   * CHANGER L'IDENTIFIANT — `comptes_parents.php`, `comptes_profs.php`,
   * `comptes_staffs.php` and `modifier_profil.php` all carry it.
   *
   * ⚠ NOTHING IN THE APPLICATION COULD CHANGE A LOGIN IDENTIFIER. A parent's
   * telephone IS their identifier here, and telephone numbers change: a lost
   * SIM, a new operator, a digit written down wrong at the counter in October.
   * Any of those locked a family out of their own account permanently, and the
   * only remedy was editing the database.
   *
   * ⚠ THE ACCOUNT MUST KEEP A WAY IN. Clearing the only identifier does not
   * lock the door, it removes it — the row survives and nobody can ever sign in
   * to it again.
   *
   * ⚠ AND EVERY SESSION GOES WITH IT. Changing how somebody signs in while
   * leaving their old sessions live means the replaced identifier still works,
   * which is precisely wrong when the reason for the change is that the number
   * now belongs to somebody else.
   */
  /** Le nom d'un correspondant d'ici (une famille = un compte global : le nom vaut partout). */
  async renommerCorrespondant(userId: string, fullName: string, actorId: string): Promise<void> {
    const { schoolId } = currentTenant();
    const belongs = await this.db.query(async (tx) => {
      const { rows } = await tx.query('SELECT 1 FROM students WHERE guardian_id = $1 LIMIT 1', [userId]);
      return rows.length > 0;
    });
    if (!belongs) throw new NotFoundException('Correspondant introuvable dans cette école.');
    // Un correspondant qui est AUSSI agent ou professeur se renomme depuis
    // « Comptes du personnel » : son nom signe des reçus et des écritures.
    const personnel = await this.db.query(async (tx) => {
      const { rows } = await tx.query(
        'SELECT 1 FROM staff WHERE user_id = $1 UNION SELECT 1 FROM teachers WHERE user_id = $1 LIMIT 1',
        [userId],
      );
      return rows.length > 0;
    });
    const portee = await this.porteeCompte(userId);
    if (personnel || portee.ailleurs || portee.plateforme) {
      throw new ConflictException('Ce correspondant est aussi un membre du personnel : son nom se change depuis « Comptes du personnel ».');
    }
    await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ full_name: string }>('UPDATE users SET full_name = $2 WHERE id = $1 AND NOT is_platform_admin RETURNING full_name', [userId, fullName]);
      if (!rows[0]) throw new NotFoundException('Correspondant introuvable.');
    });
    await this.audit.record({ actorId, schoolId, action: 'guardian_renamed', entity: 'user', entityId: userId, after: { fullName } });
  }

  async setIdentifier(
    userId: string,
    input: { phone?: string; email?: string },
    actorId: string,
    opts: { correspondantSeulement?: boolean } = {},
  ): Promise<void> {
    const { schoolId } = currentTenant();
    if (opts.correspondantSeulement) {
      // Depuis le dossier de la famille : un correspondant d'ici, rien d'autre.
      const estCorrespondant = await this.db.query(async (tx) => {
        const { rows } = await tx.query('SELECT 1 FROM students WHERE guardian_id = $1 LIMIT 1', [userId]);
        return rows.length > 0;
      });
      if (!estCorrespondant) throw new NotFoundException('Correspondant introuvable dans cette école.');
      const portee = await this.porteeCompte(userId);
      if (portee.plateforme || portee.ailleurs) {
        throw new ConflictException('Ce compte est aussi agent ailleurs ou administrateur de la plateforme : son identifiant se change depuis « Comptes ».');
      }
    }

    const belongs = await this.appartientIci(userId);
    if (!belongs) throw new NotFoundException('Compte introuvable dans cette école.');
    // Un compte aussi agent d'une autre branche ou administrateur de la plateforme
    // n'est pas « d'ici » : changer son identifiant global révoquerait ses sessions là-bas.
    if (!opts.correspondantSeulement) await this.exigerCompteDIci(userId, 'la modification de son identifiant');

    // Lowercased: an identifier that differs only by case is a second account
    // waiting to happen, and the person typing it will not know which they made.
    const email = input.email === undefined ? undefined : input.email.trim().toLowerCase();
    const phone = input.phone === undefined ? undefined : input.phone.trim();

    // Its own check: "Numéro de téléphone invalide." — six digits is the floor,
    // because below that it is not a number anyone can be reached on.
    //
    // ⚠ EMPTY IS NOT INVALID, it is REMOVAL. An account may legitimately drop
    // its telephone and keep signing in by email; refusing that here would have
    // made the both-empty guard below unreachable, and that guard is the one
    // that matters.
    // Un numéro de téléphone est l'identifiant d'une famille dans l'application,
    // qui n'accepte qu'un numéro mauritanien : la même règle ici, et la forme
    // canonique (huit chiffres) est ce qui s'enregistre.
    let phoneCanonique = phone;
    if (phone) {
      phoneCanonique = telephoneMauritanien(phone) ?? undefined;
      if (!phoneCanonique) throw new BadRequestException(TELEPHONE_MAURITANIEN_REFUS);
    }

    await this.db.registry(async (tx) => {
      // Le même verrou consultatif qu'ajouterTelephone (voir là-bas) : un
      // numéro ne peut pas être posé sur deux comptes par deux requêtes croisées.
      await tx.query('BEGIN');
      try {
      if (phoneCanonique) await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tel:${phoneCanonique}`]);
      const { rows: before } = await tx.query<{ email: string | null; phone: string | null }>(
        'SELECT email, phone FROM users WHERE id = $1',
        [userId],
      );
      if (before.length === 0) throw new NotFoundException('Compte introuvable.');

      const nextEmail = email === undefined ? before[0]!.email : email || null;
      const nextPhone = phone === undefined ? before[0]!.phone : phoneCanonique || null;
      // Le même numéro écrit autrement est le même identifiant.
      if (nextPhone) {
        const { rows: pris } = await tx.query(
          `SELECT 1 FROM users WHERE id <> $1 AND right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 8) = $2
           UNION ALL
           SELECT 1 FROM user_phones WHERE user_id <> $1 AND phone = $2
           LIMIT 1`,
          [userId, nextPhone],
        );
        if (pris.length > 0) throw new ConflictException('Cet identifiant est déjà utilisé par un autre compte.');
        // Un numéro supplémentaire promu principal ne reste pas en double.
        await tx.query('DELETE FROM user_phones WHERE user_id = $1 AND phone = $2', [userId, nextPhone]);
      }
      if (!nextEmail && !nextPhone) {
        throw new BadRequestException(
          'Un compte a besoin d’un email ou d’un numéro de téléphone : sans ' +
            'identifiant, plus personne ne peut s’y connecter.',
        );
      }

      try {
        await tx.query('UPDATE users SET email = $2, phone = $3 WHERE id = $1', [
          userId,
          nextEmail,
          nextPhone,
        ]);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          // Its own message. Two accounts on one identifier means one of them
          // cannot sign in, and nothing on screen would say which.
          throw new ConflictException(
            'Cet identifiant est déjà utilisé par un autre compte.',
          );
        }
        throw error;
      }
      await tx.query('COMMIT');
      } catch (e) {
        await tx.query('ROLLBACK').catch(() => undefined);
        throw e;
      }
    });

    await this.sessions.revokeAllForUser(userId, 'identifier_changed');
    await this.audit.record({
      actorId,
      schoolId,
      action: 'identifier_changed',
      entity: 'user',
      entityId: userId,
      after: { email: email ?? '(inchangé)', phone: phone ?? '(inchangé)' },
    });
  }

  /**
   * LES COMPTES DU PERSONNEL — `comptes_staffs.php` : « UNE SEULE LISTE POUR
   * TOUT LE PERSONNEL DE DIRECTION », professeurs compris (son
   * `u.role IN ('admin','comptable','secretaire','collecteur_absence','professeur')`).
   * Un compte qui détient `super_admin` n'y est pas — chez lui, son rôle
   * principal l'écarte.
   */
  async listComptesPersonnel() {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        identifiant: string;
        prenom: string;
        nom: string;
        telephone: string | null;
        fonction: string;
        est_professeur: boolean;
        actif: boolean;
        derniere_connexion: string | null;
        date_creation: string;
        bloque_jusqua: string | null;
        mdp_reinitialise_le: string | null;
        roles: { code: string; libelle: string }[];
      }>(
        `SELECT u.id,
                COALESCE(u.username, u.email, u.phone) AS identifiant,
                COALESCE(s.first_name, t.first_name, split_part(u.full_name, ' ', 1)) AS prenom,
                COALESCE(s.last_name, t.last_name,
                         NULLIF(substr(u.full_name, length(split_part(u.full_name, ' ', 1)) + 2), '')) AS nom,
                COALESCE(s.phone, t.phone, u.phone) AS telephone,
                COALESCE(s.role_title,
                         CASE WHEN t.id IS NOT NULL THEN 'Professeur' ELSE 'Personnel administratif' END) AS fonction,
                (t.id IS NOT NULL) AS est_professeur,
                u.active AS actif,
                u.last_login_at AS derniere_connexion,
                u.created_at AS date_creation,
                u.locked_until AS bloque_jusqua,
                (SELECT max(a.created_at) FROM audit_log a
                  WHERE a.entity = 'user' AND a.entity_id = u.id
                    AND a.action = 'password_reset_by_admin') AS mdp_reinitialise_le,
                COALESCE(json_agg(json_build_object('code', r.code, 'libelle', r.label) ORDER BY r.sort_order)
                         FILTER (WHERE r.code IS NOT NULL), '[]') AS roles
           FROM users u
           JOIN user_school_roles usr ON usr.user_id = u.id AND usr.school_id = $1
           JOIN roles r ON r.id = usr.role_id
           LEFT JOIN staff s ON s.user_id = u.id AND s.school_id = $1
           LEFT JOIN teachers t ON t.user_id = u.id AND t.school_id = $1
          WHERE NOT u.is_platform_admin
          GROUP BY u.id, s.id, t.id
         HAVING bool_or(r.code IN ('admin','comptable','secretaire','collecteur_absence','professeur'))
            AND NOT bool_or(r.code = 'super_admin')
          ORDER BY u.active DESC, nom, prenom`,
        [schoolId],
      );
      return rows;
    });
  }

  /**
   * ⚠ CE QU'UNE ÉCOLE PEUT FAIRE D'UN COMPTE S'ARRÊTE À SA PORTE. `users` est
   * global : la même personne peut être agent ici et super administrateur
   * ailleurs, ou administrateur de la plateforme. Réinitialiser son mot de
   * passe, la désactiver ou changer ses rôles depuis une branche donnerait
   * cette autre porte à qui ne la détient pas. Ces trois actions exigent donc
   * un compte qui n'a de pouvoir QU'ICI (les rôles `parent` ailleurs ne
   * comptent pas : une famille inscrite dans deux écoles reste gérable par
   * chacune, comme chez El Ourwa) ; sinon, c'est la console de la plateforme.
   */
  // ── LES NUMÉROS SUPPLÉMENTAIRES D'UNE FAMILLE (0041) ─────────────────────

  /**
   * PLUSIEURS NUMÉROS POUR UN COMPTE PARENT — demande du propriétaire, 23/09/2026.
   *
   * Le téléphone est l'identifiant d'une famille (`users.phone`) ; une famille
   * en a souvent deux ou trois — le père, la mère, l'oncle qui règle les mois —
   * et n'importe lequel doit ouvrir le compte, avec le même mot de passe.
   * `user_phones` porte les numéros supplémentaires ; la connexion accepte
   * l'un quelconque (auth.service). Le principal reste dans `users.phone` :
   * c'est l'identifiant affiché, celui que `setIdentifier` change.
   *
   * ⚠ UN NUMÉRO N'APPARTIENT QU'À UN COMPTE, principal ou supplémentaire. Deux
   * comptes joignables par le même numéro, et la connexion tirerait au sort.
   *
   * Réservé aux correspondants de CETTE école : `users` est global, et sans ce
   * contrôle une école pourrait ajouter un numéro au compte d'une famille
   * d'ailleurs — et s'y connecter.
   */
  async telephonesDe(userId: string): Promise<{ phone: string; label: string | null; createdAt: Date }[]> {
    await this.exigerCorrespondantDIci(userId);
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ phone: string; label: string | null; created_at: Date }>(
        'SELECT phone, label, created_at FROM user_phones WHERE user_id = $1 ORDER BY created_at',
        [userId],
      );
      return rows.map((r) => ({ phone: r.phone, label: r.label, createdAt: r.created_at }));
    });
  }

  async ajouterTelephone(userId: string, input: { phone: string; label?: string | null }, actorId: string): Promise<void> {
    const { schoolId } = currentTenant();
    await this.exigerCorrespondantDIci(userId);
    const phone = telephoneMauritanien(input.phone);
    if (!phone) throw new BadRequestException(TELEPHONE_MAURITANIEN_REFUS);
    const label = (input.label ?? '').trim().slice(0, 40) || null;

    await this.db.registry(async (tx) => {
      // ⚠ UN VERROU SUR LE NUMÉRO. Deux écritures simultanées — ici et
      // setIdentifier, sur deux comptes — vérifiaient chacune avant que l'autre
      // n'écrive : le même numéro finissait principal de A et supplémentaire de
      // B, et la connexion tirait au sort. `registry()` n'ouvre pas de
      // transaction : elle est ouverte ici, le temps du verrou.
      await tx.query('BEGIN');
      try {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tel:${phone}`]);
      const { rows: principal } = await tx.query<{ meme: boolean }>(
        `SELECT right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 8) = $2 AS meme FROM users WHERE id = $1`,
        [userId, phone],
      );
      if (!principal[0]) throw new NotFoundException('Compte introuvable.');
      if (principal[0].meme) throw new ConflictException('Ce numéro est déjà l’identifiant principal du compte.');
      const { rows: pris } = await tx.query(
        `SELECT 1 FROM users WHERE id <> $1 AND right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 8) = $2
         UNION ALL
         SELECT 1 FROM user_phones WHERE user_id <> $1 AND phone = $2
         LIMIT 1`,
        [userId, phone],
      );
      if (pris.length > 0) throw new ConflictException('Ce numéro est déjà utilisé par un autre compte.');
      try {
        await tx.query(
          'INSERT INTO user_phones (user_id, phone, label) VALUES ($1, $2, $3) ON CONFLICT (user_id, phone) DO UPDATE SET label = EXCLUDED.label',
          [userId, phone, label],
        );
      } catch (error) {
        // La course entre deux écoles : l'unique global tranche.
        if ((error as { code?: string }).code === '23505') {
          throw new ConflictException('Ce numéro est déjà utilisé par un autre compte.');
        }
        throw error;
      }
      await tx.query('COMMIT');
      } catch (e) {
        await tx.query('ROLLBACK').catch(() => undefined);
        throw e;
      }
    });
    await this.audit.record({
      actorId,
      schoolId,
      action: 'guardian_phone_added',
      entity: 'user',
      entityId: userId,
      after: { phone, label },
    });
  }

  async retirerTelephone(userId: string, brut: string, actorId: string): Promise<void> {
    const { schoolId } = currentTenant();
    await this.exigerCorrespondantDIci(userId);
    const phone = telephoneMauritanien(brut);
    if (!phone) throw new BadRequestException(TELEPHONE_MAURITANIEN_REFUS);
    const retire = await this.db.registry(async (tx) => {
      const r = await tx.query('DELETE FROM user_phones WHERE user_id = $1 AND phone = $2', [userId, phone]);
      return (r.rowCount ?? 0) > 0;
    });
    if (!retire) throw new NotFoundException('Ce numéro n’est pas rattaché à ce compte.');
    // Un numéro qui n'ouvre plus ce compte ne doit pas garder de session ouverte
    // (la même raison que pour un identifiant changé).
    await this.sessions.revokeAllForUser(userId, 'identifier_changed');
    await this.audit.record({
      actorId,
      schoolId,
      action: 'guardian_phone_removed',
      entity: 'user',
      entityId: userId,
      before: { phone },
    });
  }

  /** Le compte est correspondant d'un élève de CETTE école (RLS borne `students`). */
  private async exigerCorrespondantDIci(userId: string): Promise<void> {
    const correspondant = await this.db.query(async (tx) => {
      const { rows } = await tx.query('SELECT 1 FROM students WHERE guardian_id = $1 LIMIT 1', [userId]);
      return rows.length > 0;
    });
    if (!correspondant) throw new NotFoundException('Correspondant introuvable dans cette école.');
    // ⚠ La même garde que setIdentifier : `users` est global, et retirer un
    // numéro révoque TOUTES les sessions du compte — une école ne le fait pas
    // à un agent d'une autre branche ni à un administrateur de la plateforme.
    const portee = await this.porteeCompte(userId);
    if (portee.plateforme || portee.ailleurs) {
      throw new ConflictException(
        `Ce compte est aussi ${portee.plateforme ? 'administrateur de la plateforme' : 'agent d’une autre école'} : ses numéros ne se gèrent pas depuis cette école.`,
      );
    }
  }

  private async porteeCompte(userId: string): Promise<{ existe: boolean; plateforme: boolean; ailleurs: boolean; ici: boolean }> {
    const { schoolId } = currentTenant();
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ plateforme: boolean; ailleurs: boolean; ici: boolean }>(
        `SELECT u.is_platform_admin AS plateforme,
                EXISTS (SELECT 1 FROM user_school_roles x JOIN roles r ON r.id = x.role_id
                         WHERE x.user_id = u.id AND x.school_id <> $2 AND r.code <> 'parent') AS ailleurs,
                EXISTS (SELECT 1 FROM user_school_roles x WHERE x.user_id = u.id AND x.school_id = $2) AS ici
           FROM users u WHERE u.id = $1`,
        [userId, schoolId],
      );
      const r = rows[0];
      return r ? { existe: true, ...r } : { existe: false, plateforme: false, ailleurs: false, ici: false };
    });
  }

  /**
   * LE COMPTE EST-IL D'ICI ? Une fiche dans cette école (personnel,
   * professeur, correspondant d'un élève) OU un rôle dans cette école.
   *
   * ⚠ LE RÔLE SEUL SUFFIT (04/10/2026, signalé par Jinan) : « Comptes du
   * personnel » liste les comptes à partir de leurs RÔLES, et le compte de
   * direction posé à l'installation, comme un compte rattaché par la console,
   * n'a pas de fiche de personnel. « Mot de passe » et « Désactiver » leur
   * répondaient « Compte introuvable dans cette école. » — pour un compte que
   * la page venait d'afficher. Un compte d'une AUTRE école reste refusé : ni
   * fiche ni rôle ici.
   */
  private async appartientIci(userId: string): Promise<boolean> {
    const fiche = await this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT 1 FROM users u
          WHERE u.id = $1
            AND (EXISTS (SELECT 1 FROM staff WHERE user_id = u.id)
              OR EXISTS (SELECT 1 FROM teachers WHERE user_id = u.id)
              OR EXISTS (SELECT 1 FROM students WHERE guardian_id = u.id))`,
        [userId],
      );
      return rows.length > 0;
    });
    return fiche || (await this.porteeCompte(userId)).ici;
  }

  private async exigerCompteDIci(userId: string, action: string) {
    const portee = await this.porteeCompte(userId);
    if (portee.plateforme || portee.ailleurs) {
      throw new ConflictException(
        `Ce compte est aussi ${portee.plateforme ? 'administrateur de la plateforme' : 'agent d’une autre école'} : ${action} passe par la console de la plateforme.`,
      );
    }
    return portee;
  }

  /** Le compte visé est-il bien un compte de personnel gérable ici ? (`staff_gerable()`) */
  private async compteGerable(userId: string): Promise<{ identifiant: string; prenom: string; nom: string } | null> {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ identifiant: string; prenom: string; nom: string; est_super: boolean }>(
        `SELECT COALESCE(u.username, u.email, u.phone) AS identifiant,
                COALESCE(s.first_name, t.first_name, split_part(u.full_name, ' ', 1)) AS prenom,
                COALESCE(s.last_name, t.last_name, '') AS nom,
                EXISTS (SELECT 1 FROM user_school_roles x JOIN roles r ON r.id = x.role_id
                         WHERE x.user_id = u.id AND x.school_id = $2 AND r.code = 'super_admin') AS est_super
           FROM users u
           JOIN user_school_roles usr ON usr.user_id = u.id AND usr.school_id = $2
           LEFT JOIN staff s ON s.user_id = u.id AND s.school_id = $2
           LEFT JOIN teachers t ON t.user_id = u.id AND t.school_id = $2
          WHERE u.id = $1
          LIMIT 1`,
        [userId, schoolId],
      );
      const u = rows[0];
      if (!u) return null;
      return { identifiant: u.identifiant, prenom: u.prenom, nom: u.nom };
    });
  }

  /**
   * MODIFIER L'IDENTITÉ — son action `modifier` : prénom, nom, téléphone,
   * fonction (« Personnel administratif » à défaut). La fiche de personnel est
   * créée si elle manque (son `INSERT … ON DUPLICATE KEY UPDATE`).
   */
  async updateIdentity(
    userId: string,
    input: { prenom: string; nom: string; telephone: string | null; fonction: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    const u = await this.compteGerable(userId);
    if (!u) throw new NotFoundException('Compte introuvable ou non modifiable ici.');
    await this.exigerCompteDIci(userId, 'la modification de son identité');
    const fonction = input.fonction.trim() !== '' ? input.fonction.trim() : 'Personnel administratif';

    await this.db.registry((tx) =>
      tx.query('UPDATE users SET full_name = $2 WHERE id = $1', [userId, `${input.prenom} ${input.nom}`.trim()]),
    );
    await this.db.query(async (tx) => {
      const { rows: t } = await tx.query('SELECT id FROM teachers WHERE user_id = $1', [userId]);
      if (t.length > 0) {
        await tx.query(
          'UPDATE teachers SET first_name = $2, last_name = $3, phone = $4 WHERE user_id = $1',
          [userId, input.prenom, input.nom, input.telephone],
        );
        return;
      }
      const { rowCount } = await tx.query(
        `UPDATE staff SET first_name = $2, last_name = $3, phone = $4, role_title = $5 WHERE user_id = $1`,
        [userId, input.prenom, input.nom, input.telephone, fonction],
      );
      if ((rowCount ?? 0) === 0) {
        await tx.query(
          `INSERT INTO staff (school_id, user_id, first_name, last_name, phone, role_title)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [schoolId, userId, input.prenom, input.nom, input.telephone, fonction],
        );
      }
    });
    await this.audit.record({
      actorId,
      schoolId,
      action: 'account_identity_changed',
      entity: 'user',
      entityId: userId,
      after: { prenom: input.prenom, nom: input.nom, telephone: input.telephone, fonction },
    });
    return { userId };
  }

  /**
   * RÉINITIALISER L'IDENTIFIANT — son action `identifiant` : 3 à 100
   * caractères, lettres / chiffres / point / tiret / souligné / arobase, libre
   * (comparaison insensible à la casse).
   */
  async setUsername(userId: string, brut: string, actorId: string) {
    const { schoolId } = currentTenant();
    const u = await this.compteGerable(userId);
    if (!u) throw new NotFoundException('Compte introuvable.');
    await this.exigerCompteDIci(userId, 'la modification de son identifiant');
    const idf = brut.trim();
    if (idf === '' || idf.length < 3) throw new BadRequestException("L'identifiant doit faire au moins 3 caractères.");
    if (idf.length > 100) throw new BadRequestException("L'identifiant est trop long (100 caractères maximum).");
    if (!/^[A-Za-z0-9._@-]+$/.test(idf)) {
      throw new BadRequestException("L'identifiant n'accepte que lettres, chiffres, point, tiret, souligné et arobase.");
    }
    const libre = await this.db.registry(async (tx) => {
      const { rows } = await tx.query(
        `SELECT 1 FROM users WHERE id <> $1
          AND (lower(username) = lower($2) OR lower(email) = lower($2) OR phone = $2) LIMIT 1`,
        [userId, idf],
      );
      return rows.length === 0;
    });
    if (!libre) throw new ConflictException('Cet identifiant est déjà utilisé par un autre compte.');
    await this.db.registry((tx) => tx.query('UPDATE users SET username = $2 WHERE id = $1', [userId, idf]));
    await this.sessions.revokeAllForUser(userId, 'identifier_changed');
    await this.audit.record({
      actorId,
      schoolId,
      action: 'identifier_changed',
      entity: 'user',
      entityId: userId,
      before: { identifiant: u.identifiant },
      after: { identifiant: idf },
    });
    return { userId, identifiant: idf };
  }

  /**
   * SUPPRIMER UNE FICHE DE PERSONNEL — le « Supprimer » de `ajouter_staff.php`
   * (son `DELETE FROM staff`). Une fiche qui porte un compte ou des paiements
   * de salaire n'est pas supprimée : règle 7, l'historique de paie reste lisible.
   */
  async deleteStaff(staffId: string, actorId: string) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ first_name: string; last_name: string; user_id: string | null; paiements: string }>(
        `SELECT s.first_name, s.last_name, s.user_id,
                (SELECT count(*)::text FROM salary_payments p WHERE p.payee_kind = 'staff' AND p.payee_id = s.id) AS paiements
           FROM staff s WHERE s.id = $1`,
        [staffId],
      );
      const s = rows[0];
      if (!s) throw new NotFoundException('Personnel introuvable.');
      if (s.user_id) {
        throw new ConflictException('Ce membre du personnel a un compte : désactivez-le depuis « Comptes du personnel ».');
      }
      if (Number(s.paiements) > 0) {
        throw new ConflictException('Ce membre du personnel a des paiements de salaire : sa fiche est conservée. Désactivez-la plutôt.');
      }
      await tx.query('DELETE FROM staff WHERE id = $1', [staffId]);
      await this.audit.record(
        { actorId, schoolId, action: 'staff_deleted', entity: 'staff', entityId: staffId, before: { name: `${s.first_name} ${s.last_name}`.trim() } },
        tx,
      );
      return { deleted: true };
    });
  }

  /** Suspend or restore an account without deleting anything. */
  async setActive(userId: string, active: boolean, actorId: string) {
    const { schoolId } = currentTenant();

    const belongs = await this.appartientIci(userId);
    if (!belongs) throw new NotFoundException('Compte introuvable dans cette école.');
    // `users.active` vaut pour toute la plateforme : on ne suspend d'ici qu'un
    // compte qui n'existe qu'ici.
    await this.exigerCompteDIci(userId, active ? 'sa réactivation' : 'sa désactivation');

    // « Sans ce garde-fou, un administrateur seul pouvait se verrouiller dehors ».
    if (!active && userId === actorId) {
      throw new BadRequestException('Vous ne pouvez pas désactiver votre propre compte.');
    }
    // Verrouillage collectif : le dernier super administrateur actif.
    if (!active) {
      const dernier = await this.db.query(async (tx) => {
        const { rows: cible } = await tx.query(
          `SELECT 1 FROM user_school_roles usr JOIN roles r ON r.id = usr.role_id
            WHERE usr.user_id = $1 AND usr.school_id = $2 AND r.code = 'super_admin'`,
          [userId, schoolId],
        );
        if (cible.length === 0) return false;
        const { rows: autres } = await tx.query<{ n: string }>(
          `SELECT count(DISTINCT u.id)::text AS n
             FROM users u JOIN user_school_roles usr ON usr.user_id = u.id
             JOIN roles r ON r.id = usr.role_id
            WHERE u.active AND u.id <> $1 AND usr.school_id = $2 AND r.code = 'super_admin'`,
          [userId, schoolId],
        );
        return Number(autres[0]!.n) === 0;
      });
      if (dernier) {
        throw new BadRequestException(
          "Refusé : c'est le dernier super administrateur actif. " +
            'Créez ou réactivez un autre super administrateur avant de désactiver celui-ci.',
        );
      }
    }

    await this.db.registry((tx) =>
      tx.query('UPDATE users SET active = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [userId, active]),
    );
    // A suspended account keeps no live sessions, or suspension means nothing
    // until the access token happens to expire.
    if (!active) await this.sessions.revokeAllForUser(userId, 'account_suspended');

    await this.audit.record({
      actorId,
      schoolId,
      action: active ? 'account_restored' : 'account_suspended',
      entity: 'user',
      entityId: userId,
    });
    return { userId, active };
  }

  /** Change which roles somebody holds at this school. */
  async setRoles(userId: string, codes: string[], actorId: string) {
    const { schoolId } = currentTenant();
    if (codes.length === 0) {
      throw new BadRequestException(
        'Un compte a besoin d’au moins un rôle, sinon il se connecte et ne peut rien faire.',
      );
    }
    // Seuls les rôles que l'écran propose, et seulement sur un compte déjà
    // d'ici : sans ces deux bornes, n'importe quel identifiant de la
    // plateforme recevait `super_admin` ici d'un simple appel.
    const inconnu = codes.find((c) => !AccountsService.ASSIGNABLE_HERE.includes(c));
    if (inconnu) throw new BadRequestException(`Le rôle « ${inconnu} » ne s’attribue pas depuis cet écran.`);
    const portee = await this.exigerCompteDIci(userId, 'la modification de ses rôles');
    if (!portee.ici) throw new NotFoundException('Compte introuvable dans cette école.');

    return this.db.query(async (tx) => {
      /**
       * ⚠ CE QUE CET ÉCRAN N'OFFRE PAS, IL NE L'EMPORTE PAS.
       *
       * L'écran coche quatre rôles ; `super_admin` et `professeur` n'y figurent
       * pas. Comme cette méthode efface tout avant de réinsérer, enregistrer
       * n'importe quel changement aurait retiré en silence le rôle d'un super
       * administrateur ou d'un professeur — et personne ne l'aurait vu avant
       * qu'il ne perde l'accès.
       *
       * Les rôles hors de la liste assignable sont donc relus et remis.
       */
      const { rows: kept } = await tx.query<{ code: string }>(
        `SELECT r.code FROM user_school_roles usr
           JOIN roles r ON r.id = usr.role_id
          WHERE usr.user_id = $1 AND usr.school_id = $2
            AND NOT (r.code = ANY($3::text[]))`,
        [userId, schoolId, AccountsService.ASSIGNABLE_HERE],
      );
      const finalCodes = [...new Set([...codes, ...kept.map((r) => r.code)])];

      await tx.query(
        'DELETE FROM user_school_roles WHERE user_id = $1 AND school_id = $2',
        [userId, schoolId],
      );
      const granted = await tx.query(
        `INSERT INTO user_school_roles (user_id, school_id, role_id)
         SELECT $1, $2, r.id FROM roles r WHERE r.code = ANY($3::text[])`,
        [userId, schoolId, finalCodes],
      );
      if ((granted.rowCount ?? 0) === 0) {
        throw new BadRequestException('Aucun de ces rôles n’existe.');
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'account_roles_changed',
          entity: 'user',
          entityId: userId,
          after: { roles: finalCodes },
        },
        tx,
      );
      return { userId, roles: finalCodes };
    });
  }

  /** Edit a staff member's own record — function, salary, hire date. */
  async updateStaff(
    staffId: string,
    input: { jobTitle?: string; salary?: string; phone?: string; hiredOn?: string; isActive?: boolean; paidMonths?: number[] },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const result = await tx.query(
        `UPDATE staff
            SET role_title = COALESCE($2, role_title),
                salary     = COALESCE($3::numeric, salary),
                phone      = COALESCE($4, phone),
                hired_on   = COALESCE($5::date, hired_on),
                is_active  = COALESCE($6::boolean, is_active),
                paid_months = COALESCE($7::smallint[], paid_months)
          WHERE id = $1`,
        [
          staffId,
          input.jobTitle ?? null,
          input.salary ?? null,
          input.phone ?? null,
          input.hiredOn ?? null,
          input.isActive ?? null,
          input.paidMonths === undefined ? null : moisPayes(input.paidMonths),
        ],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Membre du personnel introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'staff_updated',
          entity: 'staff',
          entityId: staffId,
          after: { ...input },
        },
        tx,
      );
      return { id: staffId };
    });
  }

  /** Edit a teacher — El Ourwa's `gerer_professeurs.php`. */
  async updateTeacher(
    teacherId: string,
    input: {
      phone?: string;
      employment?: 'permanent' | 'interim';
      salary?: string;
      hourlyRate?: string;
    },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      /**
       * ⚠ CHANGING THE CONTRACT CLEARS THE OTHER SIDE, as its own handler does:
       * `SET salaire = :s, prix_par_heure = 0` for a permanent teacher, and
       * `SET prix_par_heure = :t, salaire = 0` for an intérimaire.
       *
       * COALESCE on both columns left a teacher moved from permanent to
       * intérimaire with a monthly salary sitting beside their new hourly rate.
       * `teacherReferencePay` branches on `employment`, so the stale figure is
       * not paid today — and that is what makes it dangerous: a live money
       * column holding a number from a contract the person no longer has,
       * waiting for the first report that sums it.
       *
       * A change that does NOT touch the contract — a phone number correction —
       * must leave both alone, or fixing a typo would zero a salary.
       */
      const contract = input.employment ?? null;
      const result = await tx.query(
        `UPDATE teachers
            SET phone       = COALESCE($2, phone),
                employment  = COALESCE($3, employment),
                salary      = CASE
                                WHEN $3::text = 'interim'   THEN 0
                                WHEN $3::text = 'permanent' THEN COALESCE($4::numeric, salary)
                                ELSE COALESCE($4::numeric, salary)
                              END,
                hourly_rate = CASE
                                WHEN $3::text = 'permanent' THEN 0
                                WHEN $3::text = 'interim'   THEN COALESCE($5::numeric, hourly_rate)
                                ELSE COALESCE($5::numeric, hourly_rate)
                              END
          WHERE id = $1`,
        [
          teacherId,
          input.phone ?? null,
          contract,
          input.salary ?? null,
          input.hourlyRate ?? null,
        ],
      );
      if ((result.rowCount ?? 0) === 0) throw new NotFoundException('Professeur introuvable.');

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'teacher_updated',
          entity: 'teacher',
          entityId: teacherId,
          after: { ...input },
        },
        tx,
      );
      return { id: teacherId };
    });
  }

  /**
   * Login history — El Ourwa's `historique.php`.
   *
   * ⚠ `login_attempts` is a PLATFORM table: no `school_id`, no RLS, because
   * rate limiting has to work before a tenant is even known. Showing it raw to
   * a branch administrator would hand them every other branch's sign-in
   * identifiers.
   *
   * So it is scoped by JOINING to the people who belong here. `staff`,
   * `teachers` and `students` are all tenant tables, so the policy does the
   * scoping and this query cannot reach past it.
   *
   * A consequence worth stating: attempts against an identifier that matches
   * nobody here are invisible. That is correct — an unknown identifier is not
   * this school's business, and it could be anyone's.
   */
  /**
   * LES CONNEXIONS D'UNE JOURNÉE — `historique.php`.
   *
   * ⚠ SES SIX COLONNES SONT CELLES D'UNE SESSION, PAS D'UNE TENTATIVE. Nom
   * Complet, Téléphone, Rôle, Date / Heure Connexion, Déconnexion, Adresse IP.
   * Nous affichions « Quand · Qui · Depuis · Résultat », lu depuis
   * `login_attempts` : pas une colonne en commun, et surtout pas la même
   * question. Un directeur ouvre cet écran pour savoir QUI ÉTAIT CONNECTÉ ce
   * jour-là, pas qui s'est trompé de mot de passe.
   *
   * ⚠ ET NOUS AVIONS DÉJÀ LA DONNÉE. `refresh_tokens` porte les mêmes faits que
   * ses `login_historique` / `parent_login_historique` : `issued_at` est la
   * connexion, `revoked_at` la déconnexion, avec l'IP et l'agent. Aucune
   * migration n'a été nécessaire.
   *
   * ⚠ L'INTERVALLE PORTE SUR LA COLONNE BRUTE, et sa propre note dit pourquoi :
   * « Envelopper la colonne dans une fonction empeche MySQL d utiliser le moindre
   * index. » Postgres se comporte pareil, et `issued_at` est indexé ici.
   *
   * ⚠ ET LE PLAFOND DEMANDE UNE LIGNE DE TROP, comme le sien : si elle arrive,
   * la journée est plus chargée que la liste, et l'écran le dit au lieu de
   * laisser croire à une liste complète.
   */
  async connectionHistory(input: { day: string; tab: 'staff' | 'parent'; max?: number }) {
    const max = input.max ?? 500;
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        full_name: string;
        phone: string | null;
        role: string | null;
        connected_at: string;
        disconnected_at: string | null;
        ip: string | null;
      }>(
        // ⚠ UNE CONNEXION = UNE FAMILLE DE JETONS, pas une ligne : le jeton tourne
        // à chaque rafraîchissement (un quart d'heure) et chaque rotation est une
        // ligne. Compter les lignes affichait « 40 connexions » pour une journée de
        // travail. On garde la première ligne de chaque famille (la connexion),
        // et la déconnexion est la révocation la plus tardive de la famille.
        //
        // ⚠ LES PARENTS N'ONT PLUS D'ÉCOLE DANS LEUR SESSION (ADR-0061 : une
        // application pour toutes les branches, school_id NULL). Exiger
        // t.school_id = current_school_id() n'affichait plus aucun parent.
        // Un parent compte ici s'il a le rôle parent dans CETTE école.
        `WITH familles AS (
           SELECT DISTINCT ON (t.family_id)
                  t.family_id, t.user_id, t.school_id, t.issued_at, t.ip, t.user_agent
             FROM refresh_tokens t
            WHERE t.issued_at >= $1::date - interval '1 day'
            ORDER BY t.family_id, t.issued_at ASC
         )
         SELECT u.full_name,
                COALESCE(u.phone, u.email) AS phone,
                (SELECT r.code FROM user_school_roles ur
                   JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND ur.school_id = current_school_id()
                  ORDER BY r.sort_order LIMIT 1) AS role,
                f.issued_at AS connected_at,
                (SELECT max(x.revoked_at) FROM refresh_tokens x
                  WHERE x.family_id = f.family_id
                    AND x.revoked_reason IN ('logout', 'logout_all', 'deconnexion')) AS disconnected_at,
                host(f.ip) AS ip
           FROM familles f
           JOIN users u ON u.id = f.user_id
          WHERE f.issued_at >= $1::date
            AND f.issued_at <  ($1::date + interval '1 day')
            AND ((NOT $2 AND f.school_id = current_school_id())
                 OR ($2 AND (f.school_id IS NULL OR f.school_id = current_school_id())))
            AND EXISTS (
              SELECT 1 FROM user_school_roles ur
                JOIN roles r ON r.id = ur.role_id
               WHERE ur.user_id = u.id AND ur.school_id = current_school_id()
                 AND (r.code = 'parent') = $2
            )
          ORDER BY f.issued_at DESC
          LIMIT $3`,
        [input.day, input.tab === 'parent', max + 1],
      );

      const truncated = rows.length > max;
      return { rows: truncated ? rows.slice(0, max) : rows, truncated, max };
    });
  }
}

/**
 * Son `mdp_provisoire()` : une majuscule, une minuscule, six caractères parmi
 * minuscules et chiffres, un chiffre, un signe — sans O/0, l/1, I.
 */
export function mdpProvisoire(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const b = 'abcdefghijkmnopqrstuvwxyz';
  const c = '23456789';
  const d = '!@#$%&*';
  const pick = (s: string) => s[randomInt(s.length)]!;
  let out = pick(a) + pick(b);
  for (let i = 0; i < 6; i += 1) out += randomInt(2) ? pick(b) : pick(c);
  return out + pick(c) + pick(d);
}

/**
 * Les mois payés d'un membre du personnel : triés, dédoublonnés, 1..12 ; une
 * liste vide vaut « tous les mois » (le défaut, et ce que tout le personnel
 * existant garde — 0037).
 */
export function moisPayes(brut: readonly number[] | undefined): number[] {
  const mois = [...new Set((brut ?? []).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b);
  return mois.length === 0 ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : mois;
}
