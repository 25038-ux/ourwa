# python3 polices.py OUTDIR  — fetch Google Fonts CSS (woff2) and self-host the files.
#
# Two finishing steps need fontTools and brotli (`pip install fonttools brotli`):
#
#  * Amiri is cut down to the Arabic letters, harakat, digits and punctuation the
#    site writes (≈ 43 Ko per weight instead of ≈ 100 Ko); its unicode-range is
#    narrowed to match, so any other character falls back to the next font.
#  * Bodoni Moda at optical size 96 draws the hyphen and dashes as an invisible
#    hairline ("quelques-uns" reads "quelques uns"). Those three signs come from
#    optical size 6, weight 700, served through an extra unicode-range face.
import hashlib, io, re, sys, urllib.request
from pathlib import Path
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
FAMILLES = [
    ('bodoni-moda', 'Bodoni+Moda:ital,opsz,wght@0,96,500;1,96,500', {'latin', 'latin-ext'}),
    ('jost', 'Jost:wght@300..600', {'latin', 'latin-ext'}),
    ('amiri', 'Amiri:wght@400;700', {'arabic'}),
    ('tajawal', 'Tajawal:wght@400;500;700', {'arabic'}),
]
# Ce que le site écrit en arabe (vérifié contre src/textes/ar.json) : lettres, harakat,
# tatweel, chiffres arabes, ponctuation arabe, ZWNJ/ZWJ et marques de direction.
AMIRI_GARDE = ('U+060C, U+061B, U+061F, U+0621-063A, U+0640-0652, U+0660-066D, U+0670-0671, '
               'U+067E, U+0686, U+06A4, U+06A9, U+06AF, U+06CC, U+06D4, U+200C-200F, U+FD3E-FD3F')
TIRETS = 'U+002D, U+2013-2014'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    return urllib.request.urlopen(req, timeout=60).read()


def sous_ensemble(data, unicodes):
    from fontTools import subset
    from fontTools.ttLib import TTFont
    police = TTFont(io.BytesIO(data))
    options = subset.Options()
    options.layout_features = ['*']
    options.flavor = 'woff2'
    s = subset.Subsetter(options)
    s.populate(unicodes=subset.parse_unicodes(unicodes.replace(' ', '')))
    s.subset(police)
    sortie = io.BytesIO()
    police.flavor = 'woff2'
    police.save(sortie)
    return sortie.getvalue()


def ecrire(nom, subset, data):
    h = hashlib.sha1(data).hexdigest()[:6]
    fichier = f'{nom}-{subset}-{h}.woff2'
    (OUT / fichier).write_bytes(data)
    print(f'{fichier:60} {len(data)//1024:4} Ko')
    return fichier


css_out = ['/* Polices auto-hébergées (Google Fonts, SIL OFL 1.1) : Bodoni Moda, Jost, Amiri, Tajawal. Générées par polices.py. */']
vus = {}
for nom, q, subsets in FAMILLES:
    css = get(f'https://fonts.googleapis.com/css2?family={q}&display=swap').decode()
    for m in re.finditer(r'/\* ([\w-]+) \*/\s*(@font-face \{.*?\})', css, re.S):
        subset, bloc = m.group(1), m.group(2)
        if subset not in subsets: continue
        mu = re.search(r'url\((https://[^)]+)\)', bloc)
        if not mu: print('NO URL', nom, subset, bloc[:300]); continue
        url = mu.group(1)
        data = get(url); h = hashlib.sha1(data).hexdigest()[:6]
        poids = re.search(r'font-weight: ([\d ]+);', bloc).group(1).replace(' ', '-')
        cle = (nom, subset, h)
        if cle in vus:
            vus[cle][1].append(poids); continue
        if nom == 'amiri':
            data = sous_ensemble(data, AMIRI_GARDE)
            bloc = re.sub(r'unicode-range: [^;]+;', f'unicode-range: {AMIRI_GARDE};', bloc)
        fichier = ecrire(nom, subset, data)
        vus[cle] = [len(css_out), [poids], bloc.replace(url, fichier), nom, subset]
        css_out.append(None)
for i, poids, bloc, nom, subset in vus.values():
    ws = sorted({int(x) for p in poids for x in p.split('-')})
    w = str(ws[0]) if len(ws) == 1 else f'{ws[0]} {ws[-1]}'
    bloc = re.sub(r'font-weight: [\d ]+;', f'font-weight: {w};', bloc)
    css_out[i] = f'/* {nom} — {subset} */\n' + bloc

# Les tirets de Bodoni Moda, pris à la taille optique 6 (voir l'en-tête).
css = get('https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6,700;1,6,700&display=swap').decode()
for m in re.finditer(r'/\* latin \*/\s*(@font-face \{.*?\})', css, re.S):
    style = re.search(r'font-style: (\w+);', m.group(1)).group(1)
    data = sous_ensemble(get(re.search(r'url\((https://[^)]+)\)', m.group(1)).group(1)), TIRETS)
    fichier = ecrire('bodoni-moda-tirets', style, data)
    css_out.append(
        f"/* bodoni-moda — tirets ({style}) : à la taille optique 96, le trait d'union et les tirets\n"
        "   ne sont qu'un filet invisible ; ces trois signes viennent de la taille 6, plus épaisse. */\n"
        "@font-face {\n  font-family: 'Bodoni Moda';\n"
        f"  font-style: {style};\n  font-weight: 500;\n  font-display: swap;\n"
        f"  src: url({fichier}) format('woff2');\n  unicode-range: {TIRETS};\n}}")
(OUT / 'polices.css').write_text('\n'.join(css_out) + '\n')
