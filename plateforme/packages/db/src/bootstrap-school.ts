/**
 * INSTALLER UNE ÉCOLE SUR UNE BASE NEUVE — sans aucune donnée de démonstration.
 *
 *   pnpm --filter @elourwa/db bootstrap-school -- \
 *     --slug elmourad --name "El Mourad" --name-ar "المراد" --prefix ELM \
 *     --admin-email direction@elmourad.mr --admin-name "Direction El Mourad"
 *
 *   --sync-name   (facultatif) : le nom et le nom arabe d'une école DÉJÀ
 *     installée prennent ceux donnés — sans cela, une école existante garde
 *     les siens. Ni le modèle de facturation ni le préfixe ne changent.
 *
 *   --billing-model famille|services   (facultatif, « famille » par défaut)
 *     Le modèle de facturation de l'école (0042, ADR-0073) : « famille » =
 *     El Ourwa tel quel (El Mourad) ; « services » = Jinan (modes d'étude,
 *     frais d'inscription par élève, services optionnels). ⚠ POSÉ À LA
 *     CRÉATION, JAMAIS CHANGÉ ENSUITE : relancer sur une école existante le
 *     laisse tel quel, et un modèle DIFFÉRENT de celui en base est refusé.
 *
 * Ce que cela crée, et RIEN d'autre :
 *   1. le catalogue des six rôles et de leurs permissions (`seed-roles.ts`),
 *      s'il n'existe pas encore — sans lui, aucun compte ne peut tenir un rôle ;
 *   2. la ligne de l'école (`schools`, avec son modèle de facturation) et son
 *      nom d'hôte (`school_domains`) ;
 *   3. UN compte super administrateur, avec un mot de passe provisoire tiré au
 *      sort (ou `ADMIN_PASSWORD` dans l'environnement), à changer à la première
 *      connexion (`must_change_password`).
 *
 * Pas d'année scolaire, pas de niveau, pas de classe, pas de moyen de paiement,
 * pas de frais : la direction crée tout cela depuis le site, dans l'ordre que
 * les pages proposent (Années scolaires → Gestion de scolarité → Finance).
 * Une école neuve part d'une base vide — c'est la demande du propriétaire (22/09).
 *
 * Relançable sans danger : une école déjà présente est reprise telle quelle ;
 * un compte déjà présent n'est pas touché (ni son mot de passe), il reçoit
 * seulement le rôle s'il ne l'a pas.
 *
 * ⚠ JAMAIS `pnpm seed` sur une base réelle : la graine TRONQUE tout pour poser
 * ses trois écoles de démonstration.
 */
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { hash as argonHash } from '@node-rs/argon2';
import { ROLES } from './seed-roles.js';

/** Les valeurs de `schools.billing_model` (CHECK de 0042 ; `@elourwa/shared` MODELES_FACTURATION). */
const MODELES_FACTURATION = ['famille', 'services'] as const;
type ModeleFacturation = (typeof MODELES_FACTURATION)[number];

export interface Options {
  slug: string;
  name: string;
  nameAr: string | null;
  prefix: string;
  adminEmail: string;
  adminName: string;
  hostname: string | null;
  password: string | null;
  /** `null` : non précisé — une école neuve est « famille », une école existante garde le sien. */
  billingModel: ModeleFacturation | null;
  /**
   * `--sync-name` : le nom (et le nom arabe) d'une école DÉJÀ installée prend
   * celui donné. Sans lui, une école existante garde le sien. Jamais le modèle
   * de facturation ni le préfixe des reçus.
   */
  syncName: boolean;
}

function lireModele(argv: string[]): ModeleFacturation | null {
  const i = argv.indexOf('--billing-model');
  if (i < 0) return null;
  const brut = (argv[i + 1] ?? '').trim().toLowerCase();
  if (!(MODELES_FACTURATION as readonly string[]).includes(brut)) {
    throw new Error(`--billing-model « ${argv[i + 1] ?? ''} » invalide : famille ou services.`);
  }
  return brut as ModeleFacturation;
}

export function lireOptions(argv: string[]): Options {
  const v = (k: string): string | undefined => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const slug = (v('--slug') ?? '').trim().toLowerCase();
  const name = (v('--name') ?? '').trim();
  const adminEmail = (v('--admin-email') ?? '').trim().toLowerCase();
  if (!slug || !name || !adminEmail) {
    throw new Error('Obligatoires : --slug, --name, --admin-email (voir l’en-tête du fichier).');
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) || /^[0-9]+$/.test(slug) || slug === 'admin' || slug === 'www') {
    throw new Error(`--slug « ${slug} » invalide : minuscules, chiffres, tirets ; ni admin ni www.`);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    throw new Error(`--admin-email « ${adminEmail} » n’est pas une adresse.`);
  }
  const prefix = (v('--prefix') ?? slug.replace(/[^a-z0-9]/g, '').slice(0, 4)).toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(prefix)) throw new Error(`--prefix « ${prefix} » : 2 à 8 lettres ou chiffres.`);
  return {
    slug,
    name,
    nameAr: (v('--name-ar') ?? '').trim() || null,
    prefix,
    adminEmail,
    adminName: (v('--admin-name') ?? 'Direction').trim(),
    hostname: (v('--hostname') ?? '').trim().toLowerCase() || null,
    password: process.env.ADMIN_PASSWORD?.trim() || null,
    billingModel: lireModele(argv),
    syncName: argv.includes('--sync-name'),
  };
}

/** Un mot de passe provisoire qui passe la politique (trois classes de caractères). */
function motDePasseProvisoire(): string {
  const lettres = 'abcdefghjkmnpqrstuvwxyz';
  const majuscules = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const chiffres = '23456789';
  const tout = lettres + majuscules + chiffres;
  const pick = (s: string) => s[randomBytes(1)[0]! % s.length]!;
  let p = pick(majuscules) + pick(chiffres);
  while (p.length < 12) p += pick(tout);
  return p;
}

export async function bootstrapSchool(databaseUrl: string, o: Options): Promise<{
  schoolId: string;
  adminId: string;
  password: string | null;
  billingModel: ModeleFacturation;
}> {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query('BEGIN');

    // 1. Le catalogue des rôles — structurel, pas une donnée de démonstration.
    const { rows: existants } = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM roles');
    if (existants[0]!.n === '0') {
      for (const r of ROLES) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO roles (code, label, description, is_system, sort_order)
           VALUES ($1, $2, $3, true, $4) RETURNING id`,
          [r.code, r.label, 'description' in r ? r.description : null, r.order],
        );
        for (const p of r.perms) {
          await db.query('INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2)', [rows[0]!.id, p]);
        }
      }
      console.log(`  rôles : ${ROLES.length} créés`);
    } else {
      console.log(`  rôles : déjà présents (${existants[0]!.n})`);
    }
    const { rows: superAdmin } = await db.query<{ id: string }>("SELECT id FROM roles WHERE code = 'super_admin'");
    if (!superAdmin[0]) throw new Error('Le rôle super_admin est absent du catalogue.');

    // 2. L'école.
    let schoolId: string;
    let billingModel: ModeleFacturation;
    const { rows: ecole } = await db.query<{ id: string; billing_model: string }>(
      'SELECT id, billing_model FROM schools WHERE slug = $1',
      [o.slug],
    );
    if (ecole[0]) {
      schoolId = ecole[0].id;
      billingModel = ecole[0].billing_model as ModeleFacturation;
      // ⚠ Le modèle de facturation ne change jamais après la création : les
      // mêmes mois, les mêmes reçus se lisent autrement d'un modèle à l'autre.
      // Relancer avec le même modèle, ou sans le préciser, est sans effet.
      if (o.billingModel && o.billingModel !== ecole[0].billing_model) {
        throw new Error(
          `l’école « ${o.slug} » existe déjà en facturation « ${ecole[0].billing_model} » ; ` +
            `le modèle est posé à la création et jamais changé ensuite (--billing-model ${o.billingModel} refusé).`,
        );
      }
      console.log(`  école « ${o.slug} » : déjà présente, reprise telle quelle (facturation « ${ecole[0].billing_model} »)`);
      // Le nom est une donnée d'affichage, pas un réglage : `--sync-name` le
      // fait suivre (l'installation de Jinan le lit dans son fichier de marque).
      if (o.syncName) {
        const { rowCount } = await db.query(
          `UPDATE schools SET name = $2, name_ar = $3
            WHERE id = $1 AND (name IS DISTINCT FROM $2 OR name_ar IS DISTINCT FROM $3)`,
          [schoolId, o.name, o.nameAr],
        );
        if (rowCount) console.log(`  nom de l'école : « ${o.name} »${o.nameAr ? ` / « ${o.nameAr} »` : ''}`);
      }
    } else {
      const modele: ModeleFacturation = o.billingModel ?? 'famille';
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO schools (slug, name, name_ar, receipt_prefix, billing_model)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [o.slug, o.name, o.nameAr, o.prefix, modele],
      );
      schoolId = rows[0]!.id;
      billingModel = modele;
      console.log(`  école « ${o.name} » (${o.slug}) : créée, reçus ${o.prefix}-…, facturation « ${modele} »`);
    }
    if (o.hostname) {
      await db.query(
        `INSERT INTO school_domains (school_id, hostname, is_primary)
         VALUES ($1, $2, true) ON CONFLICT (hostname) DO NOTHING`,
        [schoolId, o.hostname],
      );
    }

    // 3. Le compte de la direction.
    let adminId: string;
    let password: string | null = null;
    const { rows: compte } = await db.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [o.adminEmail]);
    if (compte[0]) {
      adminId = compte[0].id;
      console.log(`  compte ${o.adminEmail} : déjà présent, mot de passe conservé`);
    } else {
      password = o.password ?? motDePasseProvisoire();
      const hashed = await argonHash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, must_change_password)
         VALUES ($1, $2, $3, true) RETURNING id`,
        [o.adminEmail, hashed, o.adminName],
      );
      adminId = rows[0]!.id;
      console.log(`  compte ${o.adminEmail} : créé (mot de passe provisoire, à changer à la première connexion)`);
    }
    await db.query(
      `INSERT INTO user_school_roles (user_id, school_id, role_id)
       VALUES ($1, $2, $3) ON CONFLICT (user_id, school_id, role_id) DO NOTHING`,
      [adminId, schoolId, superAdmin[0].id],
    );

    await db.query('COMMIT');
    return { schoolId, adminId, password, billingModel };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await db.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_ADMIN_URL (ou DATABASE_URL) doit être défini.');
    process.exit(1);
  }
  let options: Options;
  try {
    options = lireOptions(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  bootstrapSchool(url, options)
    .then((r) => {
      console.log('\nInstallation terminée.');
      console.log(`  École        : ${options.name} (${options.slug})`);
      console.log(`  Direction    : ${options.adminEmail}`);
      console.log(`  Facturation  : ${r.billingModel}`);
      if (r.password) {
        console.log(`  Mot de passe provisoire : ${r.password}`);
        console.log('  ⚠ Affiché UNE fois. Il sera demandé de le changer à la première connexion.');
      }
      console.log('\nEnsuite, sur le site : Années scolaires → créer l’année → Gestion de scolarité → niveaux, classes, matières → Finance → moyens de paiement.');
    })
    .catch((e: Error) => {
      console.error(`Installation refusée : ${e.message}`);
      process.exit(1);
    });
}
