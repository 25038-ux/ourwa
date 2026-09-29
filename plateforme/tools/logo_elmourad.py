#!/usr/bin/env python3
"""
LE LOGO D'EL MOURAD — et tout ce qui en découle, d'une seule source.

    pip install fonttools uharfbuzz cairosvg pillow
    python3 tools/logo_elmourad.py

L'IDÉE. « المراد », c'est le but visé, ce vers quoi l'on tend. Le signe est une
porte en arc — celle des ksour de Chinguetti et d'Ouadane, et celle de l'école —
ouverte sur un soleil levant ; du seuil montent trois gradins, les trois cycles
qu'on gravit pour l'atteindre. Trois couleurs, franches, sans dégradé ni effet :
le vert-bleu profond du mur, le sable de la baie, l'ocre du soleil. Les gradins
sont symétriques : le signe se lit aussi bien de droite à gauche que de gauche à
droite, comme l'école parle les deux langues.

Les lettres : Marcellus (capitales d'inscription, taillées comme dans la pierre)
pour « EL MOURAD », Amiri (naskh classique) pour « المراد » ; toutes deux sous
licence OFL, copiées dans tools/polices/. Dans les SVG, le texte est vectorisé :
le logo s'affiche pareil partout, sans police installée.

Écrit :
  deploy/brands/elmourad/logo/   marque.svg, logo-horizontal.svg, logo-vertical.svg (+ PNG)
  apps/mobile/android/app/src/brands/elmourad/res/   icônes Android (classique,
                                 adaptative, monochrome pour les thèmes d'Android 13)
  apps/mobile/ios/brands/elmourad/AppIcon.appiconset/   icônes iOS (sans alpha)
  docs/store/elmourad/           icone-512.png et graphique-1024x500.png (Play Store)
"""
from __future__ import annotations

import io
import json
import shutil
from pathlib import Path

import cairosvg
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageChops

RACINE = Path(__file__).resolve().parent.parent
POLICES = RACINE / "tools" / "polices"
LATINE = POLICES / "Marcellus-Regular.ttf"
ARABE = POLICES / "Amiri-Bold.ttf"

MUR = "#0F4C5C"     # vert-bleu profond — le mur, le fond
SABLE = "#F1E2C4"   # la baie ouverte
OCRE = "#E0962A"    # le soleil

# ── Le signe, sur un carré de 1000 ───────────────────────────────────────────
# La baie : 440 de large, arc en plein cintre (rayon 220, centre 500/430),
# seuil à 790. Les gradins : 340, 220, 100 de large, posés sur le seuil. Le
# soleil : concentrique à l'arc, rayon 72.
BAIE = "M280 790 L280 430 A220 220 0 0 1 720 430 L720 790 Z"
GRADINS = "M330 790 L330 700 L390 700 L390 615 L450 615 L450 535 L550 535 L550 615 L610 615 L610 700 L670 700 L670 790 Z"
SOLEIL = (500, 430, 72)


def signe(fond: bool, arrondi: float = 0.0, echelle: float = 1.0) -> str:
    """Le signe en éléments SVG sur 1000×1000 : avec ou sans le mur autour."""
    s = []
    if fond:
        s.append(f'<rect width="1000" height="1000" rx="{arrondi}" fill="{MUR}"/>')
    t = f' transform="translate({500 - 500 * echelle} {500 - 500 * echelle}) scale({echelle})"' if echelle != 1 else ""
    x, y, r = SOLEIL
    s.append(
        f"<g{t}>"
        f'<path d="{BAIE}" fill="{SABLE}"/>'
        f'<path d="{GRADINS}" fill="{MUR}"/>'
        f'<circle cx="{x}" cy="{y}" r="{r}" fill="{OCRE}"/>'
        "</g>"
    )
    return "".join(s)


def monochrome(cote: int, echelle: float = 0.80) -> Image.Image:
    """La silhouette pour les icônes à thème (Android 13) : la baie évidée des
    gradins et d'un anneau autour du soleil — le système la teint d'une seule
    couleur. Composée par couches (les masques SVG ne sont pas rendus partout)."""
    t = f"translate({500 - 500 * echelle} {500 - 500 * echelle}) scale({echelle})"
    x, y, r = SOLEIL

    def couche(element: str) -> Image.Image:
        return png(svg(1000, 1000, f'<g transform="{t}">{element}</g>'), cote).getchannel("A")

    a = ImageChops.subtract(couche(f'<path d="{BAIE}" fill="white"/>'), couche(f'<path d="{GRADINS}" fill="white"/>'))
    a = ImageChops.subtract(a, couche(f'<circle cx="{x}" cy="{y}" r="{r + 26}" fill="white"/>'))
    a = ImageChops.lighter(a, couche(f'<circle cx="{x}" cy="{y}" r="{r}" fill="white"/>'))
    im = Image.new("RGBA", (cote, cote), (255, 255, 255, 0))
    im.putalpha(a)
    return im


def svg(largeur: float, hauteur: float, corps: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {largeur:g} {hauteur:g}" '
        f'width="{largeur:g}" height="{hauteur:g}">{corps}</svg>'
    )


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
    lat, chasse = texte(LATINE, "EL MOURAD", 96, x, 122, MUR, interlettre=0.07)
    ara, _ = texte(ARABE, "المراد", 104, x + chasse, 222, MUR, ancre="fin")
    return svg(x + chasse + 8, h, tuile + lat + ara)


def logo_vertical() -> str:
    w = 1000
    tuile = f'<g transform="translate(320 40) scale(0.36)">{signe(True, arrondi=216)}</g>'
    lat, _ = texte(LATINE, "EL MOURAD", 118, w / 2, 560, MUR, interlettre=0.08, ancre="milieu")
    ara, _ = texte(ARABE, "المراد", 132, w / 2, 700, MUR, ancre="milieu")
    desc, dl = texte(LATINE, "COMPLEXE ÉCOLES PRIVÉES", 34, w / 2, 790, MUR, interlettre=0.22, ancre="milieu")
    filets = (
        f'<rect x="{w / 2 - dl / 2 - 70}" y="776" width="44" height="3" fill="{OCRE}"/>'
        f'<rect x="{w / 2 + dl / 2 + 26}" y="776" width="44" height="3" fill="{OCRE}"/>'
    )
    return svg(w, 830, tuile + lat + ara + desc + filets)


def graphique_play() -> str:
    w, h = 1024, 500
    corps = [f'<rect width="{w}" height="{h}" fill="{MUR}"/>']
    corps.append(f'<g transform="translate(40 -10) scale(0.52)">{signe(False)}</g>')
    x = 470
    lat, chasse = texte(LATINE, "EL MOURAD", 80, x, 196, SABLE, interlettre=0.07)
    ara, _ = texte(ARABE, "المراد", 88, x + chasse, 292, SABLE, ancre="fin")
    corps += [lat, ara, f'<rect x="{x}" y="332" width="{chasse}" height="3" fill="{OCRE}"/>']
    esp, _ = texte(LATINE, "ESPACE PARENTS", 28, x, 382, SABLE, interlettre=0.16)
    ar2, _ = texte(ARABE, "فضاء الأولياء", 34, x + chasse, 384, SABLE, ancre="fin")
    corps += [esp, ar2]
    return svg(w, h, "".join(corps))


def png(source: str, largeur: int, hauteur: int | None = None, alpha: bool = True) -> Image.Image:
    im = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=source.encode(), output_width=largeur,
                                                  output_height=hauteur))).convert("RGBA")
    return im if alpha else im.convert("RGB")


def main() -> None:
    # 1. Les fichiers du logo — pour le site, les documents, l'enseigne.
    logo = RACINE / "deploy/brands/elmourad/logo"
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

    # 2. Android : classique (carré arrondi), adaptative (mur + baie dans la zone
    #    sûre de 66 dp sur 108) et monochrome (icônes à thème d'Android 13).
    res = RACINE / "apps/mobile/android/app/src/brands/elmourad/res"
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
        '<?xml version="1.0" encoding="utf-8"?>\n<!-- Le mur du logo El Mourad (tools/logo_elmourad.py). -->\n'
        f'<resources>\n    <color name="ic_launcher_background">{MUR}</color>\n</resources>\n', encoding="utf-8")
    (res / "mipmap-anydpi-v26").mkdir()
    (res / "mipmap-anydpi-v26" / "ic_launcher.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<!-- Icône adaptative El Mourad (Android 8+) ; `monochrome` sert les icônes à thème (Android 13+). -->\n"
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n'
        "</adaptive-icon>\n", encoding="utf-8")

    # 3. iOS : carrés pleins, SANS alpha (iOS applique son propre masque).
    modele = RACINE / "apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json"
    ios = RACINE / "apps/mobile/ios/brands/elmourad/AppIcon.appiconset"
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
    magasin = RACINE / "docs/store/elmourad"
    magasin.mkdir(parents=True, exist_ok=True)
    png(plein, 512).save(magasin / "icone-512.png", optimize=True)
    png(graphique_play(), 1024, 500, alpha=False).save(magasin / "graphique-1024x500.png", optimize=True)
    print("✓ logo, icônes Android/iOS et visuels Play Store d'El Mourad écrits")


if __name__ == "__main__":
    main()
