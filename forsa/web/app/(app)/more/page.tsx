"use client";

import { motion } from "motion/react";
import { Bell, Building2, ChevronRight, Languages, ListTodo, LogOut, Moon, Radio, Settings, Sparkles, Sun, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Segmented } from "@/components/ui";
import { api, safeSet } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useLive } from "@/lib/live";
import { fadeUp, haptic, stagger } from "@/lib/motion";
import { usePrefs } from "@/lib/prefs";
import { useApi } from "@/lib/store";

type Me = { user: { full_name: string; email: string }; memberships: { org_id: string; org_name: string; role: string }[] };

function Tile({ href, icon, label, tint, badge }: { href: string; icon: ReactNode; label: string; tint: string; badge?: number }) {
  return (
    <motion.div variants={fadeUp} whileTap={{ scale: 0.96 }}>
      <Link href={href} className="card" onClick={() => haptic(6)} style={{ display: "flex", flexDirection: "column", gap: 14,
        padding: 16, position: "relative" }}>
        <span style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center", color: tint,
          background: `color-mix(in srgb, ${tint} 13%, transparent)` }}>{icon}</span>
        <b>{label}</b>
        {!!badge && <span className="chip HIGH num" style={{ position: "absolute", top: 14, right: 14 }}>{badge}</span>}
      </Link>
    </motion.div>
  );
}

export default function More() {
  const { t, lang, setLang } = useI18n();
  const { prefs, set } = usePrefs();
  const theme = prefs.theme;
  const setTheme = (v: typeof theme) => set({ theme: v });
  const { unread } = useLive();
  const { data: me } = useApi<Me>("/auth/me", { maxAgeMs: 60_000 });
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    safeSet("forsa.org", null);
    window.location.href = "/login";
  };
  return (
    <motion.div className="stack" variants={stagger(0.04)} initial="hidden" animate="show">
      <motion.div variants={fadeUp} className="card row" style={{ gap: 14, flexWrap: "nowrap" }}>
        <div className="orb" style={{ width: 52, height: 52, fontSize: 20, fontWeight: 700 }}>{me?.user.full_name.slice(0, 1) ?? "·"}</div>
        <div style={{ minWidth: 0 }}>
          <div className="item-title" style={{ fontSize: 17 }}>{me?.user.full_name ?? "…"}</div>
          <div className="faint">{me?.memberships[0]?.org_name} · {me?.memberships[0]?.role}</div>
        </div>
      </motion.div>
      <div className="grid g2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <Tile href="/tasks" icon={<ListTodo size={20} />} label={t("tasks")} tint="var(--review)" />
        <Tile href="/company" icon={<Building2 size={20} />} label={t("company")} tint="var(--accent)" />
        <Tile href="/notifications" icon={<Bell size={20} />} label={t("notifications")} tint="var(--nobid)" badge={unread} />
        <Tile href="/team" icon={<Users size={20} />} label={t("team")} tint="var(--gold)" />
        <Tile href="/assistant" icon={<Sparkles size={20} />} label={t("assistant")} tint="var(--accent-2)" />
        <Tile href="/sources" icon={<Radio size={20} />} label={t("sources")} tint="var(--cond)" />
      </div>
      <motion.div variants={fadeUp} className="card flush">
        <div className="item between"><span className="row" style={{ gap: 12 }}><Languages size={18} />{t("language")}</span>
          <Segmented id="more-lang" value={lang} onChange={setLang} options={[{ value: "fr", label: "FR" }, { value: "en", label: "EN" }]} /></div>
        <div className="item between" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="row" style={{ gap: 12 }}>{theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}{t("theme")}</span>
          <Segmented id="more-theme" value={theme} onChange={setTheme} options={[{ value: "system", label: "Auto" },
            { value: "light", label: <Sun size={14} /> }, { value: "dark", label: <Moon size={14} /> }]} /></div>
        <Link href="/settings" className="item between" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="row" style={{ gap: 12 }}><Settings size={18} />{t("settings")}</span><ChevronRight size={18} color="var(--faint)" /></Link>
      </motion.div>
      <motion.button variants={fadeUp} className="btn lg danger" style={{ width: "100%" }} onClick={logout}>
        <LogOut size={18} />{t("logout")}</motion.button>
      <p className="faint" style={{ textAlign: "center" }}>FORSA · {lang === "fr" ? "Intelligence commerciale fondée sur les preuves"
        : "Evidence-first commercial intelligence"}</p>
    </motion.div>
  );
}
