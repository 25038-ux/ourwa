"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { safeGet } from "./api";
import { usePrefs } from "./prefs";

export type Step = { name: string; label: string; status: "running" | "done"; summary?: string };
export type Action = { type: string; opportunity_id?: string; opportunity_title?: string; title?: string; href?: string };
export type Msg = {
  id: string; role: "user" | "bot"; text: string; steps?: Step[]; citations?: { label: string; href: string }[];
  actions?: Action[]; mode?: string; provider?: string | null; pending?: boolean; speech?: string;
};

type Ctx = {
  open: boolean; setOpen: (v: boolean) => void; messages: Msg[]; busy: boolean; ask: (text: string) => Promise<void>;
  focus: string | null; setFocus: (id: string | null) => void; reset: () => void; speaking: boolean;
  speak: (text: string) => void; stopSpeaking: () => void;
};
const AssistantCtx = createContext<Ctx | null>(null);

const LOCALES: Record<string, string> = { fr: "fr-FR", en: "en-US", ar: "ar-SA" };

export function AssistantProvider({ children, lang }: { children: ReactNode; lang: string }) {
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const conv = useRef<string | null>(null);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !prefs.voice) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const locale = LOCALES[/[؀-ۿ]/.test(text) ? "ar" : lang] ?? "fr-FR";
    u.lang = locale;
    const voices = window.speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.voiceURI === prefs.voiceURI) ?? voices.find((v) => v.lang.startsWith(locale.slice(0, 2))) ?? null;
    u.rate = 1.02;
    u.onstart = () => setSpeaking(true);
    u.onend = u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, [lang, prefs.voice, prefs.voiceURI]);

  const ask = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    stopSpeaking();
    setBusy(true);
    const uid = crypto.randomUUID(), bid = crypto.randomUUID();
    setMessages((m) => [...m, { id: uid, role: "user", text: q }, { id: bid, role: "bot", text: "", steps: [], pending: true }]);
    const patch = (fn: (m: Msg) => Msg) => setMessages((all) => all.map((m) => (m.id === bid ? fn(m) : m)));
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", "X-Requested-With": "forsa" };
      const org = safeGet("forsa.org");
      if (org) headers["X-Org-Id"] = org;
      const res = await fetch("/api/v1/assistant/messages", {
        method: "POST", credentials: "same-origin", headers,
        body: JSON.stringify({ text: q, lang, conversation_id: conv.current, opportunity_id: focus }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!data) continue;
          const ev = JSON.parse(data.slice(6));
          if (ev.type === "meta") conv.current = ev.conversation_id;
          else if (ev.type === "tool") patch((m) => {
            const steps = [...(m.steps ?? [])];
            const i = steps.findIndex((s) => s.name === ev.name && s.status === "running");
            if (ev.status === "running") steps.push({ name: ev.name, label: ev.label, status: "running" });
            else if (i >= 0) steps[i] = { ...steps[i], status: "done", summary: ev.summary };
            return { ...m, steps };
          });
          else if (ev.type === "delta") patch((m) => ({ ...m, text: m.text + ev.text }));
          else if (ev.type === "final") {
            patch((m) => ({ ...m, text: ev.text, citations: ev.citations, actions: ev.actions, mode: ev.mode,
              provider: ev.provider, pending: false, speech: ev.speech }));
            if (prefs.autoSpeak) speak(ev.speech);
          } else if (ev.type === "error") patch((m) => ({ ...m, text: ev.message, pending: false }));
        }
      }
    } catch (e) {
      patch((m) => ({ ...m, text: lang === "fr" ? "Connexion interrompue. Réessayez." : "Connection lost. Try again.",
        pending: false }));
    } finally {
      setBusy(false);
    }
  }, [busy, focus, lang, prefs.autoSpeak, speak, stopSpeaking]);

  const reset = useCallback(() => {
    conv.current = null;
    setMessages([]);
    stopSpeaking();
  }, [stopSpeaking]);

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  return (
    <AssistantCtx.Provider value={{ open, setOpen, messages, busy, ask, focus, setFocus, reset, speaking, speak, stopSpeaking }}>
      {children}
    </AssistantCtx.Provider>
  );
}

export function useAssistant(): Ctx {
  const c = useContext(AssistantCtx);
  if (!c) throw new Error("AssistantProvider missing");
  return c;
}

/** Speech-to-text through the browser (on-device or the browser vendor's service) + live input level. */
export function useDictation(lang: string, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const rec = useRef<any>(null);
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const supported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const stopLevel = () => {
    if (!audio.current) return;
    cancelAnimationFrame(audio.current.raf);
    audio.current.stream.getTracks().forEach((t) => t.stop());
    audio.current.ctx.close().catch(() => undefined);
    audio.current = null;
    setLevel(0);
  };

  const stop = useCallback(() => {
    rec.current?.stop();
    setListening(false);
    stopLevel();
  }, []);

  const start = useCallback(async () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = LOCALES[lang] ?? "fr-FR";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e: any) => {
      let fin = "", tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else tmp += t;
      }
      setInterim(tmp || fin);
      if (fin) onFinal(fin);
    };
    r.onend = () => { setListening(false); setInterim(""); stopLevel(); };
    r.onerror = () => { setListening(false); stopLevel(); };
    rec.current = r;
    r.start();
    setListening(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        setLevel(buf.reduce((a, b) => a + b, 0) / buf.length / 255);
        if (audio.current) audio.current.raf = requestAnimationFrame(tick);
      };
      audio.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch {
      /* level meter optional */
    }
  }, [lang, onFinal]);

  return { supported, listening, interim, level, start, stop };
}
