import { apiFetchBrut, can, requireSession, ServeurInjoignable } from '@/lib/session';

/**
 * « VOIR » UN DOCUMENT SIGNÉ — relayé, parce que le navigateur ne détient
 * jamais le jeton de l'API (il vit dans un cookie httpOnly). La permission
 * est demandée ici aussi : un relais qui ne fait que transmettre est un trou
 * avec un joli nom.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let user;
  try {
    ({ user } = await requireSession());
  } catch (e) {
    if (e instanceof ServeurInjoignable) return new Response(e.message, { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    throw e;
  }
  if (!can(user, 'documents.gerer')) return new Response('Non autorisé.', { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Document introuvable.', { status: 404 });

  const telecharger = new URL(request.url).searchParams.get('telecharger') === '1';
  const r = await apiFetchBrut(`/documents/${id}/fichier${telecharger ? '' : '?voir=1'}`).catch(() => null);
  if (!r || !r.ok) {
    return new Response(r?.status === 404 ? 'Document introuvable.' : 'Le serveur ne répond pas.', {
      status: r?.status ?? 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(r.body, {
    headers: {
      'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': r.headers.get('content-disposition') ?? 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
