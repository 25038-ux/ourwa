"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bell, Bot, Check, Cpu, Globe, KeyRound, LoaderCircle, Monitor, Moon, Palette, Sun, User, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, Chip, ErrorBox, PageHead, Segmented, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { CATEGORY_LABEL, useI18n } from "@/lib/i18n";
import { fadeUp, stagger } from "@/lib/motion";
import { usePrefs, type Theme } from "@/lib/prefs";
import { useApi } from "@/lib/store";

type Tab = "profile" | "notifications" | "appearance" | "voice" | "ai";

function Saved({ show }: { show: boolean }) {
  const { t } = useI18n();
  return <AnimatePresence>{show && <motion.span className="chip BID" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
    <Check size={12} />{t("saved")}</motion.span>}</AnimatePresence>;
}

function Profile() {
  const { t, lang, setLang } = useI18n();
  const { data: me } = useApi<any>("/auth/me");
  const [name, setName] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (me) setName(me.user.full_name); }, [me]);
  const flash = (k: string) => { setOk(k); setTimeout(() => setOk(null), 1800); };
  return (
    <div className="stack">
      <Card title={t("profile")} icon={<User size={16} />}>
        <div className="grid g2">
          <label className="field">{t("fullName")}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">{t("email")}<input value={me?.user.email ?? ""} disabled /></label>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => api("/me/profile", { method: "PUT", json: { full_name: name, locale: lang } })
            .then(() => flash("p")).catch(setError)}>{t("save")}</button><Saved show={ok === "p"} />
        </div>
      </Card>
      <Card title={t("language")} icon={<Globe size={16} />}>
        <Segmented id="lang" value={lang} onChange={setLang} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} />
      </Card>
      <Card title={t("changePassword")} icon={<KeyRound size={16} />}>
        <ErrorBox error={error} />
        <div className="grid g2">
          <label className="field">{t("currentPassword")}<input type="password" autoComplete="current-password" value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label className="field">{t("newPassword")}<input type="password" autoComplete="new-password" value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" disabled={pw.next.length < 10} onClick={() => api("/me/password", { method: "POST",
            json: { current: pw.current, new: pw.next } }).then(() => { setPw({ current: "", next: "" }); flash("pw"); setError(null); })
            .catch(setError)}>{t("changePassword")}</button><Saved show={ok === "pw"} />
        </div>
      </Card>
    </div>
  );
}

function Notifications() {
  const { t, lang } = useI18n();
  const { data, mutate } = useApi<{ categories: string[]; prefs: Record<string, { in_app: boolean; push: boolean }> }>(
    "/me/notification-preferences");
  const [saved, setSaved] = useState(false);
  if (!data) return null;
  const toggle = async (cat: string, key: "in_app" | "push", v: boolean) => {
    const prefs = { ...data.prefs, [cat]: { ...data.prefs[cat], [key]: v } };
    await api("/me/notification-preferences", { method: "PUT", json: { prefs } });
    await mutate();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <Card title={t("notifications")} icon={<Bell size={16} />} action={<Saved show={saved} />} flush>
      <table>
        <thead><tr><th /><th style={{ width: 90 }}>In-app</th><th style={{ width: 90 }}>Push</th></tr></thead>
        <tbody>
          {data.categories.map((c) => (
            <tr key={c}>
              <td>{CATEGORY_LABEL[c]?.[lang] ?? c}</td>
              <td><Switch on={data.prefs[c].in_app} onChange={(v) => toggle(c, "in_app", v)} label={`${c} in-app`} /></td>
              <td><Switch on={data.prefs[c].push} onChange={(v) => toggle(c, "push", v)} label={`${c} push`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Appearance() {
  const { t } = useI18n();
  const { prefs, set } = usePrefs();
  return (
    <Card title={t("appearance")} icon={<Palette size={16} />}>
      <h3>{t("theme")}</h3>
      <Segmented<Theme> id="theme" value={prefs.theme} onChange={(v) => set({ theme: v })} options={[
        { value: "system", label: <span className="row" style={{ gap: 6 }}><Monitor size={14} />{t("system")}</span> },
        { value: "light", label: <span className="row" style={{ gap: 6 }}><Sun size={14} />{t("light")}</span> },
        { value: "dark", label: <span className="row" style={{ gap: 6 }}><Moon size={14} />{t("dark")}</span> }]} />
      <p className="faint" style={{ marginTop: 14 }}>Motion respects your system&apos;s “reduce motion” setting.</p>
    </Card>
  );
}

function Voice() {
  const { t, lang } = useI18n();
  const { prefs, set } = usePrefs();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => setVoices(window.speechSynthesis.getVoices().filter((v) => /^(fr|en|ar)/.test(v.lang)));
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);
  const test = () => {
    const u = new SpeechSynthesisUtterance(lang === "fr" ? "Bonjour, je suis l'assistant FORSA." : "Hello, I am the FORSA assistant.");
    u.voice = voices.find((v) => v.voiceURI === prefs.voiceURI) ?? null;
    u.lang = lang === "fr" ? "fr-FR" : "en-US";
    window.speechSynthesis.speak(u);
  };
  return (
    <Card title={t("voice")} icon={<Volume2 size={16} />}>
      <div className="col" style={{ gap: 14 }}>
        <div className="row between"><span>{t("voiceReplies")}</span><Switch on={prefs.voice} onChange={(v) => set({ voice: v })} /></div>
        <div className="row between"><span>{t("autoSpeak")}</span><Switch on={prefs.autoSpeak} onChange={(v) => set({ autoSpeak: v })} /></div>
        <label className="field">{t("voiceChoice")}
          <select value={prefs.voiceURI ?? ""} onChange={(e) => set({ voiceURI: e.target.value || null })}>
            <option value="">Auto</option>
            {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}
          </select>
        </label>
        <div><button className="btn" onClick={test}><Volume2 size={15} />{t("speak")}</button></div>
        <p className="faint">{lang === "fr" ? "La dictée et la voix utilisent les moteurs de votre navigateur/appareil."
          : "Dictation and speech use your browser/device engines."}</p>
      </div>
    </Card>
  );
}

type Provider = { id: string; name: string; kind: string; region: string; free_tier: boolean; key_present: boolean; needs_key: boolean;
  api_key_env: string | null; enabled: boolean; requested: boolean; priority: number; models: Record<string, string>;
  max_sensitivity: string; dpa_reviewed: boolean; docs_url: string | null; verified_defaults: boolean };

function ProviderRow({ p, onChange }: { p: Provider; onChange: () => void }) {
  const { lang } = useI18n();
  const [models, setModels] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (body: Record<string, unknown>) => api(`/admin/ai/providers/${p.id}`, { method: "PUT", json: body }).then(onChange);
  const discover = async () => {
    setBusy(true);
    const r = await api(`/admin/ai/providers/${p.id}/discover`, { method: "POST" });
    setBusy(false);
    if (r.ok) setModels(r.models); else setMsg(r.error);
  };
  const test = async () => {
    setBusy(true);
    const r = await api(`/admin/ai/providers/${p.id}/test`, { method: "POST" });
    setBusy(false);
    setMsg(`${r.ok ? "✓" : "✕"} ${r.detail ?? r.error ?? ""} · ${r.latency_ms ?? "?"} ms`);
  };
  const tier = p.kind === "typesafe_system_one" ? "decision" : "fast";
  return (
    <motion.div variants={fadeUp} className="card" style={{ padding: 14 }}>
      <div className="row between" style={{ flexWrap: "nowrap" }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}><b>{p.name}</b><span className="chip neutral">{p.region}</span>
            {p.free_tier && <span className="chip BID">free tier</span>}
            {p.kind === "typesafe_system_one" && <span className="chip ai">decision model</span>}</div>
          <div className="faint" style={{ marginTop: 4 }}>
            {p.needs_key ? (p.key_present ? <>✓ {p.api_key_env}</> : <>✕ {lang === "fr" ? "définir" : "set"} <span className="mono">{p.api_key_env}</span></>)
              : "no key needed"} · {Object.entries(p.models).map(([k, v]) => `${k}: ${v}`).join(" · ") || "no model pinned"}</div>
        </div>
        <Switch on={p.requested} onChange={(v) => update({ enabled: v })} label={`enable ${p.id}`} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <span className={`chip ${p.enabled ? "BID" : "neutral"}`}>{p.enabled ? "active" : "inactive"}</span>
        <select value={p.max_sensitivity} onChange={(e) => update({ max_sensitivity: e.target.value })} style={{ width: "auto", height: 30 }}
          aria-label="data ceiling">
          <option value="public">public data only</option><option value="internal">internal</option><option value="confidential">confidential</option>
        </select>
        <label className="row faint" style={{ gap: 6 }}><Switch on={p.dpa_reviewed} onChange={(v) => update({ dpa_reviewed: v })} />DPA reviewed</label>
        <button className="btn sm" onClick={discover} disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <Cpu size={13} />}Discover models</button>
        <button className="btn sm" onClick={test} disabled={busy}>Test</button>
        {p.docs_url && <a className="btn ghost sm" href={p.docs_url} target="_blank" rel="noreferrer">Docs ↗</a>}
      </div>
      {models && (
        <select style={{ marginTop: 10 }} onChange={(e) => e.target.value && update({ [`${tier}_model`]: e.target.value })} defaultValue="">
          <option value="">{lang === "fr" ? `Épingler un modèle ${tier}…` : `Pin a ${tier} model…`} ({models.length})</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      )}
      {msg && <p className="faint" style={{ marginTop: 8 }}>{msg}</p>}
    </motion.div>
  );
}

function Providers() {
  const { t, lang } = useI18n();
  const { data, mutate, error } = useApi<{ items: Provider[] }>("/admin/ai/providers");
  if (error) return <Card title={t("aiProviders")} icon={<Bot size={16} />}><p className="muted">{lang === "fr"
    ? "Réservé aux administrateurs de la plateforme." : "Platform administrators only."}</p></Card>;
  const groups: [string, (p: Provider) => boolean][] = [
    ["Decision models", (p) => p.kind === "typesafe_system_one"],
    ["Frontier", (p) => ["anthropic", "openai", "gemini", "mistral"].includes(p.id)],
    [lang === "fr" ? "Modèles chinois" : "Chinese labs", (p) => p.region === "CN"],
    [lang === "fr" ? "Gratuits / free tier" : "Free / free tier", (p) => ["nvidia", "groq", "openrouter", "cerebras", "huggingface"].includes(p.id)],
    ["Local", (p) => p.region === "local"],
  ];
  return (
    <div className="stack">
      <p className="muted">{lang === "fr"
        ? "Les clés API se configurent uniquement dans l'environnement du serveur — jamais ici. Plafond de données : un fournisseur ne reçoit que des données de sensibilité inférieure ou égale."
        : "API keys are configured only in the server environment — never here. Data ceiling: a provider only receives data at or below its level."}</p>
      {groups.map(([label, fn]) => (
        <div key={label} className="stack">
          <h3>{label}</h3>
          <motion.div className="grid g2" variants={stagger(0.04)} initial="hidden" animate="show">
            {data?.items.filter(fn).map((p) => <ProviderRow key={p.id} p={p} onChange={() => mutate()} />)}
          </motion.div>
        </div>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("profile");
  const tabs: { value: Tab; label: React.ReactNode }[] = [
    { value: "profile", label: t("profile") }, { value: "notifications", label: t("notifications") },
    { value: "appearance", label: t("appearance") }, { value: "voice", label: t("voice") }, { value: "ai", label: "IA" },
  ];
  return (
    <div className="stack">
      <PageHead title={t("settings")} />
      <div style={{ overflowX: "auto" }}><Segmented id="settings" value={tab} onChange={setTab} options={tabs} /></div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.22 }}>
          {tab === "profile" && <Profile />}
          {tab === "notifications" && <Notifications />}
          {tab === "appearance" && <Appearance />}
          {tab === "voice" && <Voice />}
          {tab === "ai" && <Providers />}
        </motion.div>
      </AnimatePresence>
      <Chip kind="neutral">FORSA v0.2</Chip>
    </div>
  );
}
