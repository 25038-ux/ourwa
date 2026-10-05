import { NextResponse } from 'next/server';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * L'API RÉPOND-ELLE ? — pour la page qui n'a pas pu s'afficher : elle dit
 * « le serveur ne répond pas » quand c'est le cas (et réessaie seule quand il
 * revient), au lieu d'un message vague ou d'un renvoi à la connexion. Aucune
 * donnée, aucune session : un oui ou un non.
 */
export async function GET() {
  try {
    const r = await fetch(`${API}/health`, { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    return NextResponse.json({ api: r.ok ? 'ok' : 'injoignable' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ api: 'injoignable' }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
