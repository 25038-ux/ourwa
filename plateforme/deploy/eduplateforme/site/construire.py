#!/usr/bin/env python3
"""Construit le site d'EduPlateforme — français à la racine, arabe sous /ar/.

    python3 construire.py                    # les pages, prêtes à servir (adresses propres)
    python3 construire.py --apercu DOSSIER   # une copie qui s'ouvre en double-cliquant
                                             # (chemins relatifs, …/index.html)

Sources :
    src/config.json          adresse du site, de la console, coordonnées
    src/textes/fr.json       TOUS les textes français
    src/textes/ar.json       les mêmes clés, en arabe (le script refuse un écart)
    src/gabarit.html         l'en-tête et le pied, communs à toutes les pages
    src/pages/*.html         le corps de chaque page
    src/style.css            la feuille de style (les polices y sont ajoutées)

Gabarits : {{ cle }} (texte échappé), {{{ cle }}} (HTML tel quel),
{% for x in liste %}…{% endfor %}, {% if cle %}…{% else %}…{% endif %}.
Dans les textes, ⟦…⟧ marque une information que le propriétaire doit fournir :
elle s'affiche surlignée et le script la liste à chaque construction.

Aucune dépendance : Python 3.
"""
import argparse
import hashlib
import html
import json
import re
import shutil
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
SRC = ICI / 'src'
LANGUES = {'fr': {'dir': 'ltr', 'prefixe': ''}, 'ar': {'dir': 'rtl', 'prefixe': 'ar/'}}
# (clé, chemin) — l'ordre est celui du plan du site.
PAGES = [
    ('accueil', ''),
    ('plateforme', 'plateforme/'),
    ('initiative', 'initiative/'),
    ('contact', 'contact/'),
    ('mentions', 'mentions-legales/'),
    ('confidentialite', 'confidentialite/'),
]
# Les polices préchargées : celles du premier écran, (famille, sous-ensemble,
# graisse), retrouvées dans assets/fonts/polices.css — jamais par un début de
# nom : « latin- » attraperait aussi « latin-ext- », 56 Ko inutiles.
POLICES_PRECHARGEES = {
    'fr': [('source-serif-4', 'latin', 600), ('ibm-plex-sans', 'latin', 400)],
    'ar': [('noto-naskh-arabic', 'arabic', 700), ('ibm-plex-sans-arabic', 'arabic', 400)],
}


def fichier_police(css, famille, sous_ensemble, graisse):
    for m in re.finditer(r'/\* ([\w-]+) — ([\w-]+) \*/\s*@font-face \{(.*?)\}', css, re.S):
        if (m.group(1), m.group(2)) != (famille, sous_ensemble):
            continue
        g = [int(x) for x in re.search(r'font-weight: ([\d ]+);', m.group(3)).group(1).split()]
        if g[0] <= graisse <= g[-1]:
            return re.search(r'url\(([\w.-]+\.woff2)\)', m.group(3)).group(1)
    raise SystemExit(f'Police introuvable dans polices.css : {famille} {sous_ensemble} {graisse}')


# ─────────────────────────── le moteur de gabarits ───────────────────────────

JETON = re.compile(r'(\{%.*?%\}|\{\{\{.*?\}\}\}|\{\{.*?\}\})', re.S)


def analyser(source, nom):
    morceaux = JETON.split(source)
    pos = 0

    def bloc(fins):
        nonlocal pos
        sortie = []
        while pos < len(morceaux):
            m = morceaux[pos]
            pos += 1
            if m.startswith('{%'):
                instr = m[2:-2].strip()
                if instr in fins:
                    return sortie, instr
                if instr.startswith('for '):
                    r = re.fullmatch(r'for (\w+) in ([\w.]+)', instr)
                    if not r:
                        raise SyntaxError(f'{nom} : « {instr} »')
                    corps, _ = bloc({'endfor'})
                    sortie.append(('for', r.group(1), r.group(2), corps))
                elif instr.startswith('if '):
                    corps, fin = bloc({'else', 'endif'})
                    autre = bloc({'endif'})[0] if fin == 'else' else []
                    sortie.append(('if', instr[3:].strip(), corps, autre))
                else:
                    raise SyntaxError(f'{nom} : instruction inconnue « {instr} »')
            elif m.startswith('{{{'):
                sortie.append(('brut', m[3:-3].strip()))
            elif m.startswith('{{'):
                sortie.append(('texte', m[2:-2].strip()))
            elif m:
                sortie.append(('html', m))
        if fins:
            raise SyntaxError(f'{nom} : il manque {fins}')
        return sortie, None

    return bloc(set())[0]


class Introuvable(KeyError):
    pass


def lire(portees, chemin):
    for portee in portees:
        valeur = portee
        try:
            for part in chemin.split('.'):
                valeur = valeur[int(part)] if isinstance(valeur, list) else valeur[part]
            return valeur
        except (KeyError, IndexError, ValueError, TypeError):
            continue
    raise Introuvable(chemin)


def rendre(arbre, portees, nom):
    sortie = []
    for noeud in arbre:
        genre = noeud[0]
        if genre == 'html':
            sortie.append(noeud[1])
        elif genre in ('texte', 'brut'):
            try:
                valeur = lire(portees, noeud[1])
            except Introuvable:
                raise SystemExit(f'{nom} : clé inconnue « {noeud[1]} »')
            valeur = '' if valeur is None else str(valeur)
            sortie.append(html.escape(valeur, quote=True) if genre == 'texte' else valeur)
        elif genre == 'for':
            _, var, chemin, corps = noeud
            try:
                liste = lire(portees, chemin)
            except Introuvable:
                liste = []  # une rubrique facultative (ex. « suite ») absente
            for i, element in enumerate(liste):
                sortie.append(rendre(corps, [{var: element, 'boucle': {'n': i + 1, 'i': i}}] + portees, nom))
        elif genre == 'if':
            _, cond, corps, autre = noeud
            nie = cond.startswith('not ')
            try:
                vrai = bool(lire(portees, cond[4:] if nie else cond))
            except Introuvable:
                vrai = False
            sortie.append(rendre(corps if vrai != nie else autre, portees, nom))
    return ''.join(sortie)


# ─────────────────────────── les textes ───────────────────────────

def structure(valeur, chemin=''):
    """Les chemins de clés d'un arbre de textes (les listes comptent par position)."""
    if isinstance(valeur, dict):
        out = set()
        for k, v in valeur.items():
            out |= structure(v, f'{chemin}.{k}' if chemin else k)
        return out
    if isinstance(valeur, list):
        out = set()
        for i, v in enumerate(valeur):
            out |= structure(v, f'{chemin}[{i}]')
        return out
    return {chemin}


def a_completer(texte, trouves, ou):
    def remplace(m):
        trouves.append(f'{ou} : {m.group(1)}')
        return f'<mark class="a-completer">{m.group(1)}</mark>'
    return re.sub(r'⟦(.*?)⟧', remplace, texte)


# ─────────────────────────── les adresses ───────────────────────────

def chemin_page(lang, chemin):
    return LANGUES[lang]['prefixe'] + chemin


def lien(depuis, vers, apercu):
    """Adresse de `vers` vue depuis `depuis` (deux chemins de pages, '' = racine)."""
    if not apercu:
        return '/' + vers
    profondeur = depuis.count('/')
    return '../' * profondeur + vers + 'index.html'


# ─────────────────────────── la construction ───────────────────────────

def construire(sortie, apercu):
    config = json.loads((SRC / 'config.json').read_text(encoding='utf-8'))
    textes = {l: json.loads((SRC / 'textes' / f'{l}.json').read_text(encoding='utf-8')) for l in LANGUES}
    ref = structure(textes['fr'])
    for l, t in textes.items():
        ecart = ref ^ structure(t)
        if ecart:
            raise SystemExit(f'Textes « {l} » : clés différentes du français : {sorted(ecart)[:12]}')

    gabarit = analyser((SRC / 'gabarit.html').read_text(encoding='utf-8'), 'gabarit.html')
    corps = {cle: analyser((SRC / 'pages' / f'{cle}.html').read_text(encoding='utf-8'), f'{cle}.html')
             for cle, _ in PAGES + [('introuvable', None)]}

    # La feuille de style : les polices d'abord, puis le style ; une empreinte pour le cache.
    polices_src = (ICI / 'assets/fonts/polices.css').read_text(encoding='utf-8')
    polices = re.sub(r'url\(([\w.-]+\.woff2)\)', r'url(../fonts/\1)', polices_src)
    css = polices + '\n' + (SRC / 'style.css').read_text(encoding='utf-8')
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    css = re.sub(r'\s*\n\s*', '\n', css).strip() + '\n'
    sortie.joinpath('assets/css').mkdir(parents=True, exist_ok=True)
    (sortie / 'assets/css/site.css').write_text(css, encoding='utf-8')
    js = (ICI / 'assets/js/site.js').read_text(encoding='utf-8')
    version = hashlib.sha1((css + js).encode()).hexdigest()[:8]

    precharge = {l: [fichier_police(polices_src, *x) for x in pref] for l, pref in POLICES_PRECHARGEES.items()}

    manques = []
    pages_ecrites = []
    site = config.get('site_url', '').rstrip('/')
    for lang, prop in LANGUES.items():
        t = textes[lang]
        autre = 'ar' if lang == 'fr' else 'fr'
        for cle, chemin in PAGES + [('introuvable', None)]:
            ici = chemin_page(lang, chemin) if chemin is not None else ('404.html' if lang == 'fr' else 'ar/404.html')
            depuis = ici if chemin is not None else ici.replace('404.html', '')
            u = {k: lien(depuis, chemin_page(lang, c), apercu) for k, c in PAGES}
            u['demo'] = u['contact'] + '?sujet=demo'
            u['autre_langue'] = lien(depuis, chemin_page(autre, chemin if chemin is not None else ''), apercu)
            a = '../' * depuis.count('/') if apercu else '/'
            absolu = lambda l, c: (site + '/' + chemin_page(l, c)) if site else '/' + chemin_page(l, c)
            portees = [{
                'lang': lang, 'dir': prop['dir'], 'autre': autre,
                't': t, 'p': t['pages'][cle], 'cfg': config, 'u': u, 'a': a, 'v': version,
                'courant': {k: (k == cle) for k, _ in PAGES},
                'canon': absolu(lang, chemin or ''), 'alt_fr': absolu('fr', chemin or ''), 'alt_ar': absolu('ar', chemin or ''),
                'polices': [{'f': f} for f in precharge[lang]],
                'console': config.get('console_url', ''),
                'introuvable': chemin is None,
            }]
            page = rendre(gabarit, portees, f'{lang}/{cle}')
            page = page.replace('<!--CORPS-->', rendre(corps[cle], portees, f'{lang}/{cle}'))
            page = a_completer(page, manques, f'{lang}/{chemin if chemin is not None else "404"}')
            reste = re.findall(r'\{\{.*?\}\}|\{%.*?%\}', page)
            if reste:
                raise SystemExit(f'{lang}/{cle} : balises non rendues {reste[:3]}')
            cible = sortie / (ici if ici.endswith('.html') else ici + 'index.html')
            cible.parent.mkdir(parents=True, exist_ok=True)
            cible.write_text(page, encoding='utf-8')
            pages_ecrites.append(cible.relative_to(sortie).as_posix())

    if site and not apercu:
        urls = ''.join(
            f'  <url><loc>{site}/{chemin_page(l, c)}</loc>'
            + ''.join(f'<xhtml:link rel="alternate" hreflang="{x}" href="{site}/{chemin_page(x, c)}"/>' for x in LANGUES)
            + '</url>\n'
            for c in [c for _, c in PAGES] for l in LANGUES)
        (sortie / 'sitemap.xml').write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
            + urls + '</urlset>\n', encoding='utf-8')
        (sortie / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nSitemap: {site}/sitemap.xml\n', encoding='utf-8')
    elif not apercu:
        (sortie / 'robots.txt').write_text('User-agent: *\nAllow: /\n', encoding='utf-8')
        for vieux in ('sitemap.xml',):
            (sortie / vieux).unlink(missing_ok=True)

    print(f'{len(pages_ecrites)} pages ({", ".join(LANGUES)}) — style {len(css.encode()) // 1024} Ko, script {len(js.encode()) // 1024} Ko')
    if not site:
        print('⚠ site_url vide dans src/config.json : adresses canoniques relatives, pas de sitemap.xml')
    if not config.get('console_url'):
        print('⚠ console_url vide dans src/config.json : le lien vers la console n’est pas affiché')
    if manques:
        print(f'⚠ {len(manques)} information(s) à fournir (surlignées sur les pages) :')
        for m in dict.fromkeys(manques):
            print('   ·', m)


def copier_actifs(sortie):
    for dossier in ('assets/fonts', 'assets/logo', 'assets/js', 'assets/img'):
        src = ICI / dossier
        if src.exists():
            shutil.copytree(src, sortie / dossier, dirs_exist_ok=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--apercu', metavar='DOSSIER', help='copie navigable hors serveur')
    args = ap.parse_args()
    if args.apercu:
        cible = Path(args.apercu).resolve()
        if cible == ICI or ICI in cible.parents:
            sys.exit('Le dossier d’aperçu doit être en dehors du site.')
        cible.mkdir(parents=True, exist_ok=True)
        copier_actifs(cible)
        construire(cible, apercu=True)
        print(f'aperçu : {cible}/index.html')
    else:
        construire(ICI, apercu=False)
