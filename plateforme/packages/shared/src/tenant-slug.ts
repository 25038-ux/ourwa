/**
 * L'ÉCOLE DANS LE NOM D'HÔTE — une seule règle, écrite une fois.
 *
 * `nour.localhost:3000` → `nour` ; `nour.elourwa.duckdns.org` → `nour`. La
 * console de la plateforme vit sous `admin.`, qui n'est délibérément PAS une
 * école ; `www.` non plus ; une adresse IP n'a pas de sous-domaine. Cette
 * fonction vivait en QUATRE copies (l'intercepteur de l'API, le middleware du
 * site, `lib/tenant.ts`, la route de connexion) qui pouvaient dériver l'une de
 * l'autre — une école lue ici et pas là, c'est un cookie cherché sous le mauvais
 * nom et une connexion qui renvoie à la page de connexion.
 *
 * ÉCOLE UNIQUE : quand l'installation ne sert qu'une école
 * (`SINGLE_SCHOOL_SLUG`), TOUT nom d'hôte la désigne — l'apex du domaine,
 * `www.`, l'adresse IP, `admin.` : il n'y a rien d'autre à servir.
 */

export const LABELS_RESERVES = ['admin', 'www'] as const;

export function slugDepuisHote(
  host: string | null | undefined,
  ecoleUnique: string | null = null,
): string | null {
  if (ecoleUnique) return ecoleUnique;
  if (!host) return null;
  const hostname = host.split(':')[0]!.toLowerCase();
  // Une adresse IP n'est pas un sous-domaine : `127.0.0.1:3000` donnerait
  // l'école « 127 », et un hôte dont la première étiquette est numérique
  // passerait pour une branche.
  if (/^[0-9.]+$/.test(hostname) || hostname.includes('[')) return null;
  const parts = hostname.split('.');
  if (parts.length < 2) return null;
  const slug = parts[0]!;
  if (!slug || (LABELS_RESERVES as readonly string[]).includes(slug)) return null;
  // Minuscules, chiffres, tirets ; jamais purement numérique.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || /^[0-9]+$/.test(slug)) return null;
  return slug;
}

/**
 * Le même hôte, pour une autre école — `null` pour la console (`admin.`).
 *
 * `hoteAvecSlug('admin.elourwa.duckdns.org', 'nour')` → `nour.elourwa.duckdns.org` ;
 * `hoteAvecSlug('nour.localhost:3000', null)` → `admin.localhost:3000`. Sert aux
 * liens « Entrer » et « Quitter » de la console, qui visaient `localhost:3000`
 * en dur — sur le serveur en ligne ils envoyaient l'administrateur sur sa
 * propre machine.
 */
export function hoteAvecSlug(host: string, slug: string | null): string {
  const [hostname, port] = host.split(':') as [string, string | undefined];
  const etiquette = slug ?? 'admin';
  const parts = hostname.toLowerCase().split('.');
  const reste = parts.length >= 2 ? parts.slice(1) : parts;
  return [etiquette, ...reste].join('.') + (port ? `:${port}` : '');
}
