#!/usr/bin/env python3
"""Dessine le logo d'EduPlateforme : un cèdre du Liban dont les feuilles tombent.

    python3 src/logo.py      # réécrit assets/logo/*.svg et src/marque.json (tracés des pages)

LE DESSIN. Un cèdre du Liban (Cedrus libani) : un tronc droit, évasé au pied, qui
monte jusqu'à la cime ; trois paires de branches maîtresses ; cinq plateaux de
feuillage horizontaux, plats dessous, en dôme bas dessus, aux pointes relevées —
la silhouette étagée du vieux cèdre, plus large que haute, et non le cône d'un
sapin. Trois feuilles se détachent du plateau le plus bas et tombent vers la
droite, de plus en plus petites.

LES COULEURS. Le cèdre en or (#C9A25B) sur la nuit (#0C1512) ; les feuilles qui
tombent en cuivre (#D88A57). Sur l'ivoire : le cèdre en émeraude (#0F3D2F).

Le mot « EduPlateforme » du logo horizontal est vectorisé depuis Bodoni Moda
(assets/fonts) ; il faut fontTools et brotli (`pip install fonttools brotli`).
Sans eux, les autres fichiers sont écrits quand même.
"""
import json
import math
from pathlib import Path

ICI = Path(__file__).resolve().parent.parent
LOGO = ICI / 'assets/logo'

NUIT, EMERAUDE, OR, CUIVRE, IVOIRE = '#0C1512', '#0F3D2F', '#C9A25B', '#D88A57', '#F5EFE4'


def f(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


def plateau(x0, x1, yb, h, bascule=0.0):
    """Un plateau de feuillage : dessous presque plat, dessus en dôme bas, pointes relevées."""
    w = x1 - x0
    m = x0 + w * (0.5 + 0.18 * bascule)
    return (f'M{f(x0)} {f(yb - 0.18 * h)}'
            f'C{f(x0 + 0.10 * w)} {f(yb - 0.75 * h)} {f(m - 0.28 * w)} {f(yb - h)} {f(m)} {f(yb - h)}'
            f'C{f(m + 0.28 * w)} {f(yb - h)} {f(x1 - 0.10 * w)} {f(yb - 0.75 * h)} {f(x1)} {f(yb - 0.18 * h)}'
            f'C{f(x1 - 0.22 * w)} {f(yb + 0.10 * h)} {f(x0 + 0.22 * w)} {f(yb + 0.10 * h)} {f(x0)} {f(yb - 0.18 * h)}Z')


def branche(x0, y0, x1, y1, e0, e1):
    """Une branche effilée de (x0, y0), épaisseur e0, à (x1, y1), épaisseur e1.

    Toujours tournée dans le même sens que le tronc (aire signée positive) :
    tournée à l'envers, la partie qui chevauche le tronc s'annulerait (règle
    « nonzero ») et percerait le tronc d'un trou là où la branche le traverse."""
    a = math.atan2(y1 - y0, x1 - x0)
    nx, ny = -math.sin(a), math.cos(a)
    pts = [(x0 + nx * e0 / 2, y0 + ny * e0 / 2), (x1 + nx * e1 / 2, y1 + ny * e1 / 2),
           (x1 - nx * e1 / 2, y1 - ny * e1 / 2), (x0 - nx * e0 / 2, y0 - ny * e0 / 2)]
    if sum(xa * yb - xb * ya for (xa, ya), (xb, yb) in zip(pts, pts[1:] + pts[:1])) < 0:
        pts.reverse()
    return 'M' + 'L'.join(f'{f(x)} {f(y)}' for x, y in pts) + 'Z'


def feuille(x, y, longueur, angle):
    """Une feuille en amande centrée en (x, y), inclinée de `angle` degrés."""
    a = math.radians(angle)
    dx, dy = math.cos(a) * longueur / 2, math.sin(a) * longueur / 2
    nx, ny = -math.sin(a) * longueur * 0.26, math.cos(a) * longueur * 0.26
    return (f'M{f(x - dx)} {f(y - dy)}Q{f(x + nx)} {f(y + ny)} {f(x + dx)} {f(y + dy)}'
            f'Q{f(x - nx)} {f(y - ny)} {f(x - dx)} {f(y - dy)}Z')


def geometrie():
    """Le cèdre dans une boîte de 120 × 120."""
    bois = ('M52.6 116C54 104 55.4 88 56.2 62L57.4 26H60.6L61.8 62C62.6 88 64 104 65.4 116Z'
            + branche(58, 84, 26, 72.5, 4, 1.4) + branche(60, 82, 92, 69.5, 4, 1.4)
            + branche(58.5, 70, 33, 58, 3, 1.1) + branche(59.5, 68, 85, 55, 3, 1.1)
            + branche(58.7, 55, 42, 44, 2.4, 1) + branche(59.3, 54, 77, 42, 2.4, 1))
    plateaux = (plateau(5, 113, 77, 11.5, 0.08) + plateau(15, 101, 62.5, 11, -0.08)
                + plateau(26, 92, 48.5, 10.5, 0.06) + plateau(36, 82, 35, 9.5, -0.05)
                + plateau(46, 72, 23, 8, 0))
    feuilles = feuille(104, 89, 12, 32) + feuille(111, 103, 9.5, -36) + feuille(101, 114, 7.5, 62)
    # ⚠ Le bois et les plateaux sont deux tracés distincts : réunis en un seul,
    # une branche tracée dans un sens et un plateau dans l'autre s'annulent
    # (règle « nonzero ») et percent l'arbre de fentes.
    return {'bois': bois, 'plateaux': plateaux, 'feuilles': feuilles, 'boite': 120}


def marque(g, arbre=OR, feuilles=CUIVRE):
    return (f'<path fill="{arbre}" d="{g["bois"]}"/><path fill="{arbre}" d="{g["plateaux"]}"/>'
            f'<path fill="{feuilles}" d="{g["feuilles"]}"/>')


def mot_vectorise(texte, taille, approche=0):
    from fontTools.ttLib import TTFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    polices = ICI / 'assets/fonts/polices.css'
    import re
    bloc = re.search(r'/\* bodoni-moda — latin \*/\s*@font-face \{([^}]*font-style: normal[^}]*)\}', polices.read_text())
    fichier = re.search(r'url\(([\w.-]+)\)', bloc.group(1)).group(1)
    police = TTFont(str(ICI / 'assets/fonts' / fichier))
    glyphes, cmap = police.getGlyphSet(), police.getBestCmap()
    upm, avances = police['head'].unitsPerEm, police['hmtx']
    k, x, traces = taille / upm, 0, []
    for ch in texte:
        nom = cmap[ord(ch)]
        stylo = SVGPathPen(glyphes, ntos=lambda v: f'{v:.1f}'.rstrip('0').rstrip('.'))
        glyphes[nom].draw(TransformPen(stylo, (k, 0, 0, -k, x * k, 0)))
        traces.append(stylo.getCommands())
        x += avances[nom][0] + approche
    return ' '.join(traces), x * k, police['OS/2'].sCapHeight / upm * taille


ENTETE = '<!-- EduPlateforme — un cèdre du Liban, ses feuilles qui tombent. Généré par src/logo.py. -->\n'


def ecrire():
    g = geometrie()
    LOGO.mkdir(parents=True, exist_ok=True)
    tete = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="EduPlateforme">\n'
    (LOGO / 'marque.svg').write_text(tete + ENTETE + marque(g) + '\n</svg>\n', encoding='utf-8')
    (LOGO / 'marque-fond-clair.svg').write_text(tete + ENTETE + marque(g, EMERAUDE, CUIVRE) + '\n</svg>\n', encoding='utf-8')
    (LOGO / 'silhouette.svg').write_text(tete + ENTETE + marque(g, 'currentColor', 'currentColor') + '\n</svg>\n', encoding='utf-8')
    k = 640 / 120
    (LOGO / 'icone-app.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="EduPlateforme">\n' + ENTETE
        + f'<rect width="1024" height="1024" fill="{NUIT}"/>'
        + f'<g transform="translate({f((1024 - 120 * k) / 2)} {f((1024 - 120 * k) / 2 - 6)}) scale({k:.4f})">{marque(g)}</g>\n</svg>\n',
        encoding='utf-8')
    for fichier in LOGO.glob('logo-*.svg'):
        fichier.unlink()
    try:
        trace, largeur, capitales = mot_vectorise('EduPlateforme', 100)
    except ImportError:
        print('⚠ fontTools absent : logos horizontaux non réécrits (pip install fonttools brotli)')
    else:
        # La marque mesure 2,1 capitales et repose sur la ligne de base ; écart 0,45 capitale.
        hm = capitales * 2.1
        km = hm / 120
        ecart = capitales * 0.45
        total = 120 * km + ecart + largeur
        for nom, arbre, texte in (('logo-horizontal.svg', OR, IVOIRE), ('logo-horizontal-fond-clair.svg', EMERAUDE, NUIT)):
            (LOGO / nom).write_text(
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {f(-hm - 2)} {f(total)} {f(hm + 26)}" role="img" aria-label="EduPlateforme">\n'
                + ENTETE + f'<g transform="translate(0 {f(-hm)}) scale({km:.4f})">{marque(g, arbre, CUIVRE)}</g>'
                + f'<path fill="{texte}" transform="translate({f(120 * km + ecart)} 0)" d="{trace}"/>\n</svg>\n',
                encoding='utf-8')
    (ICI / 'src/marque.json').write_text(json.dumps(g, indent=1) + '\n', encoding='utf-8')
    print('assets/logo : marque, marque-fond-clair, silhouette, icone-app, logo-horizontal(-fond-clair)')
    return g


if __name__ == '__main__':
    ecrire()
