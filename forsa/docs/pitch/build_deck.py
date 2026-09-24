"""Build the FORSA customer pitch deck (FR + EN) as 16:9 HTML slides, then render to PDF with render.mjs.

    python3 build_deck.py            # writes deck-fr.html and deck-en.html
    node render.mjs                  # writes presentation.pdf (FR) and presentation-en.pdf (EN)

Figures are real, read from the official sources on 2026-09-24 (see docs/research/source-registry.md).
Set CONTACT below (e.g. "contact@votre-domaine.mr · +222 …") before rendering to add a contact line.
"""

from __future__ import annotations

import html
from pathlib import Path

CONTACT = ""  # e.g. "contact@forsa.mr · +222 00 00 00 00"
HERE = Path(__file__).resolve().parent

STATS = {"records": "1 434", "awards": "859", "planned": "345", "buyers": "90+", "ocr": "67", "red": "11"}
STATS_EN = {"records": "1,434", "awards": "859", "planned": "345", "buyers": "90+", "ocr": "67", "red": "11"}

T = {
    "fr": {
        "lang": "fr",
        "cover_kicker": "Présentation client · Septembre 2026",
        "cover_title": "Trouvez les marchés publics que vous pouvez gagner.",
        "cover_sub": "FORSA surveille les sources officielles, lit les avis à votre place, vous dit ce qui vous "
        "correspond — et pourquoi. Conçu pour les entreprises mauritaniennes.",
        "pain_kicker": "Le constat",
        "pain_title": "Chaque année, des marchés vous échappent.",
        "pains": [
            ("Dispersés", "Portail national, bailleurs, Nations unies… des centaines d'avis, souvent en PDF scannés."),
            ("Trop tard", "On découvre l'appel d'offres à quelques jours de la date limite — ou jamais."),
            ("Rejetés", "Un dossier solide est écarté pour une seule attestation manquante ou expirée."),
            ("Au feeling", "On répond sans savoir si le marché correspond vraiment à nos capacités."),
        ],
        "sol_kicker": "La solution",
        "sol_title": "FORSA fait la veille, l'analyse et l'organisation. Vous gardez la décision.",
        "pillars": [
            ("Détecter", "Tous les avis et plans de passation officiels, surveillés jour et nuit."),
            ("Comprendre", "Exigences, pièces, délais et risques extraits — avec la citation de l'avis."),
            ("Décider", "Un score d'adéquation expliqué, et ce qu'il faut obtenir pour y aller."),
            ("Gagner", "Espace d'offre, tâches, rappels et approbations jusqu'à la soumission."),
        ],
        "how_kicker": "Comment ça marche",
        "how_title": "Opérationnel en une matinée.",
        "steps": [
            ("Décrivez votre entreprise", "En 2 minutes, à la voix ou par écrit, en français, arabe ou anglais. "
             "FORSA comprend vos métiers ; vous confirmez."),
            ("FORSA surveille pour vous", "Portail national des marchés publics, Banque mondiale, Nations unies… "
             "Même les avis scannés sont lus."),
            ("Recevez ce qui vous correspond", "Chaque matin, les opportunités à forte adéquation, les échéances et "
             "les pièces à préparer — avec la preuve."),
        ],
        "data_kicker": "Déjà branché sur les sources officielles",
        "data_title": "Des données réelles, pas des promesses.",
        "data": [
            ("records", "avis et lignes de plans de passation analysés"),
            ("awards", "attributions étudiées : qui gagne quoi, à quel prix"),
            ("planned", "achats publics annoncés dans les plans de passation"),
            ("buyers", "acheteurs publics suivis"),
        ],
        "data_sources": "Portail National des Marchés Publics (ARMP) · Banque mondiale (CC BY 4.0) · "
        "Nations unies — UNGM (sur accréditation)",
        "data_note": "Chiffres au 24 septembre 2026, lus sur les sources officielles.",
        "source_cards": [
            ("Portail National des Marchés Publics", "avis, plans de passation et liste rouge de l'ARMP — "
             "même les avis scannés sont lus."),
            ("Banque mondiale", "appels d'offres et attributions des projets financés en Mauritanie (CC BY 4.0)."),
            ("Nations unies — UNGM", "avis des agences onusiennes, via l'API officielle (sur accréditation)."),
        ],
        "brief_kicker": "Chaque matin",
        "brief_title": "Votre briefing : ce qui mérite votre attention aujourd'hui.",
        "brief_points": ["L'action prioritaire du jour", "Les échéances à moins de 7 jours",
                         "Les pièces à obtenir avant qu'il ne soit trop tard", "Les signaux précoces des plans de passation"],
        "why_kicker": "Transparence",
        "why_title": "Chaque recommandation est expliquée.",
        "why_points": [
            ("Score d'adéquation", "sur 100, calculé à partir de vos capacités et des exigences de l'avis — "
             "jamais présenté comme une probabilité de gain."),
            ("Les raisons", "ce qui joue pour vous, ce qui manque, ce qui est inconnu."),
            ("La preuve", "chaque exigence est citée depuis l'avis officiel, page à l'appui."),
            ("L'économie de l'offre", "effort, coût de réponse et contribution estimés, en fourchettes."),
        ],
        "why_note": "Exemple réel : une ligne du plan de passation publiée sur le portail national.",
        "market_kicker": "Veille concurrentielle",
        "market_title": "Voyez qui gagne, qui achète, ce qui arrive.",
        "market_points": [
            ("Concurrents", "marchés gagnés et perdus, montants, acheteurs servis."),
            ("Acheteurs", "les administrations et projets les plus actifs dans votre secteur."),
            ("À venir", "les achats prévus dans les 12 prochains mois, avant même l'appel d'offres."),
            ("Liste rouge", "vérifiez en une seconde qu'un partenaire n'est pas exclu des marchés publics."),
        ],
        "ai_kicker": "Assistant intelligent",
        "ai_title": "Posez vos questions. À la voix.",
        "ai_points": [
            "« Qui gagne les marchés de forage ? »  « Quelles échéances arrivent ? »",
            "Français, arabe, anglais — à l'écrit comme à l'oral",
            "Répond uniquement à partir de vos données et des sources officielles",
            "Propose des actions que vous validez : rien n'est fait sans vous",
        ],
        "flow_kicker": "Du repérage à la soumission",
        "flow_title": "Toute l'équipe, au même endroit.",
        "flow": [
            ("Espace d'offre", "décision soumissionner / ne pas soumissionner, tracée"),
            ("Matrice de conformité", "chaque exigence, son statut, sa réponse"),
            ("Tâches automatiques", "les conditions deviennent des tâches assignées"),
            ("Approbation à 4 yeux", "aucune soumission sans validation humaine"),
            ("Rappels J-7, J-3, J-1", "notifications instantanées, même sur mobile"),
            ("Calendrier & WhatsApp", "export Google / Outlook, partage en un geste"),
        ],
        "mobile_kicker": "Partout",
        "mobile_title": "Sur ordinateur, et dans votre poche.",
        "mobile_points": ["Application Android", "Application web installable sur iPhone",
                          "Notifications instantanées", "Tri rapide d'un glissement de doigt", "Mode sombre"],
        "trust_kicker": "Confiance",
        "trust_title": "Vos données restent les vôtres.",
        "trust": [
            ("Cloisonnement strict", "chaque entreprise est isolée au niveau de la base de données."),
            ("Hébergement maîtrisé", "sur votre serveur ou sur un serveur dédié, en HTTPS."),
            ("Vous décidez", "aucune soumission, aucun contact acheteur sans votre approbation."),
            ("IA encadrée", "optionnelle ; les informations confidentielles ne partent pas sans accord."),
            ("Sources citées", "chaque fait renvoie à l'avis officiel ; l'inconnu est affiché comme tel."),
            ("Liste rouge", "vérification des partenaires et sous-traitants intégrée."),
        ],
        "who_kicker": "Pour qui",
        "who_title": "Pour les entreprises qui répondent aux marchés publics et des bailleurs.",
        "who_sub": "Vous répondez déjà aux appels d'offres ? FORSA vous fait répondre plus souvent, aux bons marchés, "
        "avec des dossiers complets — et vous montre ceux que vous ne voyiez pas.",
        "who": ["BTP & travaux", "Énergie solaire & électricité", "Hydraulique & forages", "Informatique & télécoms",
                "Bureaux d'études & conseil", "Fournitures & équipements"],
        "start_kicker": "Démarrer",
        "start_title": "Parlons de vos prochains marchés.",
        "start_steps": [("Démo de 30 minutes", "sur vos propres métiers et vos régions"),
                        ("Mise en place accompagnée", "profil, attestations, alertes — en une matinée"),
                        ("Programme pilote", "vos premières opportunités qualifiées dès le premier jour")],
        "footer": "FORSA — intelligence commerciale fondée sur les preuves",
        "demo_note": "Captures d'écran : profil d'entreprise de démonstration ; opportunités et attributions réelles.",
    },
    "en": {
        "lang": "en",
        "cover_kicker": "Customer presentation · September 2026",
        "cover_title": "Find the public tenders you can win.",
        "cover_sub": "FORSA watches the official sources, reads the notices for you and tells you what fits — "
        "and why. Built for Mauritanian companies.",
        "pain_kicker": "The problem",
        "pain_title": "Every year, winnable contracts slip away.",
        "pains": [
            ("Scattered", "National portal, donors, United Nations… hundreds of notices, often scanned PDFs."),
            ("Too late", "You find the tender a few days before the deadline — or never."),
            ("Rejected", "A strong bid is excluded for one missing or expired certificate."),
            ("Gut feeling", "You bid without knowing whether the contract really fits your capacity."),
        ],
        "sol_kicker": "The solution",
        "sol_title": "FORSA does the watching, reading and organising. You keep the decision.",
        "pillars": [
            ("Detect", "Every official notice and procurement plan, watched day and night."),
            ("Understand", "Requirements, documents, deadlines and risks — quoted from the notice."),
            ("Decide", "An explained fit score, and what you need to obtain to go for it."),
            ("Win", "Bid workspace, tasks, reminders and approvals up to submission."),
        ],
        "how_kicker": "How it works",
        "how_title": "Up and running in a morning.",
        "steps": [
            ("Describe your company", "In 2 minutes, by voice or text, in French, Arabic or English. "
             "FORSA understands your trades; you confirm."),
            ("FORSA watches for you", "National procurement portal, World Bank, United Nations… "
             "Even scanned notices are read."),
            ("Get what fits you", "Every morning: high-fit opportunities, deadlines and documents to prepare — "
             "with the evidence."),
        ],
        "data_kicker": "Already connected to official sources",
        "data_title": "Real data, not promises.",
        "data": [
            ("records", "notices and procurement-plan lines analysed"),
            ("awards", "contract awards studied: who wins what, at what price"),
            ("planned", "public purchases announced in procurement plans"),
            ("buyers", "public buyers tracked"),
        ],
        "data_sources": "National Public Procurement Portal (ARMP) · World Bank (CC BY 4.0) · "
        "United Nations — UNGM (with accreditation)",
        "data_note": "Figures as of 24 September 2026, read from the official sources.",
        "source_cards": [
            ("National Public Procurement Portal", "ARMP notices, procurement plans and red list — even scanned "
             "notices are read."),
            ("World Bank", "tenders and contract awards of projects financed in Mauritania (CC BY 4.0)."),
            ("United Nations — UNGM", "UN agencies' notices through the official API (with accreditation)."),
        ],
        "brief_kicker": "Every morning",
        "brief_title": "Your briefing: what deserves your attention today.",
        "brief_points": ["Today's top action", "Deadlines within 7 days", "Documents to obtain before it is too late",
                         "Early signals from procurement plans"],
        "why_kicker": "Transparency",
        "why_title": "Every recommendation is explained.",
        "why_points": [
            ("Fit score", "out of 100, from your capabilities and the notice's requirements — never presented as a "
             "win probability."),
            ("The reasons", "what works for you, what is missing, what is unknown."),
            ("The evidence", "every requirement is quoted from the official notice, with its page."),
            ("Bid economics", "effort, cost to respond and expected contribution, as ranges."),
        ],
        "why_note": "Real example: a procurement-plan line published on the national portal.",
        "market_kicker": "Competitive intelligence",
        "market_title": "See who wins, who buys, what is coming.",
        "market_points": [
            ("Competitors", "contracts won and lost, amounts, buyers served."),
            ("Buyers", "the most active administrations and projects in your sector."),
            ("Pipeline", "purchases planned in the next 12 months, before the tender is out."),
            ("Red list", "check in a second that a partner is not excluded from public procurement."),
        ],
        "ai_kicker": "Intelligent assistant",
        "ai_title": "Ask your questions. By voice.",
        "ai_points": [
            "“Who wins borehole contracts?”  “Which deadlines are coming?”",
            "French, Arabic, English — typed or spoken",
            "Answers only from your data and the official sources",
            "Proposes actions you confirm: nothing happens without you",
        ],
        "flow_kicker": "From discovery to submission",
        "flow_title": "The whole team, in one place.",
        "flow": [
            ("Bid workspace", "bid / no-bid decision, recorded"),
            ("Compliance matrix", "every requirement, its status, its answer"),
            ("Automatic tasks", "conditions become assigned tasks"),
            ("Four-eyes approval", "no submission without human sign-off"),
            ("Reminders D-7, D-3, D-1", "instant notifications, on mobile too"),
            ("Calendar & WhatsApp", "Google / Outlook export, one-tap sharing"),
        ],
        "mobile_kicker": "Everywhere",
        "mobile_title": "On your computer, and in your pocket.",
        "mobile_points": ["Android app", "Installable web app on iPhone", "Instant notifications",
                          "Swipe-to-triage", "Dark mode"],
        "trust_kicker": "Trust",
        "trust_title": "Your data stays yours.",
        "trust": [
            ("Strict isolation", "each company is isolated at the database level."),
            ("Controlled hosting", "on your server or a dedicated server, over HTTPS."),
            ("You decide", "no submission, no buyer contact without your approval."),
            ("Governed AI", "optional; confidential information never leaves without consent."),
            ("Sources cited", "every fact links to the official notice; unknowns are shown as such."),
            ("Red list", "built-in checks on partners and subcontractors."),
        ],
        "who_kicker": "Who it is for",
        "who_title": "For companies bidding on public and donor-funded contracts.",
        "who_sub": "Already bidding? FORSA helps you bid more often, on the right contracts, with complete files — "
        "and shows you the ones you were missing.",
        "who": ["Construction & works", "Solar & electrical", "Water & boreholes", "IT & telecoms",
                "Engineering & consulting", "Supplies & equipment"],
        "start_kicker": "Get started",
        "start_title": "Let's talk about your next contracts.",
        "start_steps": [("30-minute demo", "on your own trades and regions"),
                        ("Guided set-up", "profile, certificates, alerts — in a morning"),
                        ("Pilot programme", "your first qualified opportunities from day one")],
        "footer": "FORSA — evidence-first commercial intelligence",
        "demo_note": "Screenshots: demo company profile; real opportunities and awards.",
    },
}

LOGO = """<svg viewBox="0 0 64 64" class="logo"><defs><linearGradient id="g{n}" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#1fc293"/><stop offset="1" stop-color="#0a5c47"/></linearGradient></defs>
<rect width="64" height="64" rx="18" fill="url(#g{n})"/><path d="M16 44c8-1 12-6 16-14s8-12 16-12" fill="none"
stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="48" cy="18" r="4.5" fill="#f3c86b"/>
<path d="M14 50h36" stroke="rgba(255,255,255,.45)" stroke-width="3" stroke-linecap="round"/></svg>"""

CSS = """
@page { size: 1600px 900px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Inter, "IBM Plex Sans Arabic", system-ui, sans-serif; color: #15181b; -webkit-font-smoothing: antialiased; }
.slide { width: 1600px; height: 900px; position: relative; overflow: hidden; page-break-after: always; padding: 84px 96px;
  background: #f5f3ee; }
.slide.dark { background: radial-gradient(1000px 600px at 15% -10%, rgba(47,197,155,.35), transparent 60%),
  radial-gradient(900px 600px at 110% 110%, rgba(183,134,43,.30), transparent 60%), #06231c; color: #eaf6f1; }
.kicker { font-size: 20px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #0e7a5f; }
.dark .kicker { color: #5fe0b9; }
h1 { font-size: 64px; line-height: 1.06; letter-spacing: -.03em; margin: 18px 0 0; font-weight: 800; max-width: 1250px; }
h1.xl { font-size: 92px; max-width: 1100px; }
p.sub { font-size: 27px; line-height: 1.45; color: #3d4247; max-width: 1000px; margin: 26px 0 0; }
.dark p.sub { color: #b8d8cf; }
.foot { position: absolute; left: 96px; right: 96px; bottom: 34px; display: flex; justify-content: space-between;
  align-items: center; font-size: 15px; color: #979ba0; }
.dark .foot { color: #6fa395; }
.foot .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .14em; color: inherit; }
.logo { width: 30px; height: 30px; }
.cover > .logo { width: 88px; height: 88px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 26px; margin-top: 64px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin-top: 56px; }
.grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 22px 40px; margin-top: 40px; }
.card { background: #fff; border-radius: 28px; padding: 34px; box-shadow: 0 24px 60px -30px rgba(20,24,28,.35);
  border: 1px solid rgba(24,28,32,.06); }
.dark .card { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.1); box-shadow: none; }
.card b { display: block; font-size: 30px; letter-spacing: -.01em; margin-bottom: 12px; }
.card span { font-size: 21px; line-height: 1.45; color: #3d4247; }
.dark .card span { color: #b8d8cf; }
.num { font-size: 26px; width: 54px; height: 54px; border-radius: 16px; display: grid; place-items: center; font-weight: 800;
  background: rgba(14,122,95,.12); color: #0e7a5f; margin-bottom: 22px; }
.dark .num { background: rgba(95,224,185,.14); color: #5fe0b9; }
.big { font-size: 96px; font-weight: 800; letter-spacing: -.04em; line-height: 1; color: #fff; }
.big small { display: block; font-size: 21px; font-weight: 500; color: #b8d8cf; letter-spacing: 0; line-height: 1.4;
  margin-top: 14px; }
.split { display: grid; grid-template-columns: 1fr 1.35fr; gap: 64px; align-items: center; height: calc(100% - 30px); }
.split h1 { font-size: 52px; }
.split ul.points li { font-size: 21px; padding: 11px 0 11px 42px; }
.split ul.points li::before { top: 17px; }
.caption { font-size: 15px; color: #979ba0; margin-top: 16px; text-align: center; }
.split.rev { grid-template-columns: 1.35fr 1fr; }
.shot { width: 100%; border-radius: 18px; box-shadow: 0 40px 90px -40px rgba(6,35,28,.55), 0 0 0 1px rgba(0,0,0,.06);
  display: block; }
.laptop { background: #0c0f11; padding: 14px 14px 18px; border-radius: 26px; box-shadow: 0 50px 100px -40px rgba(0,0,0,.6); }
.laptop img { width: 100%; display: block; border-radius: 12px; }
.phone { width: 300px; border-radius: 46px; background: #0c0f11; padding: 11px; box-shadow: 0 50px 90px -35px rgba(0,0,0,.6); }
.phone img { width: 100%; display: block; border-radius: 36px; }
.phones { display: flex; gap: 28px; align-items: flex-end; justify-content: center; }
.phones .phone:nth-child(2) { transform: translateY(-34px); }
ul.points { list-style: none; padding: 0; margin: 36px 0 0; }
ul.points li { font-size: 24px; line-height: 1.4; padding: 14px 0 14px 46px; position: relative; border-top: 1px solid rgba(24,28,32,.08); }
.dark ul.points li { border-color: rgba(255,255,255,.1); }
ul.points li::before { content: ""; position: absolute; left: 0; top: 22px; width: 22px; height: 22px; border-radius: 7px;
  background: linear-gradient(135deg, #5fe0b9, #0e7a5f); }
ul.points li b { font-weight: 700; }
.note { font-size: 16px; color: #979ba0; margin-top: 18px; }
.dark .note { color: #6fa395; }
.chips { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 60px; }
.chips span { font-size: 28px; font-weight: 600; padding: 18px 30px; border-radius: 999px; background: #fff;
  box-shadow: 0 16px 40px -24px rgba(20,24,28,.4); }
.dark .chips span { background: rgba(255,255,255,.08); }
.radar { position: absolute; right: -140px; top: 90px; width: 760px; height: 760px; opacity: .9; }
.sources { margin-top: 40px; font-size: 21px; color: #b8d8cf; }
.gold { color: #f3c86b; }
.contact { margin-top: 30px; font-size: 26px; color: #5fe0b9; font-weight: 600; }
"""

RADAR = """<svg class="radar" viewBox="0 0 400 400"><defs><radialGradient id="rg"><stop offset="0" stop-color="#5fe0b9"
stop-opacity=".45"/><stop offset="1" stop-color="#5fe0b9" stop-opacity="0"/></radialGradient></defs>
<circle cx="200" cy="200" r="190" fill="none" stroke="rgba(255,255,255,.12)"/><circle cx="200" cy="200" r="140" fill="none"
stroke="rgba(255,255,255,.12)"/><circle cx="200" cy="200" r="90" fill="none" stroke="rgba(255,255,255,.12)"/>
<circle cx="200" cy="200" r="40" fill="none" stroke="rgba(255,255,255,.12)"/>
<path d="M200 200 L390 200 A190 190 0 0 0 334 66 Z" fill="url(#rg)"/>
<circle cx="296" cy="120" r="7" fill="#f3c86b"/><circle cx="120" cy="170" r="6" fill="#5fe0b9"/><circle cx="250" cy="280" r="6"
fill="#5fe0b9"/><circle cx="160" cy="300" r="5" fill="#5fe0b9"/><circle cx="200" cy="200" r="16" fill="#fff"/></svg>"""


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def foot(t: dict, n: int, total: int) -> str:
    return (f'<div class="foot"><span class="brand">{LOGO.format(n=f"f{n}")}FORSA</span>'
            f'<span>{esc(t["footer"])}</span><span>{n} / {total}</span></div>')  # fmt: skip


def build(lang: str) -> str:
    t, st = T[lang], (STATS if lang == "fr" else STATS_EN)
    slides: list[tuple[str, str]] = []
    slides.append(("dark cover", f"""{RADAR}{LOGO.format(n="c")}
<div class="kicker" style="margin-top:40px">{esc(t["cover_kicker"])}</div>
<h1 class="xl">{esc(t["cover_title"])}</h1><p class="sub">{esc(t["cover_sub"])}</p>"""))
    slides.append(("", f"""<div class="kicker">{esc(t["pain_kicker"])}</div><h1>{esc(t["pain_title"])}</h1>
<div class="grid4">{"".join(f'<div class="card"><b>{esc(a)}</b><span>{esc(b)}</span></div>' for a, b in t["pains"])}</div>"""))
    slides.append(("dark", f"""<div class="kicker">{esc(t["sol_kicker"])}</div><h1>{esc(t["sol_title"])}</h1>
<div class="grid4">{"".join(f'<div class="card"><div class="num">{i + 1}</div><b>{esc(a)}</b><span>{esc(b)}</span></div>'
                                for i, (a, b) in enumerate(t["pillars"]))}</div>"""))
    slides.append(("", f"""<div class="split"><div><div class="kicker">{esc(t["how_kicker"])}</div>
<h1>{esc(t["how_title"])}</h1><ul class="points">{"".join(f'<li><b>{esc(a)}</b><br>{esc(b)}</li>' for a, b in t["steps"])}</ul></div>
<div class="phones"><div class="phone"><img src="img/m-onboarding.jpg"></div><div class="phone"><img src="img/m-today.jpg"></div></div></div>"""))
    slides.append(("dark", f"""<div class="kicker">{esc(t["data_kicker"])}</div><h1>{esc(t["data_title"])}</h1>
<div class="grid4" style="margin-top:80px">{"".join(f'<div class="big">{st[k]}<small>{esc(label)}</small></div>' for k, label in t["data"])}</div>
<div class="grid3" style="margin-top:64px">{"".join(f'<div class="card"><b style="font-size:24px">{esc(a)}</b><span>{esc(b)}</span></div>' for a, b in t["source_cards"])}</div>
<div class="note">{esc(t["data_note"])}</div>"""))
    slides.append(("", f"""<div class="split"><div><div class="kicker">{esc(t["brief_kicker"])}</div>
<h1>{esc(t["brief_title"])}</h1><ul class="points">{"".join(f'<li>{esc(p)}</li>' for p in t["brief_points"])}</ul></div>
<div class="laptop"><img src="img/d-today.jpg"></div></div>"""))
    slides.append(("", f"""<div class="split rev"><div><div class="laptop"><img src="img/d-opp.jpg"></div>
<div class="caption">{esc(t["why_note"])}</div></div><div>
<div class="kicker">{esc(t["why_kicker"])}</div><h1>{esc(t["why_title"])}</h1>
<ul class="points">{"".join(f'<li><b>{esc(a)}</b> — {esc(b)}</li>' for a, b in t["why_points"])}</ul></div></div>"""))
    slides.append(("dark", f"""<div class="split"><div><div class="kicker">{esc(t["market_kicker"])}</div>
<h1>{esc(t["market_title"])}</h1>
<ul class="points">{"".join(f'<li><b>{esc(a)}</b> — {esc(b)}</li>' for a, b in t["market_points"])}</ul></div>
<div class="laptop"><img src="img/d-market-dark.jpg"></div></div>"""))
    slides.append(("", f"""<div class="split"><div><div class="kicker">{esc(t["ai_kicker"])}</div>
<h1>{esc(t["ai_title"])}</h1><ul class="points">{"".join(f'<li>{esc(p)}</li>' for p in t["ai_points"])}</ul></div>
<div class="phones"><div class="phone"><img src="img/m-assistant.jpg"></div><div class="phone"><img src="img/m-triage.jpg"></div></div></div>"""))
    slides.append(("", f"""<div class="kicker">{esc(t["flow_kicker"])}</div><h1>{esc(t["flow_title"])}</h1>
<div class="grid3">{"".join(f'<div class="card"><div class="num">{i + 1}</div><b>{esc(a)}</b><span>{esc(b)}</span></div>'
                                for i, (a, b) in enumerate(t["flow"]))}</div>"""))
    slides.append(("dark", f"""<div class="split"><div><div class="kicker">{esc(t["mobile_kicker"])}</div>
<h1>{esc(t["mobile_title"])}</h1><ul class="points">{"".join(f'<li>{esc(p)}</li>' for p in t["mobile_points"])}</ul></div>
<div class="phones"><div class="phone"><img src="img/m-today.jpg"></div><div class="phone"><img src="img/m-market.jpg"></div>
<div class="phone"><img src="img/m-opp.jpg"></div></div></div>"""))
    slides.append(("", f"""<div class="kicker">{esc(t["trust_kicker"])}</div><h1>{esc(t["trust_title"])}</h1>
<div class="grid3">{"".join(f'<div class="card"><b>{esc(a)}</b><span>{esc(b)}</span></div>' for a, b in t["trust"])}</div>"""))
    slides.append(("", f"""<div class="kicker">{esc(t["who_kicker"])}</div><h1>{esc(t["who_title"])}</h1>
<div class="chips">{"".join(f'<span>{esc(w)}</span>' for w in t["who"])}</div>
<p class="sub" style="margin-top:56px">{esc(t["who_sub"])}</p>
<div class="note" style="margin-top:60px">{esc(t["demo_note"])}</div>"""))
    contact = f'<div class="contact">{esc(CONTACT)}</div>' if CONTACT else ""
    slides.append(("dark cover", f"""{RADAR}{LOGO.format(n="e")}
<div class="kicker" style="margin-top:40px">{esc(t["start_kicker"])}</div><h1 class="xl" style="font-size:78px">{esc(t["start_title"])}</h1>
<div class="grid3" style="max-width:1100px">{"".join(f'<div class="card"><div class="num">{i + 1}</div><b style="font-size:26px">{esc(a)}</b><span>{esc(b)}</span></div>'
                                                      for i, (a, b) in enumerate(t["start_steps"]))}</div>{contact}"""))
    total = len(slides)
    body = "".join(f'<section class="slide {cls}">{content}{foot(t, i + 1, total)}</section>' for i, (cls, content) in enumerate(slides))
    fonts = (HERE / "fonts" / "inter-local.css").read_text(encoding="utf-8")  # bundled: renders offline, identically
    return (f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><title>FORSA</title>'
            f'<style>{fonts}{CSS}</style></head><body>{body}</body></html>')  # fmt: skip


if __name__ == "__main__":
    for lang in ("fr", "en"):
        (HERE / f"deck-{lang}.html").write_text(build(lang), encoding="utf-8")
        print(f"wrote deck-{lang}.html")
