'use client';

import { useEffect, useRef, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { signalerNavigation } from '@/lib/navigation-signal';

/**
 * CHANGER DE PAGE SANS RECHARGER LE SITE — la navigation interne de Next pour
 * les liens `<a href>` des 57 pages, sans en réécrire un seul.
 *
 * ⚠ « LE SITE EST ENCORE UN PEU LENT » (propriétaire, 10/10/2026, le jour de la
 * mise en ligne). Chaque lien est un `<a href>` simple, comme chez El Ourwa :
 * chaque clic rechargeait le DOCUMENT entier — la coquille, la barre latérale,
 * sept feuilles de style et tout le JavaScript réévalués — à travers une ligne
 * Nouakchott → Europe de 100 à 600 ms l'aller-retour. Le serveur, lui, répond
 * en 20 à 500 ms : le temps perdu n'était pas le sien.
 *
 * Ce composant, monté une fois dans la coquille, prend le clic gauche simple
 * sur un lien du site et le confie au routeur (`router.push`) : seule la page
 * voyage, la coquille reste, et `(app)/loading.tsx` montre sa trame aussitôt.
 * Au survol (ou au toucher) d'UN lien, il prévient le routeur (`prefetch`).
 *
 * ⚠ IL NE REMPLACE RIEN. Un lien qu'il ne prend pas reste un lien ordinaire, et
 * la barre de `navigation-en-cours.tsx` continue de servir pour ceux-là et pour
 * les formulaires. Il ne prend PAS :
 *   - un clic qu'un autre gestionnaire a annulé (une confirmation refusée) ;
 *   - une touche de modification, un autre bouton que le gauche ;
 *   - `target` autre que `_self`, `download`, un autre site ;
 *   - `/api/…`, la connexion, les pages légales, les fichiers — tout ce qui
 *     n'est pas une page de la coquille `(app)` ;
 *   - un lien (ou un bloc) qui porte `data-plein` : la sortie de secours, à
 *     poser là où une page doit absolument être rechargée en entier ;
 *   - une ancre, ou un lien vers l'adresse où l'on est déjà (le navigateur
 *     recharge la page, comme avant : c'est ce qu'on attend d'un tel clic).
 *
 * ⚠ CE QU'UN RECHARGEMENT FAISAIT SANS QU'ON Y PENSE, ET QUI EST TENU AILLEURS :
 *   - rien d'une fiche ne survit dans une autre : `page-par-adresse.tsx`
 *     remonte la page à chaque changement d'adresse ;
 *   - l'entrée active du menu suit l'adresse : `sidebar-liens.tsx` ;
 *   - le changement de mot de passe imposé : la coquille passe `active={false}`
 *     tant qu'il n'est pas fait, et chaque clic repasse donc par elle ;
 *   - une session finie : chaque page appelle `requireSession()` elle-même.
 *
 * ⚠ « PRÉCÉDENT » ET « SUIVANT » NE MONTRENT JAMAIS UN ARGENT PÉRIMÉ. Le
 * routeur restaurerait ces pages depuis sa mémoire — telles qu'elles étaient
 * en les quittant. Ici, un retour dans l'historique RECHARGE la page entière,
 * comme avant ce composant : le serveur la rend de nouveau, et le routeur n'a
 * pas la main (l'écouteur est en capture et arrête l'événement).
 *
 * ⚠ ET PAS `router.refresh()`, QUI ÉTAIT LE PREMIER CHOIX. Mesuré le 10/10/2026
 * sur les données réelles : sur une page que le serveur met du temps à rendre
 * (« Finance », « Dérogations examens »), `router.refresh()` lit toute la
 * réponse (704 ko) et ne l'affiche JAMAIS — la page restaurée, périmée, reste
 * à l'écran sans erreur ni fin. Sur les pages rapides il fonctionne. Tant que
 * ce défaut n'est pas compris, rien ici ne s'appuie sur lui.
 * (Compris et corrigé le 11/10/2026 — `correctifs/react-reveil-perdu.cjs` :
 * `router.refresh()` aboutit désormais sur « Finance », 6 fois sur 6. Le
 * rechargement complet au retour d'historique reste le choix fait ici : il ne
 * dépend d'aucun correctif.)
 *
 * ⚠ LE SURVOL NE RAPPORTE JAMAIS LES CHIFFRES D'UNE PAGE. Le préchargement est
 * « auto » — jamais « full », le défaut de `router.prefetch`, qui garderait la
 * page entière cinq minutes. Mesuré le 10/10/2026 (Next 15.5.25, données
 * réelles) : le serveur ne renvoie alors que l'arbre des routes, 129 à 182
 * octets, sans un seul appel à l'API, et c'est le clic qui demande la page.
 * Cela tient à une règle interne de Next (rien n'est rendu sous la trame de
 * `loading.tsx`), et le premier clic dans les cinq minutes afficherait tel quel
 * ce qu'un préchargement aurait rapporté. Deux gardes n'en dépendent donc pas :
 *   - `chauffable` : quand la cible est la page d'un dossier où l'on est déjà
 *     (« Finance » depuis une fiche de famille, le tableau de bord, la même
 *     page avec un autre filtre), c'est la PAGE elle-même que le serveur aurait
 *     à ne pas rendre — ces liens ne sont pas préchargés du tout, leur trame
 *     arrive un aller-retour plus tard ;
 *   - un lien qui porte `?annee_id=` n'est jamais préchargé : le middleware
 *     mémoriserait cette année au simple survol.
 *
 * ⚠ PAS DE RAFALE. Un seul lien à la fois, après un court arrêt du pointeur
 * dessus, une fois par demi-minute au plus — jamais « tous les liens visibles » :
 * l'API limite chaque personne à 600 requêtes par minute. Mesuré : s'arrêter
 * sur chacune des 24 entrées du menu coûte 22 requêtes au site et aucune à
 * l'API ; balayer le menu sans s'arrêter, une seule.
 *
 * Une nouvelle version déployée pendant qu'un onglet est ouvert : Next compare
 * l'identifiant de construction de chaque réponse au sien, et recharge la page
 * entière s'il diffère — la navigation ne casse pas, elle redevient un
 * chargement complet.
 *
 * L'INTERRUPTEUR : `NAVIGATION_DOUCE=0` dans l'environnement du site (lu par la
 * coquille à chaque requête, donc sans reconstruire : il suffit de relancer le
 * conteneur) rend tous les liens à leur chargement complet d'avant.
 */

/** Ce qui n'est pas une page de la coquille `(app)`. */
const HORS_COQUILLE = ['/api', '/login', '/legal', '/_next', '/elourwa'];
/** Le pointeur doit s'arrêter ce temps sur un lien avant qu'on le précharge. */
const ARRET_SURVOL_MS = 90;
/** Un lien préchargé ne l'est pas de nouveau avant ce délai. */
const CHAUFFE_VALABLE_MS = 30_000;

/** L'adresse que ce lien ouvre par navigation interne — ou `null` : au navigateur. */
export function adresseDouce(lien: HTMLAnchorElement): URL | null {
  if (lien.target && lien.target !== '_self') return null;
  if (lien.hasAttribute('download') || lien.closest('[data-plein]')) return null;
  const brut = lien.getAttribute('href') ?? '';
  if (brut === '' || brut.startsWith('#')) return null;
  let url: URL;
  try {
    url = new URL(lien.href, window.location.href);
  } catch {
    return null;
  }
  // Un autre site — et `mailto:`, `tel:`, dont l'origine est « null ».
  if (url.origin !== window.location.origin) return null;
  const chemin = url.pathname;
  if (HORS_COQUILLE.some((p) => chemin === p || chemin.startsWith(`${p}/`))) return null;
  // Un fichier (dernier segment avec une extension) n'est pas une page.
  if (/\.[a-z0-9]{1,8}$/i.test(chemin)) return null;
  // La même adresse : une ancre, ou un lien vers soi.
  if (chemin === window.location.pathname && url.search === window.location.search) return null;
  return url;
}

/**
 * Peut-on précharger cette adresse sans rien devoir à ce que le serveur choisit
 * de ne pas rendre ?
 *
 * Non quand tous les segments de la cible sont le début du chemin courant :
 * le premier segment qui diffère est alors la PAGE elle-même. Voir l'en-tête :
 * « le survol ne rapporte jamais les chiffres d'une page ».
 */
export function chauffable(cible: string, ici: string): boolean {
  const c = cible.split('/').filter(Boolean);
  const i = ici.split('/').filter(Boolean);
  return !(c.length <= i.length && c.every((segment, n) => segment === i[n]));
}

const lienDe = (cible: EventTarget | null): HTMLAnchorElement | null => {
  const lien = cible instanceof Element ? cible.closest('a[href]') : null;
  return lien instanceof HTMLAnchorElement ? lien : null;
};

export function NavigationDouce({ active }: { active: boolean }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const partie = useRef(false);
  // L'adresse de la page À L'ÉCRAN (celle que le routeur a rendue), pour
  // reconnaître un retour d'historique qui ne change que l'ancre.
  const chemin = usePathname();
  const requete = useSearchParams().toString();
  const affichee = useRef('');
  affichee.current = `${chemin}?${requete}`;

  // La navigation est arrivée : la barre du haut s'efface.
  useEffect(() => {
    if (enCours) {
      partie.current = true;
      return;
    }
    if (!partie.current) return;
    partie.current = false;
    signalerNavigation('fin');
  }, [enCours]);

  useEffect(() => {
    if (!active) return;

    const surClic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const lien = lienDe(e.target);
      const url = lien ? adresseDouce(lien) : null;
      if (!url) return;
      e.preventDefault();
      // Le clic est parti avant la fin de l'arrêt du pointeur : précharger
      // maintenant ne ferait que doubler la requête (mesuré : deux pour un clic).
      window.clearTimeout(arret);
      signalerNavigation('debut');
      demarrer(() => router.push(url.pathname + url.search + url.hash));
    };

    // ── Le préchargement : un lien, après un arrêt du pointeur. ──
    const chauffes = new Map<string, number>();
    let survole: HTMLAnchorElement | null = null;
    let arret: number | undefined;

    const chauffer = (lien: HTMLAnchorElement) => {
      // « Économiseur de données » du navigateur : on ne dépense rien d'avance.
      if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
      const url = adresseDouce(lien);
      if (!url || !chauffable(url.pathname, window.location.pathname)) return;
      // ⚠ Un lien qui porte `?annee_id=` : le middleware mémoriserait cette année
      // au simple survol (il ne peut pas reconnaître un préchargement — voir son
      // en-tête). Seul le clic choisit une année.
      if (url.searchParams.has('annee_id')) return;
      const cle = url.pathname + url.search;
      const maintenant = Date.now();
      const deja = chauffes.get(cle);
      if (deja !== undefined && maintenant - deja < CHAUFFE_VALABLE_MS) return;
      chauffes.set(cle, maintenant);
      router.prefetch(cle, { kind: PrefetchKind.AUTO });
    };

    const surSurvol = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const lien = lienDe(e.target);
      if (lien === survole) return;
      survole = lien;
      window.clearTimeout(arret);
      if (lien) arret = window.setTimeout(() => chauffer(lien), ARRET_SURVOL_MS);
    };
    const surToucher = (e: TouchEvent) => {
      const lien = lienDe(e.target);
      if (lien) chauffer(lien);
    };

    // ── « Précédent » / « Suivant » : la page est rechargée en entier. ──
    const surRetour = (e: PopStateEvent) => {
      // Une entrée posée hors du routeur (une ancre de la page) : rien à recharger.
      const etat = e.state as { __NA?: boolean } | null;
      if (!etat || !etat.__NA) return;
      // Retour depuis une ancre de la MÊME page : elle est déjà à l'écran.
      const arrivee = `${window.location.pathname}?${new URLSearchParams(window.location.search).toString()}`;
      if (arrivee === affichee.current) return;
      // Le routeur ne doit pas restaurer la page depuis sa mémoire : l'adresse
      // est déjà celle de l'entrée d'historique, le navigateur la redemande.
      e.stopImmediatePropagation();
      signalerNavigation('debut');
      window.location.reload();
    };

    // Sur `window`, en phase de remontée : après tous les gestionnaires du
    // document (React, les confirmations), pour voir un clic qu'ils ont annulé.
    window.addEventListener('click', surClic);
    window.addEventListener('pointerover', surSurvol, { passive: true });
    window.addEventListener('touchstart', surToucher, { passive: true });
    // En CAPTURE : avant l'écouteur du routeur, quel que soit l'ordre de pose.
    window.addEventListener('popstate', surRetour, true);
    return () => {
      window.removeEventListener('click', surClic);
      window.removeEventListener('pointerover', surSurvol);
      window.removeEventListener('touchstart', surToucher);
      window.removeEventListener('popstate', surRetour, true);
      window.clearTimeout(arret);
    };
  }, [active, router]);

  return null;
}
