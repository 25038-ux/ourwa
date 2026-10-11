# Le site public d'EduPlateforme

Cinq pages, en **français** (à la racine) et en **arabe** (sous `/ar/`, mise en
page de droite à gauche complète) : l'accueil, la plateforme, l'initiative, le
contact, les mentions légales et la politique de confidentialité — plus une page
404 dans chaque langue. Tout est statique : HTML, une feuille de style, un
script de 4 Ko, des polices hébergées sur le site. **Aucun cookie, aucune mesure
d'audience, aucune ressource de tiers.**

```
site/
├── index.html, plateforme/, initiative/, contact/,
│   mentions-legales/, confidentialite/, 404.html   ← GÉNÉRÉS (ne pas modifier à la main)
├── ar/…                                            ← GÉNÉRÉS, la version arabe
├── assets/
│   ├── css/site.css      ← GÉNÉRÉE (polices + src/style.css)
│   ├── js/site.js        ← apparitions, menu du téléphone, formulaire
│   ├── fonts/            ← Source Serif 4, IBM Plex Sans, IBM Plex Sans Arabic, Noto Naskh Arabic
│   └── logo/             ← les quatre fichiers du logo (PROVISOIRES, voir plus bas)
├── src/
│   ├── config.json       ← adresse du site, de la console, coordonnées
│   ├── textes/fr.json    ← TOUS les textes français
│   ├── textes/ar.json    ← les mêmes clés, en arabe
│   ├── gabarit.html      ← en-tête et pied communs
│   ├── pages/*.html      ← le corps de chaque page
│   └── style.css         ← la feuille de style source
├── construire.py         ← reconstruit tout (Python 3, rien à installer)
├── polices.py            ← re-télécharge les polices depuis Google Fonts
├── caddy/eduplateforme.caddy  ← la configuration de mise en ligne
├── DIRECTION.md          ← la direction visuelle, en une page
└── CONSOLE.md            ← la console d'administration : ce qui existe, ce qui manque
```

## Changer un texte

1. Modifier `src/textes/fr.json` **et** `src/textes/ar.json` (mêmes clés : le
   script refuse de construire si l'une a une clé que l'autre n'a pas).
2. `python3 construire.py`
3. Recopier le dossier sur le serveur.

Le catalogue de « La plateforme » est dans `pages.plateforme.domaines` : huit
domaines, chacun avec sa liste de fonctions. Il a été établi d'après le registre
des fonctions de l'application (`docs/FEATURES.md`), **sans rien inventer**.
Le catalogue des 167 capacités annoncé dans la commande n'a pas été fourni : il
se range au même endroit, domaine par domaine, sans toucher au reste.

## Les informations à fournir

Le script les liste à chaque construction, et elles s'affichent **surlignées**
sur les pages tant qu'elles ne sont pas remplies (texte entre `⟦…⟧` dans les
fichiers de textes) :

- forme juridique, immatriculation, adresse postale (mentions légales) ;
- l'hébergeur du site et celui de la plateforme ;
- la durée de conservation des journaux du serveur.

Et dans `src/config.json` :

- `site_url` — l'adresse du site (ex. `https://eduplateforme.mr`) : adresses
  canoniques absolues, `hreflang`, `sitemap.xml`. Sans elle, le score SEO de
  Lighthouse tombe à 83 ; avec elle, 100.
- `console_url` — l'adresse de la console de la plateforme (voir `CONSOLE.md`).
  Vide : aucun lien. Renseignée : un lien « Console des établissements » dans le
  pied de page.

**À faire relire avant publication** : les deux pages légales par un juriste,
et toute la version arabe par un arabophone. La graphie arabe du nom du porteur
n'a pas été inventée : le nom reste en lettres latines sur les pages arabes.

## Le logo — provisoire

Les quatre fichiers SVG du logo n'étaient pas joints à la commande. Ceux de
`assets/logo/` sont **dessinés d'après sa description** (un arc brisé, trois
plateaux qui montent) pour que la mise en page soit juste. Remplacer chaque
fichier par l'officiel du même rôle :

| Fichier | Rôle |
|---|---|
| `marque.svg` | la marque seule (aussi l'icône de l'onglet) |
| `logo-horizontal.svg` | le lockup horizontal |
| `icone-app.svg` | l'icône d'application |
| `silhouette.svg` | la silhouette monochrome |

La marque est aussi **dessinée dans les pages** (en-tête et pied, deux lignes
dans `src/gabarit.html`) pour s'afficher sans requête : y recopier le tracé
officiel le moment venu.

## Voir le site sur un ordinateur

```bash
cd plateforme/deploy/eduplateforme/site
python3 -m http.server 8080          # puis http://localhost:8080
```

Ou une copie qui s'ouvre en double-cliquant, sans serveur :

```bash
python3 construire.py --apercu ~/eduplateforme-apercu   # puis ouvrir index.html
```

## Le mettre en ligne

Rien n'est publié sans l'accord du propriétaire. Le jour venu : copier le dossier
sur le serveur (ex. `/srv/eduplateforme`) et ajouter le bloc
`caddy/eduplateforme.caddy` à la configuration de Caddy, en y mettant le
domaine. Ce bloc sert les pages et les ressources, **refuse** `src/`, les
scripts Python et les `.md`, envoie les en-têtes de sécurité (CSP stricte sans
`unsafe-inline`, HSTS, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`,
`Permissions-Policy`), met les ressources en cache un an (leurs adresses
changent à chaque version) et répond par la page 404 de la bonne langue.

## Mesures (Chromium, Lighthouse 12, profil mobile)

| Page | Performance | Accessibilité | Bonnes pratiques | SEO |
|---|---:|---:|---:|---:|
| Accueil | 98 | 100 | 100 | 100 ¹ |
| La plateforme | 99 | 100 | 100 | 100 ¹ |
| Contact | 99 | 100 | 100 | 100 ¹ |
| Accueil arabe | 99 | 100 | 100 | 100 ¹ |
| Confidentialité | 99 | 100 | 100 | 100 ¹ |

¹ avec `site_url` renseignée (83 sans, à cause des adresses canoniques relatives).

Accueil : **11 Ko** transférés hors polices (HTML 4 Ko, style 6 Ko, script
1 Ko, compressés), 57 Ko de polices pour le français. CLS ≤ 0,02, aucun temps
de blocage. Les animations ne touchent que `transform` et `opacity`, se jouent
une fois, et disparaissent avec `prefers-reduced-motion`.

## Le formulaire de contact

Il n'envoie rien à ce site — il n'y a pas de serveur d'application. Il compose
le message (objet, nom, établissement, téléphone, texte) et l'ouvre dans
**WhatsApp** (`wa.me/22247331944`) ou dans la **messagerie** de la personne
(`25038@supnum.mr`), qui le relit et l'envoie elle-même. Aucune donnée n'est donc
conservée par le site, ce que dit la politique de confidentialité. Sans
JavaScript, le formulaire part par la messagerie.

Conçu et réalisé pour EduPlateforme — 25038@supnum.mr · +222 47 33 19 44.
