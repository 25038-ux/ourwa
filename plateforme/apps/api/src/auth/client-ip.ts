import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * The real client IP, for rate limiting and the audit log.
 *
 * ⚠ Why this is not just `req.ip`, and not just the header either.
 *
 * Behind Cloudflare every request arrives from a Cloudflare address. El Ourwa
 * rate-limited on that address, so its IP lockout would have banned every user
 * simultaneously the moment anyone tripped it.
 *
 * The naive fix — trust `CF-Connecting-IP` — is worse: anyone can send that
 * header directly and evade the limit entirely, or forge someone else's address
 * into the audit log.
 *
 * So the header is honoured ONLY when the immediate peer is actually Cloudflare.
 */

// Cloudflare's published ranges. https://www.cloudflare.com/ips/
// Refreshed by a scheduled job in production rather than hand-edited; pinned
// here so behaviour is deterministic in development and tests.
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

export function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const target = ipv4ToInt(ip);
  const base = ipv4ToInt(range!);
  if (target === null || base === null || !Number.isInteger(bits)) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (target & mask) === (base & mask);
}

export function isCloudflareIp(ip: string): boolean {
  if (isIP(ip) !== 4) return false; // IPv6 ranges omitted; extend when needed.
  return CLOUDFLARE_V4.some((cidr) => inCidr(ip, cidr));
}

/**
 * LE PAIR, C'EST LA PRISE TCP. Fastify est lancé avec `trustProxy: true`, donc
 * `request.ip` vaut la première adresse de X-Forwarded-For — que n'importe quel
 * appelant direct peut écrire. Décider « ce pair est le serveur web » sur cette
 * base laissait forger X-Client-IP, X-Client-User-Agent et (production)
 * X-School-Slug depuis l'extérieur. L'adresse de la connexion, elle, ne se
 * forge pas.
 */
export function peerOf(request: FastifyRequest): string {
  return request.socket?.remoteAddress ?? request.ip;
}

/**
 * Le serveur web (ou le mandataire du conteneur) peut nommer l'école par
 * `X-School-Slug` en production : il la lit dans SON nom d'hôte, celui que la
 * personne a visité. Un appelant direct, lui, la nomme par le sous-domaine.
 */
export function schoolSlugFromTrustedHeader(request: FastifyRequest): string | undefined {
  const h = request.headers['x-school-slug'];
  if (typeof h !== 'string' || !h) return undefined;
  if (process.env.NODE_ENV !== 'production') return h;
  return isTrustedProxy(peerOf(request)) ? h : undefined;
}

export function clientIp(request: FastifyRequest): string {
  const peer = peerOf(request);
  const forwarded = request.headers['cf-connecting-ip'];

  if (typeof forwarded === 'string' && isIP(forwarded) && isCloudflareIp(peer)) {
    return forwarded;
  }

  // ⚠ LE SITE DU PERSONNEL PARLE À L'API DEPUIS SON PROPRE SERVEUR. Chaque
  // connexion et chaque rafraîchissement arrivent donc de l'adresse du serveur
  // Next, avec son User-Agent (« node ») — et l'empreinte de session (0031)
  // était celle du serveur, pas de la personne. Pire : selon le moteur
  // (Node, Edge), `localhost` se résolvait en 127.0.0.1 ou en ::1, l'empreinte
  // changeait entre la connexion et le premier rafraîchissement, et toute la
  // famille de jetons était révoquée : chaque utilisateur déconnecté au bout
  // de quinze minutes. Le serveur web est un mandataire de confiance : quand
  // l'appel vient de lui, `X-Client-IP` dit qui est vraiment devant l'écran.
  // ⚠ NORMALISÉE ICI AUSSI. Le serveur web transmet l'adresse que Next lui
  // donne (x-forwarded-for) : un navigateur sur le poste arrive tantôt en
  // ::1, tantôt en 127.0.0.1 — la connexion et le rafraîchissement portaient
  // deux adresses, l'empreinte ne correspondait plus, et chaque session du
  // poste mourait à quinze minutes (« fingerprint_mismatch », 22/09).
  const client = request.headers['x-client-ip'];
  if (typeof client === 'string' && isIP(client) && isTrustedProxy(peer)) {
    return normaliserBoucle(client);
  }

  // `X-Forwarded-For` is deliberately NOT consulted. It is trivially spoofable
  // and we do not control every hop that might set it.
  return normaliserBoucle(peer);
}

/** `::1` et `::ffff:127.0.0.1` sont la même machine que `127.0.0.1`. */
function normaliserBoucle(ip: string): string {
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.1';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

/**
 * Le serveur web, et lui seul, peut dire pour qui il parle : la boucle locale
 * par défaut, ou les adresses de `TRUSTED_PROXIES` (séparées par des virgules)
 * quand l'API et le site ne partagent pas la machine.
 */
export function isTrustedProxy(peer: string): boolean {
  const ip = normaliserBoucle(peer);
  if (ip === '127.0.0.1') return true;
  const liste = (process.env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return liste.includes(ip);
}

/** Le User-Agent de la personne — transmis par le serveur web, sinon celui du pair. */
export function clientUserAgent(request: FastifyRequest): string | null {
  const client = request.headers['x-client-user-agent'];
  if (typeof client === 'string' && client && isTrustedProxy(peerOf(request))) return client;
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}
