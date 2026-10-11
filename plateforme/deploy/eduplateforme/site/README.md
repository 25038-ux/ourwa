# Le site public d'EduPlateforme

EduPlateforme est un **atelier numérique de Nouakchott** : quelques ingénieurs
mauritaniens qui conçoivent des sites web sur mesure et ouvrent, **sur demande**,
l'accès à leurs produits exclusifs — la plateforme de gestion scolaire et
l'application des familles, qui gèrent aujourd'hui **près de 3 000 élèves**. Le
site est une vitrine de prestige : il ne vend rien en ligne, il fait demander un
accès.

Cinq pages, en **français** (à la racine), en **anglais** (sous `/en/`) et en
**arabe** (sous `/ar/`, mise en page de droite à gauche complète) : l'accueil,
les produits, le contact, les mentions légales et la confidentialité — plus une
page 404 par langue, soit **18 pages**. Le sélecteur FR · EN · عربي, en haut de
chaque page, mène à la même page dans l'autre langue. Tout est statique : HTML,
une feuille de style, un script de 4 Ko, des polices hébergées sur le site.
**Aucun cookie, aucune mesure d'audience, aucune ressource de tiers.**

```
site/
├── index.html, produits/, contact/,
│   mentions-legales/, confidentialite/, 404.html   ← GÉNÉRÉS (ne pas modifier à la main)
├── en/…, ar/…                                      ← GÉNÉRÉS, l'anglais et l'arabe
├── assets/
│   ├── css/site.css      ← GÉNÉRÉE (polices + src/style.css)
│   ├── css/sans-js.css   ← GÉNÉRÉE (src/sans-js.css), chargée seulement sans JavaScript
│   ├── js/site.js        ← compteur, apparitions, menu du téléphone, formulaire
│   ├── fonts/            ← Bodoni Moda, Jost, Amiri (allégée), Tajawal
│   └── logo/             ← le cèdre, six fichiers (générés par src/logo.py)
├── src/
│   ├── config.json       ← adresse du site, de la console, coordonnées
│   ├── textes/fr.json    ← TOUS les textes français
│   ├── textes/en.json    ← les mêmes clés, en anglais
│   ├── textes/ar.json    ← les mêmes clés, en arabe
│   ├── gabarit.html      ← en-tête et pied communs
│   ├── pages/*.html      ← le corps de chaque page
│   ├── style.css         ← la feuille de style source
│   ├── sans-js.css       ← la navigation à plat quand le script ne tourne pas
│   ├── logo.py           ← dessine le cèdre (géométrie exacte, six fichiers)
│   └── marque.json       ← GÉNÉRÉ par logo.py : les tracés que reprennent les pages
├── construire.py         ← reconstruit tout (Python 3, rien à installer)
├── polices.py            ← re-télécharge et prépare les polices
├── caddy/eduplateforme.caddy  ← la configuration de mise en ligne
├── DIRECTION.md          ← la direction artistique, en une page
└── CONSOLE.md            ← la console d'administration : ce qui existe, ce qui manque
```

## Changer un texte

1. Modifier `src/textes/fr.json`, `en.json` **et** `ar.json` (mêmes clés : le
   script refuse de construire si une langue a une clé que les autres n'ont pas).
2. `python3 construire.py`
3. Recopier le dossier sur le serveur.

**Les chiffres.** Seuls des faits figurent sur le site : *près de 3 000 élèves*
(donné par le propriétaire), *0 écart sur 88 contrôles* (les contrôles de
rapprochement menés avant la mise en service, voir `docs/STATE.md`), *3 langues*,
*100 % conçu et développé en Mauritanie*. Les fonctions des produits viennent du
registre de l'application (`docs/FEATURES.md`). Aucun témoignage, aucun logo de
client, aucun nom d'école : rien n'a été fourni, rien n'a été inventé. Pour
changer le nombre d'élèves : `pages.accueil.chiffres.items[0]` (`valeur` pour le
texte, `compte` pour le compteur animé) et la phrase d'accroche (`chapo`) dans
les trois langues.

**Les liens « Demander un accès »** mènent à `contact/?sujet=acces` ; « Parler de
votre site » à `contact/?sujet=site`. Le formulaire choisit l'objet d'avance.

## Les informations à fournir

Le script les liste à chaque construction, et elles s'affichent **surlignées**
sur les pages tant qu'elles ne sont pas remplies (texte entre `⟦…⟧` dans les
fichiers de textes) :

- forme juridique, immatriculation, adresse postale (mentions légales) ;
- l'hébergeur du site et celui des produits ;
- la durée de conservation des journaux du serveur.

Et dans `src/config.json` :

- `site_url` — l'adresse du site (ex. `https://eduplateforme.mr`). Renseignée :
  adresses canoniques, `hreflang` des trois langues et `sitemap.xml`. Vide :
  aucune de ces balises (des adresses relatives seraient fausses) ; le site
  fonctionne et le SEO de Lighthouse reste à 100, mais les moteurs ne savent
  pas que les trois langues sont la même page.
- `console_url` — l'adresse de la console de la plateforme (voir `CONSOLE.md`).
  Vide : aucun lien. Renseignée : un lien « Console des établissements » dans le
  pied de page.

**À faire relire avant publication** : les deux pages légales par un juriste,
la version anglaise par un anglophone et la version arabe par un arabophone. Le
nom de l'interlocuteur (Sidibrahim Mohammed) reste en lettres latines sur les
pages arabes : sa graphie arabe n'a pas été inventée.

## Le logo : un cèdre du Liban

Redessiné le 11/10/2026 à la demande du propriétaire. Un **cèdre du Liban** :
tronc droit évasé au pied, trois paires de branches maîtresses, **cinq plateaux
de feuillage** horizontaux — la silhouette étagée du vieux cèdre, plus large que
haute, et non le cône d'un sapin — et **trois feuilles qui se détachent** et
tombent, de plus en plus petites. Le cèdre en **or champagne** (#C9A25B) sur la
**nuit** (#0C1512), les feuilles en **cuivre** (#D88A57) ; sur l'ivoire, le cèdre
passe en **émeraude** (#0F3D2F).

La géométrie est calculée dans `src/logo.py` (boîte de 120 × 120), pas dessinée
à main levée. `python3 src/logo.py` réécrit les six fichiers et `src/marque.json`,
que les pages reprennent (en-tête, ouverture de l'accueil, filigranes, appel
final) : changer le dessin à un endroit le change partout. Le logo horizontal
vectorise « EduPlateforme » en Bodoni Moda (il faut `pip install fonttools
brotli`). Le bois et le feuillage sont deux tracés distincts : réunis en un seul,
une branche et un plateau tracés en sens contraires s'annulent et percent l'arbre
de fentes.

| Fichier | Rôle |
|---|---|
| `marque.svg` | le cèdre seul, or et cuivre — sur fond sombre (aussi l'icône de l'onglet) |
| `marque-fond-clair.svg` | le cèdre émeraude et cuivre — sur fond clair |
| `logo-horizontal.svg` | le cèdre et le mot, ivoire — sur fond sombre |
| `logo-horizontal-fond-clair.svg` | le cèdre émeraude et le mot nuit — sur fond clair |
| `icone-app.svg` | l'icône d'application, 1024 × 1024, fond nuit |
| `silhouette.svg` | une seule couleur (`currentColor`) : tampon, gravure, broderie |

Taille minimale : 20 px pour le cèdre seul (en dessous, les feuilles qui tombent
se perdent ; le cèdre reste lisible). Zone de protection : la largeur d'un
plateau du bas tout autour. Sur les pages arabes, le grand cèdre de l'accueil
est retourné : les feuilles tombent vers la gauche, dans le sens de la lecture.

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
domaine. Ce bloc sert les pages et les ressources, **refuse** `src/`, `caddy/`,
les scripts Python et les `.md`, envoie les en-têtes de sécurité (CSP stricte
sans `unsafe-inline`, HSTS, `nosniff`, `frame-ancestors 'none'`,
`Referrer-Policy`, `Permissions-Policy`), met les ressources en cache un an
(leurs adresses changent à chaque version) et répond par la page 404 de la
langue demandée (`/en/…` en anglais, `/ar/…` en arabe, le reste en français).
Vérifié le 11/10/2026 avec `caddy:2-alpine` : configuration valide, aucune
violation de CSP avec ou sans JavaScript.

## Mesures (Chromium, Lighthouse 12, profil mobile, compression comme en production)

| Page | Performance | Accessibilité | Bonnes pratiques | SEO |
|---|---:|---:|---:|---:|
| Accueil | 100 | 100 | 100 | 100 |
| Accueil anglais | 100 | 100 | 100 | 100 |
| Accueil arabe | 98 | 100 | 100 | 100 |
| Produits, arabe | 99 | 100 | 100 | 100 |
| Contact | 100 | 100 | 100 | 100 |

Mesuré après la mise en scène de l'accueil (sceau, bandeau, monument, maquette,
grain). Le sceau est dessiné à l'échelle 3 pour que ses lettres aient une taille
calculée lisible (100 % de texte lisible au sens de Lighthouse).

Accueil : **≈ 17 Ko** transférés hors polices (HTML, style et script compressés) ; polices 67 Ko en français et en anglais, 158 Ko en arabe.
CLS ≤ 0,005, aucun temps de blocage. Amiri est réduite par `polices.py` aux
lettres que le site écrit (41 Ko par graisse au lieu de 100). Les animations ne
touchent que `transform` et `opacity` ; les feuilles du cèdre s'arrêtent quand
elles sortent de l'écran ; rien ne bouge avec `prefers-reduced-motion`.

## Le formulaire de contact

Il n'envoie rien à ce site — il n'y a pas de serveur d'application. Il compose
le message (objet, nom, établissement, téléphone, texte) et l'ouvre dans
**WhatsApp** (`wa.me/22247331944`) ou dans la **messagerie** de la personne
(`25038@supnum.mr`), qui le relit et l'envoie elle-même. Aucune donnée n'est donc
conservée par le site, ce que dit la politique de confidentialité. Sans
JavaScript, le formulaire part par la messagerie.

Conçu et réalisé pour EduPlateforme — 25038@supnum.mr · +222 47 33 19 44.
