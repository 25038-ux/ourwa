import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { clientIp, clientUserAgent, isTrustedProxy } from '../src/auth/client-ip.js';
import { fingerprint } from '../src/auth/sessions.service.js';

/**
 * ⚠ TOUT LE MONDE ÉTAIT DÉCONNECTÉ AU BOUT DE QUINZE MINUTES.
 *
 * Le site du personnel parle à l'API depuis son propre serveur. La connexion
 * (route handler, Node) et le rafraîchissement (middleware, Edge) arrivaient
 * tous deux avec le User-Agent « node » — mais `localhost` se résolvait en
 * 127.0.0.1 pour l'un et ::1 pour l'autre. L'empreinte de session (0031)
 * différait, la famille de jetons était révoquée « fingerprint_mismatch », et
 * l'accès expiré à quinze minutes ne se renouvelait jamais.
 *
 * Deux corrections : la boucle locale est UNE adresse, et le serveur web —
 * mandataire de confiance — transmet qui est vraiment devant l'écran.
 */
function req(peer: string, headers: Record<string, string> = {}): FastifyRequest {
  return { ip: peer, headers } as unknown as FastifyRequest;
}

describe('la boucle locale est une seule adresse', () => {
  it('::1, ::ffff:127.0.0.1 et 127.0.0.1 donnent la même empreinte', () => {
    const a = fingerprint({ ip: clientIp(req('::1')), userAgent: 'node' });
    const b = fingerprint({ ip: clientIp(req('::ffff:127.0.0.1')), userAgent: 'node' });
    const c = fingerprint({ ip: clientIp(req('127.0.0.1')), userAgent: 'node' });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('le serveur web dit pour qui il parle', () => {
  const UA = 'Mozilla/5.0 (Android 14) Chrome/128';

  it('⚠ X-Client-IP en ::1 vaut 127.0.0.1 : le navigateur du poste arrive par l’une ou l’autre', () => {
    expect(clientIp(req('127.0.0.1', { 'x-client-ip': '::1' }))).toBe('127.0.0.1');
    expect(clientIp(req('::1', { 'x-client-ip': '::ffff:127.0.0.1' }))).toBe('127.0.0.1');
    expect(fingerprint({ ip: '::1', userAgent: 'Mozilla' })).toBe(fingerprint({ ip: '127.0.0.1', userAgent: 'Mozilla' }));
  });

  it('une adresse IPv6 garde son /64 : la fin change seule (confidentialité), pas l’appareil', () => {
    expect(fingerprint({ ip: '2a01:e0a:1:2:aaaa:bbbb:cccc:1', userAgent: 'M' })).toBe(
      fingerprint({ ip: '2a01:e0a:1:2:dddd:eeee:ffff:2', userAgent: 'M' }),
    );
    expect(fingerprint({ ip: '2a01:e0a:1:2:aaaa::1', userAgent: 'M' })).not.toBe(
      fingerprint({ ip: '2a01:e0a:9:9:aaaa::1', userAgent: 'M' }),
    );
  });

  it('accepte X-Client-IP et X-Client-User-Agent depuis la boucle locale', () => {
    const r = req('127.0.0.1', { 'x-client-ip': '41.188.12.34', 'x-client-user-agent': UA, 'user-agent': 'node' });
    expect(clientIp(r)).toBe('41.188.12.34');
    expect(clientUserAgent(r)).toBe(UA);
  });

  it('⚠ les ignore venant de n’importe qui d’autre', () => {
    const r = req('41.188.99.1', { 'x-client-ip': '10.0.0.1', 'x-client-user-agent': UA, 'user-agent': 'curl/8' });
    expect(clientIp(r)).toBe('41.188.99.1');
    expect(clientUserAgent(r)).toBe('curl/8');
    expect(isTrustedProxy('41.188.99.1')).toBe(false);
  });

  it('connexion et rafraîchissement transmis par le serveur web ont la même empreinte', () => {
    const login = req('::1', { 'x-client-ip': '41.188.12.34', 'x-client-user-agent': UA, 'user-agent': 'node' });
    const refresh = req('127.0.0.1', { 'x-client-ip': '41.188.12.34', 'x-client-user-agent': UA, 'user-agent': 'Next.js Middleware' });
    expect(fingerprint({ ip: clientIp(login), userAgent: clientUserAgent(login) })).toBe(
      fingerprint({ ip: clientIp(refresh), userAgent: clientUserAgent(refresh) }),
    );
  });

  it('un vrai changement d’appareil change encore l’empreinte', () => {
    const a = req('127.0.0.1', { 'x-client-ip': '41.188.12.34', 'x-client-user-agent': UA });
    const b = req('127.0.0.1', { 'x-client-ip': '196.1.2.3', 'x-client-user-agent': 'Mozilla/5.0 (iPhone)' });
    expect(fingerprint({ ip: clientIp(a), userAgent: clientUserAgent(a) })).not.toBe(
      fingerprint({ ip: clientIp(b), userAgent: clientUserAgent(b) }),
    );
  });
});
