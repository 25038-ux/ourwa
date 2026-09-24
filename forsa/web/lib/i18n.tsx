"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { safeGet, safeSet } from "./api";

export type Lang = "fr" | "en";

const M = {
  fr: {
    command: "Aujourd'hui", opportunities: "Opportunités", company: "Entreprise", bids: "Offres", tasks: "Tâches",
    team: "Équipe", sources: "Sources", settings: "Réglages", notifications: "Notifications", assistant: "Assistant",
    more: "Plus", logout: "Déconnexion", email: "E-mail", password: "Mot de passe", signin: "Se connecter",
    goodMorning: "Bonjour", goodAfternoon: "Bon après-midi", goodEvening: "Bonsoir",
    today: "Voici ce qui mérite votre attention aujourd'hui.", newSignals: "Nouveaux signaux", highFit: "Forte adéquation",
    deadlines: "Échéances ≤ 7 j", missing: "À obtenir", early: "Signaux précoces", changes: "Changements",
    approvals: "Approbations", topAction: "Action prioritaire", pursue: "À poursuivre",
    earlySignals: "Signaux précoces", missingItems: "À obtenir / justifier", noData: "Rien pour l'instant.",
    fit: "Adéquation", deadline: "Date limite", daysLeft: "j", buyer: "Acheteur", region: "Région",
    search: "Rechercher une opportunité, une page, ou demander…", all: "Tous", matchedOnly: "Mes correspondances",
    open: "Ouvrir", whyItMatters: "Pourquoi c'est important", recommendation: "Recommandation", conditions: "Conditions",
    breakdown: "Détail de l'adéquation", gates: "Critères éliminatoires", unknowns: "Inconnues", risks: "Risques",
    economics: "Économie de l'offre", requirements: "Exigences extraites", documents: "Documents", history: "Historique",
    facts: "Pourquoi FORSA dit cela ?", startBid: "Ouvrir un espace d'offre", irrelevant: "Non pertinent",
    reportError: "Signaler une erreur", why: "Pourquoi ?", evidence: "Preuve", completeness: "complétude",
    notProbability: "Score d'adéquation fondé sur les éléments disponibles — pas une probabilité de gain.",
    demo: "DÉMO", capabilities: "Compétences", credentials: "Attestations & certifications", projects: "Références",
    identity: "Identité & capacité", save: "Enregistrer", saved: "Enregistré", add: "Ajouter", verified: "Vérifié",
    claimed: "Déclaré", upload: "Téléverser un justificatif", suggestions: "Suggestions (à confirmer)", confirm: "Confirmer",
    decision: "Décision", compliance: "Matrice de conformité", requestApproval: "Demander l'approbation finale",
    approve: "Approuver", reject: "Rejeter", markSubmitted: "Enregistrer la soumission (faite par un humain)",
    outcome: "Résultat", health: "Santé", status: "Statut", effort: "Effort (j-personne)", bidCost: "Coût de l'offre",
    value: "Montant", contribution: "Contribution estimée", range: "fourchette", loading: "Chargement…", source: "Source",
    method: "Procédure", published: "Publié", sort: "Tri", fitSort: "Adéquation", deadlineSort: "Échéance",
    recentSort: "Récent", minFit: "Adéquation min.", draft: "Squelette de réponse", sourceAlert: "Alerte source",
    askAnything: "Demandez à FORSA…", listening: "Je vous écoute…", thinking: "Analyse en cours",
    assistantHello: "Bonjour ! Je peux trouver des opportunités, expliquer une recommandation, lister les exigences ou préparer une action. Parlez ou écrivez.",
    grounded: "Réponses fondées sur vos données FORSA", speak: "Écouter", stop: "Arrêter", newChat: "Nouvelle conversation",
    triage: "Tri rapide", triageHint: "Glissez à droite pour poursuivre, à gauche pour écarter.", pursueAction: "Poursuivre",
    dismissAction: "Écarter", undo: "Annuler", done: "Terminé", allCaughtUp: "Vous êtes à jour",
    markAllRead: "Tout marquer comme lu", live: "En direct", reconnecting: "Reconnexion…",
    enablePush: "Activer les notifications sur cet appareil", pushOn: "Notifications activées sur cet appareil",
    pushUnavailable: "Notifications push non configurées sur le serveur",
    profile: "Profil", appearance: "Apparence", voice: "Voix & assistant", aiProviders: "Fournisseurs IA",
    language: "Langue", theme: "Thème", system: "Système", light: "Clair", dark: "Sombre", fullName: "Nom complet",
    currentPassword: "Mot de passe actuel", newPassword: "Nouveau mot de passe", changePassword: "Changer le mot de passe",
    voiceReplies: "Réponses vocales", autoSpeak: "Lire les réponses automatiquement", voiceChoice: "Voix",
    invite: "Inviter", role: "Rôle", members: "Membres", pendingInvites: "Invitations en attente", copyLink: "Copier le lien",
    copied: "Copié", newTask: "Nouvelle tâche", todo: "À faire", inProgress: "En cours", doneCol: "Terminé",
    dueDate: "Échéance", assignee: "Responsable", create: "Créer", cancel: "Annuler", title: "Titre",
    onbWelcome: "Bienvenue sur FORSA", onbWelcomeSub: "En 2 minutes, FORSA apprend ce que votre entreprise sait faire — puis trouve les marchés que vous pouvez gagner.",
    start: "Commencer", next: "Continuer", back: "Retour", onbDescribe: "Décrivez votre entreprise",
    onbDescribeSub: "Ce que vous faites, où, pour qui. Parlez ou écrivez, en français, arabe ou anglais.",
    analyze: "Analyser", onbConfirm: "Voici ce que FORSA a compris", onbConfirmSub: "Touchez pour retirer ou ajouter. Rien n'est enregistré sans votre accord.",
    onbCapacity: "Identité & capacité", onbReference: "Une référence récente (facultatif)", finish: "Terminer",
    onbDone: "Votre profil est prêt", onbDoneSub: "FORSA analyse maintenant les opportunités pour vous.", goToday: "Voir mes opportunités",
    legalName: "Raison sociale", turnover: "Chiffre d'affaires annuel", maxProject: "Taille max. de projet",
    staff: "Effectif", regions: "Zones d'intervention", year: "Année", aiSummary: "Résumé IA",
    aiSummaryNote: "Reformulation vérifiée : aucun chiffre ajouté.", jev: "Estimation Jev", quickPrompts: "Suggestions",
    installApp: "Installer l'application", offline: "Hors ligne", viewAll: "Tout voir", empty: "Rien à afficher.",
  },
  en: {
    command: "Today", opportunities: "Opportunities", company: "Company", bids: "Bids", tasks: "Tasks", team: "Team",
    sources: "Sources", settings: "Settings", notifications: "Notifications", assistant: "Assistant", more: "More",
    logout: "Sign out", email: "Email", password: "Password", signin: "Sign in", goodMorning: "Good morning",
    goodAfternoon: "Good afternoon", goodEvening: "Good evening", today: "Here's what deserves your attention today.",
    newSignals: "New signals", highFit: "High fit", deadlines: "Deadlines ≤ 7d", missing: "To obtain", early: "Early signals",
    changes: "Changes", approvals: "Approvals", topAction: "Top action", pursue: "Pursue", earlySignals: "Early signals",
    missingItems: "To obtain / evidence", noData: "Nothing yet.", fit: "Fit", deadline: "Deadline", daysLeft: "d",
    buyer: "Buyer", region: "Region", search: "Search an opportunity, a page, or ask…", all: "All",
    matchedOnly: "My matches", open: "Open", whyItMatters: "Why it matters", recommendation: "Recommendation",
    conditions: "Conditions", breakdown: "Fit breakdown", gates: "Hard gates", unknowns: "Unknowns", risks: "Risks",
    economics: "Bid economics", requirements: "Extracted requirements", documents: "Documents", history: "History",
    facts: "Why does FORSA say this?", startBid: "Open bid workspace", irrelevant: "Not relevant",
    reportError: "Report error", why: "Why?", evidence: "Evidence", completeness: "completeness",
    notProbability: "Fit score based on available evidence — not a win probability.", demo: "DEMO",
    capabilities: "Capabilities", credentials: "Credentials & certifications", projects: "References",
    identity: "Identity & capacity", save: "Save", saved: "Saved", add: "Add", verified: "Verified", claimed: "Claimed",
    upload: "Upload evidence", suggestions: "Suggestions (to confirm)", confirm: "Confirm", decision: "Decision",
    compliance: "Compliance matrix", requestApproval: "Request final approval", approve: "Approve", reject: "Reject",
    markSubmitted: "Record submission (done by a human)", outcome: "Outcome", health: "Health", status: "Status",
    effort: "Effort (person-days)", bidCost: "Bid cost", value: "Value", contribution: "Estimated contribution",
    range: "range", loading: "Loading…", source: "Source", method: "Method", published: "Published", sort: "Sort",
    fitSort: "Fit", deadlineSort: "Deadline", recentSort: "Recent", minFit: "Min. fit", draft: "Response skeleton",
    sourceAlert: "Source alert", askAnything: "Ask FORSA…", listening: "Listening…", thinking: "Working",
    assistantHello: "Hi! I can find opportunities, explain a recommendation, list requirements or prepare an action. Speak or type.",
    grounded: "Answers grounded in your FORSA data", speak: "Listen", stop: "Stop", newChat: "New conversation",
    triage: "Quick triage", triageHint: "Swipe right to pursue, left to dismiss.", pursueAction: "Pursue",
    dismissAction: "Dismiss", undo: "Undo", done: "Done", allCaughtUp: "You're all caught up",
    markAllRead: "Mark all as read", live: "Live", reconnecting: "Reconnecting…",
    enablePush: "Enable notifications on this device", pushOn: "Notifications enabled on this device",
    pushUnavailable: "Push notifications are not configured on the server", profile: "Profile",
    appearance: "Appearance", voice: "Voice & assistant", aiProviders: "AI providers", language: "Language",
    theme: "Theme", system: "System", light: "Light", dark: "Dark", fullName: "Full name",
    currentPassword: "Current password", newPassword: "New password", changePassword: "Change password",
    voiceReplies: "Spoken replies", autoSpeak: "Read answers aloud automatically", voiceChoice: "Voice",
    invite: "Invite", role: "Role", members: "Members", pendingInvites: "Pending invitations", copyLink: "Copy link",
    copied: "Copied", newTask: "New task", todo: "To do", inProgress: "In progress", doneCol: "Done", dueDate: "Due",
    assignee: "Owner", create: "Create", cancel: "Cancel", title: "Title", onbWelcome: "Welcome to FORSA",
    onbWelcomeSub: "In 2 minutes FORSA learns what your company can do — then finds the tenders you can win.",
    start: "Get started", next: "Continue", back: "Back", onbDescribe: "Describe your company",
    onbDescribeSub: "What you do, where, for whom. Speak or type — French, Arabic or English.", analyze: "Analyse",
    onbConfirm: "Here's what FORSA understood", onbConfirmSub: "Tap to remove or add. Nothing is saved without your consent.",
    onbCapacity: "Identity & capacity", onbReference: "A recent reference (optional)", finish: "Finish",
    onbDone: "Your profile is ready", onbDoneSub: "FORSA is now analysing opportunities for you.",
    goToday: "See my opportunities", legalName: "Legal name", turnover: "Annual turnover", maxProject: "Max project size",
    staff: "Staff", regions: "Service area", year: "Year", aiSummary: "AI summary",
    aiSummaryNote: "Verified rewording: no numbers added.", jev: "Jev estimate", quickPrompts: "Try",
    installApp: "Install app", offline: "Offline", viewAll: "View all", empty: "Nothing to show.",
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
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    safeSet("forsa.lang", l);
  };
  return <Ctx.Provider value={{ lang, setLang, t: (k) => M[lang][k] }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

export const CATEGORY_LABEL: Record<string, { fr: string; en: string }> = {
  high_fit_opportunity: { fr: "Opportunité à forte adéquation", en: "High-fit opportunity" },
  tender_change: { fr: "Changement sur un marché", en: "Tender change" },
  deadline: { fr: "Échéance proche", en: "Deadline approaching" },
  approval_request: { fr: "Approbation demandée", en: "Approval requested" },
  task_assignment: { fr: "Tâche assignée", en: "Task assigned" },
  missing_document: { fr: "Document manquant", en: "Missing document" },
  partner_match: { fr: "Partenaire potentiel", en: "Partner match" },
  early_signal: { fr: "Signal précoce", en: "Early signal" },
  award: { fr: "Attribution", en: "Award" },
  daily_briefing: { fr: "Briefing du jour", en: "Daily briefing" },
  system: { fr: "Système", en: "System" },
};
