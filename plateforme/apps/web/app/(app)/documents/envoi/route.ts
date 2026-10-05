import { NextResponse } from 'next/server';
import { can, requireSession, ServeurInjoignable } from '@/lib/session';
import { deposerDocument, supprimerDocument } from '@/lib/documents';

/**
 * DÉPOSER, REMPLACER, SUPPRIMER un document signé — une requête ordinaire,
 * pas une action serveur : voir `lib/documents.ts` (les actions d'une page
 * passent une par une et un envoi lent bloquait tous les boutons).
 *
 * ⚠ La permission est demandée ici, et l'API la redemande. Une requête venue
 * d'une autre origine est refusée (les cookies de session sont déjà
 * `SameSite=Lax`, ce contrôle ne coûte rien de plus).
 */
export async function POST(request: Request) {
  const origine = request.headers.get('origin');
  const hote = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (origine && hote && new URL(origine).host !== hote) {
    return NextResponse.json({ error: 'Origine refusée.' }, { status: 403 });
  }
  let user;
  try {
    ({ user } = await requireSession());
  } catch (e) {
    if (e instanceof ServeurInjoignable) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
  if (!can(user, 'documents.gerer')) {
    return NextResponse.json({ error: 'Cette action demande le droit de gérer les documents.' }, { status: 403 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Envoi illisible : réessayez.' }, { status: 400 });
  }
  const r = form.get('operation') === 'supprimer' ? await supprimerDocument(form) : await deposerDocument(form);
  return NextResponse.json(r ?? { error: 'Échec.' }, { status: r?.error ? 400 : 200 });
}
