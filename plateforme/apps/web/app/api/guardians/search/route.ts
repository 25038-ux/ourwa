import { NextResponse } from 'next/server';
import { apiFetch, requireSession, can } from '@/lib/session';

/**
 * The correspondent search, proxied.
 *
 * ⚠ THE BROWSER NEVER HOLDS THE API TOKEN. It lives in an httpOnly cookie that
 * server code reads; a `fetch` straight from the page to the API would need the
 * token in JavaScript, which is the one place it must not be. So the search
 * goes through the app, which already has the session.
 *
 * ⚠ AND THE PERMISSION IS CHECKED HERE TOO. This route is reachable by anyone
 * signed in, whatever screen they came from, so it re-asks the question the
 * enrolment page asked: may this person see the family list at all? A proxy
 * that only forwards is a hole with a nice name.
 */
export async function GET(request: Request) {
  const { user } = await requireSession();

  if (!can(user, 'scolarite.inscrire', 'scolarite.reinscrire', 'messagerie.envoyer')) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const q = params.get('q') ?? '';
  // Its two-character floor, enforced before the round trip as well as after:
  // below it the search returns half the school and helps nobody.
  if (q.trim().length < 2) return NextResponse.json([]);
  // `messagerie.php` : parents actifs seulement, 30 au plus.
  const suite = `${params.get('actifs') === '1' ? '&actifs=1' : ''}${/^\d+$/.test(params.get('limit') ?? '') ? `&limit=${params.get('limit')}` : ''}`;

  try {
    const results = await apiFetch<unknown[]>(
      `/students/guardians/search?q=${encodeURIComponent(q)}${suite}`,
    );
    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: 'Recherche indisponible' }, { status: 502 });
  }
}
