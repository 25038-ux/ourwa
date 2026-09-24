"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, LoaderCircle, Mic, RefreshCw, Send, Sparkles, Square, Volume2, VolumeX, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { type Action, type Msg, useAssistant, useDictation } from "@/lib/assistant";
import { useI18n } from "@/lib/i18n";
import { haptic, spring } from "@/lib/motion";
import { Sheet } from "./sheet";

const PROMPTS = {
  fr: ["Que dois-je poursuivre cette semaine ?", "Montre-moi les marchés solaires", "Quelles échéances arrivent ?",
    "Pourquoi cette recommandation ?"],
  en: ["What should we bid on this week?", "Show me solar opportunities", "Which deadlines are coming?",
    "Why this recommendation?"],
};

export function Waveform({ level, active }: { level: number; active: boolean }) {
  const bars = 18;
  return (
    <div className="wave" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const shape = Math.sin((i / (bars - 1)) * Math.PI);
        return (
          <motion.i key={i} animate={{ height: active ? 4 + shape * (6 + level * 60) * (0.6 + Math.random() * 0.4) : 4 }}
            transition={{ type: "spring", stiffness: 500, damping: 18 }} />
        );
      })}
    </div>
  );
}

function ActionCard({ a }: { a: Action }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const labels: Record<string, [string, string]> = {
    start_bid: ["Ouvrir l'espace d'offre", "Open bid workspace"], mark_irrelevant: ["Marquer non pertinent", "Mark not relevant"],
    create_task: ["Créer la tâche", "Create task"], open_opportunity: ["Ouvrir", "Open"],
  };
  const run = async () => {
    setState("busy");
    haptic(10);
    try {
      if (a.type === "start_bid" && a.opportunity_id) {
        try {
          const bid = await api("/bids", { method: "POST", json: { opportunity_id: a.opportunity_id } });
          router.push(`/bids/${bid.id}`);
        } catch {
          const bids = await api("/bids");
          const found = bids.items.find((b: any) => b.opportunity_id === a.opportunity_id);
          if (found) router.push(`/bids/${found.id}`);
        }
      } else if (a.type === "create_task") {
        await api("/tasks", { method: "POST", json: { title: a.title, source: "ai" } });
      } else if (a.type === "mark_irrelevant" && a.opportunity_id) {
        const m = await api(`/opportunities/${a.opportunity_id}`);
        if (m.match?.id) await api(`/matches/${m.match.id}`, { method: "PATCH", json: { status: "DISMISSED" } });
      } else if (a.href) router.push(a.href);
      setState("done");
    } catch {
      setState("idle");
    }
  };
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card"
      style={{ padding: 12, borderColor: "var(--accent)", display: "flex", gap: 10, alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="faint">{lang === "fr" ? "Action proposée — à confirmer" : "Proposed action — confirm"}</div>
        <div className="item-title clamp2">{a.opportunity_title ?? a.title}</div>
      </div>
      <button className="btn accent sm" onClick={run} disabled={state !== "idle"}>
        {state === "busy" ? <LoaderCircle size={14} className="spin" /> : state === "done" ? <Check size={14} /> : null}
        {state === "done" ? t("done") : labels[a.type]?.[lang === "fr" ? 0 : 1] ?? a.type}
      </button>
    </motion.div>
  );
}

function Bubble({ m, onSpeak }: { m: Msg; onSpeak: (t: string) => void }) {
  const { t } = useI18n();
  if (m.role === "user") {
    return <motion.div className="bubble user" initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}>{m.text}</motion.div>;
  }
  return (
    <motion.div className="col" style={{ gap: 8, alignSelf: "stretch" }} initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }} transition={spring}>
      {!!m.steps?.length && (
        <div className="row" style={{ gap: 6 }}>
          <AnimatePresence>
            {m.steps.map((s, i) => (
              <motion.span key={`${s.name}-${i}`} className="step" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                {s.status === "running" ? <LoaderCircle size={12} className="spin" /> : <Check size={12} color="var(--accent)" />}
                {s.label}{s.summary ? ` · ${s.summary}` : ""}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}
      {(m.text || m.pending) && (
        <div className="bubble bot">
          {m.text || <span className="muted row" style={{ gap: 6 }}><Dots />{t("thinking")}</span>}
          {m.pending && m.text && <span className="caret" />}
        </div>
      )}
      {!m.pending && !!m.citations?.length && (
        <div className="row" style={{ gap: 6 }}>
          {m.citations.map((c) => <Link key={c.href} href={c.href} className="chip neutral" style={{ maxWidth: 260 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span></Link>)}
        </div>
      )}
      {!m.pending && m.actions?.map((a, i) => <ActionCard key={i} a={a} />)}
      {!m.pending && m.text && (
        <div className="row faint" style={{ gap: 8 }}>
          <button className="btn ghost sm" onClick={() => onSpeak(m.speech ?? m.text)}><Volume2 size={14} />{t("speak")}</button>
          <span>{m.mode === "llm" ? `IA · ${m.provider}` : m.mode === "llm_rejected" ? "IA vérifiée → réponse déterministe" : "FORSA"}</span>
        </div>
      )}
    </motion.div>
  );
}

function Dots() {
  return (
    <span className="row" style={{ gap: 3 }}>
      {[0, 1, 2].map((i) => <motion.i key={i} style={{ width: 5, height: 5, borderRadius: 3, background: "var(--muted)", display: "block" }}
        animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />)}
    </span>
  );
}

export function AssistantChat({ compact }: { compact?: boolean }) {
  const { t, lang } = useI18n();
  const { messages, ask, busy, speak, speaking, stopSpeaking, reset, focus } = useAssistant();
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const onFinal = useCallback((heard: string) => { setText(""); ask(heard); }, [ask]);
  const dict = useDictation(lang, onFinal);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    ask(text);
    setText("");
  };

  return (
    <div className="col" style={{ height: "100%", gap: 0, minHeight: 0 }}>
      <div ref={scroller} className="col" style={{ flex: 1, overflowY: "auto", padding: compact ? "8px 16px" : "8px 4px", gap: 14 }}>
        {messages.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="col" style={{ gap: 14, marginTop: 12 }}>
            <div className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
              <motion.div className="orb" animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 3, repeat: Infinity }}>
                <Sparkles size={20} /></motion.div>
              <p className="muted">{t("assistantHello")}</p>
            </div>
            {focus && <span className="chip ai">{lang === "fr" ? "Contexte : l'opportunité ouverte" : "Context: the open opportunity"}</span>}
            <h3 style={{ marginTop: 8 }}>{t("quickPrompts")}</h3>
            <div className="row" style={{ gap: 8 }}>
              {PROMPTS[lang].map((p) => <motion.button key={p} className="pick" whileTap={{ scale: 0.95 }} onClick={() => ask(p)}>{p}</motion.button>)}
            </div>
          </motion.div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} onSpeak={speak} />)}
      </div>
      <form onSubmit={submit} className="col" style={{ padding: compact ? "10px 16px 14px" : "12px 0 0", gap: 8,
        borderTop: "1px solid var(--border)" }}>
        <AnimatePresence>
          {dict.listening && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="row" style={{ gap: 12, overflow: "hidden" }}>
              <Waveform level={dict.level} active />
              <span className="muted">{dict.interim || t("listening")}</span>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          {messages.length > 0 && <button type="button" className="btn icon ghost" onClick={reset} aria-label={t("newChat")}><RefreshCw size={16} /></button>}
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("askAnything")} aria-label={t("askAnything")}
            style={{ height: 46, borderRadius: 16 }} dir="auto" />
          {speaking ? (
            <button type="button" className="btn icon" style={{ height: 46, width: 46, borderRadius: 16 }} onClick={stopSpeaking}
              aria-label={t("stop")}><VolumeX size={18} /></button>
          ) : null}
          {dict.supported && (
            <motion.button type="button" className={`btn icon ${dict.listening ? "accent" : ""}`} whileTap={{ scale: 0.9 }}
              style={{ height: 46, width: 46, borderRadius: 16 }} aria-label="Micro"
              onClick={() => { haptic(12); dict.listening ? dict.stop() : dict.start(); }}>
              {dict.listening ? <Square size={16} /> : <Mic size={18} />}
            </motion.button>
          )}
          <motion.button type="submit" className="btn primary icon" whileTap={{ scale: 0.9 }} disabled={busy || !text.trim()}
            style={{ height: 46, width: 46, borderRadius: 16 }} aria-label="Send"><Send size={17} /></motion.button>
        </div>
        <span className="faint" style={{ textAlign: "center" }}>{t("grounded")}</span>
      </form>
    </div>
  );
}

export function AssistantPanel() {
  const { open, setOpen } = useAssistant();
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={() => setOpen(false)} label={t("assistant")}>
      <div className="row between" style={{ padding: "14px 16px 6px", flexWrap: "nowrap" }}>
        <div className="row" style={{ gap: 10 }}><div className="orb" style={{ width: 32, height: 32 }}><Sparkles size={16} /></div>
          <b>{t("assistant")}</b></div>
        <button className="btn icon ghost" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}><AssistantChat compact /></div>
    </Sheet>
  );
}
