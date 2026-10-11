# Direction visuelle — en une page

> La commande demandait de proposer cette direction et d'attendre sa validation
> avant de construire. Le propriétaire a demandé ensuite les livrables finaux
> directement : la direction ci-dessous est donc **celle qui a été construite**.
> Toute remarque sur elle se traite dans `src/style.css` et `src/pages/`, sans
> refonte.

## Le parti pris : l'architecture saharienne

Des **masses pleines** (aplats de couleur unie, jamais de carte blanche à ombre
portée), des **ouvertures franches** (l'arc brisé du logo, la porte de l'école,
la fenêtre étroite), une **ombre et une lumière tranchées** (un plan plus sombre
posé à côté du plan clair, sans dégradé ni flou). Aucune illustration de
personnages, aucune icône, aucun emoji : la typographie et ces quelques formes
portent tout.

## La grille

Douze colonnes, 1360 px au plus, marges `clamp(20px, 5vw, 72px)`, gouttière
`clamp(16px, 2vw, 28px)`. Employée de façon **asymétrique** : le grand titre
prend 7 colonnes à gauche et la masse de la porte les 5 autres jusqu'au bord ;
les sections posent leur titre sur 4 à 6 colonnes et leur contenu sur la moitié
opposée, avec une colonne vide entre les deux. Sur téléphone, une seule colonne.

## L'échelle typographique

| Rôle | Police | Taille (fluide) | Interligne |
|---|---|---|---|
| Titre de page | Source Serif 4, 600, optique « display » | 2,6 → 6 rem | 0,98 |
| Titre de section | Source Serif 4, 600 | 2 → 3,5 rem | 1,04 |
| Sous-titre | Source Serif 4, 600 | 1,5 → 2,05 rem | 1,15 |
| Chapeau | IBM Plex Sans 400 | 1,1 → 1,28 rem | 1,6 |
| Texte | IBM Plex Sans 400 | 1,0625 rem | 1,65 |
| Surtitre | IBM Plex Sans 500, capitales espacées | 0,81 rem | — |
| Arabe | Noto Naskh Arabic 700 (titres), IBM Plex Sans Arabic (texte) | mêmes rôles | 1,4 – 1,85 |

Les grands chiffres (« 01 », « 88 ») sont des éléments graphiques à part
entière, en sérif, ton sur ton ou en terre cuite. En arabe, ni capitales ni
espacement des lettres (il casserait les liaisons).

## Les couleurs

La palette du propriétaire, telle quelle : encre `#16241F`, vert profond
`#2F6F62`, terre cuite `#C2683A`, sable `#F2EDE4`, gris `#6E7873`. Quatre
nuances d'ombre seulement (sable plus foncé, vert et terre cuite à l'ombre),
toujours en aplat. La terre cuite est un **accent** : un trait, un chiffre, la
lumière dans la porte.

⚠ Deux couples de la palette sont sous le seuil d'accessibilité pour le petit
texte : gris sur sable (3,9:1) et terre cuite sur sable (3,4:1). Ils ne servent
qu'aux grands textes et au décor ; le petit texte est en encre (13,8:1) ou en
vert profond (5,0:1). Résultat : 100 en accessibilité sur chaque page mesurée.

## Le traitement des images

Pas de photographie d'illustration ni de banque d'images. Les « images » sont
des formes tracées en SVG dans la page (zéro requête) : la porte, les plateaux,
la fenêtre. Le produit se montre par sa **typographie réelle** — l'en-tête
bilingue du bulletin, composé comme la plateforme le compose. Des captures
d'écran de l'application pourront s'ajouter plus tard, recadrées à plat, sans
cadre d'appareil.

## Trois idées pour l'accueil

1. **La porte** *(construite)* — une masse vert profond, de face et de biais,
   percée du même arc outrepassé que le logo ; dans l'ouverture, un mur en terre
   cuite, l'escalier de trois plateaux en sable et une ombre franche en
   diagonale. Au chargement, l'ombre glisse et l'escalier monte, une seule fois.
2. **Les plateaux** *(construite, deuxième section)* — « le produit en trois
   temps » en trois bandes d'aplat empilées (sable, vert, encre), chacune moins
   retirée que la précédente : la silhouette d'un escalier qui monte. Un grand
   chiffre ton sur ton en guise d'image.
3. **Le mur** *(construite, dernière section)* — un aplat d'encre percé d'une
   fenêtre étroite en terre cuite, à côté de l'appel à la démonstration.

## Le mouvement

Sobre : des apparitions décalées au défilement (opacité et 16 px de montée,
courbe sans rebond), la lumière qui entre dans la porte au chargement. Seulement
`transform` et `opacity`. Rien si `prefers-reduced-motion` est demandé ; rien
de caché si le script ne se charge pas.
