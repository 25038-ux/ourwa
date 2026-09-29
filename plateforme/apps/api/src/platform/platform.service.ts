import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { money, toStorage, validatePassword } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../auth/permissions.service.js';
import { seal } from '../auth/auth.guard.js';
import { signAccessToken } from '../auth/tokens.js';
import { getJwtKeys } from '../auth/keys.js';
import { hashPassword } from '../auth/passwords.js';
import { SOURCE_LABELS } from '../reports/reports.service.js';

const SLUG = /^[a-z][a-z0-9-]{1,30}$/;

/**
 * The platform layer — above every branch.
 *
 * Built last on purpose: it is worthless until branches exist, and its most
 * dangerous feature (impersonation) is only safe once the isolation it crosses
 * is proven.
 */
export interface PeriodeDuTableau { entrees: string; sorties: string; net: string }
export interface BrancheDuTableau {
  id: string; slug: string; name: string; currency: string; active: boolean; effectif: number;
  jour: PeriodeDuTableau & { recus: number };
  mois: PeriodeDuTableau & { parSource: { source_type: string; direction: string; total: string; label: string }[] };
  annee: PeriodeDuTableau & { parMois: { mois: number; entrees: string; sorties: string }[] };
}

@Injectable()
export class PlatformService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  private async assertPlatformAdmin(userId: string): Promise<void> {
    const ok = await this.db.registry(async (tx) => {
      const { rows } = await tx.query(
        'SELECT 1 FROM users WHERE id = $1 AND is_platform_admin AND active',
        [userId],
      );
      return rows.length > 0;
    });
    // A branch super-admin is NOT a platform admin. The two are different
    // orders of authority and conflating them would let any school enter any
    // other.
    if (!ok) throw new ForbiddenException('Réservé aux administrateurs de la plateforme.');
  }

  /**
   * LA FACTURATION — `sidibrahim.php`'s whole reason for existing.
   *
   * ⚠ ITS CONSOLE IS A BILLING SCREEN AND OURS WAS NOT. `sidibrahim.php` opens
   * with "Suivi des effectifs et facturation": enrolled students, the per-pupil
   * tariff, this month's invoice, the annual projection, and a table of every
   * class with its own line. Ours showed collected revenue and expenses — the
   * school's money, not the platform's.
   *
   * Those are different questions. What a branch COLLECTS is its business; what
   * a branch OWES for using the platform is `élèves × TARIF_PAR_ELEVE`, and
   * nothing in our console could answer it.
   *
   * ⚠ THE TARIFF IS CONFIGURABLE, NOT `define('TARIF_PAR_ELEVE', 500)`. Its
   * constant lives in the source, so changing it means editing PHP on the
   * server. Ours reads `platform_settings`, defaulting to its 500.
   *
   * ⚠ AND IT COUNTS THE ACTIVE ENROLMENTS OF THE YEAR BEING VIEWED, not every
   * student row ever written. A school billed for pupils who left two years ago
   * would notice on the first invoice.
   */
  async billing(actorId: string) {
    await this.assertPlatformAdmin(actorId);
    const tariff = money(await this.perStudentTariff());
    const branches = await this.listBranches(actorId);

    /**
     * ⚠ ONE QUERY PER BRANCH, INSIDE ITS OWN TENANT CONTEXT — never one query
     * across all of them.
     *
     * My first version selected from `enrollments` through `db.registry`, which
     * is the untenanted pool: RLS did its job and returned nothing, so the
     * console showed every branch billing zero while the table beside it showed
     * two hundred pupils each. The screen was wrong in the safe direction, which
     * is the only reason it was obvious.
     *
     * `app_reporter` and its BYPASSRLS would make it one query and must not be
     * reachable from a request path (standing rule 3). At a handful of branches
     * a loop is cheaper than the risk — the same reasoning `combinedFinance()`
     * already records.
     */
    const perBranch = [];
    for (const branch of branches as {
      id: string;
      slug: string;
      name: string;
      currency: string;
    }[]) {
      const { students, groups } = await this.db.queryFor(branch.id, async (tx) => {
        // ⚠ The ACTIVE year's enrolments, not every student row ever written.
        // A school billed for pupils who left two years ago notices on the
        // first invoice.
        const { rows: groupRows } = await tx.query<{
          level_name: string;
          group_name: string;
          students: string;
        }>(
          `SELECT COALESCE(l.name, '—') AS level_name,
                  COALESCE(g.name, '—') AS group_name,
                  count(*)::text AS students
             FROM enrollments e
             JOIN academic_years y ON y.id = e.academic_year_id AND y.status = 'active'
             LEFT JOIN groups g ON g.id = e.group_id
             LEFT JOIN levels l ON l.id = COALESCE(e.level_id, g.level_id)
            WHERE e.status <> 'cancelled'
            GROUP BY l.name, g.name, l.sort_order
            ORDER BY l.sort_order NULLS LAST, g.name`,
        );
        const total = groupRows.reduce((n, r) => n + Number(r.students), 0);
        return { students: total, groups: groupRows };
      });

      perBranch.push({
        id: branch.id,
        slug: branch.slug,
        name: branch.name,
        currency: branch.currency,
        students,
        // ⚠ EN DECIMAL, PAS EN FLOTTANT. Les effectifs sont des entiers, mais le
        // tarif ne l'est pas forcément : `students * 750.5` dérive, et le
        // résultat part sur une facture.
        monthly: toStorage(tariff.times(students)),
        annual: toStorage(tariff.times(students).times(12)),
        groups: groups.map((g) => ({
          levelName: g.level_name,
          groupName: g.group_name,
          students: Number(g.students),
          amount: toStorage(tariff.times(Number(g.students))),
        })),
      });
    }

    await this.audit.record({
      actorId,
      action: 'platform_billing_viewed',
      entity: 'platform',
      entityId: null,
    });

    const totalStudents = perBranch.reduce((n, b) => n + b.students, 0);
    return {
      tariff: toStorage(tariff),
      branches: perBranch,
      totals: {
        students: totalStudents,
        monthly: toStorage(tariff.times(totalStudents)),
        annual: toStorage(tariff.times(totalStudents).times(12)),
      },
    };
  }

  /**
   * Son `TARIF_PAR_ELEVE`, stocké plutôt que compilé.
   *
   * ⚠ UNE CHAÎNE, PAS UN `number`. Il multiplie un effectif pour produire une
   * facture envoyée à une école : c'est de l'argent, et l'argent ne passe pas
   * par un flottant (règle 6). Il était lu en `Number` et toute la facturation
   * s'en servait — le commentaire qui s'en justifiait disait « the tariff is a
   * whole number of MRU », ce que rien n'imposait : le champ accepte 750,50.
   */
  async perStudentTariff(): Promise<string> {
    const { rows } = await this.db.registry((tx) =>
      tx.query<{ value: string }>(
        "SELECT value FROM platform_settings WHERE key = 'tarif_par_eleve'",
      ),
    );
    return toStorage(money(rows[0]?.value ?? '500'));
  }

  /**
   * Le changer. Audité : il décide de ce que chaque branche paie.
   *
   * ⚠ IL ÉTAIT LE SEUL HANDLER DE LA CONSOLE SANS AUCUN CONTRÔLE D'AUTORITÉ.
   * Le contrôleur porte cette note : « Every handler asserts platform-admin
   * status inside the service. There is no permission decorator here on
   * purpose » — il n'existe donc pas d'autre garde que cet appel, et celui-ci
   * ne le faisait pas. N'importe quel compte connecté, un parent compris,
   * pouvait changer le nombre qui facture toutes les écoles. L'action étant
   * auditée, elle laissait même une trace d'apparence régulière.
   */
  async setPerStudentTariff(amount: string, actorId: string): Promise<void> {
    await this.assertPlatformAdmin(actorId);

    let value: Decimal;
    try {
      value = money(amount);
    } catch {
      throw new BadRequestException('Le tarif doit être un montant.');
    }
    if (value.isNegative()) {
      throw new BadRequestException('Le tarif doit être un nombre positif.');
    }

    const stored = toStorage(value);
    await this.db.registry((tx) =>
      tx.query(
        `INSERT INTO platform_settings (key, value) VALUES ('tarif_par_eleve', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [stored],
      ),
    );
    await this.audit.record({
      actorId,
      action: 'platform_tariff_changed',
      entity: 'platform',
      entityId: null,
      after: { tarifParEleve: stored },
    });
  }

  async listBranches(userId: string) {
    await this.assertPlatformAdmin(userId);
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.slug, s.name, s.name_ar, s.currency, s.locale,
                s.theme_color, s.logo_emoji, s.active, s.created_at
           FROM schools s ORDER BY s.name`,
      );
      return rows;
    });
  }

  /**
   * Create a branch.
   *
   * There is no provisioning step: the site is live the moment the row exists,
   * because one deployment serves every school and the hostname is resolved per
   * request (ARCHITECTURE.md §4).
   */
  async createBranch(
    input: {
      slug: string;
      name: string;
      nameAr?: string;
      currency?: string;
      locale?: string;
      themeColor?: string;
      logoEmoji?: string;
      receiptPrefix?: string;
    },
    userId: string,
  ) {
    await this.assertPlatformAdmin(userId);

    if (!SLUG.test(input.slug)) {
      throw new BadRequestException(
        'Un identifiant de branche est en minuscules, chiffres et tirets, et commence par une lettre.',
      );
    }
    // These would collide with the platform console and the www convention.
    if (['admin', 'www', 'api'].includes(input.slug)) {
      throw new BadRequestException(`« ${input.slug} » est réservé.`);
    }

    const prefix = (input.receiptPrefix ?? input.slug.slice(0, 4)).toUpperCase();

    return this.db.registry(async (tx) => {
      const clash = await tx.query('SELECT 1 FROM schools WHERE slug = $1', [input.slug]);
      if (clash.rows.length > 0) {
        throw new ConflictException(`Une branche utilise déjà l’identifiant « ${input.slug} ».`);
      }

      const { rows } = await tx.query<{ id: string; slug: string; name: string }>(
        `INSERT INTO schools
           (slug, name, name_ar, currency, locale, theme_color, logo_emoji, receipt_prefix)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, slug, name`,
        [
          input.slug, input.name, input.nameAr ?? null, input.currency ?? 'MRU',
          input.locale ?? 'fr', input.themeColor ?? '#0f766e',
          input.logoEmoji ?? '🎓', prefix,
        ],
      );
      const school = rows[0]!;

      /**
       * ⚠ THIS RECORDED `nour.localhost` AS A SCHOOL'S PRIMARY DOMAIN — a
       * development address, written into production data and never corrected,
       * because nothing reads this table back and so nothing ever noticed.
       *
       * The host suffix is the one the rest of the deployment already knows:
       * `ALLOWED_ORIGIN_SUFFIX`, which CORS refuses to start without in
       * production. A branch created on `elourwa.mr` records
       * `nour.elourwa.mr`, which is true.
       *
       * ⚠ AND THE RESOLVER STILL DOES NOT READ THIS TABLE. Tenancy is decided
       * by the subdomain (`slugFromHost`), which is correct for every branch
       * this platform has. The row is a record of where a branch lives, not the
       * mechanism — and it has to be true before it can become the mechanism.
       */
      const suffix = process.env.ALLOWED_ORIGIN_SUFFIX?.trim() || 'localhost';
      await tx.query(
        `INSERT INTO school_domains (school_id, hostname, is_primary)
         VALUES ($1, $2, true)`,
        [school.id, `${input.slug}.${suffix}`],
      );

      await this.audit.record(
        {
          actorId: userId,
          schoolId: school.id,
          action: 'branch_created',
          entity: 'school',
          entityId: school.id,
          after: { slug: school.slug, name: school.name },
        },
        tx,
      );

      return school;
    });
  }

  /** Appoint a branch administrator. Creates the account if it does not exist. */
  async appointAdmin(
    schoolId: string,
    input: { email: string; fullName: string; password: string },
    userId: string,
  ) {
    await this.assertPlatformAdmin(userId);
    const hash = await hashPassword(input.password);

    return this.db.registry(async (tx) => {
      // Trois écritures qui vont ensemble : dans une transaction.
      await tx.query('BEGIN');
      try {
        const { rows: role } = await tx.query<{ id: string }>(
          "SELECT id FROM roles WHERE code = 'super_admin'",
        );
        if (!role[0]) throw new BadRequestException('Le rôle super_admin est absent de cette base.');

        // ⚠ UN E-MAIL DÉJÀ PRIS N'EST PAS UN COMPTE À RÉÉCRIRE. « ON CONFLICT
        // DO UPDATE » renommait le compte existant (un parent, un agent) et
        // lui donnait super_admin en gardant SON mot de passe — celui tapé ici
        // était jeté sans un mot. Un compte de la plateforme ne se nomme pas
        // ici non plus ; un autre compte est rattaché tel quel, et la réponse le dit.
        const { rows: existant } = await tx.query<{ id: string; is_platform_admin: boolean }>(
          'SELECT id, is_platform_admin FROM users WHERE lower(email) = lower($1)',
          [input.email],
        );
        if (existant[0]?.is_platform_admin) {
          throw new ConflictException('Cet e-mail est celui d’un administrateur de la plateforme : il entre dans une branche par « Entrer », pas par une nomination.');
        }
        let id: string;
        const attached = Boolean(existant[0]);
        if (existant[0]) {
          id = existant[0].id;
        } else {
          const { rows: user } = await tx.query<{ id: string }>(
            `INSERT INTO users (email, password_hash, full_name, must_change_password)
             VALUES ($1, $2, $3, true) RETURNING id`,
            [input.email, hash, input.fullName],
          );
          id = user[0]!.id;
        }

        await tx.query(
          `INSERT INTO user_school_roles (user_id, school_id, role_id)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, schoolId, role[0].id],
        );

        await this.audit.record(
          {
            actorId: userId,
            schoolId,
            action: attached ? 'branch_admin_attached' : 'branch_admin_appointed',
            entity: 'user',
            entityId: id,
            after: { email: input.email, attached },
          },
          tx,
        );
        await tx.query('COMMIT');
        return { id, email: input.email, attached, passwordApplied: !attached };
      } catch (error) {
        await tx.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  /**
   * ⚠ IMPERSONATION — enter a branch without re-authenticating.
   *
   * Three non-negotiables (ARCHITECTURE.md §5):
   *
   *  1. Every session is audit-logged: who, which branch, when. This is the
   *     feature most likely to be abused or disputed, and the log is what
   *     protects everyone — including the administrator.
   *  2. Time-boxed to 30 minutes. Re-enter to extend.
   *  3. It runs through NORMAL RLS, never BYPASSRLS. The admin inside a school
   *     is subject to exactly the same isolation as anyone else, so a bug in a
   *     school page cannot leak across branches even for them.
   *
   * The UI must show a persistent banner. Without it, someone will eventually
   * act in the wrong school believing they are somewhere else.
   */
  async enterBranch(schoolId: string, userId: string, ip?: string) {
    await this.assertPlatformAdmin(userId);

    const school = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ id: string; slug: string; name: string; active: boolean }>(
        'SELECT id, slug, name, active FROM schools WHERE id = $1',
        [schoolId],
      );
      return rows[0];
    });
    if (!school) throw new NotFoundException('Branche introuvable.');
    if (!school.active) throw new BadRequestException(`${school.name} n’est pas active.`);

    // The effective permissions inside the branch are a branch super-admin's,
    // not "everything": impersonation grants presence, not extra power.
    const permissions = await this.permissions.forRole('super_admin');

    const sceau = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [userId],
      );
      return rows[0] ? seal(rows[0].password_hash) : undefined;
    });

    const TTL = 30 * 60;
    const token = await signAccessToken(
      {
        sub: userId,
        schoolId: school.id,
        roles: ['super_admin'],
        permissions,
        impersonated: true,
        actorId: userId,
        seal: sceau,
      },
      getJwtKeys().privateKey,
      TTL,
    );

    await this.audit.record({
      actorId: userId,
      schoolId: school.id,
      action: 'impersonation_started',
      entity: 'school',
      entityId: school.id,
      ip: ip ?? null,
      impersonated: true,
      after: { slug: school.slug, expiresInSeconds: TTL },
    });

    return {
      accessToken: token,
      expiresIn: TTL,
      school: { id: school.id, slug: school.slug, name: school.name },
      impersonated: true,
    };
  }

  /**
   * ⚠ ELLE N'ÉCRIT QU'UNE LIGNE D'AUDIT — ET C'EST PRÉCISÉMENT POURQUOI ELLE
   * DOIT SE GARDER. L'identifiant d'école vient de l'appelant : sans contrôle,
   * un compte quelconque fabriquait une trace « impersonation_ended » sur
   * l'école de son choix, et salissait le seul journal qui permette d'établir
   * qui est entré où.
   */
  async leaveBranch(schoolId: string, userId: string, ip?: string): Promise<void> {
    await this.assertPlatformAdmin(userId);
    await this.audit.record({
      actorId: userId,
      schoolId,
      action: 'impersonation_ended',
      entity: 'school',
      entityId: schoolId,
      ip: ip ?? null,
      impersonated: true,
    });
  }

  /**
   * SUSPENDRE OU RÉOUVRIR UNE BRANCHE.
   *
   * ⚠ L'ÉCRAN AFFICHAIT DÉJÀ L'ÉTAT SANS POUVOIR LE POSER. La console rend
   * `b.active ? 'active' : 'suspendue'` sur chaque branche, et `schools.active`
   * existe depuis la migration 0001 — mais aucune route ne le changeait. Un
   * état qu'on montre sans commande pour l'atteindre est pire qu'un état absent :
   * il laisse croire que le bouton se trouve ailleurs.
   *
   * ⚠ SUSPENDRE N'EST PAS SUPPRIMER. Une branche suspendue garde ses élèves,
   * ses paiements et son historique ; elle cesse d'ouvrir ses portes, et c'est
   * tout. Réversible par construction — un seul booléen, aucune cascade.
   */
  async setBranchActive(schoolId: string, active: boolean, userId: string) {
    await this.assertPlatformAdmin(userId);

    // `schools` est GLOBALE, pas locataire : elle se lit et s'écrit par le
    // registre, comme `listBranches` — `db.query` exigerait un contexte de
    // locataire qu'une console plateforme n'a pas.
    const { rows } = await this.db.registry(async (tx) => {
      return tx.query<{ slug: string; name: string; active: boolean }>(
        'UPDATE schools SET active = $2 WHERE id = $1 RETURNING slug, name, active',
        [schoolId, active],
      );
    });
    const branche = rows[0];
    if (!branche) throw new NotFoundException('Branche introuvable.');

    await this.audit.record({
      actorId: userId,
      schoolId,
      action: active ? 'branch_reopened' : 'branch_suspended',
      entity: 'school',
      entityId: schoolId,
      after: { slug: branche.slug, active: branche.active },
    });

    return branche;
  }

  /**
   * Combined figures across every branch.
   *
   * Runs as the ordinary application role with an explicit per-branch loop
   * rather than BYPASSRLS. `app_reporter` exists for scheduled rollup jobs and
   * must never be reachable from a request path (standing rule 3) — and at this
   * scale a loop over a handful of branches is cheaper than the risk.
   */
  async combinedFinance(userId: string) {
    await this.assertPlatformAdmin(userId);
    const branches = await this.listBranches(userId);

    const rows = [];
    for (const branch of branches as { id: string; slug: string; name: string; currency: string }[]) {
      const figures = await this.db.queryFor(branch.id, async (tx) => {
        const { rows: r } = await tx.query<{
          collected: string;
          students: string;
          expenses: string;
        }>(
          `SELECT
             (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM payments) AS collected,
             (SELECT count(*)::text FROM students) AS students,
             (SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text FROM expenses) AS expenses`,
        );
        return r[0]!;
      });
      rows.push({
        slug: branch.slug,
        name: branch.name,
        currency: branch.currency,
        students: Number(figures.students),
        collected: figures.collected,
        expenses: figures.expenses,
      });
    }
    return { branches: rows };
  }

  // ── LE TABLEAU DE BORD DE LA PLATEFORME — le cumul de toutes les branches ──
  //
  // Décision du propriétaire (2026-09-14) : la console montre ce que l'ensemble
  // des écoles a encaissé AUJOURD'HUI, ce qu'il a dépensé, puis un rapport
  // mensuel et un rapport annuel — chaque chiffre étant la somme des branches.
  //
  // La source est la caisse (`tender_lines`, `rapport_financier.php`) : une
  // ligne par mouvement d'argent, dans les deux sens — scolarité, frais
  // annuels, cours du soir, dettes diverses en entrée ; dépenses, salaires,
  // prêts, retraits en sortie. Sommer la caisse, c'est sommer ce qui est
  // réellement entré et sorti, pas ce qui était dû.
  //
  // Branche par branche, sous RLS (`queryFor`), jamais `app_reporter` dans une
  // requête (règle 3) ; les montants s'additionnent en `Decimal` et sortent en
  // chaînes (règle 6). Une monnaie par école (règle 9) : le cumul n'est donné
  // que si toutes comptent dans la même, sinon il est nul plutôt que faux.

  async tableauBord(userId: string, mois: number, annee: number) {
    await this.assertPlatformAdmin(userId);
    const branches = (await this.listBranches(userId)) as {
      id: string; slug: string; name: string; currency: string; active: boolean;
    }[];

    const parBranche: BrancheDuTableau[] = [];
    for (const b of branches) {
      const f = await this.db.queryFor(b.id, async (tx) => {
        const { rows } = await tx.query<{
          jour_in: string; jour_out: string;
          mois_in: string; mois_out: string;
          annee_in: string; annee_out: string;
          jour_recus: string;
        }>(
          `SELECT
             COALESCE(SUM(amount) FILTER (WHERE direction = 'in'  AND created_at::date = CURRENT_DATE), 0)::numeric(14,2)::text AS jour_in,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'out' AND created_at::date = CURRENT_DATE), 0)::numeric(14,2)::text AS jour_out,
             count(DISTINCT (source_type, source_id)) FILTER (WHERE direction = 'in' AND created_at::date = CURRENT_DATE)::text AS jour_recus,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'in'  AND EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2), 0)::numeric(14,2)::text AS mois_in,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'out' AND EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2), 0)::numeric(14,2)::text AS mois_out,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'in'  AND EXTRACT(YEAR FROM created_at) = $2), 0)::numeric(14,2)::text AS annee_in,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'out' AND EXTRACT(YEAR FROM created_at) = $2), 0)::numeric(14,2)::text AS annee_out
           FROM tender_lines`,
          [mois, annee],
        );
        // Le rapport mensuel de l'année : douze lignes, comme la « synthèse
        // mensuelle » de `revenue_live.php`, entrées et sorties.
        const { rows: parMois } = await tx.query<{ mois: number; entrees: string; sorties: string }>(
          `SELECT EXTRACT(MONTH FROM created_at)::int AS mois,
                  COALESCE(SUM(amount) FILTER (WHERE direction = 'in'), 0)::numeric(14,2)::text AS entrees,
                  COALESCE(SUM(amount) FILTER (WHERE direction = 'out'), 0)::numeric(14,2)::text AS sorties
             FROM tender_lines
            WHERE EXTRACT(YEAR FROM created_at) = $1
            GROUP BY 1 ORDER BY 1`,
          [annee],
        );
        // Le détail du mois par origine, entrées comme sorties.
        const { rows: parSource } = await tx.query<{ source_type: string; direction: string; total: string }>(
          `SELECT source_type, direction::text, COALESCE(SUM(amount), 0)::numeric(14,2)::text AS total
             FROM tender_lines
            WHERE EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2
            GROUP BY source_type, direction ORDER BY direction, SUM(amount) DESC`,
          [mois, annee],
        );
        const { rows: eff } = await tx.query<{ n: string }>(
          // La même règle que la facturation : l'année active, hors annulées.
          `SELECT count(*)::text AS n FROM enrollments e
             JOIN academic_years y ON y.id = e.academic_year_id AND y.status = 'active'
            WHERE e.status <> 'cancelled'`,
        );
        return {
          ...rows[0]!,
          parMois,
          // Ses libellés d'origine (`rapport_financier.php`), les mêmes qu'à la caisse.
          parSource: parSource.map((s) => ({ ...s, label: SOURCE_LABELS[s.source_type] ?? s.source_type })),
          effectif: Number(eff[0]!.n),
        };
      });
      parBranche.push({
        id: b.id, slug: b.slug, name: b.name, currency: b.currency, active: b.active,
        effectif: f.effectif,
        jour: { entrees: f.jour_in, sorties: f.jour_out, recus: Number(f.jour_recus),
                net: toStorage(money(f.jour_in).minus(money(f.jour_out))) },
        mois: { entrees: f.mois_in, sorties: f.mois_out,
                net: toStorage(money(f.mois_in).minus(money(f.mois_out))), parSource: f.parSource },
        annee: { entrees: f.annee_in, sorties: f.annee_out,
                 net: toStorage(money(f.annee_in).minus(money(f.annee_out))), parMois: f.parMois },
      });
    }

    const monnaies = new Set(parBranche.map((b) => b.currency));
    const cumul = (cle: 'jour' | 'mois' | 'annee', champ: 'entrees' | 'sorties') =>
      toStorage(parBranche.reduce((s, b) => s.plus(money(b[cle][champ])), money('0')));
    const total = (cle: 'jour' | 'mois' | 'annee') => ({
      entrees: cumul(cle, 'entrees'),
      sorties: cumul(cle, 'sorties'),
      net: toStorage(money(cumul(cle, 'entrees')).minus(money(cumul(cle, 'sorties')))),
    });
    // Le cumul par mois de l'année, toutes branches.
    const parMois = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const entrees = parBranche.reduce(
        (s, b) => s.plus(money(b.annee.parMois.find((x) => x.mois === m)?.entrees ?? '0')), money('0'));
      const sorties = parBranche.reduce(
        (s, b) => s.plus(money(b.annee.parMois.find((x) => x.mois === m)?.sorties ?? '0')), money('0'));
      return { mois: m, entrees: toStorage(entrees), sorties: toStorage(sorties), net: toStorage(entrees.minus(sorties)) };
    });

    return {
      mois,
      annee,
      currency: monnaies.size === 1 ? [...monnaies][0] : null,
      cumul: monnaies.size <= 1
        ? { jour: { ...total('jour'), recus: parBranche.reduce((n, b) => n + b.jour.recus, 0) },
            mois: total('mois'), annee: total('annee'), parMois,
            effectif: parBranche.reduce((n, b) => n + b.effectif, 0) }
        : null,
      branches: parBranche,
    };
  }

  // ── LES ADMINISTRATEURS DE LA PLATEFORME ────────────────────────────────
  //
  // Décision du propriétaire (2026-09-14) : l'administrateur de toutes les
  // branches peut créer d'autres administrateurs de la plateforme, avec les
  // mêmes privilèges que lui (`is_platform_admin`). Ce n'est pas un rôle
  // d'école : aucun rôle rattaché à une école (aucune ligne de rôle) — la console
  // entière, et rien d'autre.

  async listPlatformAdmins(userId: string) {
    await this.assertPlatformAdmin(userId);
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{
        id: string; full_name: string; email: string | null; username: string | null;
        phone: string | null; active: boolean; last_login_at: Date | null; created_at: Date;
      }>(
        `SELECT id, full_name, email, username, phone, active, last_login_at, created_at
           FROM users WHERE is_platform_admin ORDER BY created_at`,
      );
      return rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        identifier: r.username ?? r.email ?? r.phone ?? '',
        active: r.active,
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at,
        self: r.id === userId,
      }));
    });
  }

  /**
   * Créer un administrateur de la plateforme : nom, identifiant (une adresse
   * ou un nom d'utilisateur — ses règles : 3 à 100 caractères, lettres,
   * chiffres, `._@-`), mot de passe (la politique), qu'il devra changer à la
   * première connexion. Audité : c'est une clé de toute la plateforme.
   */
  async createPlatformAdmin(
    input: { fullName: string; identifier: string; password: string },
    actorId: string,
    ip?: string,
  ) {
    await this.assertPlatformAdmin(actorId);
    const fullName = input.fullName.trim();
    const identifier = input.identifier.trim();
    if (fullName.length < 3) throw new BadRequestException('Le nom est obligatoire (3 caractères au moins).');
    if (!/^[a-zA-Z0-9._@-]{3,100}$/.test(identifier)) {
      throw new BadRequestException('Identifiant invalide (3-100 caractères, lettres, chiffres, @, ., -, _).');
    }
    const refus = validatePassword(input.password);
    if (refus) throw new BadRequestException(refus);
    const estUneAdresse = identifier.includes('@');

    const pris = await this.db.registry(async (tx) => {
      const { rows } = await tx.query(
        `SELECT 1 FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1) LIMIT 1`,
        [identifier],
      );
      return rows.length > 0;
    });
    if (pris) throw new ConflictException('Cet identifiant existe déjà.');

    const hash = await hashPassword(input.password);
    const created = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO users (email, username, password_hash, full_name, is_platform_admin, must_change_password)
         VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [estUneAdresse ? identifier.toLowerCase() : null, estUneAdresse ? null : identifier, hash, fullName],
      );
      return rows[0]!.id;
    });
    await this.audit.record({
      actorId,
      schoolId: null,
      action: 'platform_admin_created',
      entity: 'user',
      entityId: created,
      ip,
      after: { identifier, fullName },
    });
    return { id: created, identifier };
  }

  /**
   * Désactiver ou réactiver un administrateur de la plateforme — jamais
   * soi-même, jamais le dernier actif : la console ne doit pas se fermer sur
   * tout le monde.
   */
  async setPlatformAdminActive(targetId: string, active: boolean, actorId: string, ip?: string) {
    await this.assertPlatformAdmin(actorId);
    if (targetId === actorId) throw new BadRequestException('Vous ne pouvez pas désactiver votre propre compte.');
    await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ id: string; active: boolean }>(
        'SELECT id, active FROM users WHERE id = $1 AND is_platform_admin',
        [targetId],
      );
      if (!rows[0]) throw new NotFoundException('Administrateur introuvable.');
      if (!active) {
        const { rows: actifs } = await tx.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM users WHERE is_platform_admin AND active AND id <> $1',
          [targetId],
        );
        if (Number(actifs[0]!.n) === 0) {
          throw new BadRequestException("Refusé : c'est le dernier administrateur actif de la plateforme.");
        }
      }
      await tx.query('UPDATE users SET active = $2 WHERE id = $1', [targetId, active]);
      if (!active) {
        await tx.query(
          `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'platform_admin_deactivated'
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [targetId],
        );
      }
    });
    await this.audit.record({
      actorId,
      schoolId: null,
      action: active ? 'platform_admin_restored' : 'platform_admin_suspended',
      entity: 'user',
      entityId: targetId,
      ip,
    });
    return { id: targetId, active };
  }
}
