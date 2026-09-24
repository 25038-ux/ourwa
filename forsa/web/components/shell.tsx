"use client";

import { AnimatePresence, motion, useScroll, useMotionValueEvent } from "motion/react";
import {
  Bell, BellRing, Briefcase, Building2, ChevronLeft, Ellipsis, House, ListTodo, Radar, Search, Settings, Sparkles, Users,
  Radio, TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useAssistant } from "@/lib/assistant";
import { CATEGORY_LABEL, useI18n } from "@/lib/i18n";
import { useLive } from "@/lib/live";
import { haptic, spring } from "@/lib/motion";
import { Logo } from "./logo";

type Me = { user: { full_name: string; is_platform_admin: boolean }; memberships: { org_id: string; org_name: string; role: string }[] };

export function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function Sidebar({ me, orgId, onSearch }: { me: Me; orgId: string | null; onSearch: () => void }) {
  const { t } = useI18n();
  const path = usePathname();
  const { unread } = useLive();
  const org = me.memberships.find((m) => m.org_id === orgId) ?? me.memberships[0];
  const main: [string, string, ReactNode][] = [
    ["/", t("command"), <House key="h" size={18} />],
    ["/opportunities", t("opportunities"), <Radar key="r" size={18} />],
    ["/assistant", t("assistant"), <Sparkles key="s" size={18} />],
    ["/bids", t("bids"), <Briefcase key="b" size={18} />],
    ["/market", t("market"), <TrendingUp key="mk" size={18} />],
    ["/tasks", t("tasks"), <ListTodo key="t" size={18} />],
    ["/company", t("company"), <Building2 key="c" size={18} />],
  ];
  const secondary: [string, string, ReactNode, number?][] = [
    ["/notifications", t("notifications"), <Bell key="n" size={18} />, unread],
    ["/team", t("team"), <Users key="u" size={18} />],
    ["/sources", t("sources"), <Radio key="so" size={18} />],
    ["/settings", t("settings"), <Settings key="se" size={18} />],
  ];
  const link = ([href, label, icon, count]: [string, string, ReactNode, number?]) => (
    <Link key={href} href={href} className="nav-link" data-active={isActive(path, href)}>
      {isActive(path, href) && <motion.span layoutId="nav-pill" className="nav-pill" transition={spring} />}
      {icon}<span>{label}</span>
      <AnimatePresence>
        {count ? (
          <motion.span className="count num" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring}
            key={count}>{count > 99 ? "99+" : count}</motion.span>
        ) : null}
      </AnimatePresence>
    </Link>
  );
  return (
    <aside className="side">
      <div className="brand"><Logo /><div><b>FORSA</b><small>{org?.org_name ?? "…"}</small></div></div>
      <button className="search-trigger" style={{ maxWidth: "none", marginBottom: 12, height: 38, flex: "none" }} onClick={onSearch}>
        <Search size={15} /><span style={{ fontSize: 13 }}>{t("askAnything")}</span><span className="kbd">⌘K</span>
      </button>
      {main.map(link)}
      <div className="sep" />
      {secondary.map(link)}
      <div className="spacer" />
      <UserCard me={me} role={org?.role} />
    </aside>
  );
}

function UserCard({ me, role }: { me: Me; role?: string }) {
  const { status } = useLive();
  const { t } = useI18n();
  return (
    <div className="row" style={{ padding: "10px 8px", gap: 10, flexWrap: "nowrap" }}>
      <div style={{ width: 34, height: 34, borderRadius: 12, background: "var(--surface-3)", display: "grid", placeItems: "center",
        fontWeight: 700 }}>{me.user.full_name.slice(0, 1)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {me.user.full_name}</div>
        <div className="faint row" style={{ gap: 6 }}>
          <span className={`dot ${status === "live" ? "live" : ""}`} />{status === "live" ? t("live") : t("reconnecting")} · {role}
        </div>
      </div>
    </div>
  );
}

export function TopBar({ onSearch }: { onSearch: () => void }) {
  const { t } = useI18n();
  const { unread, status } = useLive();
  const { setOpen } = useAssistant();
  return (
    <div className="topbar">
      <button className="search-trigger" onClick={onSearch}>
        <Search size={16} /><span>{t("search")}</span><span className="kbd">⌘K</span>
      </button>
      <div style={{ flex: 1 }} />
      <span className="faint row" style={{ gap: 6 }}><span className={`dot ${status === "live" ? "live" : ""}`} />
        {status === "live" ? t("live") : t("reconnecting")}</span>
      <Link href="/notifications" className="btn icon ghost" aria-label={t("notifications")} style={{ position: "relative" }}>
        {unread ? <BellRing size={18} /> : <Bell size={18} />}
        <AnimatePresence>
          {unread > 0 && (
            <motion.span key={unread} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring}
              className="num" style={{ position: "absolute", top: 3, right: 3, minWidth: 16, height: 16, borderRadius: 8,
                background: "var(--nobid)", color: "#fff", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center",
                padding: "0 4px" }}>{unread > 9 ? "9+" : unread}</motion.span>
          )}
        </AnimatePresence>
      </Link>
      <motion.button className="orb" whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }} onClick={() => setOpen(true)}
        aria-label={t("assistant")} style={{ width: 38, height: 38 }}>
        <Sparkles size={18} />
      </motion.button>
    </div>
  );
}

const TITLES: Record<string, string> = {
  "/": "command", "/opportunities": "opportunities", "/assistant": "assistant", "/bids": "bids", "/tasks": "tasks",
  "/company": "company", "/notifications": "notifications", "/team": "team", "/sources": "sources",
  "/settings": "settings", "/more": "more", "/market": "market",
};

export function MobileTop() {
  const path = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { unread } = useLive();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 8));
  const root = "/" + (path.split("/")[1] ?? "");
  const deep = path.split("/").filter(Boolean).length > 1;
  const key = TITLES[root] as Parameters<typeof t>[0] | undefined;
  return (
    <header className={`m-top ${scrolled ? "scrolled" : ""}`}>
      {deep ? (
        <button className="btn icon ghost" onClick={() => router.back()} aria-label="Back"><ChevronLeft size={22} /></button>
      ) : <Logo size={26} />}
      <motion.span className="m-title" key={path} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
        {key ? t(key) : "FORSA"}</motion.span>
      <div style={{ flex: 1 }} />
      <Link href="/notifications" className="btn icon ghost" aria-label={t("notifications")} style={{ position: "relative" }}>
        <Bell size={20} />
        {unread > 0 && <span style={{ position: "absolute", top: 7, right: 7, width: 9, height: 9, borderRadius: 5,
          background: "var(--nobid)", border: "2px solid var(--bg)" }} />}
      </Link>
    </header>
  );
}

export function TabBar() {
  const path = usePathname();
  const { t } = useI18n();
  const { setOpen } = useAssistant();
  const tabs: [string, string, ReactNode][] = [
    ["/", t("command"), <House key="h" size={22} />],
    ["/opportunities", t("opportunities"), <Radar key="r" size={22} />],
    ["#assistant", "", null],
    ["/bids", t("bids"), <Briefcase key="b" size={22} />],
    ["/more", t("more"), <Ellipsis key="m" size={22} />],
  ];
  return (
    <nav className="tabbar" aria-label="Tabs">
      {tabs.map(([href, label, icon]) => href === "#assistant" ? (
        <div key={href} style={{ display: "grid", placeItems: "center" }}>
          <motion.button className="tab-orb" whileTap={{ scale: 0.9 }} aria-label={t("assistant")}
            onClick={() => { haptic(12); setOpen(true); }}>
            <Sparkles size={24} />
          </motion.button>
        </div>
      ) : (
        <Link key={href} href={href} className="tab" data-active={isActive(path, href) || (href === "/more" &&
          ["/company", "/tasks", "/team", "/sources", "/settings", "/notifications", "/more", "/market"].some((p) => isActive(path, p)))}
          onClick={() => haptic(6)}>
          {(isActive(path, href)) && <motion.span layoutId="tab-dot" className="tab-dot" transition={spring} />}
          <motion.span whileTap={{ scale: 0.85 }} style={{ display: "grid" }}>{icon}</motion.span>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useLive();
  const { lang } = useI18n();
  const router = useRouter();
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div key={toast.key} className="toast" layout initial={{ opacity: 0, y: -30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.95, transition: { duration: 0.18 } }}
            transition={spring} drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.8, bottom: 0 }}
            onDragEnd={(_, i) => i.offset.y < -30 && dismiss(toast.key)}
            onClick={() => { dismiss(toast.key); router.push(toast.href); }}>
            <div className="orb" style={{ width: 34, height: 34 }}><BellRing size={16} /></div>
            <div style={{ minWidth: 0 }}>
              <div className="faint" style={{ fontWeight: 600 }}>{CATEGORY_LABEL[toast.category]?.[lang] ?? toast.category}</div>
              <div className="item-title clamp2">{toast.title}</div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
