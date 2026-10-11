'use strict';

/**
 * LE RÉVEIL PERDU DE REACT — « j'enregistre, le message dit que c'est fait, et la
 * page ne change pas » (11/10/2026).
 *
 * ⚠ CE QUE L'ON VOYAIT. Après une action serveur qui reste sur la même adresse
 * (`revalidatePath` sans redirection : presque toutes celles de `app/actions.ts`),
 * la base était à jour et le message de succès s'affichait — mais la page gardait
 * l'ancien état et le bouton restait grisé, sans erreur, jusqu'à un rechargement
 * à la main. Qui enregistre et ne voit rien changer enregistre une seconde fois :
 * sur un encaissement, c'est de l'argent compté deux fois. Mesuré le 11/10/2026
 * sur une copie des données réelles, construction de production : « Dérogations
 * examens » 9 blocages sur 10 (réponse de 160 ko) ; « Ajouter Staff » un sur
 * huit environ (63 ko) ; sur « Finance » (711 ko) à chaque fois, moyens de
 * paiement comme `router.refresh()`. C'est aussi ce qui bloquait le sélecteur
 * d'année avant `page-par-adresse.tsx`.
 *
 * ⚠ LA CAUSE N'EST PAS DANS LE SITE : elle est dans le React que Next embarque
 * (Next 15.5.27, `next/dist/compiled/react-dom`, React 19.2.0-canary-0bdb9206).
 * Quatre faits, chacun lu dans son code puis vu à l'écran :
 *
 *   1. Une mise à jour SUR PLACE est une transition sous une frontière Suspense
 *      déjà révélée (celle de `(app)/loading.tsx`) : React n'a pas le droit de
 *      remontrer la trame, il attend donc que TOUT le flux du serveur soit là.
 *      Chaque morceau pas encore arrivé « suspend » le rendu, et React lui pose
 *      un réveil : `attachPingListener` → `morceau.then(pingSuspendedRoot)`.
 *   2. Avant de poser ce réveil, React rend la main un instant (« le morceau
 *      arrive peut-être tout de suite »). Si la ligne du flux arrive pendant cet
 *      instant, le morceau est REÇU mais pas encore lu (« resolved_model »).
 *   3. Le `then()` d'un tel morceau le lit et appelle le réveil AUSSITÔT, dans le
 *      même appel — donc PENDANT le rendu.
 *   4. Or `pingSuspendedRoot`, quand le rendu en cours est « suspendu avec
 *      délai » et qu'on est pendant le rendu, ne fait RIEN : ni redémarrage (il
 *      ferait planter le rendu en cours — le source de React y porte un « TODO »),
 *      ni note du réveil. Le rendu se termine « suspendu », rien ne le réveillera.
 *      Si c'était le dernier morceau attendu, la page reste figée pour toujours.
 *
 * D'où : plus la réponse est grosse, plus c'est fréquent ; la même réponse livrée
 * en un seul bloc passe toujours (aucun morceau n'est attendu) ; une page NEUVE
 * (changement d'adresse) passe toujours (les réveils d'une frontière neuve sont
 * posés après le rendu). Preuves du 11/10/2026, toutes sur la construction de
 * production : dans chaque blocage observé (3 sur 3), le dernier `then()` posé
 * par React avait rappelé pendant le rendu, et la racine restait « en attente,
 * suspendue, sans réveil, rien de planifié » ; dans aucun succès (0 sur 7). Et
 * en repoussant ce seul rappel d'une micro-tâche, sans rien changer d'autre :
 * 0 blocage sur 24, là où il y en avait 9 sur 10.
 *
 * ⚠ LE CORRECTIF : UNE EXPRESSION. Dans le cas « pendant le rendu », au lieu de
 * ne rien faire, le réveil est NOTÉ (`workInProgressRootPingedLanes`) — ce que
 * React fait déjà, deux lignes plus bas, dans tous les autres cas. À la fin du
 * rendu, un couloir noté n'est pas marqué « suspendu » : React refait une passe,
 * lit le morceau désormais prêt, et affiche la page. Rien d'autre ne change, et
 * ce chemin ne servait à rien avant (il ne faisait rien).
 *
 * Mesuré le 11/10/2026 avec ce correctif, même copie, construction de
 * production : 226 enregistrements de suite sans un blocage (personnel,
 * dérogations, moyens de paiement et frais de plateforme sur « Finance », seuil
 * d'un niveau, classes, seize encaissements dont huit au double clic — un seul
 * paiement en base à chaque fois), l'écran à jour 110 à 370 ms après le clic
 * (médianes) ; `router.refresh()` sur « Finance » 9 sur 9. Et le témoin : la
 * MÊME construction, où le navigateur reçoit React avec l'expression d'origine
 * remise — « Dérogations » 7 blocages sur 10, « Finance » 9 sur 9,
 * `router.refresh()` 4 sur 4. Seule cette expression sépare les deux.
 *
 * Il est appliqué ICI, à la construction, par un chargeur webpack (posé dans
 * `next.config.mjs`) : `node_modules` n'est pas modifié, et tout ce qui construit
 * le site (`next build`, l'image Docker) le reçoit. Le serveur de développement
 * (`next dev`) charge un autre fichier de React, qui n'est pas corrigé : ne jamais
 * juger ce défaut — ni son absence — sur `next dev`.
 *
 * ⚠ SI LA CONSTRUCTION S'ARRÊTE SUR CE FICHIER après une montée de version de
 * Next : le code de React a changé de forme. Ne pas passer outre sans regarder.
 * Ou bien React a corrigé le défaut (l'essai ci-dessous passe SANS ce chargeur) :
 * retirer alors ce fichier et sa règle dans `next.config.mjs`. Ou bien seule la
 * forme a changé : adapter `DEFAUT` et `CORRIGE`, puis refaire l'essai. Il n'a
 * pas été vérifié si une version plus récente de React corrige déjà ce défaut.
 * L'essai qui tranche : sur une copie des données (jamais les vraies), dix
 * fois de suite « Accorder la dérogation » puis « Révoquer » sur « Dérogations
 * examens », construction de production — la ligne doit changer à l'écran à
 * chaque fois, sans recharger.
 */

/** Le React de production que Next met dans les pages (et sa variante expérimentale). */
const FICHIER = /[\\/]next[\\/]dist[\\/]compiled[\\/]react-dom(?:-experimental)?[\\/]cjs[\\/]react-dom-client\.production\.js$/;

const FONCTION = 'function pingSuspendedRoot(root, wakeable, pingedLanes) {';
/** « Pas pendant le rendu ? Alors on redémarre. » — et pendant le rendu : rien. */
const DEFAUT = '0 === (executionContext & 2) && prepareFreshStack(root, 0)';
/** La branche d'à côté, celle qui note le réveil : elle doit suivre immédiatement. */
const SUITE = /^\s*: \(workInProgressRootPingedLanes \|= pingedLanes\),/;
const CORRIGE =
  '(0 === (executionContext & 2) ? prepareFreshStack(root, 0) : (workInProgressRootPingedLanes |= pingedLanes))';

function refuser(raison, fichier) {
  return new Error(
    `correctifs/react-reveil-perdu.cjs — ${raison}\n` +
      `  fichier : ${fichier}\n` +
      '  Le code de React embarqué par Next a changé. Sans ce correctif, une page peut ne plus se mettre à jour\n' +
      '  après un enregistrement (voir l’en-tête de ce fichier : comment vérifier, puis retirer ou adapter).',
  );
}

/** Rend la source corrigée ; lève une erreur si elle n'a pas exactement la forme attendue. */
function corriger(source, fichier = '(source)') {
  const debut = source.indexOf(FONCTION);
  if (debut === -1 || source.indexOf(FONCTION, debut + 1) !== -1) {
    throw refuser('`pingSuspendedRoot` est introuvable (ou en double).', fichier);
  }
  const fin = source.indexOf('\nfunction ', debut + FONCTION.length);
  const corps = source.slice(debut, fin === -1 ? undefined : fin);
  const ou = corps.indexOf(DEFAUT);
  if (ou === -1 || corps.indexOf(DEFAUT, ou + 1) !== -1 || source.split(DEFAUT).length !== 2) {
    throw refuser('l’expression à corriger n’est pas (ou plus une seule fois) dans `pingSuspendedRoot`.', fichier);
  }
  if (!SUITE.test(corps.slice(ou + DEFAUT.length))) {
    throw refuser('l’expression à corriger n’est plus suivie de la branche qui note le réveil.', fichier);
  }
  const position = debut + ou;
  return source.slice(0, position) + CORRIGE + source.slice(position + DEFAUT.length);
}

/** Le chargeur webpack. */
module.exports = function reveilPerdu(source) {
  return corriger(source, this.resourcePath);
};
module.exports.FICHIER = FICHIER;
module.exports.CHEMIN = __filename;
module.exports.corriger = corriger;
