/**
 * QUI EST VRAIMENT DEVANT L'ÉCRAN — transmis à l'API par le serveur web.
 *
 * Le site parle à l'API depuis son propre serveur : sans ces deux en-têtes,
 * l'API voit « node » sur 127.0.0.1 pour tout le monde, et l'empreinte de
 * session (auth.php → 0031) est celle du serveur, pas de la personne. L'API ne
 * les croit que venant d'un mandataire de confiance — ce serveur.
 */
export function clientIdentityHeaders(h: {
  get(name: string): string | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const ua = h.get('user-agent');
  if (ua) out['X-Client-User-Agent'] = ua;
  // Derrière un mandataire, la première adresse de X-Forwarded-For est la
  // personne ; en développement il n'y en a pas, et l'API garde le pair.
  const xff = h.get('x-forwarded-for');
  const ip = xff?.split(',')[0]?.trim();
  if (ip && /^[0-9a-fA-F.:]+$/.test(ip)) out['X-Client-IP'] = ip;
  return out;
}
