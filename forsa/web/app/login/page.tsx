"use client";

import { motion } from "motion/react";
import { ArrowRight, Eye, EyeOff, FileSearch, Radar, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { ErrorBox, Segmented } from "@/components/ui";
import { api, safeSet } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { spring } from "@/lib/motion";

/** Signature visual: a radar sweep that surfaces opportunities — what FORSA does, in one image. */
function RadarVisual() {
  const dots = [[0.62, 0.3], [0.28, 0.42], [0.72, 0.66], [0.44, 0.74], [0.35, 0.22], [0.8, 0.45]];
  return (
    <div style={{ position: "relative", width: "min(420px, 80%)", aspectRatio: "1" }} aria-hidden>
      {[1, 0.74, 0.48, 0.22].map((s) => (
        <div key={s} style={{ position: "absolute", inset: `${(1 - s) * 50}%`, borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.14)" }} />
      ))}
      <motion.div style={{ position: "absolute", inset: 0, borderRadius: "50%",
        background: "conic-gradient(from 0deg, transparent 0deg, rgba(95,224,185,0.0) 270deg, rgba(95,224,185,0.45) 360deg)" }}
        animate={{ rotate: 360 }} transition={{ duration: 5, repeat: Infinity, ease: "linear" }} />
      {dots.map(([x, y], i) => (
        <motion.span key={i} style={{ position: "absolute", left: `${x * 100}%`, top: `${y * 100}%`, width: 12, height: 12,
          marginLeft: -6, marginTop: -6, borderRadius: 6, background: i % 3 === 0 ? "#f3c86b" : "#5fe0b9",
          boxShadow: "0 0 0 6px rgba(95,224,185,0.15)" }}
          animate={{ scale: [0, 1.25, 1, 1, 0], opacity: [0, 1, 1, 0.9, 0] }}
          transition={{ duration: 5, repeat: Infinity, delay: i * 0.8, times: [0, 0.1, 0.2, 0.8, 1] }} />
      ))}
      <div style={{ position: "absolute", inset: "44%", borderRadius: "50%", background: "#fff", boxShadow: "0 0 30px rgba(95,224,185,0.8)" }} />
    </div>
  );
}

export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ memberships: { org_id: string }[] }>("/auth/login", { method: "POST", json: { email, password } });
      safeSet("forsa.org", res.memberships[0]?.org_id ?? null);
      router.replace("/");
    } catch (err) {
      setError(err);
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const points: [React.ReactNode, string][] = lang === "fr"
    ? [[<Radar key="r" size={18} />, "Chaque marché public et bailleur, surveillé en continu"],
      [<FileSearch key="f" size={18} />, "Chaque recommandation citée à sa source"],
      [<ShieldCheck key="s" size={18} />, "Vos données isolées, vos décisions approuvées par des humains"]]
    : [[<Radar key="r" size={18} />, "Every public and donor tender, continuously watched"],
      [<FileSearch key="f" size={18} />, "Every recommendation cited to its source"],
      [<ShieldCheck key="s" size={18} />, "Your data isolated, your decisions approved by humans"]];

  return (
    <div className="auth">
      <aside className="auth-hero">
        <div className="row" style={{ gap: 10 }}><Logo size={34} /><b style={{ letterSpacing: "0.16em", fontSize: 16 }}>FORSA</b></div>
        <div style={{ display: "grid", placeItems: "center", flex: 1 }}><RadarVisual /></div>
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          style={{ fontSize: "clamp(28px, 3vw, 40px)", maxWidth: 520 }}>
          {lang === "fr" ? "Trouvez les marchés que vous pouvez gagner." : "Find the tenders you can win."}</motion.h1>
        <div className="col" style={{ gap: 10, marginTop: 18 }}>
          {points.map(([icon, s], i) => (
            <motion.div key={s} className="row" style={{ gap: 12, flexWrap: "nowrap", opacity: 0.9 }} initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 0.9, x: 0 }} transition={{ delay: 0.35 + i * 0.1 }}>{icon}<span>{s}</span></motion.div>
          ))}
        </div>
      </aside>
      <main className="auth-main">
        <div style={{ position: "absolute", top: 18, right: 18 }}>
          <Segmented id="login-lang" value={lang} onChange={setLang} options={[{ value: "fr", label: "FR" }, { value: "en", label: "EN" }]} />
        </div>
        <motion.form key={shake} onSubmit={submit} className="col" style={{ width: "min(380px, 100%)", gap: 16 }}
          initial={shake ? { x: 0 } : { opacity: 0, y: 16 }} animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : { opacity: 1, y: 0 }}
          transition={shake ? { duration: 0.4 } : spring}>
          <div className="show-m" style={{ marginBottom: 8 }}><Logo size={52} /></div>
          <div>
            <h1>{lang === "fr" ? "Bon retour" : "Welcome back"}</h1>
            <p className="muted" style={{ marginTop: 6 }}>{lang === "fr" ? "Intelligence commerciale fondée sur les preuves."
              : "Evidence-first commercial intelligence."}</p>
          </div>
          <ErrorBox error={error} />
          <label className="field">{t("email")}
            <input type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              style={{ height: 48, fontSize: 16 }} /></label>
          <label className="field">{t("password")}
            <span style={{ position: "relative", display: "block" }}>
              <input type={show ? "text" : "password"} autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} required style={{ height: 48, fontSize: 16, paddingRight: 46 }} />
              <button type="button" className="btn icon ghost sm" style={{ position: "absolute", right: 8, top: 9 }}
                onClick={() => setShow(!show)} aria-label="Show password">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </span></label>
          <motion.button className="btn accent lg" type="submit" disabled={busy} whileTap={{ scale: 0.97 }}>
            {busy ? <span className="spin" style={{ display: "inline-flex" }}>◌</span> : <>{t("signin")}<ArrowRight size={18} /></>}
          </motion.button>
          <p className="faint" style={{ textAlign: "center" }}>{lang === "fr" ? "Accès sur invitation de votre organisation."
            : "Access by invitation from your organisation."}</p>
        </motion.form>
      </main>
    </div>
  );
}
