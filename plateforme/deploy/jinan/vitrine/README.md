# Le site vitrine de Heavenly (جنان)

Un site d'une page, en **français, anglais et arabe** (bouton en haut à droite),
pour présenter Heavenly Educational Institution aux familles. Tout est
statique : HTML, CSS, JavaScript, images, polices. **Aucun serveur
d'application, aucune base de données.**

```
vitrine/
├── index.html              ← la page (GÉNÉRÉE : ne pas la modifier à la main)
├── favicon.svg
├── assets/
│   ├── css/site.css        ← le style
│   ├── js/site.js          ← les animations, le changement de langue
│   ├── js/i18n.js          ← les textes (GÉNÉRÉ depuis src/i18n.json)
│   ├── img/                ← les photos (WebP, 760 px et 1400 px)
│   ├── fonts/              ← Fraunces, Manrope, Amiri, IBM Plex Sans Arabic, Aref Ruqaa
│   └── vendor/             ← GSAP 3.15 + ScrollTrigger, Lenis 1.3
├── src/
│   ├── i18n.json           ← TOUS les textes, dans les trois langues
│   └── index.template.html ← la structure de la page
└── construire.py           ← reconstruit index.html et i18n.js
```

## Changer un texte

1. Modifier `src/i18n.json` (la même clé dans `fr`, `en` et `ar`).
2. `python3 construire.py` (Python 3, rien à installer).
3. Recopier le dossier sur le serveur.

Le script refuse de construire si une langue a une clé de plus ou de moins.

## Voir le site sur un ordinateur

```bash
cd plateforme/deploy/jinan/vitrine
python3 -m http.server 8080      # puis http://localhost:8080
```

Un aperçu en **un seul fichier** (images et scripts intégrés, polices depuis
Google Fonts) : `python3 construire.py --apercu heavenly-apercu.html`.

## Le mettre en ligne

Le domaine `ecole-jinan.com` sert aujourd'hui l'application (la page `/` est
le tableau de bord du personnel). Deux façons de publier la vitrine **sans
toucher à l'application** — dans `deploy/jinan/Caddyfile`, puis
`docker compose up -d caddy` :

**A. Sur un sous-domaine** (ex. `heavenly.ecole-jinan.com` ; un enregistrement
DNS A vers le serveur d'abord) :

```caddy
heavenly.{$PUBLIC_DOMAIN} {
	root * /srv/vitrine
	file_server
	encode zstd gzip
	header /assets/* Cache-Control "public, max-age=31536000, immutable"
}
```

**B. Sur un chemin du domaine actuel** (`ecole-jinan.com/decouvrir/`, aucun DNS) —
à ajouter AVANT `reverse_proxy web:3000` dans le bloc du site :

```caddy
	redir /decouvrir /decouvrir/
	handle_path /decouvrir/* {
		root * /srv/vitrine
		file_server
	}
```

Dans les deux cas, monter le dossier dans le conteneur Caddy
(`docker-compose.yml`, service `caddy`, `volumes:`) :

```yaml
      - ./vitrine:/srv/vitrine:ro
```

N'importe quel hébergeur de fichiers statiques convient aussi (Netlify,
Cloudflare Pages, GitHub Pages…) : déposer le dossier tel quel.

## Ce qui est vrai, et ce qui est à confirmer

Les textes ne disent que ce que l'école a donné : le programme national
mauritanien de la maternelle au lycée, l'accent sur l'anglais, la touche du
programme américain, les valeurs, l'adresse (entre Appetizer et l'ambassade du
Brésil, Plus Code `4268+JWX`), le téléphone `38 32 88 88`, le courriel
`infoheavenly24@gmail.com`. Les services (deux rythmes 8 h – 14 h / 8 h – 17 h,
cantine, piscine, transport, médecin, fournitures, espace parents) sont ceux
que l'école a configurés dans la plateforme. **Aucun chiffre, aucun témoignage,
aucune date de fondation n'a été inventé.** Le verset est Tâ-Hâ 20 : 114.

À relire par l'école avant publication : les intitulés des classes (« 1re → 4e
AS »…) et la traduction arabe du nom officiel (« مؤسسة هيفنلي التعليمية »).

## Sobriété et accessibilité

- « Réduire les animations » (réglage du téléphone ou de l'ordinateur) : pas de
  rideau, pas de défilement doux, tout est visible d'emblée.
- Sans JavaScript : la page s'affiche en français, entière.
- Arabe : mise en page de droite à gauche (`dir="rtl"`), mots jamais coupés en
  lettres (les liaisons restent intactes).
- La carte Google ne se charge que lorsqu'on s'en approche.

Conçu et réalisé par **EduPlateforme** — 25038@supnum.mr · 47 33 19 44.
