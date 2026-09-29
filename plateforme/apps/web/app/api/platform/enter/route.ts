import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { apiFetch } from '@/lib/session';
import { DEPLOIEMENT, cookieName } from '@/lib/brand';
import { headers } from 'next/headers';

/**
 * Enter a branch as the platform administrator.
 *
 * The API mints a 30-minute token scoped to that one branch. It is written into
 * the cookie for THAT branch's slug, so the platform admin's own session at
 * `admin.` is left untouched — leaving a branch is then just closing the tab,
 * and their own console session is still there.
 */
export async function POST(request: Request): Promise<Response> {
  // Pas de console : la route n'existe pas.
  if (!DEPLOIEMENT.console) return new NextResponse(null, { status: 404 });
  const { branchId, slug } = (await request.json()) as { branchId?: string; slug?: string };
  if (!branchId || !slug) {
    return NextResponse.json({ error: 'branchId and slug are required' }, { status: 400 });
  }

  try {
    const session = await apiFetch<{ accessToken: string; expiresIn: number }>(
      `/platform/branches/${branchId}/enter`,
      { method: 'POST' },
    );

    const jar = await cookies();
    // ⚠ Posé depuis admin.<domaine>, un cookie sans `domain` reste à admin. et
    // n'atteint jamais <slug>.<domaine> : « Entrer » menait à la page de
    // connexion. Sur un vrai domaine, le cookie est posé pour le domaine parent ;
    // sur *.localhost (deux étiquettes) les navigateurs n'acceptent pas de
    // domaine parent — limite connue du poste de développement.
    const entetes = await headers();
    const hote = (entetes.get('x-forwarded-host') ?? entetes.get('host') ?? '').split(':')[0]!;
    const etiquettes = hote.split('.');
    const domaine = etiquettes.length >= 3 ? `.${etiquettes.slice(1).join('.')}` : undefined;
    jar.set(cookieName(slug, 'access'), session.accessToken, {
      ...(domaine ? { domain: domaine } : {}),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // Expires with the token. An impersonation session that outlived its own
      // token would leave the UI claiming access it no longer has.
      maxAge: session.expiresIn,
    });

    return NextResponse.json({ ok: true, slug });
  } catch {
    return NextResponse.json({ error: 'Entry refused' }, { status: 403 });
  }
}
