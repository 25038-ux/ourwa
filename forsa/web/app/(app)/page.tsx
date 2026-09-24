"use client";

import { motion } from "motion/react";
import { ArrowUpRight, CalendarClock, CircleDashed, Flame, Radar, Sparkles, Telescope, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { AnimatedNumber, Card, DemoBadge, Empty, ErrorBox, FitRing, RecChip, Skeleton } from "@/components/ui";
import { useAssistant } from "@/lib/assistant";
import { date, days } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fadeUp, stagger } from "@/lib/motion";
import { useApi } from "@/lib/store";

type Item = { opportunity_id: string; title: string; fit: number; recommendation: string; deadline_days: number | null;
  blockers: string[]; is_synthetic: boolean; status: string };
type Briefing = { date: string; counts: Record<string, number>; top_action: (Item & { blocker: string | null }) | null;
  pursue: Item[]; deadlines: Item[]; early_signals: Item[]; missing_items: string[];
  changes: { opportunity_id: string; title: string; type: string }[];
  source_alerts: { key: string; name: string; health: string; detail: string }[] };

function greeting(t: ReturnType<typeof useI18n>["t"]) {
  const h = new Date().getHours();
  return h < 12 ? t("goodMorning") : h < 18 ? t("goodAfternoon") : t("goodEvening");
}

function Row({ item }: { item: Item }) {
  const { t } = useI18n();
  return (
    <motion.li variants={fadeUp}>
      <Link className="item" href={`/opportunities/${item.opportunity_id}`}>
        <FitRing score={item.fit} rec={item.recommendation} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="item-title clamp2">{item.title}</div>
          <div className="row faint" style={{ gap: 8, marginTop: 4 }}>
            <RecChip rec={item.recommendation} />
            {item.deadline_days !== null && <span className="num">{days(item.deadline_days, t("daysLeft"))}</span>}
            {item.blockers[0] && <span className="clamp2" style={{ maxWidth: 280 }}>· {item.blockers[0]}</span>}
            <DemoBadge show={item.is_synthetic} />
          </div>
        </div>
        <ArrowUpRight size={16} className="hide-m" color="var(--faint)" />
      </Link>
    </motion.li>
  );
}

export default function Today() {
  const { t, lang } = useI18n();
  const { setOpen, ask } = useAssistant();
  const { data: b, error } = useApi<Briefing>(`/briefing/today?lang=${lang}`);
  if (error) return <ErrorBox error={error} />;
  const stats: [string, number | undefined, React.ReactNode, string][] = [
    [t("highFit"), b?.counts.high_fit, <Flame key="f" size={16} />, "var(--accent)"],
    [t("deadlines"), b?.counts.deadlines, <CalendarClock key="d" size={16} />, "var(--cond)"],
    [t("missing"), b?.counts.missing_items, <TriangleAlert key="m" size={16} />, "var(--nobid)"],
    [t("early"), b?.counts.early_signals, <Telescope key="e" size={16} />, "var(--review)"],
    [t("newSignals"), b?.counts.new_signals, <Radar key="n" size={16} />, "var(--gold)"],
  ];
  const prompts = lang === "fr"
    ? ["Que dois-je poursuivre cette semaine ?", "Quelles échéances arrivent ?", "Trouve des partenaires"]
    : ["What should we pursue this week?", "Which deadlines are coming?", "Find partners"];

  return (
    <div className="stack">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
        <p className="faint" style={{ textTransform: "capitalize" }}>{b ? date(b.date, lang) : " "}</p>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 38px)" }}>{greeting(t)} 👋</h1>
        <p className="muted" style={{ marginTop: 6 }}>{t("today")}</p>
      </motion.div>

      {b?.source_alerts.map((a) => (
        <motion.div key={a.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="quote"
          style={{ borderColor: "var(--cond)" }}><b>{t("sourceAlert")} · {a.name}</b> — {a.health}: {a.detail}</motion.div>
      ))}

      <motion.div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}
        variants={stagger(0.06)} initial="hidden" animate="show">
        {stats.map(([label, n, icon, color]) => (
          <motion.div key={label} variants={fadeUp} className="card" style={{ padding: 16 }} whileHover={{ y: -2 }}>
            <div className="row between"><span className="faint">{label}</span><span style={{ color }}>{icon}</span></div>
            <div style={{ fontSize: 30, fontWeight: 700, marginTop: 6, letterSpacing: "-0.02em" }}>
              {n === undefined ? <Skeleton h={30} w={40} /> : <AnimatedNumber value={n} />}</div>
          </motion.div>
        ))}
      </motion.div>

      {b?.top_action && (
        <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="card" style={{ position: "relative", overflow: "hidden", padding: 22,
            background: "radial-gradient(600px 200px at 0% 0%, var(--accent-soft), transparent 70%), var(--surface)",
            borderColor: "color-mix(in srgb, var(--accent) 35%, var(--border))" }}>
          <motion.div aria-hidden style={{ position: "absolute", inset: -2, borderRadius: "inherit", pointerEvents: "none",
            background: "conic-gradient(from 0deg, transparent 0 80%, var(--accent-glow) 90%, transparent 100%)", opacity: 0.35,
            maskImage: "linear-gradient(#000, #000)", filter: "blur(18px)" }} animate={{ rotate: 360 }}
            transition={{ duration: 9, repeat: Infinity, ease: "linear" }} />
          <div className="row" style={{ gap: 18, position: "relative", flexWrap: "nowrap", alignItems: "center" }}>
            <FitRing score={b.top_action.fit} rec={b.top_action.recommendation} size={76} stroke={6} label />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ color: "var(--accent)" }}><Sparkles size={12} style={{ verticalAlign: -1 }} /> {t("topAction")}</h3>
              <Link href={`/opportunities/${b.top_action.opportunity_id}`} className="item-title clamp2" style={{ fontSize: 18 }}>
                {b.top_action.title}</Link>
              <div className="row muted" style={{ marginTop: 8, gap: 8 }}>
                <RecChip rec={b.top_action.recommendation} />
                {b.top_action.deadline_days !== null && <span>{t("deadline")} · <b className="num">
                  {days(b.top_action.deadline_days, t("daysLeft"))}</b></span>}
                {b.top_action.blocker && <span className="clamp2">· {b.top_action.blocker}</span>}
                <DemoBadge show={b.top_action.is_synthetic} />
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <motion.div className="row" style={{ gap: 8 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
        {prompts.map((p) => (
          <motion.button key={p} className="pick" whileTap={{ scale: 0.95 }} onClick={() => { setOpen(true); ask(p); }}>
            <Sparkles size={14} color="var(--accent)" />{p}
          </motion.button>
        ))}
      </motion.div>

      <div className="grid g-main">
        <div className="stack">
          <Card title={t("pursue")} icon={<Flame size={16} color="var(--accent)" />} flush delay={0.1}
            action={<Link href="/opportunities" className="btn ghost sm">{t("viewAll")}</Link>}>
            {!b ? <div style={{ padding: 18 }} className="col"><Skeleton h={48} /><Skeleton h={48} /></div>
              : b.pursue.length ? (
                <motion.ul className="list" variants={stagger()} initial="hidden" animate="show">
                  {b.pursue.map((i) => <Row key={i.opportunity_id} item={i} />)}</motion.ul>
              ) : <Empty icon={<CircleDashed size={28} />} title={t("noData")} />}
          </Card>
          <Card title={t("earlySignals")} icon={<Telescope size={16} color="var(--review)" />} flush delay={0.16}>
            {b && b.early_signals.length ? (
              <motion.ul className="list" variants={stagger()} initial="hidden" animate="show">
                {b.early_signals.map((i) => <Row key={i.opportunity_id} item={i} />)}</motion.ul>
            ) : <Empty title={t("noData")} />}
          </Card>
        </div>
        <div className="stack">
          <Card title={t("deadlines")} icon={<CalendarClock size={16} color="var(--cond)" />} delay={0.12}>
            {b?.deadlines.length ? b.deadlines.map((i) => (
              <Link key={i.opportunity_id} href={`/opportunities/${i.opportunity_id}`} className="row between"
                style={{ padding: "8px 0", flexWrap: "nowrap", gap: 12 }}>
                <span className="clamp2">{i.title}</span>
                <motion.b className="num chip MEDIUM" animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 2, repeat: Infinity }}>
                  {days(i.deadline_days, t("daysLeft"))}</motion.b>
              </Link>
            )) : <p className="muted">{t("noData")}</p>}
          </Card>
          <Card title={t("missingItems")} icon={<TriangleAlert size={16} color="var(--nobid)" />} delay={0.18}>
            {b?.missing_items.length ? (
              <ul style={{ margin: 0, paddingInlineStart: 18 }} className="col">{b.missing_items.map((m) => <li key={m}>{m}</li>)}</ul>
            ) : <p className="muted">{t("noData")}</p>}
          </Card>
          <Card title={t("changes")} delay={0.24}>
            {b?.changes.length ? b.changes.map((c, i) => (
              <Link key={i} href={`/opportunities/${c.opportunity_id}`} className="row between" style={{ padding: "6px 0" }}>
                <span className="clamp2">{c.title}</span><span className="chip neutral">{c.type}</span></Link>
            )) : <p className="muted">{t("noData")}</p>}
          </Card>
          <p className="faint">{t("notProbability")}</p>
        </div>
      </div>
    </div>
  );
}
