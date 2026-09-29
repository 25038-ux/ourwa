#!/usr/bin/env python3
"""
LES ICÔNES D'UNE ENSEIGNE — Android, iOS et fiche Play Store, d'un seul geste.

    python3 tools/icones.py --marque elmourad --monogramme EM
    python3 tools/icones.py --marque elmourad --logo chemin/vers/logo.png

⚠ POURQUOI. Les mipmaps de src/main sont communes à toutes les enseignes, et
c'était le logo de Flutter : l'application « El Mourad » se présentait sous le
logo d'une marque de Google. Ce script écrit les icônes de l'enseigne là où
app/build.gradle les prend (src/brands/<marque>/res, prioritaire sur main) :

  apps/mobile/android/app/src/brands/<marque>/res/
      mipmap-*/ic_launcher.png              icône classique (Android 7 et avant)
      mipmap-*/ic_launcher_foreground.png   premier plan de l'icône adaptative
      mipmap-anydpi-v26/ic_launcher.xml     icône adaptative (+ thème Android 13)
      drawable/ic_launcher_background.xml   son fond, un dégradé
  apps/mobile/ios/brands/<marque>/AppIcon.appiconset/   (copié par packager.sh ios)
  docs/store/<marque>/icone-512.png                      icône de la fiche Play
  docs/store/<marque>/graphique-1024x500.png             « feature graphic » Play

Avec --logo : une image carrée, fond transparent de préférence, 1024 px ou plus.
Le logo est posé dans la zone sûre des icônes adaptatives (le centre, 60 %).
Il faut Pillow (pip install pillow) ; l'arabe du graphique demande Pillow avec
libraqm (c'est le cas des roues officielles récentes).
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, features

RACINE = Path(__file__).resolve().parent.parent
POLICE_LATINE = [
    "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
POLICE_LATINE_FINE = [
    "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
POLICE_ARABE = RACINE / "apps/mobile/assets/fonts/NotoSansArabic.ttf"
DENSITES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def police(chemins: list[str], taille: int) -> ImageFont.FreeTypeFont:
    for c in chemins:
        if Path(c).exists():
            return ImageFont.truetype(c, taille)
    return ImageFont.load_default(taille)


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def degrade(taille: tuple[int, int], c1: str, c2: str) -> Image.Image:
    """Un dégradé diagonal, haut-gauche → bas-droite."""
    w, h = taille
    a, b = hex_rgb(c1), hex_rgb(c2)
    petit = Image.new("RGB", (64, 64))
    px = petit.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return petit.resize((w, h), Image.BICUBIC)


def glyphe(texte: str | None, logo: Path | None, cote: int, part: float) -> Image.Image:
    """Le signe de l'enseigne, blanc (monogramme) ou logo, centré dans `part` du côté."""
    toile = Image.new("RGBA", (cote, cote), (0, 0, 0, 0))
    boite = int(cote * part)
    if logo is not None:
        im = Image.open(logo).convert("RGBA")
        im.thumbnail((boite, boite), Image.LANCZOS)
        toile.alpha_composite(im, ((cote - im.width) // 2, (cote - im.height) // 2))
        return toile
    assert texte
    taille = boite
    while taille > 8:
        f = police(POLICE_LATINE, taille)
        g, h_, d, b = ImageDraw.Draw(toile).textbbox((0, 0), texte, font=f)
        if d - g <= boite and b - h_ <= boite * 0.72:
            break
        taille -= 2
    dessin = ImageDraw.Draw(toile)
    g, h_, d, b = dessin.textbbox((0, 0), texte, font=f)
    dessin.text(((cote - (d - g)) / 2 - g, (cote - (b - h_)) / 2 - h_), texte, font=f, fill=(255, 255, 255, 255))
    return toile


def carre_arrondi(cote: int, rayon: float) -> Image.Image:
    masque = Image.new("L", (cote * 4, cote * 4), 0)
    ImageDraw.Draw(masque).rounded_rectangle((0, 0, cote * 4 - 1, cote * 4 - 1), radius=rayon * 4, fill=255)
    return masque.resize((cote, cote), Image.LANCZOS)


def icone_pleine(cote: int, args, arrondi: bool, alpha: bool = True) -> Image.Image:
    fond = degrade((cote, cote), args.couleur1, args.couleur2).convert("RGBA")
    fond.alpha_composite(glyphe(args.monogramme, args.logo, cote, 0.62))
    if arrondi:
        fond.putalpha(carre_arrondi(cote, cote * 0.22))
    return fond if alpha else fond.convert("RGB")


def android(args, res: Path) -> None:
    for nom, f in DENSITES.items():
        d = res / f"mipmap-{nom}"
        d.mkdir(parents=True, exist_ok=True)
        # Classique : carré arrondi, 48 dp avec une marge de 2 dp.
        c = round(48 * f)
        im = Image.new("RGBA", (c, c), (0, 0, 0, 0))
        m = round(2 * f)
        im.alpha_composite(icone_pleine(c - 2 * m, args, arrondi=True), (m, m))
        im.save(d / "ic_launcher.png", optimize=True)
        # Adaptatif : 108 dp, le signe dans la zone sûre (66 dp au centre).
        c = round(108 * f)
        glyphe(args.monogramme, args.logo, c, 0.56).save(d / "ic_launcher_foreground.png", optimize=True)
    (res / "drawable").mkdir(parents=True, exist_ok=True)
    (res / "drawable" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<!-- Fond de l'icône adaptative de l'enseigne (tools/icones.py). -->\n"
        '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n'
        f'    <gradient android:angle="315" android:startColor="{args.couleur1}" android:endColor="{args.couleur2}" />\n'
        "</shape>\n",
        encoding="utf-8",
    )
    (res / "mipmap-anydpi-v26").mkdir(parents=True, exist_ok=True)
    (res / "mipmap-anydpi-v26" / "ic_launcher.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<!-- Icône adaptative (Android 8+) ; `monochrome` sert les icônes à thème d'Android 13. -->\n"
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@drawable/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />\n'
        "</adaptive-icon>\n",
        encoding="utf-8",
    )


def ios(args, dest: Path) -> None:
    modele = RACINE / "apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json"
    contenu = json.loads(modele.read_text(encoding="utf-8"))
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy(modele, dest / "Contents.json")
    for image in contenu["images"]:
        if "filename" not in image:
            continue
        pt = float(image["size"].split("x")[0])
        echelle = int(image["scale"].rstrip("x"))
        # Apple : des carrés pleins, SANS canal alpha (le masque est appliqué par iOS).
        icone_pleine(round(pt * echelle), args, arrondi=False, alpha=False).save(dest / image["filename"], optimize=True)


def arabe(texte: str, taille: int) -> tuple[ImageFont.FreeTypeFont, dict]:
    f = ImageFont.truetype(str(POLICE_ARABE), taille, layout_engine=ImageFont.Layout.RAQM)
    return f, {"direction": "rtl", "language": "ar"}


def graphique(args, dest: Path) -> None:
    """Le « feature graphic » du Play Store : 1024 × 500, sans transparence."""
    w, h = 1024, 500
    im = degrade((w, h), args.couleur1, args.couleur2).convert("RGBA")
    # Le signe, à gauche, dans un carré arrondi blanc translucide.
    cote = 260
    carte = Image.new("RGBA", (cote, cote), (255, 255, 255, 38))
    carte.putalpha(Image.eval(carre_arrondi(cote, 58), lambda v: v * 38 // 255))
    im.alpha_composite(carte, (90, (h - cote) // 2))
    im.alpha_composite(glyphe(args.monogramme, args.logo, cote, 0.66), (90, (h - cote) // 2))
    d = ImageDraw.Draw(im)
    x = 90 + cote + 60
    d.text((x, 104), args.nom, font=police(POLICE_LATINE, 76), fill="white")
    if features.check("raqm") and POLICE_ARABE.exists():
        f, o = arabe(args.nom_ar, 64)
        d.text((x, 190), args.nom_ar, font=f, fill="white", **o)
        f2, o2 = arabe(args.slogan_ar, 30)
        d.text((x, 362), args.slogan_ar, font=f2, fill=(224, 247, 250), **o2)
    d.text((x, 314), args.slogan, font=police(POLICE_LATINE_FINE, 32), fill=(224, 247, 250))
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(dest, optimize=True)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--marque", required=True, help="le slug de l'enseigne (deploy/brands/<marque>.env)")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--logo", type=Path, help="le logo de l'école, carré, 1024 px ou plus")
    g.add_argument("--monogramme", help="deux ou trois lettres, en attendant le logo (ex. EM)")
    p.add_argument("--couleur1", default="#0891B2", help="haut du dégradé (Ocean 600 de l'application)")
    p.add_argument("--couleur2", default="#155E75", help="bas du dégradé (Ocean 800)")
    p.add_argument("--nom", default="El Mourad")
    p.add_argument("--nom-ar", dest="nom_ar", default="المراد")
    p.add_argument("--slogan", default="Espace parents")
    p.add_argument("--slogan-ar", dest="slogan_ar", default="فضاء الأولياء")
    args = p.parse_args()

    res = RACINE / f"apps/mobile/android/app/src/brands/{args.marque}/res"
    android(args, res)
    ios(args, RACINE / f"apps/mobile/ios/brands/{args.marque}/AppIcon.appiconset")
    magasin = RACINE / f"docs/store/{args.marque}"
    magasin.mkdir(parents=True, exist_ok=True)
    # L'icône de la fiche Play : 512 × 512, carré plein (le Play Store arrondit lui-même).
    icone_pleine(512, args, arrondi=False).save(magasin / "icone-512.png", optimize=True)
    graphique(args, magasin / "graphique-1024x500.png")
    print(f"✓ icônes « {args.marque} » : {res.relative_to(RACINE)}, apps/mobile/ios/brands/{args.marque}, docs/store/{args.marque}")


if __name__ == "__main__":
    main()
