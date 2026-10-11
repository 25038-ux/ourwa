#!/usr/bin/env python3
"""Dessine le logo d'EduPlateforme — les quatre fichiers de assets/logo/.

    python3 src/logo.py            # réécrit assets/logo/*.svg et affiche le tracé à
                                   # recopier dans src/gabarit.html et la porte de l'accueil

LA CONSTRUCTION. Une porte d'école d'inspiration maghrébine : un arc brisé
OUTREPASSÉ (en fer à cheval — l'intrados repasse sous la ligne de naissance et
se resserre avant les piédroits), large de 100 unités, d'épaisseur 13. Dans
l'ouverture, un escalier de trois plateaux qui monte de gauche à droite : les
niveaux, la progression, la plateforme. La plus haute marche s'arrête
exactement à la ligne de naissance de l'arc ; l'escalier laisse un jeu de 4
unités avec les piédroits, pour que la silhouette en une couleur reste lisible.

    largeur 100 · rayon extérieur 72 (centres sur la ligne de naissance)
    épaisseur 13 · retour du fer à cheval 3,5 · jeu 4 · hauteur 125

Tout est calculé : changer une valeur ici, relancer, et les quatre fichiers
suivent. Le mot « EduPlateforme » du logo horizontal est vectorisé depuis
Source Serif 4 (assets/fonts) ; il faut fontTools et brotli
(`pip install fonttools brotli`). Sans eux, les trois autres fichiers sont
écrits quand même.
"""
import math
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent.parent
LOGO = ICI / 'assets/logo'

VERT, TERRE, SABLE, ENCRE = '#2F6F62', '#C2683A', '#F2EDE4', '#16241F'
LARGEUR, RAYON, EPAISSEUR, RETOUR, JEU = 100.0, 72.0, 13.0, 3.5, 4.0


def n(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


def arc_brise(x0, x1, naissance, rayon, base, retour=0.0):
    """Le contour d'un arc brisé de x0 à x1 (centres des deux arcs sur la ligne de
    naissance, à `rayon` de chaque naissance), piédroits jusqu'à `base`. Avec
    `retour`, l'arc est outrepassé : il repasse sous la naissance et rentre de
    `retour` avant de devenir piédroit. Renvoie (tracé, hauteur où commencent les
    piédroits)."""
    w = x1 - x0
    fleche = math.sqrt(rayon ** 2 - (rayon - w / 2) ** 2)
    ax, ay = x0 + w / 2, naissance - fleche
    r = n(rayon)
    if retour:
        bas = naissance + math.sqrt(rayon ** 2 - (rayon - retour) ** 2)
        return (f'M{n(x0 + retour)} {n(base)}V{n(bas)}A{r} {r} 0 0 1 {n(x0)} {n(naissance)}'
                f'A{r} {r} 0 0 1 {n(ax)} {n(ay)}A{r} {r} 0 0 1 {n(x1)} {n(naissance)}'
                f'A{r} {r} 0 0 1 {n(x1 - retour)} {n(bas)}V{n(base)}Z'), bas
    return (f'M{n(x0)} {n(base)}V{n(naissance)}A{r} {r} 0 0 1 {n(ax)} {n(ay)}'
            f'A{r} {r} 0 0 1 {n(x1)} {n(naissance)}V{n(base)}Z'), naissance


def escalier(x0, x1, base, hauteurs):
    pas = (x1 - x0) / len(hauteurs)
    d = f'M{n(x0)} {n(base)}'
    for i, h in enumerate(hauteurs):
        d += f'V{n(base - h)}H{n(x0 + (i + 1) * pas)}'
    return d + f'V{n(base)}Z'


def geometrie():
    naissance = math.sqrt(RAYON ** 2 - (RAYON - LARGEUR / 2) ** 2)  # l'apex est en y = 0
    hauteur = round(naissance + 56)
    exterieur, _ = arc_brise(0, LARGEUR, naissance, RAYON, hauteur)
    interieur, _ = arc_brise(EPAISSEUR, LARGEUR - EPAISSEUR, naissance, RAYON - EPAISSEUR, hauteur, RETOUR)
    x0, x1 = EPAISSEUR + RETOUR + JEU, LARGEUR - EPAISSEUR - RETOUR - JEU
    h = hauteur - naissance
    return {
        'largeur': LARGEUR, 'hauteur': hauteur,
        'cadre': f'{exterieur}{interieur}',
        'marches': escalier(x0, x1, hauteur, [h / 3, 2 * h / 3, h]),
    }


def marque(g, cadre=VERT, marches=TERRE):
    return (f'<path fill="{cadre}" fill-rule="evenodd" d="{g["cadre"]}"/>'
            f'<path fill="{marches}" d="{g["marches"]}"/>')


def mot_vectorise(texte, taille, approche=-10):
    """« EduPlateforme » en Source Serif 4 (600), contours SVG, ligne de base y = 0."""
    from fontTools.ttLib import TTFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    police = TTFont(str(next((ICI / 'assets/fonts').glob('source-serif-4-latin-[0-9a-f]*.woff2'))))
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


ENTETE = '<!-- EduPlateforme — logo. Arc brisé outrepassé, escalier de trois plateaux. Généré par src/logo.py. -->\n'


def ecrire():
    g = geometrie()
    W, H = n(g['largeur']), g['hauteur']
    LOGO.mkdir(parents=True, exist_ok=True)

    (LOGO / 'marque.svg').write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="EduPlateforme">\n'
        + ENTETE + marque(g) + '\n</svg>\n', encoding='utf-8')

    # Une couleur (currentColor) : le cadre et l'escalier, séparés par le jeu.
    (LOGO / 'silhouette.svg').write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="EduPlateforme">\n'
        + ENTETE + marque(g, 'currentColor', 'currentColor') + '\n</svg>\n', encoding='utf-8')

    # L'icône d'application : fond vert profond, porte sable, escalier terre cuite ;
    # la marque tient dans les 62 % centraux (zone sûre des icônes adaptatives).
    k = 600 / H
    dx, dy = (1024 - g['largeur'] * k) / 2, (1024 - 600) / 2 + 14
    (LOGO / 'icone-app.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="EduPlateforme">\n'
        + ENTETE + f'<rect width="1024" height="1024" fill="{VERT}"/>'
        + f'<g transform="translate({n(dx)} {n(dy)}) scale({k:.4f})">{marque(g, SABLE, TERRE)}</g>\n</svg>\n',
        encoding='utf-8')

    try:
        trace, largeur_mot, capitales = mot_vectorise('EduPlateforme', 100)
    except ImportError:
        print('⚠ fontTools absent : logo-horizontal.svg n’est pas réécrit (pip install fonttools brotli)')
    else:
        # La marque mesure 1,75 capitale et repose sur la ligne de base ; l'espace
        # entre la marque et le mot vaut 0,55 capitale.
        hm = capitales * 1.75
        km = hm / H
        ecart = capitales * 0.55
        total = g['largeur'] * km + ecart + largeur_mot
        haut, bas = hm + 4, 26
        (LOGO / 'logo-horizontal.svg').write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {n(-haut)} {n(total)} {n(haut + bas)}" role="img" aria-label="EduPlateforme">\n'
            + ENTETE
            + f'<g transform="translate(0 {n(-hm)}) scale({km:.4f})">{marque(g)}</g>'
            + f'<path fill="{ENCRE}" transform="translate({n(g["largeur"] * km + ecart)} 0)" d="{trace}"/>\n</svg>\n',
            encoding='utf-8')

    print(f'assets/logo : marque, silhouette, icône, logo horizontal — viewBox 0 0 {W} {H}')
    print('Tracés à recopier dans src/gabarit.html :')
    print(f'  cadre   : {g["cadre"]}')
    print(f'  marches : {g["marches"]}')
    return g


if __name__ == '__main__':
    sys.exit(0 if ecrire() else 1)
