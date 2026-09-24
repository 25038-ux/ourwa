"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Layers, ListFilter, MapPin, Radar, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SwipeDeck } from "@/components/swipe";
import { DemoBadge, Empty, ErrorBox, FitRing, PageHead, RecChip, Segmented, SkeletonList } from "@/components/ui";
import { api } from "@/lib/api";
import { date, days, dirOf, money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useLive } from "@/lib/live";
import { fadeUp, stagger } from "@/lib/motion";
import { revalidate, useApi } from "@/lib/store";

type Opp = {
  id: string; external_ref: string; kind: string; title: string; buyer: string | null; region: string | null;
  category: string | null; status: string; currency: string | null; estimated_value: number | null; description?: string;
  deadline_at: string | null; days_left: number | null; language: string | null; is_synthetic: boolean;
  concepts: { concept_id: string; label: string }[];
  match: { id: string; fit_score: number; recommendation: string; data_completeness: number; status: string } | null;
};

const CATS = ["", "works", "goods", "services", "consulting"] as const;

export default function Explorer() {
  const { t, lang } = useI18n();
  const { push } = useLive();
  const [view, setView] = useState<"list" | "triage">("list");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string>("");
  const [rec, setRec] = useState("");
  const [sort, setSort] = useState("fit");
  const [matchedOnly, setMatchedOnly] = useState(false);
  const query = useMemo(() => {
    const p = new URLSearchParams({ lang, sort });
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (rec) p.set("recommendation", rec);
    if (matchedOnly || view === "triage") p.set("matched_only", "true");
    return p.toString();
  }, [q, category, rec, sort, matchedOnly, lang, view]);
  const { data, error } = useApi<{ total: number; items: Opp[] }>(`/opportunities?${query}`);
  const catLabel: Record<string, string> = lang === "fr"
    ? { "": t("all"), works: "Travaux", goods: "Fournitures", services: "Services", consulting: "Conseil" }
    : { "": t("all"), works: "Works", goods: "Goods", services: "Services", consulting: "Consulting" };

  const decide = async (id: string, choice: "pursue" | "dismiss") => {
    const opp = data?.items.find((o) => o.id === id);
    if (!opp?.match) return;
    if (choice === "dismiss") {
      await api(`/matches/${opp.match.id}`, { method: "PATCH", json: { status: "DISMISSED" } }).catch(() => undefined);
      api("/feedback", { method: "POST", json: { subject_type: "match", subject_id: opp.match.id, label: "irrelevant" } })
        .catch(() => undefined);
    } else {
      await api("/bids", { method: "POST", json: { opportunity_id: id } }).catch(() => undefined);
      push({ id, category: "system", title: `${t("pursueAction")} · ${opp.title}`, priority: "normal", org_id: "", href: "/bids" });
    }
    revalidate("/briefing", "/bids");
  };

  const triageItems = (data?.items ?? []).filter((o) => o.match && o.match.status !== "DISMISSED" && o.match.status !== "PURSUED")
    .map((o) => ({
      id: o.id, node: (
        <>
          <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <div className="col" style={{ gap: 6 }}>
              <span className="faint mono">{o.external_ref}</span>
              <RecChip rec={o.match?.recommendation} />
            </div>
            <FitRing score={o.match?.fit_score} rec={o.match?.recommendation} size={84} stroke={7} label />
          </div>
          <h2 style={{ fontSize: 21, lineHeight: 1.25 }} dir={dirOf(o.language)}>{o.title}</h2>
          <div className="muted clamp2">{o.buyer}</div>
          <div className="row" style={{ gap: 6 }}>{o.concepts.map((c) => <span key={c.concept_id} className="chip neutral">{c.label}</span>)}</div>
          <div style={{ flex: 1 }} />
          <div className="grid g2" style={{ gap: 10 }}>
            <div className="card" style={{ padding: 12 }}><h3>{t("deadline")}</h3><b className="num">{days(o.days_left, t("daysLeft"))}</b></div>
            <div className="card" style={{ padding: 12 }}><h3>{t("value")}</h3><b className="num">{money(o.estimated_value, o.currency, lang)}</b></div>
          </div>
          <div className="row between"><span className="faint"><MapPin size={12} /> {o.region}</span><DemoBadge show={o.is_synthetic} /></div>
        </>
      ),
    }));

  return (
    <div className="stack">
      <PageHead title={t("opportunities")} sub={data ? `${data.total} · ${t("notProbability")}` : " "}
        actions={<Segmented id="view" value={view} onChange={setView} options={[
          { value: "list", label: <span className="row" style={{ gap: 6 }}><Layers size={14} />Liste</span> },
          { value: "triage", label: <span className="row" style={{ gap: 6 }}><Radar size={14} />{t("triage")}</span> }]} />} />

      <AnimatePresence mode="wait">
        {view === "triage" ? (
          <motion.div key="triage" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            style={{ maxWidth: 460, margin: "0 auto", width: "100%" }}>
            <p className="muted" style={{ textAlign: "center", marginBottom: 14 }}>{t("triageHint")}</p>
            {data ? <SwipeDeck items={triageItems} onDecide={decide} /> : <SkeletonList rows={2} />}
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="stack">
            <div className="row" style={{ gap: 8 }}>
              <div style={{ flex: "1 1 260px", position: "relative" }}>
                <ListFilter size={16} style={{ position: "absolute", left: 12, top: 12, color: "var(--faint)" }} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} style={{ paddingLeft: 36 }} />
              </div>
              <select value={rec} onChange={(e) => setRec(e.target.value)} style={{ width: "auto" }} aria-label={t("recommendation")}>
                <option value="">{t("recommendation")} · {t("all")}</option>
                <option value="BID">BID</option><option value="BID_WITH_CONDITIONS">BID WITH CONDITIONS</option>
                <option value="REVIEW">REVIEW</option><option value="NO_BID">NO-BID</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: "auto" }} aria-label={t("sort")}>
                <option value="fit">{t("sort")} · {t("fitSort")}</option><option value="deadline">{t("deadlineSort")}</option>
                <option value="recent">{t("recentSort")}</option>
              </select>
            </div>
            <div className="row" style={{ gap: 6, overflowX: "auto", flexWrap: "nowrap", paddingBottom: 2 }}>
              {CATS.map((c) => (
                <motion.button key={c} className="pick" data-on={category === c} whileTap={{ scale: 0.94 }}
                  onClick={() => setCategory(c)} style={{ height: 32 }}>{catLabel[c]}</motion.button>
              ))}
              <motion.button className="pick" data-on={matchedOnly} whileTap={{ scale: 0.94 }} style={{ height: 32 }}
                onClick={() => setMatchedOnly(!matchedOnly)}>{t("matchedOnly")}</motion.button>
            </div>
            <ErrorBox error={error} />
            <div className="card flush">
              {!data ? <SkeletonList rows={6} /> : data.items.length === 0 ? <Empty icon={<SearchX size={28} />} title={t("empty")} /> : (
                <motion.ul className="list" variants={stagger(0.035)} initial="hidden" animate="show" key={query}>
                  {data.items.map((o) => (
                    <motion.li key={o.id} variants={fadeUp} layout>
                      <Link className="item" href={`/opportunities/${o.id}`} style={{ alignItems: "flex-start" }}>
                        <FitRing score={o.match?.fit_score} rec={o.match?.recommendation} size={52} />
                        <div style={{ flex: 1, minWidth: 0 }} dir={dirOf(o.language)}>
                          <div className="item-title clamp2">{o.title}</div>
                          <div className="faint" style={{ marginTop: 3 }}>{o.buyer ?? "—"} · {o.region ?? "—"}
                            <span className="hide-m"> · {money(o.estimated_value, o.currency, lang)}</span></div>
                          <div className="row" style={{ gap: 6, marginTop: 8 }}>
                            <RecChip rec={o.match?.recommendation} />
                            {o.status === "PLANNED" && <span className="chip REVIEW">{t("early")}</span>}
                            {o.concepts.slice(0, 2).map((c) => <span key={c.concept_id} className="chip neutral hide-m">{c.label}</span>)}
                            <DemoBadge show={o.is_synthetic} />
                          </div>
                        </div>
                        <div className="col" style={{ alignItems: "flex-end", gap: 4, flex: "none" }}>
                          <b className="num">{o.days_left !== null ? days(o.days_left, t("daysLeft")) : "—"}</b>
                          <span className="faint hide-m">{date(o.deadline_at, lang)}</span>
                          <ArrowUpRight size={15} color="var(--faint)" className="hide-m" />
                        </div>
                      </Link>
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
