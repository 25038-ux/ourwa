import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * LES EN-TÊTES DE SÉCURITÉ DE L'API.
 *
 * ⚠ THE API SENT NONE. The web app carries a full set — CSP with a per-request
 * nonce, frame options, referrer policy, the feature policy — because it renders
 * HTML in a browser. The API answers JSON, so it looked like it needed nothing,
 * and four things were left off that a JSON API still wants:
 *
 *   `Cache-Control: no-store` — the one that matters. Every authenticated
 *   response here is one family's debt, one child's marks, one colleague's
 *   salary. Without it a shared proxy between the school and this server is
 *   free to keep a copy and hand it to the next person who asks.
 *
 *   `X-Content-Type-Options: nosniff` — a JSON body opened directly in a browser
 *   must not be sniffed into HTML and executed in this origin.
 *
 *   `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` — this
 *   origin never renders a document, so nothing should ever load from it and
 *   nothing should ever frame it. An error page is a document too.
 *
 *   `Strict-Transport-Security` — in production only, and only over HTTPS.
 *   Sending it over plain HTTP is meaningless, and sending it in development
 *   would pin `localhost` to HTTPS in every developer's browser for a year.
 *
 * ⚠ `no-store` IS UNCONDITIONAL HERE, unlike the web app's, which applies it
 * only to authenticated requests. This surface has almost nothing public, and a
 * rule with an exception is a rule somebody has to keep re-deciding.
 */
export function applyApiSecurityHeaders(request: FastifyRequest, reply: FastifyReply): void {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  reply.header('Cache-Control', 'no-store');
  // Rien ici n'est destiné à être embarqué par une autre origine, ni à ouvrir
  // une fenêtre partagée : les trois en-têtes Cross-Origin le disent au
  // navigateur, et `Permissions-Policy` refuse d'avance des capacités qu'une
  // réponse JSON n'a aucune raison de déclencher.
  reply.header('Cross-Origin-Resource-Policy', 'same-site');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');

  // ⚠ Behind the proxy the scheme arrives in `x-forwarded-proto`; `request
  // .protocol` alone says "http" for every request in a terminated-TLS
  // deployment, which is every real one.
  const proto =
    (request.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ??
    request.protocol;

  if (process.env.NODE_ENV === 'production' && proto === 'https') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}
