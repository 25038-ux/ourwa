import { afterEach, describe, expect, it } from 'vitest';
import { applyApiSecurityHeaders } from '../src/security-headers.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * ⚠ THE API SENT NO SECURITY HEADERS AT ALL.
 *
 * The web app carries a full set — CSP with a per-request nonce, frame options,
 * referrer policy, the feature policy — because it renders HTML in a browser.
 * The API answers JSON and so looked as though it needed none.
 *
 * The one that matters is `Cache-Control: no-store`. Every authenticated
 * response here is one family's debt, one child's marks, or one colleague's
 * salary. Without it any shared proxy between the school and this server is
 * free to keep a copy and hand it to the next person who asks — and in
 * Nouakchott, where offices sit behind shared connections, that is not a
 * hypothetical intermediary.
 */

function collect(headers: Record<string, string>, proto = 'http'): Record<string, string> {
  const out: Record<string, string> = {};
  const reply = { header: (k: string, v: string) => { out[k] = v; } } as unknown as FastifyReply;
  const request = { headers, protocol: proto } as unknown as FastifyRequest;
  applyApiSecurityHeaders(request, reply);
  return out;
}

const ORIGINAL = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL;
});

describe('les en-têtes de l’API', () => {
  it('⚠ forbids caching, unconditionally', () => {
    // Not "when authenticated". This surface has almost nothing public, and a
    // rule with an exception is a rule somebody has to keep re-deciding.
    expect(collect({})['Cache-Control']).toBe('no-store');
  });

  it('refuses sniffing and framing', () => {
    const h = collect({});
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    // This origin never renders a document — not even an error page.
    expect(h['Content-Security-Policy']).toContain("default-src 'none'");
  });

  it('sends no referrer — a URL here can name a family', () => {
    expect(collect({})['Referrer-Policy']).toBe('no-referrer');
  });

  describe('HSTS', () => {
    it('⚠ is absent in development, so localhost is not pinned to HTTPS', () => {
      // A year-long pin on `localhost` in every developer's browser is a very
      // long time to regret one header.
      process.env.NODE_ENV = 'development';
      expect(collect({}, 'https')['Strict-Transport-Security']).toBeUndefined();
    });

    it('is absent over plain HTTP even in production — it would mean nothing', () => {
      process.env.NODE_ENV = 'production';
      expect(collect({}, 'http')['Strict-Transport-Security']).toBeUndefined();
    });

    it('⚠ reads the scheme from `x-forwarded-proto` behind a proxy', () => {
      // With TLS terminated at the proxy — which is every real deployment —
      // `request.protocol` says "http" for every request, so keying on it alone
      // would mean the header never shipped.
      process.env.NODE_ENV = 'production';
      const h = collect({ 'x-forwarded-proto': 'https' }, 'http');
      expect(h['Strict-Transport-Security']).toContain('max-age=31536000');
      expect(h['Strict-Transport-Security']).toContain('includeSubDomains');
    });

    it('takes the FIRST value when the proxy chain appends its own', () => {
      // `x-forwarded-proto: https, http` is what two proxies produce. The first
      // is the one the client actually spoke.
      process.env.NODE_ENV = 'production';
      expect(
        collect({ 'x-forwarded-proto': 'https, http' }, 'http')['Strict-Transport-Security'],
      ).toBeTruthy();
    });
  });
});
