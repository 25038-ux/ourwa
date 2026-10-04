/*
 * ⚠ LA VERSION DES FEUILLES (/elourwa/*.css?v=…), UNE PAR CONSTRUCTION.
 *
 * Le 24/09, après la mise à jour d'El Mourad, le serveur servait la nouvelle
 * responsive.css — et un téléphone montrait encore l'ancien site : les feuilles
 * de public/ gardent le même nom d'une version à l'autre, et un onglet ouvert
 * (ou un navigateur qui se fie à son cache) garde l'ancienne. Un `?v=` qui
 * change à chaque construction les rend nouvelles pour tout le monde.
 *
 * Posée dans process.env AVANT que Next ne lance ses processus de construction,
 * pour qu'ils héritent tous de la même valeur. Lisible : AAAAMMJJTHHMMSS (UTC) —
 * deploy/elmourad/mettre-a-jour.ps1 la lit sur /login pour prouver que le site
 * en ligne est bien la construction qui vient d'être envoyée.
 */
process.env.VERSION_FEUILLES ||= new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);

import { fileURLToPath } from 'node:url';

/*
 * ⚠ LES IMPORTS « ./brand.js » DE @elourwa/shared.
 *
 * Le paquet partagé écrit ses imports relatifs à la manière ESM de Node —
 * `import … from './brand.js'` pour le fichier `brand.ts` —, ce que l'API
 * (NodeNext) exige. Webpack, lui, cherchait un vrai `brand.js` et le site
 * tombait en 500 (« Module not found: Can't resolve './brand.js' ») dès qu'une
 * page importait `@elourwa/shared/facturation`, le premier module partagé du
 * site à avoir un import relatif. La traduction `.js` → `.ts` est bornée aux
 * sources du paquet partagé : rien d'autre ne change de résolution.
 */
const SOURCES_PARTAGEES = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  env: { VERSION_FEUILLES: process.env.VERSION_FEUILLES },
  webpack(config) {
    config.module.rules.push({
      test: /\.tsx?$/,
      include: [SOURCES_PARTAGEES],
      resolve: { extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } },
    });
    return config;
  },
  reactStrictMode: true,
  /*
   * ⚠ `X-Powered-By: Next.js` PARTAIT SUR CHAQUE RÉPONSE.
   *
   * Il ne donne pas la version, mais il donne le cadre — et le cadre suffit à
   * choisir la liste de failles à essayer en premier. El Ourwa ne l'envoie pas ;
   * PHP le fait via `expose_php`, que sa configuration coupe. C'est un en-tête
   * qui ne sert à personne d'autre qu'à qui cherche une porte.
   */
  poweredByHeader: false,
  // Deux serveurs de développement (El Ourwa :3000, El Mourad :3010) ne
  // peuvent pas partager .next : le second écrase les morceaux du premier
  // (404, 500 aléatoires). NEXT_DIST_DIR donne au second son propre dossier.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Branding differs per subdomain, so nothing here may be statically shared
  // between tenants. Rendering is dynamic by default for that reason.
  // ⚠ Les exercices partent avec jusqu'à cinq fichiers de 10 Mo par une action
  // serveur ; la limite par défaut d'une action est 1 Mo, et au-delà Next
  // refuse la requête AVANT l'action — le formulaire « n'envoyait rien ».
  //
  // ⚠ ET LE MIDDLEWARE COUPAIT À 10 Mo (04/10/2026, Jinan : « envoyer
  // exercice : you can't send any document there »). Depuis Next 15.5, une
  // requête qui traverse middleware.ts n'en garde que les 10 premiers Mo
  // (`middlewareClientMaxBodySize`) : trois photos de 4 Mo arrivaient
  // tronquées, l'action ne pouvait plus lire le formulaire et la page tombait
  // sur « Cette page n'a pas pu s'afficher ». Les deux bornes sont alignées :
  // 5 × 10 Mo, plus l'enveloppe multipart.
  experimental: {
    optimizePackageImports: [],
    serverActions: { bodySizeLimit: '60mb' },
    middlewareClientMaxBodySize: '60mb',
  },
};
