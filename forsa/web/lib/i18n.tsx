"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { safeGet, safeSet } from "./api";

export type Lang = "fr" | "en";

const M = {
  fr: {
    command: "Centre de commande", opportunities: "Opportunités", company: "Mon entreprise", bids: "Offres",
    sources: "Sources", logout: "Déconnexion", login: "Connexion", email: "E-mail", password: "Mot de passe",
    signin: "Se connecter", goodMorning: "Bonjour", today: "Ce qu'il faut poursuivre aujourd'hui",
    newSignals: "Nouveaux signaux", highFit: "Forte adéquation", deadlines: "Échéances ≤ 7 j",
    missing: "Éléments manquants", early: "Signaux précoces", changes: "Changements", approvals: "Approbations",
    topAction: "Action prioritaire", pursue: "À poursuivre", earlySignals: "Signaux précoces (plans de passation)",
    missingItems: "À obtenir / justifier", noData: "Rien pour l'instant.", fit: "Adéquation", deadline: "Date limite",
    daysLeft: "j restants", buyer: "Acheteur", region: "Région", search: "Rechercher…", all: "Tous",
    matchedOnly: "Mes correspondances", open: "Ouvrir", whyItMatters: "Pourquoi c'est important",
    recommendation: "Recommandation", conditions: "Conditions", breakdown: "Détail de l'adéquation",
    gates: "Critères éliminatoires", unknowns: "Inconnues", risks: "Risques", economics: "Économie de l'offre",
    requirements: "Exigences extraites", documents: "Documents", history: "Historique", facts: "Pourquoi FORSA dit cela ?",
    startBid: "Ouvrir un espace d'offre", irrelevant: "Non pertinent", reportError: "Signaler une erreur",
    why: "Pourquoi ?", evidence: "Preuve", completeness: "complétude", notProbability:
      "Score d'adéquation fondé sur les éléments disponibles — pas une probabilité de gain.",
    demo: "DÉMO — données synthétiques", capabilities: "Compétences", credentials: "Attestations & certifications",
    projects: "Références", identity: "Identité & capacité", save: "Enregistrer", add: "Ajouter",
    verified: "Vérifié", claimed: "Déclaré", upload: "Téléverser un justificatif", suggestions: "Suggestions (à confirmer)",
    confirm: "Confirmer", decision: "Décision", compliance: "Matrice de conformité", requestApproval:
      "Demander l'approbation finale", approve: "Approuver", reject: "Rejeter", markSubmitted:
      "Enregistrer la soumission (faite par un humain)", outcome: "Résultat", health: "Santé", status: "Statut",
    effort: "Effort (j-personne)", bidCost: "Coût de l'offre", value: "Montant", contribution: "Contribution estimée",
    range: "fourchette", loading: "Chargement…", source: "Source", method: "Procédure", published: "Publié",
    sort: "Tri", fitSort: "Adéquation", deadlineSort: "Échéance", recentSort: "Récent", minFit: "Adéquation min.",
    draft: "Squelette de réponse", sourceAlert: "Alerte source",
  },
  en: {
    command: "Command center", opportunities: "Opportunities", company: "My company", bids: "Bids",
    sources: "Sources", logout: "Sign out", login: "Sign in", email: "Email", password: "Password",
    signin: "Sign in", goodMorning: "Good morning", today: "What to pursue today", newSignals: "New signals",
    highFit: "High fit", deadlines: "Deadlines ≤ 7d", missing: "Missing items", early: "Early signals",
    changes: "Changes", approvals: "Approvals", topAction: "Top action", pursue: "Pursue",
    earlySignals: "Early signals (procurement plans)", missingItems: "To obtain / evidence", noData: "Nothing yet.",
    fit: "Fit", deadline: "Deadline", daysLeft: "days left", buyer: "Buyer", region: "Region", search: "Search…",
    all: "All", matchedOnly: "My matches", open: "Open", whyItMatters: "Why it matters",
    recommendation: "Recommendation", conditions: "Conditions", breakdown: "Fit breakdown", gates: "Hard gates",
    unknowns: "Unknowns", risks: "Risks", economics: "Bid economics", requirements: "Extracted requirements",
    documents: "Documents", history: "History", facts: "Why does FORSA say this?", startBid: "Open bid workspace",
    irrelevant: "Not relevant", reportError: "Report error", why: "Why?", evidence: "Evidence",
    completeness: "completeness", notProbability: "Fit score based on available evidence — not a win probability.",
    demo: "DEMO — synthetic data", capabilities: "Capabilities", credentials: "Credentials & certifications",
    projects: "References", identity: "Identity & capacity", save: "Save", add: "Add", verified: "Verified",
    claimed: "Claimed", upload: "Upload evidence", suggestions: "Suggestions (to confirm)", confirm: "Confirm",
    decision: "Decision", compliance: "Compliance matrix", requestApproval: "Request final approval",
    approve: "Approve", reject: "Reject", markSubmitted: "Record submission (done by a human)", outcome: "Outcome",
    health: "Health", status: "Status", effort: "Effort (person-days)", bidCost: "Bid cost", value: "Value",
    contribution: "Estimated contribution", range: "range", loading: "Loading…", source: "Source", method: "Method",
    published: "Published", sort: "Sort", fitSort: "Fit", deadlineSort: "Deadline", recentSort: "Recent",
    minFit: "Min. fit", draft: "Response skeleton", sourceAlert: "Source alert",
  },
} as const;

export type MsgKey = keyof (typeof M)["fr"];
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: MsgKey) => string }>({
  lang: "fr", setLang: () => {}, t: (k) => M.fr[k],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("fr");
  useEffect(() => {
    const saved = safeGet("forsa.lang");
    if (saved === "fr" || saved === "en") setLangState(saved);
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    safeSet("forsa.lang", l);
  };
  return <Ctx.Provider value={{ lang, setLang, t: (k) => M[lang][k] }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
