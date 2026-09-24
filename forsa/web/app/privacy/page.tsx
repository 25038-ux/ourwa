"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Segmented } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { fadeUp, stagger } from "@/lib/motion";

type Section = { title: string; body: string[] };

/** Public privacy policy (also the App Store / Google Play privacy URL). Describes what this software does. */
const TEXT: Record<"fr" | "en", { title: string; updated: string; intro: string; operator: string; contact: string;
  unset: string; sections: Section[]; back: string }> = {
  fr: {
    title: "Politique de confidentialité",
    updated: "Dernière mise à jour : 24 septembre 2026",
    intro: "FORSA aide les entreprises à trouver et préparer les marchés publics qu'elles peuvent remporter. Cette page explique quelles données personnelles FORSA traite, pourquoi, et comment exercer vos droits. Elle s'applique au site web et aux applications FORSA pour iPhone et Android, qui affichent le même service.",
    operator: "Responsable du traitement : l'organisation qui exploite ce serveur FORSA",
    contact: "Contact données personnelles",
    unset: "voir les coordonnées fournies par votre organisation",
    sections: [
      { title: "Données que nous traitons", body: [
        "Compte : nom, adresse e-mail, mot de passe (stocké uniquement sous forme de hachage), langue, rôle dans votre organisation.",
        "Profil de votre entreprise : compétences, attestations, références et documents que vous choisissez de téléverser.",
        "Travail d'équipe : espaces d'offre, décisions, tâches, notifications et préférences de notification.",
        "Assistant : vos questions et ses réponses, pour afficher l'historique de la conversation.",
        "Notifications push (si vous les activez) : l'adresse technique fournie par votre navigateur ou téléphone.",
        "Sécurité : journal des connexions et des actions importantes (date, adresse IP, action) pour protéger les comptes.",
      ] },
      { title: "Sources publiques", body: [
        "FORSA lit des avis de marchés publiés officiellement (Portail National des Marchés Publics, Banque mondiale, UNGM). Les coordonnées personnelles d'agents ou de consultants individuels présentes dans ces sources ne sont pas conservées.",
      ] },
      { title: "Pourquoi", body: [
        "Fournir le service que votre organisation a choisi : trouver les opportunités adaptées, expliquer les recommandations, préparer les offres, vous prévenir des échéances. Nous ne vendons aucune donnée, n'affichons aucune publicité et n'utilisons aucun traceur publicitaire ni outil d'analyse d'audience.",
      ] },
      { title: "Intelligence artificielle", body: [
        "Les fonctions d'IA sont facultatives et activées par l'administrateur du serveur. Chaque fournisseur d'IA a un plafond de sensibilité : il ne reçoit jamais de données plus sensibles que ce plafond. Sans fournisseur configuré, FORSA fonctionne entièrement sans IA externe.",
      ] },
      { title: "Voix et micro", body: [
        "La dictée utilise le service de reconnaissance vocale de votre appareil ou navigateur (qui peut traiter l'audio sur les serveurs de son éditeur). FORSA ne reçoit que le texte, jamais l'enregistrement. Le micro n'est utilisé que lorsque vous appuyez sur le bouton micro.",
      ] },
      { title: "Cookies et stockage local", body: [
        "Un seul cookie, indispensable, maintient votre session (sécurisé, inaccessible aux scripts). Vos préférences (thème, langue, organisation active) restent dans votre appareil.",
      ] },
      { title: "Où et combien de temps", body: [
        "Les données sont hébergées sur le serveur de l'organisation qui exploite FORSA et transitent chiffrées (HTTPS). Elles sont conservées tant que votre compte est actif. Les sauvegardes nocturnes sont effacées automatiquement après 14 jours par défaut.",
      ] },
      { title: "Vos droits et la suppression du compte", body: [
        "Vous pouvez consulter et corriger vos informations dans Réglages → Profil, et supprimer votre compte à tout moment dans Réglages → Profil → Supprimer mon compte (site et applications). La suppression est immédiate : nom et e-mail sont effacés, vos notifications, conversations avec l'assistant et abonnements push sont supprimés, et vous quittez vos organisations. Les dossiers de l'entreprise (offres, tâches) restent à l'entreprise, sans vous être attribués. Le journal de sécurité conserve un identifiant technique non nominatif.",
        "Pour toute autre demande (accès, rectification, opposition), écrivez au contact ci-dessus ou à l'administrateur de votre organisation.",
      ] },
      { title: "Enfants", body: ["FORSA est un outil professionnel, non destiné aux moins de 16 ans."] },
    ],
    back: "Retour à FORSA",
  },
  en: {
    title: "Privacy policy",
    updated: "Last updated: 24 September 2026",
    intro: "FORSA helps companies find and prepare the public tenders they can win. This page explains what personal data FORSA processes, why, and how to exercise your rights. It covers the website and the FORSA apps for iPhone and Android, which show the same service.",
    operator: "Data controller: the organisation that runs this FORSA server",
    contact: "Personal-data contact",
    unset: "see the contact details provided by your organisation",
    sections: [
      { title: "Data we process", body: [
        "Account: name, e-mail address, password (stored only as a hash), language, role in your organisation.",
        "Your company profile: capabilities, certificates, references and documents you choose to upload.",
        "Teamwork: bid workspaces, decisions, tasks, notifications and notification preferences.",
        "Assistant: your questions and its answers, to show the conversation history.",
        "Push notifications (if you turn them on): the technical address provided by your browser or phone.",
        "Security: a log of sign-ins and important actions (date, IP address, action) to protect accounts.",
      ] },
      { title: "Public sources", body: [
        "FORSA reads officially published procurement notices (Mauritania's National Public Procurement Portal, World Bank, UNGM). Personal contact details of officials or individual consultants found in these sources are not kept.",
      ] },
      { title: "Why", body: [
        "To provide the service your organisation chose: find suitable opportunities, explain recommendations, prepare bids, remind you of deadlines. We sell no data, show no advertising and use no advertising trackers or audience analytics.",
      ] },
      { title: "Artificial intelligence", body: [
        "AI features are optional and turned on by the server administrator. Each AI provider has a sensitivity ceiling: it never receives data more sensitive than that ceiling. With no provider configured, FORSA works entirely without external AI.",
      ] },
      { title: "Voice and microphone", body: [
        "Dictation uses your device's or browser's speech-recognition service (which may process audio on its vendor's servers). FORSA receives only the text, never the recording. The microphone is used only while you press the microphone button.",
      ] },
      { title: "Cookies and local storage", body: [
        "A single, essential cookie keeps you signed in (secure, not readable by scripts). Your preferences (theme, language, active organisation) stay on your device.",
      ] },
      { title: "Where and for how long", body: [
        "Data is hosted on the server of the organisation that runs FORSA and travels encrypted (HTTPS). It is kept while your account is active. Nightly backups are deleted automatically after 14 days by default.",
      ] },
      { title: "Your rights and account deletion", body: [
        "You can view and correct your information in Settings → Profile, and delete your account at any time in Settings → Profile → Delete my account (website and apps). Deletion is immediate: your name and e-mail are erased, your notifications, assistant conversations and push subscriptions are deleted, and you leave your organisations. Company records (bids, tasks) stay with the company, no longer attributed to you. The security log keeps a non-identifying technical id.",
        "For any other request (access, correction, objection), write to the contact above or to your organisation's administrator.",
      ] },
      { title: "Children", body: ["FORSA is a professional tool, not intended for people under 16."] },
    ],
    back: "Back to FORSA",
  },
};

export default function PrivacyPage() {
  const { lang, setLang } = useI18n();
  const [op, setOp] = useState<{ name: string; privacy_contact: string } | null>(null);
  useEffect(() => {
    fetch("/api/v1/meta/operator").then((r) => (r.ok ? r.json() : null)).then(setOp).catch(() => setOp(null));
  }, []);
  const x = TEXT[lang];
  const contact = op?.privacy_contact;
  return (
    <main style={{ minHeight: "100dvh", background: "var(--bg)", padding: "calc(var(--safe-top) + 28px) 20px 64px" }}>
      <motion.article variants={stagger(0.05)} initial="hidden" animate="show"
        style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
        <motion.div variants={fadeUp} className="row between">
          <Link href="/" className="row" style={{ gap: 10, fontWeight: 700, fontSize: 18 }}><Logo size={32} />FORSA</Link>
          <Segmented id="privacy-lang" value={lang} onChange={setLang}
            options={[{ value: "fr", label: "FR" }, { value: "en", label: "EN" }]} />
        </motion.div>
        <motion.header variants={fadeUp}>
          <h1 style={{ fontSize: "clamp(28px, 6vw, 40px)", lineHeight: 1.1, letterSpacing: "-0.02em" }}>{x.title}</h1>
          <p className="faint" style={{ marginTop: 8 }}>{x.updated}</p>
          <p style={{ marginTop: 16, fontSize: 17, lineHeight: 1.6, color: "var(--text-2)" }}>{x.intro}</p>
        </motion.header>
        <motion.div variants={fadeUp} className="card" style={{ padding: 16, lineHeight: 1.6 }}>
          <div><b>{x.operator}</b>{op?.name ? ` — ${op.name}` : ""}</div>
          <div className="muted">{x.contact} : {contact
            ? (contact.includes("@") ? <a href={`mailto:${contact}`} style={{ color: "var(--accent)" }}>{contact}</a> : contact)
            : x.unset}</div>
        </motion.div>
        {x.sections.map((s) => (
          <motion.section key={s.title} variants={fadeUp}>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>{s.title}</h2>
            {s.body.length > 1
              ? <ul style={{ paddingInlineStart: 20, lineHeight: 1.65, color: "var(--text-2)", display: "grid", gap: 6 }}>
                  {s.body.map((b) => <li key={b}>{b}</li>)}</ul>
              : <p style={{ lineHeight: 1.65, color: "var(--text-2)" }}>{s.body[0]}</p>}
          </motion.section>
        ))}
        <motion.div variants={fadeUp} style={{ marginTop: 8 }}>
          <Link href="/" className="btn">{x.back}</Link>
        </motion.div>
      </motion.article>
    </main>
  );
}
