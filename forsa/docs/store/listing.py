"""Store listing texts (App Store + Google Play), FR/EN, checked against the stores' length limits.

Run `python3 listing.py OUTDIR` to write one text file per field. Edit the texts here, not in the output.
"""

import sys
from pathlib import Path

DESCRIPTION = {
    "fr": """FORSA trouve les marchés publics que votre entreprise peut gagner, explique pourquoi, et vous aide à préparer l'offre en équipe.

SOURCES OFFICIELLES, UN SEUL FIL
• Portail National des Marchés Publics de Mauritanie : avis, plans de passation, liste rouge
• Banque mondiale : appels d'offres et attributions de marchés
• Nations Unies (UNGM), sur connexion de votre organisation
Les avis scannés sont lus automatiquement (OCR), y compris les dates limites.

UN SCORE D'ADÉQUATION EXPLIQUÉ
Chaque opportunité reçoit un score fondé sur votre profil : compétences, attestations, références, région, montant. FORSA montre les critères éliminatoires, les inconnues et la phrase exacte de l'avis qui justifie chaque point. C'est une estimation fondée sur les éléments disponibles, jamais une promesse de gain.

TRIEZ EN UN GESTE
Glissez à droite pour poursuivre, à gauche pour écarter. Votre équipe voit les mêmes choix.

L'INTELLIGENCE DU MARCHÉ
Qui gagne quoi et à quel prix, les concurrents les plus actifs, les acheteurs, les achats prévus dans les 12 prochains mois, et les entreprises exclues (liste rouge).

UN ASSISTANT QUI NE FAIT PAS SEMBLANT
Posez vos questions par écrit ou à voix haute (français, anglais, arabe) : « Qui gagne les marchés de forage ? », « Quelles échéances arrivent ? ». Les réponses viennent de vos données FORSA, avec leurs sources.

PRÉPAREZ L'OFFRE EN ÉQUIPE
Décision soumissionner / ne pas soumissionner, matrice de conformité, tâches assignées, approbation finale à quatre yeux. Rappels J-7, J-3 et J-1, export vers votre calendrier, partage WhatsApp.

CONFIDENTIALITÉ
Vos données restent sur le serveur de votre organisation. Aucune publicité, aucun traceur. Suppression du compte directement dans l'application.

FORSA est un service professionnel : un compte fourni par votre organisation est nécessaire. À la première ouverture, saisissez l'adresse FORSA de votre entreprise.""",
    "en": """FORSA finds the public tenders your company can win, explains why, and helps your team prepare the bid.

EVERY OFFICIAL SOURCE, ONE FEED
• Mauritania's National Public Procurement Portal: notices, procurement plans, red list
• World Bank: tenders and contract awards
• United Nations (UNGM), with your organisation's credentials
Scanned notices are read automatically (OCR), deadlines included.

A FIT SCORE YOU CAN UNDERSTAND
Every opportunity gets a score based on your profile: capabilities, certificates, references, region, contract size. FORSA shows the knock-out criteria, the unknowns and the exact sentence of the notice behind each point. It is an estimate from the available evidence — never a promise of winning.

TRIAGE WITH A SWIPE
Swipe right to pursue, left to dismiss. Your whole team sees the same choices.

MARKET INTELLIGENCE
Who wins what and for how much, the most active competitors, the buyers, purchases planned for the next 12 months, and excluded companies (red list).

AN ASSISTANT THAT DOES NOT MAKE THINGS UP
Ask in writing or out loud (French, English, Arabic): "Who wins the drilling contracts?", "Which deadlines are coming?". Answers come from your FORSA data, with their sources.

PREPARE THE BID AS A TEAM
Bid / no-bid decision, compliance matrix, assigned tasks, four-eyes final approval. Reminders 7, 3 and 1 days before the deadline, export to your calendar, share on WhatsApp.

PRIVACY
Your data stays on your organisation's server. No advertising, no tracking. Delete your account from inside the app.

FORSA is a professional service: you need an account provided by your organisation. On first launch, enter your company's FORSA address.""",
}

FIELDS = {
    # App Store Connect
    "appstore/name": ({"fr": "FORSA – Marchés publics", "en": "FORSA – Public Tenders"}, 30),
    "appstore/subtitle": ({"fr": "Trouvez les marchés à gagner", "en": "Find the tenders you can win"}, 30),
    "appstore/promotional_text": ({
        "fr": "Les avis officiels de Mauritanie et des bailleurs, triés pour votre entreprise : score expliqué, "
              "rappels d'échéance, intelligence du marché et assistant vocal.",
        "en": "Official notices from Mauritania and donors, sorted for your company: explained fit score, deadline "
              "reminders, market intelligence and a voice assistant.",
    }, 170),
    "appstore/description": (DESCRIPTION, 4000),
    "appstore/keywords": ({
        "fr": "appels d'offres,marchés publics,Mauritanie,ARMP,Banque mondiale,soumission,DAO,achats,BTP",
        "en": "tenders,procurement,public contracts,Mauritania,World Bank,bid,RFP,government,award,Africa",
    }, 100),
    "appstore/whats_new": ({"fr": "Première version de FORSA pour iPhone.", "en": "First release of FORSA for iPhone."}, 4000),
    # Google Play
    "playstore/title": ({"fr": "FORSA – Marchés publics", "en": "FORSA – Public Tenders"}, 30),
    "playstore/short_description": ({
        "fr": "Trouvez, comprenez et préparez les marchés publics que vous pouvez gagner.",
        "en": "Find, understand and prepare the public tenders your company can win.",
    }, 80),
    "playstore/full_description": (DESCRIPTION, 4000),
}


def main(out: Path) -> None:
    for key, (texts, limit) in FIELDS.items():
        for lang, text in texts.items():
            size = len(text.encode("utf-8")) if key.endswith("keywords") else len(text)  # keywords: 100 bytes
            assert size <= limit, f"{key} [{lang}] is {size} > {limit}"
            path = out / key.split("/")[0] / lang / f"{key.split('/')[1]}.txt"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text + "\n", encoding="utf-8")
            print(f"{key:32} {lang}  {size:5}/{limit}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "store-listing"))
