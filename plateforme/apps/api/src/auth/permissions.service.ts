import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service.js';

/**
 * Who may do what.
 *
 * Permissions are DATA in `role_permissions`, never hardcoded (PROJECT.md §2.2).
 * A school can define custom roles later without a code change, and
 * `if (role === 'super_admin')` never appears in business logic.
 *
 * Nothing here is cached in a session. El Ourwa re-reads on every request
 * deliberately: a session cache would let an agent keep revoked rights until
 * their next login — precisely the hole to avoid when an administrator removes a
 * role. Two small indexed tables per request is the price.
 */
@Injectable()
export class PermissionsService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** Every permission a user holds in one school, as the union of their roles. */
  async forUserInSchool(userId: string, schoolId: string): Promise<Set<string>> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ permission: string }>(
        `SELECT DISTINCT rp.permission
           FROM user_school_roles usr
           JOIN role_permissions rp ON rp.role_id = usr.role_id
          WHERE usr.user_id = $1 AND usr.school_id = $2`,
        [userId, schoolId],
      );
      return new Set(rows.map((r) => r.permission));
    });
  }

  async rolesForUserInSchool(userId: string, schoolId: string): Promise<string[]> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ code: string }>(
        `SELECT r.code
           FROM user_school_roles usr
           JOIN roles r ON r.id = usr.role_id
          WHERE usr.user_id = $1 AND usr.school_id = $2
          ORDER BY r.sort_order`,
        [userId, schoolId],
      );
      return rows.map((r) => r.code);
    });
  }

  /** Which schools a user may enter at all. */
  /**
   * LES ÉCOLES D'UNE FAMILLE — celles, actives, où ce compte porte le rôle
   * `parent`. Une famille avec un enfant à Nour et un autre à Rissala en a
   * deux ; l'application des familles est une pour toutes les branches
   * (décision du propriétaire, 2026-09-14) et ouvre une session sur toutes.
   */
  async ecolesDeFamille(
    userId: string,
  ): Promise<{ id: string; slug: string; name: string; nameAr: string | null }[]> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ id: string; slug: string; name: string; name_ar: string | null }>(
        `SELECT DISTINCT s.id, s.slug, s.name, s.name_ar
           FROM user_school_roles usr
           JOIN roles r ON r.id = usr.role_id AND r.code = 'parent'
           JOIN schools s ON s.id = usr.school_id AND s.active
          WHERE usr.user_id = $1
          ORDER BY s.name`,
        [userId],
      );
      return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, nameAr: r.name_ar }));
    });
  }

  async schoolsForUser(userId: string): Promise<string[]> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ school_id: string }>(
        'SELECT DISTINCT school_id FROM user_school_roles WHERE user_id = $1',
        [userId],
      );
      return rows.map((r) => r.school_id);
    });
  }

  async isPlatformAdmin(userId: string): Promise<boolean> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ is_platform_admin: boolean }>(
        'SELECT is_platform_admin FROM users WHERE id = $1 AND active',
        [userId],
      );
      return rows[0]?.is_platform_admin ?? false;
    });
  }

  /**
   * The permissions a role carries, independent of any user.
   *
   * Used when minting an impersonation token: the platform admin takes on a
   * branch super-admin's permissions, not "everything". Impersonation grants
   * presence in a branch, not extra power inside it.
   */
  async forRole(code: string): Promise<string[]> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ permission: string }>(
        `SELECT rp.permission
           FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
          WHERE r.code = $1
          ORDER BY rp.permission`,
        [code],
      );
      return rows.map((r) => r.permission);
    });
  }
}
