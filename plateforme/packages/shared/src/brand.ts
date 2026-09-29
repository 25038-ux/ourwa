/**
 * LA MARQUE — le nom sous lequel la plateforme se présente.
 *
 * Une seule base de code, plusieurs enseignes. Par défaut « El Ourwa » ; une
 * installation peut se présenter sous un autre nom (« El Mourad ») sans qu'une
 * ligne de code change : tout ce qui est visible — titres de page, écran de
 * connexion, barre latérale, reçus, exports, pages légales, courrier — lit
 * cette marque. Les identifiants techniques (préfixe des cookies) suivent le
 * `slug`, jamais le nom affiché.
 *
 * Variables d'environnement, toutes facultatives :
 *   BRAND_NAME        « El Mourad »            (défaut : El Ourwa)
 *   BRAND_NAME_AR     « المراد »                (défaut : العروة)
 *   BRAND_SLUG        « elmourad »             (défaut : le nom en minuscules, lettres et chiffres)
 *   BRAND_TAGLINE     « Plateforme de gestion scolaire »
 *   BRAND_MAIL_FROM   « no-reply@elmourad.mr »  (défaut : no-reply@<slug>.mr)
 *
 * LE DÉPLOIEMENT — multi-écoles (la plateforme, avec sa console `admin.`) ou
 * école unique (un site, une école, pas de console) :
 *   SINGLE_SCHOOL_SLUG  « elmourad » : tout nom d'hôte désigne cette école ; la
 *                       console de la plateforme est retirée (404) ; l'API refuse
 *                       ses routes `/platform/*`.
 *   PLATFORM_CONSOLE    « on » / « off » — par défaut « off » dès qu'une école
 *                       unique est nommée, « on » sinon.
 *
 * ⚠ UNE VALEUR INVALIDE ARRÊTE LE DÉMARRAGE. Un slug d'école unique mal formé
 * qui serait ignoré en silence servirait la plateforme multi-écoles sur le
 * domaine d'une école — la page de connexion dirait « Console plateforme » à
 * une école qui n'en a pas. Mieux vaut un serveur qui refuse de partir avec la
 * phrase exacte dans son journal.
 */

export interface Marque {
  /** Le nom affiché partout : « El Ourwa », « El Mourad ». */
  nom: string;
  /** Le nom en arabe : « العروة », « المراد ». */
  nomAr: string;
  /** L'identifiant technique, minuscules : préfixe des cookies, noms de fichiers. */
  slug: string;
  /** La ligne sous le nom sur l'écran de connexion. */
  sousTitre: string;
  /** L'expéditeur par défaut du courrier sortant. */
  expediteur: string;
}

export const MARQUE_DEFAUT: Marque = Object.freeze({
  nom: 'El Ourwa',
  nomAr: 'العروة',
  slug: 'elourwa',
  sousTitre: 'Plateforme de gestion scolaire',
  expediteur: 'no-reply@elourwa.mr',
});

const SLUG_MARQUE = /^[a-z][a-z0-9]{1,30}$/;
const SLUG_ECOLE = /^[a-z0-9][a-z0-9-]{0,62}$/;

type Env = Record<string, string | undefined>;

function propre(v: string | undefined): string | undefined {
  const t = (v ?? '').trim();
  return t === '' ? undefined : t;
}

/** « El Mourad » → « elmourad » : lettres et chiffres ASCII seulement. */
export function slugDeMarque(nom: string): string {
  const s = nom
    .normalize('NFD')
    // Les accents détachés par NFD (« École » → « Ecole »).
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return SLUG_MARQUE.test(s) ? s : MARQUE_DEFAUT.slug;
}

export function marqueDepuisEnv(env: Env = typeof process !== 'undefined' ? process.env : {}): Marque {
  const nom = propre(env.BRAND_NAME) ?? MARQUE_DEFAUT.nom;
  const parDefaut = nom === MARQUE_DEFAUT.nom;
  const slugDemande = propre(env.BRAND_SLUG);
  if (slugDemande !== undefined && !SLUG_MARQUE.test(slugDemande)) {
    throw new Error(
      `BRAND_SLUG « ${slugDemande} » invalide : lettres minuscules et chiffres, 2 à 31 caractères, une lettre en tête.`,
    );
  }
  const slug = slugDemande ?? (parDefaut ? MARQUE_DEFAUT.slug : slugDeMarque(nom));
  return Object.freeze({
    nom,
    nomAr: propre(env.BRAND_NAME_AR) ?? (parDefaut ? MARQUE_DEFAUT.nomAr : nom),
    slug,
    sousTitre: propre(env.BRAND_TAGLINE) ?? MARQUE_DEFAUT.sousTitre,
    expediteur: propre(env.BRAND_MAIL_FROM) ?? (parDefaut ? MARQUE_DEFAUT.expediteur : `no-reply@${slug}.mr`),
  });
}

/**
 * LE NOM DU FRAIS ANNUEL « PHOTOCOPIE » — `FEE_PHOTOCOPY_LABEL`, facultatif.
 *
 * El Ourwa l'appelle « Frais de photocopie » ; El Mourad « Frais Graytna »
 * (demande de l'école, 28/09/2026 — deploy/brands/elmourad.env). Seul le NOM
 * affiché change : la clé technique reste `photocopy`, les barèmes
 * `frais_photocopie_<année>`, les montants et les reçus déjà émis aussi. Le nom
 * est lu à l'affichage : un reçu réimprimé porte le nom d'aujourd'hui.
 */
export const LIBELLE_FRAIS_PHOTOCOPIE_DEFAUT = 'Frais de photocopie';

export function libelleFraisPhotocopie(env: Env = typeof process !== 'undefined' ? process.env : {}): string {
  return propre(env.FEE_PHOTOCOPY_LABEL) ?? LIBELLE_FRAIS_PHOTOCOPIE_DEFAUT;
}

export interface Deploiement {
  /** L'école que tout nom d'hôte désigne, ou `null` : la plateforme multi-écoles. */
  ecoleUnique: string | null;
  /** La console de la plateforme (`admin.<domaine>`, `/platform`, `/platform/*` de l'API) existe-t-elle ? */
  console: boolean;
}

function booleen(v: string | undefined): boolean | undefined {
  const t = (v ?? '').trim().toLowerCase();
  if (['on', '1', 'true', 'oui', 'yes'].includes(t)) return true;
  if (['off', '0', 'false', 'non', 'no'].includes(t)) return false;
  return undefined;
}

export function deploiementDepuisEnv(env: Env = typeof process !== 'undefined' ? process.env : {}): Deploiement {
  const brut = propre(env.SINGLE_SCHOOL_SLUG);
  const ecoleUnique = brut === undefined ? null : brut.toLowerCase();
  if (
    ecoleUnique !== null &&
    (!SLUG_ECOLE.test(ecoleUnique) || /^[0-9]+$/.test(ecoleUnique) || ecoleUnique === 'admin' || ecoleUnique === 'www')
  ) {
    throw new Error(
      `SINGLE_SCHOOL_SLUG « ${brut} » invalide : minuscules, chiffres et tirets, ni « admin » ni « www », jamais purement numérique.`,
    );
  }
  const consoleDemandee = booleen(env.PLATFORM_CONSOLE);
  if (propre(env.PLATFORM_CONSOLE) !== undefined && consoleDemandee === undefined) {
    throw new Error(`PLATFORM_CONSOLE « ${env.PLATFORM_CONSOLE} » invalide : « on » ou « off ».`);
  }
  return Object.freeze({ ecoleUnique, console: consoleDemandee ?? ecoleUnique === null });
}
