#!/usr/bin/env python3
"""
LE LOGO DE JINAN — et tout ce qui en découle, d'une seule source.

    pip install fonttools uharfbuzz resvg-py pillow
    python tools/logo_jinan.py

L'IDÉE. « جنان », ce sont les jardins — ceux d'en haut, d'où le nom de
l'établissement, Heavenly. Le signe est un jeune arbre de cinq feuilles qui
pousse d'un livre ouvert : l'enfant grandit de ce qu'il apprend. La feuille du
milieu est d'or, la plus haute, celle qui touche le ciel. Trois couleurs,
franches, sans dégradé : l'émeraude du fond, la crème des pages et du tronc, le
vert tendre des feuilles — et l'or. Le signe est symétrique : il se lit de
droite à gauche comme de gauche à droite, comme l'école parle les deux langues.

Les lettres : Marcellus pour « JINAN », Amiri pour « جنان » (tools/polices/,
licence OFL) — les mêmes qu'El Mourad. Dans les SVG, le texte est vectorisé.

Le rendu passe par resvg (resvg-py) et non cairosvg : pas de bibliothèque Cairo
à installer sous Windows.

Écrit :
  deploy/brands/jinan/logo/        marque.svg, logo-horizontal.svg, logo-vertical.svg (+ PNG)
  apps/mobile/android/app/src/brands/jinan/res/   icônes Android (classique,
                                   adaptative, monochrome d'Android 13)
  apps/mobile/ios/brands/jinan/AppIcon.appiconset/   icônes iOS (sans alpha)
  docs/store/jinan/                icone-512.png et graphique-1024x500.png (Play Store)
"""
from __future__ import annotations

import io
import json
import shutil
from pathlib import Path

import resvg_py
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

RACINE = Path(__file__).resolve().parent.parent
POLICES = RACINE / "tools" / "polices"
LATINE = POLICES / "Marcellus-Regular.ttf"
ARABE = POLICES / "Amiri-Bold.ttf"

EMERAUDE = "#0E5A48"  # le fond
CREME = "#FBF3E2"     # les pages, le tronc
FEUILLE = "#8FD0A0"   # les feuilles
OR = "#E3B04B"        # la feuille du milieu

# ── Le signe, sur un carré de 1000 ───────────────────────────────────────────
# Le livre : deux pages qui s'ouvrent vers le haut, reliure au centre (500).
PAGES = (
    "M500 800 C430 758 334 748 232 770 L232 650 C334 628 430 638 500 680 Z "
    "M500 800 C570 758 666 748 768 770 L768 650 C666 628 570 638 500 680 Z"
)
# Le tronc, légèrement effilé, du pli du livre à la feuille du sommet.
TRONC = "M484 690 L494 360 L506 360 L516 690 Z"


def feuille(bx: float, by: float, longueur: float, largeur: float) -> str:
    """Une feuille : deux arcs, de sa base (bx, by) vers le haut, longueur l."""
    h = by - longueur
    return (
        f"M{bx} {by} C{bx - largeur} {by - longueur * 0.30} {bx - largeur} {h + longueur * 0.32} {bx} {h} "
        f"C{bx + largeur} {h + longueur * 0.32} {bx + largeur} {by - longueur * 0.30} {bx} {by} Z"
    )


# (hauteur d'attache sur le tronc, angle en degrés, longueur, demi-largeur, couleur) :
# deux feuilles basses, deux moyennes, la feuille d'or au sommet.
FEUILLES = [
    (590, -72, 150, 50, FEUILLE), (590, 72, 150, 50, FEUILLE),
    (480, -46, 185, 60, FEUILLE), (480, 46, 185, 60, FEUILLE),
    (372, 0, 210, 68, OR),
]


def arbre(couleur_unique: str | None = None) -> str:
    out = [f'<path d="{TRONC}" fill="{couleur_unique or CREME}"/>']
    for by, angle, l, w, c in FEUILLES:
        out.append(f'<path transform="rotate({angle} 500 {by})" d="{feuille(500, by, l, w)}" fill="{couleur_unique or c}"/>')
    out.append(f'<path d="{PAGES}" fill="{couleur_unique or CREME}"/>')
    return "".join(out)


def signe(fond: bool, arrondi: float = 0.0, echelle: float = 1.0) -> str:
    """Le signe en éléments SVG sur 1000×1000 : avec ou sans le fond émeraude."""
    s = []
    if fond:
        s.append(f'<rect width="1000" height="1000" rx="{arrondi}" fill="{EMERAUDE}"/>')
    t = f' transform="translate({500 - 500 * echelle} {500 - 500 * echelle}) scale({echelle})"' if echelle != 1 else ""
    s.append(f"<g{t}>{arbre()}</g>")
    return "".join(s)


def svg(largeur: float, hauteur: float, corps: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {largeur:g} {hauteur:g}" '
        f'width="{largeur:g}" height="{hauteur:g}">{corps}</svg>'
    )


def png(source: str, largeur: int, hauteur: int | None = None, alpha: bool = True) -> Image.Image:
    im = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_string=source, width=largeur, height=hauteur)))).convert("RGBA")
    if hauteur is not None and im.size != (largeur, hauteur):
        im = im.resize((largeur, hauteur), Image.LANCZOS)
    return im if alpha else im.convert("RGB")


def monochrome(cote: int, echelle: float = 0.80) -> Image.Image:
    """La silhouette pour les icônes à thème (Android 13) : l'arbre et le livre
    d'une seule couleur ; le système la teint."""
    t = f"translate({500 - 500 * echelle} {500 - 500 * echelle}) scale({echelle})"
    a = png(svg(1000, 1000, f'<g transform="{t}">{arbre("white")}</g>'), cote).getchannel("A")
    im = Image.new("RGBA", (cote, cote), (255, 255, 255, 0))
    im.putalpha(a)
    return im


# ── Le texte, vectorisé (HarfBuzz pour la mise en forme, arabe compris) ──────
_polices: dict[Path, tuple] = {}


def ligne(police: Path, texte: str, taille: float, interlettre: float = 0.0) -> tuple[str, float]:
    """Le chemin SVG d'une ligne posée à l'origine (ligne de base y=0) et sa chasse."""
    if police not in _polices:
        face = hb.Face(hb.Blob.from_file_path(str(police)))
        tt = TTFont(str(police))
        _polices[police] = (hb.Font(face), face.upem, tt.getGlyphSet(), tt.getGlyphOrder())
    font, upem, glyphes, ordre = _polices[police]
    tampon = hb.Buffer()
    tampon.add_str(texte)
    tampon.guess_segment_properties()
    hb.shape(font, tampon, {"kern": True, "liga": True})
    k = taille / upem
    stylo = SVGPathPen(glyphes)
    x = 0.0
    n = len(tampon.glyph_infos)
    for i, (info, pos) in enumerate(zip(tampon.glyph_infos, tampon.glyph_positions)):
        glyphes[ordre[info.codepoint]].draw(
            TransformPen(stylo, (k, 0, 0, -k, (x + pos.x_offset) * k, -pos.y_offset * k))
        )
        x += pos.x_advance + (interlettre * upem if i < n - 1 else 0)
    return stylo.getCommands(), x * k


def texte(police: Path, chaine: str, taille: float, x: float, y: float, couleur: str,
          interlettre: float = 0.0, ancre: str = "debut") -> tuple[str, float]:
    d, chasse = ligne(police, chaine, taille, interlettre)
    x0 = {"debut": x, "milieu": x - chasse / 2, "fin": x - chasse}[ancre]
    return f'<path transform="translate({x0:.2f} {y:.2f})" d="{d}" fill="{couleur}"/>', chasse


# ── Les compositions ─────────────────────────────────────────────────────────
def logo_horizontal() -> str:
    h = 240
    tuile = f'<g transform="scale({h / 1000})">{signe(True, arrondi=216)}</g>'
    x = h + 52
    lat, chasse = texte(LATINE, "JINAN", 104, x, 124, EMERAUDE, interlettre=0.10)
    ara, _ = texte(ARABE, "جنان", 104, x + chasse, 222, EMERAUDE, ancre="fin")
    return svg(x + chasse + 8, h, tuile + lat + ara)


def logo_vertical() -> str:
    w = 1000
    tuile = f'<g transform="translate(320 40) scale(0.36)">{signe(True, arrondi=216)}</g>'
    lat, _ = texte(LATINE, "JINAN", 128, w / 2, 562, EMERAUDE, interlettre=0.12, ancre="milieu")
    ara, _ = texte(ARABE, "جنان", 132, w / 2, 702, EMERAUDE, ancre="milieu")
    desc, dl = texte(LATINE, "HEAVENLY PRIVATE EDUCATIONAL INSTITUTION", 26, w / 2, 790, EMERAUDE,
                     interlettre=0.16, ancre="milieu")
    filets = (
        f'<rect x="{w / 2 - dl / 2 - 64}" y="780" width="40" height="3" fill="{OR}"/>'
        f'<rect x="{w / 2 + dl / 2 + 24}" y="780" width="40" height="3" fill="{OR}"/>'
    )
    return svg(w, 830, tuile + lat + ara + desc + filets)


def graphique_play() -> str:
    w, h = 1024, 500
    corps = [f'<rect width="{w}" height="{h}" fill="{EMERAUDE}"/>']
    corps.append(f'<g transform="translate(40 -10) scale(0.52)">{signe(False)}</g>')
    x = 480
    lat, chasse = texte(LATINE, "JINAN", 96, x, 176, CREME, interlettre=0.10)
    ara, _ = texte(ARABE, "جنان", 88, x, 270, CREME)
    esp, le = texte(LATINE, "ESPACE PARENTS", 28, x, 354, CREME, interlettre=0.16)
    ar2, _ = texte(ARABE, "فضاء الأولياء", 34, x, 412, CREME)
    largeur = max(chasse, le)
    corps += [lat, ara, f'<rect x="{x}" y="304" width="{largeur}" height="3" fill="{OR}"/>', esp, ar2]
    return svg(w, h, "".join(corps))


def main() -> None:
    # 1. Les fichiers du logo — pour le site, les documents, l'enseigne.
    logo = RACINE / "deploy/brands/jinan/logo"
    logo.mkdir(parents=True, exist_ok=True)
    fichiers = {
        "marque.svg": svg(1000, 1000, signe(True, arrondi=216)),
        "logo-horizontal.svg": logo_horizontal(),
        "logo-vertical.svg": logo_vertical(),
    }
    for nom, contenu in fichiers.items():
        (logo / nom).write_text(contenu, encoding="utf-8")
    png(fichiers["marque.svg"], 1024).save(logo / "marque-1024.png", optimize=True)
    png(fichiers["logo-horizontal.svg"], 2000).save(logo / "logo-horizontal.png", optimize=True)
    png(fichiers["logo-vertical.svg"], 1600).save(logo / "logo-vertical.png", optimize=True)

    # 2. Android : classique (carré arrondi), adaptative (fond + arbre dans la
    #    zone sûre de 66 dp sur 108) et monochrome (icônes à thème d'Android 13).
    res = RACINE / "apps/mobile/android/app/src/brands/jinan/res"
    if res.exists():
        shutil.rmtree(res)
    classique = svg(1000, 1000, f'<g transform="translate(42 42) scale(0.916)">{signe(True, arrondi=190)}</g>')
    avant = svg(1000, 1000, signe(False, echelle=0.80))
    for densite, f in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
        d = res / f"mipmap-{densite}"
        d.mkdir(parents=True)
        png(classique, round(48 * f)).save(d / "ic_launcher.png", optimize=True)
        png(avant, round(108 * f)).save(d / "ic_launcher_foreground.png", optimize=True)
        monochrome(round(108 * f)).save(d / "ic_launcher_monochrome.png", optimize=True)
    (res / "values").mkdir()
    (res / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<!-- Le fond émeraude du logo Jinan (tools/logo_jinan.py). -->\n'
        f'<resources>\n    <color name="ic_launcher_background">{EMERAUDE}</color>\n</resources>\n', encoding="utf-8")
    (res / "mipmap-anydpi-v26").mkdir()
    (res / "mipmap-anydpi-v26" / "ic_launcher.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<!-- Icône adaptative Jinan (Android 8+) ; `monochrome` sert les icônes à thème (Android 13+). -->\n"
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n'
        "</adaptive-icon>\n", encoding="utf-8")

    # 3. iOS : carrés pleins, SANS alpha (iOS applique son propre masque).
    modele = RACINE / "apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json"
    if modele.exists():
        ios = RACINE / "apps/mobile/ios/brands/jinan/AppIcon.appiconset"
        if ios.exists():
            shutil.rmtree(ios)
        ios.mkdir(parents=True)
        shutil.copy(modele, ios / "Contents.json")
        plein = svg(1000, 1000, signe(True))
        for image in json.loads(modele.read_text(encoding="utf-8"))["images"]:
            if "filename" in image:
                cote = round(float(image["size"].split("x")[0]) * int(image["scale"].rstrip("x")))
                png(plein, cote, alpha=False).save(ios / image["filename"], optimize=True)

    # 4. La fiche Play Store.
    magasin = RACINE / "docs/store/jinan"
    magasin.mkdir(parents=True, exist_ok=True)
    png(svg(1000, 1000, signe(True)), 512).save(magasin / "icone-512.png", optimize=True)
    png(graphique_play(), 1024, 500, alpha=False).save(magasin / "graphique-1024x500.png", optimize=True)
    print("✓ logo, icônes Android/iOS et visuels Play Store de Jinan écrits")


if __name__ == "__main__":
    main()
