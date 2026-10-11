# Direction artistique — en une page

> 11/10/2026. Le propriétaire a rejeté la direction précédente (« architecture
> saharienne », porte et escalier) : EduPlateforme n'est pas une application,
> c'est un **atelier de quelques ingénieurs**, à Nouakchott, qui conçoit des
> sites web et **ouvre l'accès** à ses produits exclusifs. Il a demandé un site
> très orienté vente, convaincant, avec une aura **VIP, exclusive** — et un logo
> d'arbre : un cèdre du Liban, d'une couleur séduisante, aux feuilles qui
> tombent. Cette page décrit ce qui a été construit.

## L'idée : un cercle fermé

On n'achète pas EduPlateforme, on **y est admis**. Tout le vocabulaire le dit :
« Réservé à quelques-uns », « Accès sur demande », « Rejoindre le cercle, en trois
temps », « Ces produits ne sont pas en libre accès ». Le seul appel à l'action est
**Demander un accès** ; il est partout, toujours le même bouton or. La preuve
vient des faits, jamais des adjectifs : près de 3 000 élèves gérés aujourd'hui,
0 écart sur 88 contrôles, trois langues, 100 % conçu et développé en Mauritanie.

## Les couleurs

| Rôle | Nom | Valeur |
|---|---|---|
| Le fond, la nuit d'un vert presque noir | nuit | `#0C1512` |
| Les sections de prestige (la vitrine, l'application) | émeraude | `#0F3D2F` |
| Le cèdre, les filets, les chiffres, le bouton | or champagne | `#C9A25B` |
| La deuxième ligne des grands titres, les chiffres | or clair | `#E8D4A6` |
| Les feuilles qui tombent — et rien d'autre | cuivre | `#D88A57` |
| Les sections claires, où l'on respire | ivoire | `#F5EFE4` |
| Le texte sur l'ivoire | encre | `#16211C` |

Contrastes vérifiés (WCAG AA au moins, AAA pour le texte courant) : or sur nuit
7,8:1 · ivoire sur nuit 16,2:1 · or sur émeraude 5,1:1 · or foncé (`#7A5C24`) sur
ivoire 5,4:1 · encre sur ivoire 14,5:1. Les grandes sections alternent nuit,
ivoire et émeraude, séparées au besoin par un filet d'or ; jamais de carte
blanche à ombre portée.

## La typographie

| Rôle | Police | Remarque |
|---|---|---|
| Titres, chiffres, citations | **Bodoni Moda** 500, taille optique 96 | une Didone : la voix du luxe éditorial |
| Deuxième ligne des grands titres | Bodoni Moda *italique*, or clair | « *Réservé à quelques-uns.* » |
| Texte, navigation | **Jost** 300 à 600 | une géométrique sobre, à la Futura |
| Surtitres, boutons | Jost 500, capitales espacées (0,22 à 0,28 em) | jamais en arabe |
| Titres arabes | **Amiri** 700 | un naskh classique, à la hauteur de la Didone |
| Texte arabe | **Tajawal** 400 à 700 | la géométrique arabe qui répond à Jost |

Grand titre de l'accueil : `clamp(2.8rem, 5.3vw, 5.8rem)`, interligne 1. À la
taille optique 96, Bodoni Moda dessine le trait d'union comme un filet
invisible : `polices.py` emprunte ces trois signes (`-`, `–`, `—`) à la taille
optique 6.

## La grille et l'air

Douze colonnes, 1400 px au plus, marges `clamp(20px, 5vw, 80px)`. Le titre de
section sur la moitié gauche, le contenu sur l'autre ; des sections hautes
(`clamp(96px, 12vw, 176px)` de marge verticale) ; des listes séparées par des
filets fins plutôt que des puces. Sur téléphone, une seule colonne, le menu se
replie derrière un bouton « Menu ».

## Le mouvement

- **Les feuilles du cèdre tombent** dans l'ouverture de l'accueil : huit feuilles
  cuivre, de 11 à 19 secondes chacune, en CSS seul. Elles s'arrêtent quand
  l'ouverture sort de l'écran.
- **Le compteur** « près de 3 000 » monte une fois, en 1,8 s, quand il paraît, et
  s'arrête sur le texte exact.
- **Les apparitions** : un léger glissement vers le haut, une seule fois. Ce qui
  est déjà à l'écran au chargement ne disparaît jamais.
- Avec `prefers-reduced-motion`, **rien ne bouge** : feuilles immobiles,
  chiffres et textes déjà en place.

## Ce que le site ne fait jamais

Pas de photo d'illustration ni d'image de banque, pas d'icône ni d'emoji, pas de
témoignage, de logo de client ou de chiffre qui n'aurait pas été donné ou
vérifié, pas de compte à rebours ni de fausse rareté. L'exclusivité tient au ton,
à l'air et à la retenue — pas à des artifices.
