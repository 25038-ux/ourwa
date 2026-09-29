import { BULLETIN_CSS } from '@elourwa/shared/bulletin-css';

/**
 * La feuille du bulletin, servie depuis la constante partagée : le site, le
 * document rendu à l'application des familles et son PDF lisent le même texte.
 */
export function GET(): Response {
  return new Response(BULLETIN_CSS, {
    headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
