import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MARQUE } from './brand';

/**
 * LE LOGO DE L'ENSEIGNE, QUAND ELLE EN A UN — `public/elourwa/marques/<slug>/marque.svg`.
 *
 * Jinan a le sien (deploy/brands/jinan/logo/marque.svg, recopié ici) : l'écran
 * de connexion, la barre latérale et l'en-tête des reçus le montrent. Une
 * enseigne sans fichier — El Ourwa, El Mourad — garde EXACTEMENT son dessin
 * d'aujourd'hui (le chapeau, le « ع » du reçu) : chaque appelant rend l'ancien
 * balisage quand ceci vaut `null`.
 *
 * Côté serveur seulement. Regardé une fois par processus, comme `MARQUE` : le
 * slug ne change pas sans redémarrage. `process.cwd()` est `apps/web`, en
 * développement comme sous `next start` — la même hypothèse que les pages
 * légales (`content/legal`).
 */
function chercher(): string | null {
  try {
    const fichier = join(process.cwd(), 'public', 'elourwa', 'marques', MARQUE.slug, 'marque.svg');
    // `?v=` : la version de construction, comme les feuilles (next.config.mjs) —
    // un logo remplacé n'attend pas le cache d'un téléphone.
    return existsSync(fichier)
      ? `/elourwa/marques/${MARQUE.slug}/marque.svg?v=${process.env.VERSION_FEUILLES ?? ''}`
      : null;
  } catch {
    return null;
  }
}

export const LOGO_MARQUE: string | null = chercher();
