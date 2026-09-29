import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { validatePassword, telephoneMauritanien, TELEPHONE_MAURITANIEN_REFUS } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { PermissionsService } from './permissions.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { SessionsService, type SessionContext } from './sessions.service.js';
import { constantTimeFloor, hashPassword, verifyAndUpgrade } from './passwords.js';
import { signAccessToken, type AccessClaims } from './tokens.js';
import { seal } from './auth.guard.js';
import { getJwtKeys } from './keys.js';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    isPlatformAdmin: boolean;
    mustChangePassword: boolean;
    locale: string;
  };
  school: { id: string; slug: string } | null;
  roles: string[];
  permissions: string[];
  /** Les écoles d'une session de famille ; vide pour le personnel et la plateforme. */
  ecoles: { id: string; slug: string; name: string; nameAr: string | null }[];
}

interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  password_hash: string;
  full_name: string;
  is_platform_admin: boolean;
  locale: string;
  active: boolean;
  must_change_password: boolean;
  locked_until: Date | null;
}

// 15 minutes — .env.example nomme JWT_ACCESS_TTL depuis le premier jour, et
// rien ne le lisait ; un test de renouvellement en a besoin plus court.
const ACCESS_TTL = Math.max(30, Number(process.env.JWT_ACCESS_TTL ?? 900) || 900);

@Injectable()
export class AuthService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  /**
   * Log in.
   *
   * `identifier` is a username or an email (staff) or a phone number (guardians
   * — El Ourwa's parents sign in with their phone). `schoolSlug` is null only for
   * a platform admin at `admin.<domain>`.
   */
  async login(
    identifier: string,
    password: string,
    schoolSlug: string | null,
    ctx: SessionContext & { ip: string },
    /**
     * L'espace des familles (`parent_connexion.php`) : les phrases de
     * `tenter_connexion_parent()` — « Numéro ou mot de passe incorrect. »,
     * « Trop de tentatives échouées. Compte verrouillé 15 minutes. » — au lieu
     * de celles de `tenter_connexion()`.
     */
    espaceParent = false,
  ): Promise<LoginResult> {
    // ⚠ L'ESPACE DES FAMILLES N'ACCEPTE QU'UN NUMÉRO MAURITANIEN comme
    // identifiant (décision du propriétaire, 2026-09-14) : huit chiffres,
    // 2/3/4 en tête, indicatif +222 admis. Le refus est dit avant toute
    // recherche — il ne révèle rien sur l'existence d'un compte.
    if (espaceParent) {
      const canonique = telephoneMauritanien(identifier);
      if (!canonique) throw new BadRequestException(TELEPHONE_MAURITANIEN_REFUS);
      identifier = canonique;
    }
    // ⚠ LA CLÉ DU VERROU EST LA FORME CANONIQUE : « 22 12 34 56 », « 22123456 »
    // et « +222 22123456 » désignent le même compte, et comptaient trois seaux.
    // ⚠ ET UN SEUL SEAU PAR COMPTE (0041) : chaque numéro supplémentaire d'une
    // famille avait son propre budget de cinq essais — trois numéros, quinze
    // essais par quart d'heure contre le même mot de passe. Un numéro
    // supplémentaire compte dans le seau du numéro principal du compte.
    const cle = await this.seauDuCompte(telephoneMauritanien(identifier) ?? identifier.trim().toLowerCase());
    await this.rateLimit.assertAllowed(cle, ctx.ip);

    const result = await constantTimeFloor(
      this.attempt(identifier, password, schoolSlug, ctx, espaceParent),
    );

    if (!result.ok) {
      await this.rateLimit.record(cle, ctx.ip, false, ctx.userAgent);
      await this.audit.record({
        action: 'login_failed',
        entity: 'user',
        ip: ctx.ip,
        after: { identifier, reason: result.reason },
      });
      // Son cinquième échec : « Trop de tentatives échouées. Compte verrouillé
      // pendant 15 minutes. » — dit au moment où le verrou se pose.
      if (await this.rateLimit.justLocked(cle)) {
        throw new HttpException(
          espaceParent
            ? 'Trop de tentatives échouées. Compte verrouillé 15 minutes.'
            : 'Trop de tentatives échouées. Compte verrouillé pendant 15 minutes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // ⚠ ONE MESSAGE FOR EVERY FAILURE MODE. Distinguishing "no such account"
      // from "wrong password" hands an attacker a user-enumeration oracle.
      //
      // ⚠ AND IT IS IN FRENCH, because a person reads it. This said "Invalid
      // credentials" and the login page printed exactly that to a school in
      // Nouakchott. El Ourwa's own sentence, full stop included.
      throw new UnauthorizedException(
        espaceParent ? 'Numéro ou mot de passe incorrect.' : 'Identifiant ou mot de passe incorrect.',
      );
    }

    await this.rateLimit.record(cle, ctx.ip, true, ctx.userAgent);
    await this.rateLimit.clearAccount(cle);
    // Son `derniere_connexion = NOW()` (auth.php, parent_auth.php) : c'est ce
    // que « Dernière connexion » lit sur les comptes du personnel, des parents
    // et de la plateforme. Sans cette ligne, tout le monde n'était « Jamais
    // connecté ».
    await this.db.registry((tx) =>
      tx.query('UPDATE users SET last_login_at = now() WHERE id = $1', [result.value.user.id]),
    );
    await this.audit.record({
      actorId: result.value.user.id,
      schoolId: result.value.school?.id ?? null,
      action: 'login_succeeded',
      entity: 'user',
      entityId: result.value.user.id,
      ip: ctx.ip,
    });
    return result.value;
  }

  /** Le seau du verrou : le numéro principal du compte quand on a tapé un numéro supplémentaire. */
  private async seauDuCompte(cle: string): Promise<string> {
    if (!/^[0-9]{8}$/.test(cle)) return cle;
    return this.db
      .registry(async (tx) => {
        const { rows } = await tx.query<{ principal: string | null; id: string }>(
          `SELECT right(regexp_replace(COALESCE(u.phone, ''), '[^0-9]', '', 'g'), 8) AS principal, u.id
             FROM user_phones up JOIN users u ON u.id = up.user_id
            WHERE up.phone = $1 LIMIT 1`,
          [cle],
        );
        const r = rows[0];
        if (!r) return cle;
        return r.principal && r.principal.length === 8 ? r.principal : `compte:${r.id}`;
      })
      .catch(() => cle);
  }

  private async attempt(
    identifier: string,
    password: string,
    schoolSlug: string | null,
    ctx: SessionContext & { ip: string },
    espaceParent = false,
  ): Promise<{ ok: true; value: LoginResult } | { ok: false; reason: string }> {
    const user = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<UserRow>(
        // ⚠ TROIS FAÇONS DE SE NOMMER, ET UNE SEULE PERSONNE DERRIÈRE.
        // Un parent tape son numéro, un membre du personnel tape son nom
        // d'utilisateur, et certains ont une adresse. Les trois colonnes sont
        // uniques — `username` sur `lower(username)`, comme la comparaison ici —
        // donc aucune saisie ne peut désigner deux comptes.
        // ⚠ LE NUMÉRO EST COMPARÉ NORMALISÉ, comme sa `tenter_connexion_parent()` :
        // « Recherche tolérante : on compare la version normalisée des deux
        // côtés » — `normaliser_telephone()` ne garde que chiffres et « + »,
        // et la colonne est lue sans espaces, tirets ni parenthèses. Un parent
        // qui tape « 22 12 34 56 » pour un numéro enregistré « 22123456 » entre.
        `SELECT id, email, phone, username, password_hash, full_name,
                is_platform_admin, locale, active, must_change_password, locked_until
           FROM users
          WHERE lower(email) = lower($1)
             OR phone = $1
             OR lower(username) = lower($1)
             OR ($2 <> '' AND right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 8) = $2)
             -- Un numéro supplémentaire de la famille (0041) ouvre le même compte.
             OR ($2 <> '' AND EXISTS (SELECT 1 FROM user_phones up WHERE up.user_id = users.id AND up.phone = $2))`,
        // La forme canonique (huit chiffres) contre la colonne réduite à ses
        // chiffres : « +222 40 00 00 00 », « 40000000 » et « (40) 00-00-00 »
        // désignent le même compte.
        [identifier.trim(), telephoneMauritanien(identifier) ?? ''],
      );
      // ⚠ DEUX COMPTES POUR UN IDENTIFIANT : ON N'OUVRE NI L'UN NI L'AUTRE.
      // Avant 0041 chaque branche du WHERE frappait une colonne unique ; un
      // numéro peut désormais, par un défaut ailleurs, être le principal d'un
      // compte et le supplémentaire d'un autre. `rows[0]` aurait vérifié le
      // mot de passe contre celui que le planificateur rend en premier — et
      // ouvert la mauvaise famille si les deux ont le même. Fermé, jusqu'à ce
      // que le secrétariat tranche.
      if (rows.length > 1) {
        await this.audit.record({
          action: 'login_ambiguous_identifier',
          entity: 'user',
          after: { identifier, comptes: rows.map((r) => r.id) },
        });
        return undefined;
      }
      return rows[0];
    });

    if (!user) {
      // Still spend time hashing so a missing account is not measurably faster
      // than a wrong password.
      await verifyAndUpgrade('$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', password);
      return { ok: false, reason: 'no_such_user' };
    }
    if (!user.active) return { ok: false, reason: 'inactive' };
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      return { ok: false, reason: 'locked' };
    }

    const verified = await verifyAndUpgrade(user.password_hash, password);
    if (!verified.ok) return { ok: false, reason: 'bad_password' };

    // Transparent upgrade: a legacy bcrypt hash becomes Argon2id on the first
    // successful login, with no reset and nothing for the user to notice.
    if (verified.upgradedHash) {
      await this.db.registry((tx) =>
        tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
          user.id,
          verified.upgradedHash,
        ]),
      );
      await this.audit.record({
        actorId: user.id,
        action: 'password_hash_upgraded',
        entity: 'user',
        entityId: user.id,
        ip: ctx.ip,
        after: { from: 'bcrypt', to: 'argon2id' },
      });
    }

    // ── Which school is this session for? ─────────────────────────────────
    let school: { id: string; slug: string } | null = null;
    let roles: string[] = [];
    let permissions: string[] = [];
    let ecolesFamille: { id: string; slug: string; name: string; nameAr: string | null }[] = [];

    if (espaceParent && !schoolSlug) {
      // UNE SESSION DE FAMILLE : pas d'école — toutes celles où le compte est
      // parent. Aucune : ce numéro n'est pas celui d'une famille, et la
      // réponse est la même que pour un mot de passe faux (pas d'énumération).
      ecolesFamille = await this.permissions.ecolesDeFamille(user.id);
      if (ecolesFamille.length === 0) return { ok: false, reason: 'not_a_parent' };
      roles = ['parent'];
    } else if (schoolSlug) {
      const found = await this.tenants.findBySlug(schoolSlug);
      const allowed = await this.permissions.schoolsForUser(user.id);
      if (!allowed.includes(found.id) && !user.is_platform_admin) {
        // The account exists and the password is right, but not here.
        return { ok: false, reason: 'not_a_member_of_school' };
      }
      school = { id: found.id, slug: found.slug };
      roles = await this.permissions.rolesForUserInSchool(user.id, found.id);
      permissions = [...(await this.permissions.forUserInSchool(user.id, found.id))];
    } else if (!user.is_platform_admin) {
      // No subdomain and not a platform admin: there is no school to enter.
      return { ok: false, reason: 'no_school_context' };
    }

    const famille = ecolesFamille.length > 0;
    const claims: AccessClaims = {
      sub: user.id,
      schoolId: school?.id ?? null,
      roles,
      permissions,
      impersonated: false,
      ...(famille ? { espace: 'parent' as const } : {}),
      // Le sceau est pris APRÈS la remise à niveau de l'empreinte, sinon le
      // premier jeton d'un compte bcrypt mourrait à sa première requête.
      seal: seal(verified.upgradedHash ?? user.password_hash),
    };

    const keys = getJwtKeys();
    const accessToken = await signAccessToken(claims, keys.privateKey, ACCESS_TTL);
    // Une session de famille n'a pas d'école sur son jeton de rafraîchissement
    // (`school_id` nul) — comme celle de la plateforme ; c'est le compte qui
    // les distingue au renouvellement.
    const session = await this.sessions.issue(user.id, school?.id ?? null, {
      ...ctx,
      // Voir SessionContext.sansAdresse : le téléphone change de réseau.
      sansAdresse: espaceParent,
    });

    return {
      ok: true,
      value: {
        accessToken,
        refreshToken: session.refreshToken,
        expiresIn: ACCESS_TTL,
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          phone: user.phone,
          isPlatformAdmin: user.is_platform_admin,
          mustChangePassword: user.must_change_password,
          locale: user.locale,
        },
        school,
        roles,
        permissions,
        /** Les écoles d'une session de famille (vide pour le personnel). */
        ecoles: ecolesFamille,
      },
    };
  }

  /** Exchange a refresh token for a fresh pair. Rotation + reuse detection. */
  async refresh(
    presented: string,
    ctx: SessionContext & { ip: string },
  ): Promise<LoginResult> {
    const rotated = await this.sessions.rotate(presented, ctx);

    const user = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<UserRow>(
        `SELECT id, email, phone, password_hash, full_name, is_platform_admin,
                locale, active, must_change_password, locked_until
           FROM users WHERE id = $1`,
        [rotated.userId],
      );
      return rows[0];
    });
    if (!user || !user.active) throw new ForbiddenException('Ce compte est désactivé.');

    let roles: string[] = [];
    let permissions: string[] = [];
    let school: { id: string; slug: string } | null = null;
    let ecolesFamille: { id: string; slug: string; name: string; nameAr: string | null }[] = [];

    const famille = !rotated.schoolId && !user.is_platform_admin;
    if (famille) {
      // Une session de famille : ses écoles sont relues, comme au garde.
      ecolesFamille = await this.permissions.ecolesDeFamille(user.id);
      if (ecolesFamille.length === 0) {
        throw new ForbiddenException('Ce compte n’est plus rattaché à une école.');
      }
      roles = ['parent'];
    } else if (rotated.schoolId) {
      // Re-read, never carry the old token's claims forward: a role revoked
      // since the last refresh must take effect now, not at next login.
      roles = await this.permissions.rolesForUserInSchool(user.id, rotated.schoolId);
      permissions = [...(await this.permissions.forUserInSchool(user.id, rotated.schoolId))];
      const row = await this.db.registry(async (tx) => {
        const { rows } = await tx.query<{ slug: string }>(
          'SELECT slug FROM schools WHERE id = $1',
          [rotated.schoolId],
        );
        return rows[0];
      });
      school = row ? { id: rotated.schoolId, slug: row.slug } : null;
    }

    const keys = getJwtKeys();
    const accessToken = await signAccessToken(
      {
        sub: user.id,
        schoolId: rotated.schoolId,
        roles,
        permissions,
        impersonated: rotated.impersonated,
        ...(famille ? { espace: 'parent' as const } : {}),
        seal: seal(user.password_hash),
      },
      keys.privateKey,
      ACCESS_TTL,
    );

    return {
      accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: ACCESS_TTL,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        isPlatformAdmin: user.is_platform_admin,
        mustChangePassword: user.must_change_password,
        locale: user.locale,
      },
      school,
      roles,
      permissions,
      ecoles: ecolesFamille,
    };
  }

  async logout(refreshToken: string, ip: string): Promise<void> {
    await this.sessions.revokeOne(refreshToken);
    await this.audit.record({ action: 'logout', ip });
  }

  async logoutEverywhere(userId: string, ip: string): Promise<number> {
    const count = await this.sessions.revokeAllForUser(userId);
    await this.audit.record({
      actorId: userId,
      action: 'logout_all',
      entity: 'user',
      entityId: userId,
      ip,
      after: { sessionsRevoked: count },
    });
    return count;
  }

  /** The signed-in person's name, for the shell. */
  /**
   * Change your own password.
   *
   * The current password is required even though the caller is already
   * authenticated: an unattended session at the cash desk must not be enough to
   * lock the real owner out of their own account.
   *
   * Every other session is revoked afterwards, for the same reason a reset
   * revokes them — if the old password was known to someone else, their refresh
   * token is still live until it is taken away.
   *
   * `users` is a platform table, so this runs on the registry connection.
   */
  /** Is this account still on the password it was issued? */
  async mustChangePassword(userId: string): Promise<boolean> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ must_change_password: boolean }>(
        'SELECT must_change_password FROM users WHERE id = $1',
        [userId],
      );
      return rows[0]?.must_change_password ?? false;
    });
  }

  /**
   * MON PROFIL — `modifier_profil.php` lit `identifiant, nom, prenom` de
   * `utilisateurs`. Chez nous `users` ne porte qu'un `full_name` ; le prénom et
   * le nom sont ceux de la fiche de personnel ou d'enseignant du compte dans
   * son école, sinon le nom complet coupé au premier espace (la même règle
   * que « Modifier » de `comptes_staffs.php`).
   */
  async profil(
    userId: string,
    schoolId: string | null,
  ): Promise<{ identifiant: string; prenom: string; nom: string }> {
    const u = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ identifiant: string; full_name: string }>(
        `SELECT COALESCE(username, email, phone, '') AS identifiant, full_name
           FROM users WHERE id = $1`,
        [userId],
      );
      return rows[0];
    });
    if (!u) throw new NotFoundException('Compte introuvable.');
    const espace = u.full_name.trim().indexOf(' ');
    let prenom = espace > 0 ? u.full_name.trim().slice(0, espace) : u.full_name.trim();
    let nom = espace > 0 ? u.full_name.trim().slice(espace + 1) : '';
    if (schoolId) {
      const fiche = await this.db.queryFor(schoolId, async (tx) => {
        const { rows } = await tx.query<{ first_name: string; last_name: string }>(
          `SELECT first_name, last_name FROM staff WHERE user_id = $1
           UNION ALL
           SELECT first_name, last_name FROM teachers WHERE user_id = $1
           LIMIT 1`,
          [userId],
        );
        return rows[0];
      });
      if (fiche) {
        prenom = fiche.first_name;
        nom = fiche.last_name;
      }
    }
    return { identifiant: u.identifiant, prenom, nom };
  }

  /**
   * MODIFIER MON NOM — `modifier_profil.php`, action `changer_nom` : « Le nom
   * et le prénom sont obligatoires. », « Nom ou prénom trop long (100
   * caractères max). » ; `UPDATE utilisateurs SET nom, prenom`.
   *
   * Le compte est celui du jeton, jamais celui d'un appelant : il n'y a
   * personne d'autre à atteindre, c'est tout le garde. La fiche de personnel ou
   * d'enseignant du compte (son `personnel_admin`) suit le même nom, pour que
   * les listes et le profil disent la même chose. Aucune session ne tombe : un
   * nom n'est pas un secret.
   */
  async changeOwnName(
    userId: string,
    prenomBrut: string,
    nomBrut: string,
    schoolId: string | null,
    ip: string,
  ): Promise<void> {
    const prenom = prenomBrut.trim();
    const nom = nomBrut.trim();
    if (nom === '' || prenom === '') {
      throw new BadRequestException('Le nom et le prénom sont obligatoires.');
    }
    if (nom.length > 100 || prenom.length > 100) {
      throw new BadRequestException('Nom ou prénom trop long (100 caractères max).');
    }

    const { rowCount } = await this.db.registry((tx) =>
      tx.query('UPDATE users SET full_name = $2 WHERE id = $1', [userId, `${prenom} ${nom}`]),
    );
    if ((rowCount ?? 0) === 0) throw new NotFoundException('Compte introuvable.');
    if (schoolId) {
      await this.db.queryFor(schoolId, async (tx) => {
        await tx.query('UPDATE staff SET first_name = $2, last_name = $3 WHERE user_id = $1', [userId, prenom, nom]);
        await tx.query('UPDATE teachers SET first_name = $2, last_name = $3 WHERE user_id = $1', [userId, prenom, nom]);
      });
    }

    await this.audit.record({
      actorId: userId,
      schoolId,
      action: 'own_name_changed',
      entity: 'user',
      entityId: userId,
      ip,
      after: { prenom, nom },
    });
  }

  /**
   * MODIFIER MON MOT DE PASSE — `modifier_profil.php`, action `changer_mdp`,
   * ses quatre refus DANS SON ORDRE : « L'ancien mot de passe est
   * incorrect. », `valider_mot_de_passe()`, « Les deux mots de passe ne
   * correspondent pas. », « Le nouveau mot de passe doit être différent de
   * l'ancien. ».
   *
   * ⚠ VÉRIFIER LE MOT DE PASSE ACTUEL EST UN ORACLE : quelqu'un qui tient une
   * session pourrait deviner à trois cents par minute le mot de passe du compte
   * où il est déjà — et, de là, le même mot de passe réutilisé ailleurs. Les
   * mêmes compteurs que la connexion, sur le compte.
   *
   * Les AUTRES sessions du compte tombent ; celle qui vient de changer le mot
   * de passe reste ouverte, comme sa session PHP — la page affiche « Mot de
   * passe modifié avec succès. » et l'on continue.
   */
  async changeOwnPassword(
    userId: string,
    ancien: string,
    nouveau: string,
    confirmer: string,
    ip: string,
    sessionConservee?: string,
    /**
     * L'espace des familles — `pages/parent/changer_mdp.php` : SON ordre
     * (mot de passe actuel, confirmation, politique), ses phrases dans la
     * langue du compte (« Mot de passe actuel incorrect. » /
     * « كلمة المرور الحالية غير صحيحة. », « La confirmation ne correspond
     * pas. » / « التأكيد لا يتطابق. »), et pas de refus « identique à l'ancien ».
     */
    espaceParent = false,
  ): Promise<void> {
    const user = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ id: string; password_hash: string; locale: string }>(
        'SELECT id, password_hash, locale FROM users WHERE id = $1 AND active',
        [userId],
      );
      return rows[0];
    });
    if (!user) throw new UnauthorizedException('Compte introuvable.');
    const ar = espaceParent && user.locale === 'ar';

    await this.rateLimit.assertAllowed(`user:${userId}`, ip);
    const verified = await constantTimeFloor(verifyAndUpgrade(user.password_hash, ancien));
    if (!verified.ok) {
      await this.rateLimit.record(`user:${userId}`, ip, false, null);
      await this.audit.record({
        actorId: userId,
        action: 'password_change_refused',
        entity: 'user',
        entityId: userId,
        ip,
      });
      throw new UnauthorizedException(
        espaceParent
          ? ar ? 'كلمة المرور الحالية غير صحيحة.' : 'Mot de passe actuel incorrect.'
          : "L'ancien mot de passe est incorrect.",
      );
    }
    await this.rateLimit.clearAccount(`user:${userId}`);

    if (espaceParent) {
      if (nouveau !== confirmer) {
        throw new BadRequestException(ar ? 'التأكيد لا يتطابق.' : 'La confirmation ne correspond pas.');
      }
      const problem = validatePassword(nouveau);
      if (problem) throw new BadRequestException(problem);
    } else {
      const problem = validatePassword(nouveau);
      if (problem) throw new BadRequestException(problem);
      if (nouveau !== confirmer) {
        throw new BadRequestException('Les deux mots de passe ne correspondent pas.');
      }
      if (nouveau === ancien) {
        throw new BadRequestException("Le nouveau mot de passe doit être différent de l'ancien.");
      }
    }

    const hash = await hashPassword(nouveau);
    await this.db.registry((tx) =>
      tx.query(
        `UPDATE users SET password_hash = $2, must_change_password = false
          WHERE id = $1`,
        [userId, hash],
      ),
    );

    await this.sessions.revokeAllForUser(userId, 'password_changed', sessionConservee);
    await this.audit.record({
      actorId: userId,
      action: 'password_changed',
      entity: 'user',
      entityId: userId,
      ip,
    });
  }

  /**
   * MODIFIER MON IDENTIFIANT DE CONNEXION — `modifier_profil.php`, action
   * `changer_identifiant`, ses refus DANS SON ORDRE : « Mot de passe actuel
   * incorrect. », « Identifiant invalide : 3 à 100 caractères,
   * lettres/chiffres/@./-/_ uniquement. » (`valider_identifiant()`), « Le
   * nouvel identifiant est identique à l'actuel. », « Cet identifiant est déjà
   * utilisé par un autre compte. » ; `UPDATE utilisateurs SET identifiant`.
   *
   * Son `identifiant` est notre `users.username` (0027). Le même oracle que le
   * mot de passe, donc les mêmes compteurs ; les autres sessions tombent, la
   * courante reste — « Utilisez le nouveau pour vos prochaines connexions. »
   */
  async changeOwnIdentifier(
    userId: string,
    nouvelIdentifiant: string,
    mdpActuel: string,
    ip: string,
    sessionConservee?: string,
  ): Promise<void> {
    const identifiant = nouvelIdentifiant.trim();

    const user = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ id: string; password_hash: string; identifiant: string }>(
        `SELECT id, password_hash, COALESCE(username, email, phone, '') AS identifiant
           FROM users WHERE id = $1 AND active`,
        [userId],
      );
      return rows[0];
    });
    if (!user) throw new UnauthorizedException('Compte introuvable.');

    await this.rateLimit.assertAllowed(`user:${userId}`, ip);
    const verified = await constantTimeFloor(verifyAndUpgrade(user.password_hash, mdpActuel));
    if (!verified.ok) {
      await this.rateLimit.record(`user:${userId}`, ip, false, null);
      await this.audit.record({
        actorId: userId,
        action: 'identifier_change_refused',
        entity: 'user',
        entityId: userId,
        ip,
      });
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    }
    await this.rateLimit.clearAccount(`user:${userId}`);

    if (!/^[a-zA-Z0-9._@-]{3,100}$/.test(identifiant)) {
      throw new BadRequestException(
        'Identifiant invalide : 3 à 100 caractères, lettres/chiffres/@./-/_ uniquement.',
      );
    }
    if (identifiant === user.identifiant) {
      throw new BadRequestException("Le nouvel identifiant est identique à l'actuel.");
    }

    const libre = await this.db.registry(async (tx) => {
      const { rows } = await tx.query(
        `SELECT 1 FROM users WHERE id <> $1
          AND (lower(username) = lower($2) OR lower(email) = lower($2) OR phone = $2
               -- ni le numéro supplémentaire d'une famille (0041)
               OR EXISTS (SELECT 1 FROM user_phones up WHERE up.user_id = users.id AND up.phone = $2))
         LIMIT 1`,
        [userId, identifiant],
      );
      return rows.length === 0;
    });
    if (!libre) {
      throw new BadRequestException('Cet identifiant est déjà utilisé par un autre compte.');
    }
    await this.db.registry((tx) =>
      tx.query('UPDATE users SET username = $2 WHERE id = $1', [userId, identifiant]),
    );

    await this.sessions.revokeAllForUser(userId, 'identifier_changed', sessionConservee);
    await this.audit.record({
      actorId: userId,
      action: 'identifier_changed',
      entity: 'user',
      entityId: userId,
      before: { identifier: user.identifiant },
      after: { identifier: identifiant },
      ip,
    });
  }

  async displayName(userId: string): Promise<string> {
    return (await this.identity(userId)).fullName;
  }

  /**
   * Le nom ET l'identifiant de connexion.
   *
   * `modifier_profil.php` imprime le second en toutes lettres — « Votre
   * identifiant actuel est <strong>…</strong> » — avant d'offrir de le changer.
   */
  async identity(
    userId: string,
  ): Promise<{ fullName: string; identifier: string; locale: string; phones: string[] }> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ full_name: string; identifier: string; locale: string; phones: string[] }>(
        // ⚠ Ce avec quoi on se connecte, quel qu'il soit : depuis 0027 un membre
        // du personnel peut n'avoir qu'un nom d'utilisateur, et un parent n'a
        // qu'un téléphone. « Mon profil » affichait l'adresse seule — vide pour
        // les deux.
        `SELECT full_name, COALESCE(username, email, phone, '') AS identifier, locale,
                COALESCE((SELECT array_agg(up.phone ORDER BY up.created_at) FROM user_phones up WHERE up.user_id = users.id), '{}') AS phones
           FROM users WHERE id = $1`,
        [userId],
      );
      return {
        fullName: rows[0]?.full_name ?? 'Utilisateur',
        identifier: rows[0]?.identifier ?? '',
        locale: rows[0]?.locale ?? 'fr',
        phones: rows[0]?.phones ?? [],
      };
    });
  }

  /**
   * LA LANGUE DU COMPTE — le port de `parents.langue`.
   *
   * Sa résolution, dans `includes/i18n.php` : URL → session → cookie → profil →
   * `fr`. Le profil est l'étape qui suit un parent d'un appareil à l'autre :
   * la mère qui a choisi l'arabe sur son téléphone le retrouve sur celui du
   * père. Chez lui, choisir la langue ÉCRIT dans `parents.langue` ; ici dans
   * `users.locale`, que `/auth/me` rend et que l'application lit avant
   * d'afficher quoi que ce soit.
   */
  /**
   * SUPPRIMER SON COMPTE — exigé par l'App Store (5.1.1 v) et le Play Store
   * pour toute application qui permet de se connecter.
   *
   * ⚠ UNE ÉCOLE NE PEUT PAS EFFACER LE GRAND LIVRE D'UNE FAMILLE. Les reçus, les
   * mois payés, les dettes constatées sont des pièces comptables qu'elle est
   * tenue de conserver, et un bulletin est un acte scolaire. « Supprimer le
   * compte » veut donc dire ce que la loi permet et ce qu'un parent attend :
   * la personne n'est plus identifiable et ne peut plus se connecter, tandis
   * que les écritures qui la concernent restent, rattachées à un compte
   * anonyme.
   *
   * Concrètement, dans une transaction :
   *   - nom → « Compte supprimé », téléphone et adresse → NULL, nom
   *     d'utilisateur → un opaque « supprime-<id> », langue → fr ;
   *   - empreinte de mot de passe → une valeur qu'aucun mot de passe ne
   *     produit ; `active = false` ;
   *   - toutes les sessions révoquées, tous les jetons d'appareil retirés ;
   *   - une ligne d'audit, sans les valeurs effacées.
   *
   * Le mot de passe courant est exigé, comme pour le changer : une session
   * volée ne doit pas pouvoir supprimer un compte. Et la même limite de
   * cadence, pour la même raison qu'à `changeOwnPassword`.
   */
  async deleteOwnAccount(userId: string, currentPassword: string, ip: string): Promise<void> {
    const user = await this.db.registry(async (tx) => {
      const { rows } = await tx.query<{ id: string; password_hash: string; is_platform_admin: boolean }>(
        'SELECT id, password_hash, is_platform_admin FROM users WHERE id = $1 AND active',
        [userId],
      );
      return rows[0];
    });
    if (!user) throw new UnauthorizedException('Compte introuvable.');
    if (user.is_platform_admin) {
      throw new BadRequestException(
        'Un administrateur de plate-forme ne se supprime pas lui-même : retirez d’abord ce rôle.',
      );
    }

    await this.rateLimit.assertAllowed(`user:${userId}`, ip);
    const verified = await constantTimeFloor(verifyAndUpgrade(user.password_hash, currentPassword));
    if (!verified.ok) {
      await this.rateLimit.record(`user:${userId}`, ip, false, null);
      throw new UnauthorizedException('Mot de passe incorrect.');
    }
    await this.rateLimit.clearAccount(`user:${userId}`);

    await this.db.registry(async (tx) => {
      await tx.query(
        `UPDATE users
            SET full_name = 'Compte supprimé',
                -- « joignable par quelque chose » reste une contrainte (0027) :
                -- un nom opaque, dérivé de l'identifiant, que personne ne tape.
                email = NULL, phone = NULL, username = 'supprime-' || id::text,
                locale = 'fr',
                -- Un préfixe qu'aucun vérificateur ne reconnaît : la connexion
                -- échoue toujours, sans exception ni chemin spécial.
                password_hash = '$deleted$',
                active = false,
                must_change_password = false
          WHERE id = $1`,
        [userId],
      );
      await tx.query('DELETE FROM device_tokens WHERE user_id = $1', [userId]);
      await tx.query('DELETE FROM user_phones WHERE user_id = $1', [userId]);
    });
    await this.sessions.revokeAllForUser(userId, 'account_deleted');
    await this.audit.record({
      actorId: userId,
      action: 'account_deleted',
      entity: 'user',
      entityId: userId,
      ip,
    });
  }

  async setLocale(userId: string, locale: 'fr' | 'ar'): Promise<void> {
    await this.db.registry(async (tx) => {
      await tx.query('UPDATE users SET locale = $2 WHERE id = $1', [userId, locale]);
    });
  }
}
