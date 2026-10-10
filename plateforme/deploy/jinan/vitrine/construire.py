#!/usr/bin/env python3
"""Construit le site vitrine de Heavenly (جنان).

    python3 construire.py                    # index.html + assets/js/i18n.js
    python3 construire.py --apercu FICHIER   # en plus : UN seul fichier HTML autonome
                                             # (images, styles, scripts intégrés ;
                                             # polices depuis Google Fonts)

La source des textes est src/i18n.json (fr, en, ar — mêmes clés). index.html
reçoit le français en dur (moteurs de recherche, navigateurs sans JavaScript) ;
le script remplace ensuite les textes par la langue choisie.

Rien d'autre que Python 3 : pas de dépendance.
"""
import argparse
import base64
import html
import json
import re
from pathlib import Path

ICI = Path(__file__).resolve().parent


def construire():
    textes = json.loads((ICI / 'src/i18n.json').read_text(encoding='utf-8'))
    cles = [set(v) for v in textes.values()]
    if any(c != cles[0] for c in cles):
        manque = {lang: sorted(cles[0] ^ set(v)) for lang, v in textes.items()}
        raise SystemExit(f'Clés différentes entre les langues : {manque}')
    fr = textes['fr']

    (ICI / 'assets/js').mkdir(parents=True, exist_ok=True)
    (ICI / 'assets/js/i18n.js').write_text(
        '/* Généré par construire.py depuis src/i18n.json — ne pas modifier à la main. */\n'
        'window.HEAVENLY_I18N = ' + json.dumps(textes, ensure_ascii=False, indent=1) + ';\n',
        encoding='utf-8')

    modele = (ICI / 'src/index.template.html').read_text(encoding='utf-8')

    def brut(m):
        return fr[m.group(1)]

    def echappe(m):
        return html.escape(fr[m.group(1)], quote=True)

    page = re.sub(r'\{\{\{([\w.]+)\}\}\}', brut, modele)
    page = re.sub(r'\{\{([\w.]+)\}\}', echappe, page)
    reste = re.findall(r'\{\{[^}]*\}\}', page)
    if reste:
        raise SystemExit(f'Clés inconnues dans le modèle : {reste}')
    (ICI / 'index.html').write_text(page, encoding='utf-8')
    print(f'index.html et assets/js/i18n.js — {len(fr)} textes × {len(textes)} langues')
    return page


def apercu(page, sortie):
    """Un fichier unique : pour regarder le site sans serveur."""
    def data_uri(chemin, mime):
        return f'data:{mime};base64,' + base64.b64encode((ICI / chemin).read_bytes()).decode()

    google = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
              '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
              '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Young+Serif&family=Figtree:wght@400..700'
              '&family=Caveat:wght@500..700&family=El+Messiri:wght@500..700&family=IBM+Plex+Sans+Arabic:wght@400;500;600'
              '&family=Amiri&family=Aref+Ruqaa:wght@700&display=swap">')
    page = re.sub(r'<!--FONTS-->.*?<!--/FONTS-->', google, page, flags=re.S)
    css = (ICI / 'assets/css/site.css').read_text(encoding='utf-8')
    page = page.replace('<link rel="stylesheet" href="assets/css/site.css">', f'<style>\n{css}\n</style>')
    for src in ['assets/js/i18n.js', 'assets/js/site.js']:
        js = (ICI / src).read_text(encoding='utf-8').replace('</script>', '<\\/script>')
        page = page.replace(f'<script src="{src}"></script>', f'<script>\n{js}\n</script>')
    page = re.sub(r'\s(srcset|sizes)="[^"]*"', '', page)
    page = re.sub(r'<link rel="preload"[^>]*>', '', page)
    page = page.replace('href="favicon.svg"', 'href="' + data_uri('favicon.svg', 'image/svg+xml') + '"')

    def image(m):
        nom = m.group(1)
        petit = ICI / f'assets/img/{nom}-760.webp'
        chemin = petit if petit.exists() else ICI / f'assets/img/{nom}-1400.webp'
        return 'src="' + data_uri(chemin.relative_to(ICI), 'image/webp') + '"'

    page = re.sub(r'src="assets/img/([\w-]+?)-(?:760|1400)\.webp"', image, page)
    page = re.sub(r'src="assets/img/([\w-]+\.webp)"',
                  lambda m: 'src="' + data_uri(f'assets/img/{m.group(1)}', 'image/webp') + '"', page)
    page = page.replace('content="assets/img/og.jpg"', 'content=""')
    Path(sortie).write_text(page, encoding='utf-8')
    print(f'aperçu : {sortie} — {len(page.encode()) // 1024} Ko')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--apercu', metavar='FICHIER')
    a = p.parse_args()
    page = construire()
    if a.apercu:
        apercu(page, a.apercu)
