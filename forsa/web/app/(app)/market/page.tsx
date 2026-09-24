"use client";

import { AnimatePresence, motion } from "motion/react";
import { Award, Ban, Building, CalendarRange, ChevronRight, ExternalLink, Search, ShieldAlert, ShieldCheck, Trophy,
  Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatedNumber, Card, Empty, ErrorBox, PageHead, Segmented, Skeleton, SkeletonList } from "@/components/ui";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fadeUp, spring, stagger } from "@/lib/motion";
import { useApi } from "@/lib/store";

type Winner = { name: string | null; type: string; country: string | null; currency: string | null; amount: number | null };
type AwardRow = { opportunity_id: string; title: string; buyer: string | null; category: string | null; published_at: string | null;
  award_date: string | null; winners: Winner[]; other_bidders: string[]; value: number | null; currency: string | null;
  source: string; url: string | null };
type Firm = { name: string; country: string | null; wins: number; bids_lost: number; totals: { currency: string; amount: number }[];
  top_buyers: string[]; categories: string[]; last_win: string | null; red_list: boolean };
type Overview = {
  awards: { count: number; totals: { currency: string; amount: number }[]; by_month: { month: string; count: number }[];
    by_category: { category: string; count: number }[]; top_buyers: { name: string; count: number }[]; recent: AwardRow[] };
  pipeline: { count: number; by_month: { month: string; count: number }[]; by_category: { category: string; count: number }[];
    top_planners: { name: string; count: number }[];
    next: { opportunity_id: string; title: string; buyer: string | null; planned_launch: string; category: string | null;
      method: string | null }[] };
  top_winners: Firm[]; red_list_count: number; note: string };
type Red = { id: string; entity_name: string; registry_number: string | null; nature: string | null; reference: string | null;
  effective_date: string | null; document_url: string | null };

const CAT: Record<string, { fr: string; en: string }> = {
  works: { fr: "Travaux", en: "Works" }, goods: { fr: "Fournitures", en: "Goods" }, services: { fr: "Services", en: "Services" },
  consulting: { fr: "Conseil", en: "Consulting" }, other: { fr: "Autre", en: "Other" },
};

function Bars({ data, color = "var(--accent)" }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="row" style={{ alignItems: "flex-end", gap: 6, height: 140, flexWrap: "nowrap" }}>
      {data.map((d, i) => (
        <div key={d.label} className="col" style={{ flex: 1, alignItems: "center", gap: 6, minWidth: 0 }}>
          <span className="faint num" style={{ fontSize: 11 }}>{d.value || ""}</span>
          <motion.div initial={{ height: 0 }} animate={{ height: `${(d.value / max) * 100}px` }}
            transition={{ ...spring, stiffness: 140, delay: i * 0.035 }}
            style={{ width: "100%", maxWidth: 34, borderRadius: 8, background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 55%, transparent))` }} />
          <span className="faint" style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function HBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="col" style={{ gap: 10 }}>
      {data.map((d, i) => (
        <div key={d.label}>
          <div className="row between" style={{ flexWrap: "nowrap", gap: 8 }}>
            <span className="clamp2" style={{ fontSize: 13 }}>{d.label}</span><b className="num">{d.value}</b></div>
          <div className="bar" style={{ marginTop: 5 }}><motion.i initial={{ width: 0 }} animate={{ width: `${(d.value / max) * 100}%` }}
            transition={{ duration: 0.7, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }} /></div>
        </div>
      ))}
    </div>
  );
}

function monthLabel(m: string, lang: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(lang, { month: "short" });
}

function AwardItem({ a }: { a: AwardRow }) {
  const { lang } = useI18n();
  const firms = a.winners.map((w) => w.name ?? (lang === "fr" ? "Consultant individuel" : "Individual consultant"));
  return (
    <motion.li variants={fadeUp} className="item" style={{ alignItems: "flex-start" }}>
      <span style={{ width: 36, height: 36, borderRadius: 12, flex: "none", display: "grid", placeItems: "center",
        background: "color-mix(in srgb, var(--gold) 14%, transparent)", color: "var(--gold)" }}><Trophy size={17} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="item-title clamp2">{firms.join(" + ") || "—"}</div>
        <div className="muted clamp2" style={{ fontSize: 13 }}>{a.title}</div>
        <div className="row faint" style={{ gap: 8, marginTop: 4 }}>
          {a.buyer && <span>{a.buyer}</span>}
          {a.category && <span className="chip neutral">{CAT[a.category]?.[lang] ?? a.category}</span>}
          <span>{date(a.award_date ?? a.published_at, lang)}</span>
          {a.other_bidders.length > 0 && <span>· {a.other_bidders.length} {lang === "fr" ? "autres offres" : "other bids"}</span>}
        </div>
      </div>
      <div className="col" style={{ alignItems: "flex-end", gap: 4 }}>
        {a.value !== null && <b className="num" style={{ whiteSpace: "nowrap" }}>{money(a.value, a.currency, lang)}</b>}
        {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="faint row" style={{ gap: 4 }}>
          {a.source.split(" ")[0]} <ExternalLink size={11} /></a>}
      </div>
    </motion.li>
  );
}

function RedListCheck() {
  const { lang } = useI18n();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ matches: (Red & { match: string })[] } | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    const id = setTimeout(() => api(`/market/red-list/check?name=${encodeURIComponent(q)}`).then(setRes).catch(() => setRes(null)), 250);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: 12, top: 12.5, color: "var(--faint)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34 }}
          placeholder={lang === "fr" ? "Vérifier un partenaire ou un sous-traitant…" : "Check a partner or subcontractor…"} />
      </div>
      <AnimatePresence mode="wait">
        {res && (
          <motion.div key={res.matches.length ? "hit" : "clear"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="quote" style={{ borderColor: res.matches.length ? "var(--nobid)" : "var(--bid)" }}>
            {res.matches.length ? (
              <span className="row" style={{ gap: 8 }}><ShieldAlert size={16} color="var(--nobid)" />
                <b>{lang === "fr" ? "Correspondance possible sur la liste rouge" : "Possible red-list match"}</b> —{" "}
                {res.matches.map((m) => `${m.entity_name}${m.registry_number ? ` (NRC ${m.registry_number})` : ""}`).join(", ")}</span>
            ) : (
              <span className="row" style={{ gap: 8 }}><ShieldCheck size={16} color="var(--bid)" />
                {lang === "fr" ? "Aucune correspondance sur la liste rouge de l'ARMP." : "No match on the ARMP red list."}</span>
            )}
            <span className="src">{lang === "fr" ? "Une correspondance de nom est un signal à vérifier (NRC), pas un verdict."
              : "A name match is a signal to verify (registry number), not a verdict."}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MarketPage() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<"overview" | "winners" | "awards" | "pipeline" | "red">("overview");
  const [q, setQ] = useState("");
  const { data, error } = useApi<Overview>("/market/overview");
  const { data: firms } = useApi<{ items: Firm[] }>(tab === "winners" ? `/market/competitors${q ? `?q=${encodeURIComponent(q)}` : ""}` : null);
  const { data: awards } = useApi<{ total: number; items: AwardRow[] }>(tab === "awards" ? `/market/awards?limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}` : null);
  const { data: red } = useApi<{ items: Red[]; note: string }>(tab === "red" ? "/market/red-list" : null);
  const mru = data?.awards.totals.find((x) => x.currency === "MRU");

  if (error) return <ErrorBox error={error} />;
  return (
    <div className="stack">
      <PageHead title={lang === "fr" ? "Marché" : "Market"} sub={lang === "fr"
        ? "Qui gagne quoi, qui achète quoi, ce qui arrive — à partir des attributions et plans officiels."
        : "Who wins what, who buys what, what is coming — from official awards and procurement plans."} />

      <motion.div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}
        variants={stagger(0.06)} initial="hidden" animate="show">
        {([
          [lang === "fr" ? "Attributions suivies" : "Awards tracked", data?.awards.count, <Award key="a" size={16} />, "var(--gold)"],
          [lang === "fr" ? "Valeur attribuée (MRU)" : "Awarded value (MRU)", mru ? Math.round(mru.amount / 1e6) : data ? 0 : undefined,
            <Trophy key="t" size={16} />, "var(--accent)", "M"],
          [lang === "fr" ? "Achats prévus (12 mois)" : "Planned purchases (12 mo)", data?.pipeline.count, <CalendarRange key="c" size={16} />,
            "var(--cond)"],
          [lang === "fr" ? "Entreprises exclues" : "Excluded firms", data?.red_list_count, <Ban key="b" size={16} />, "var(--nobid)"],
        ] as [string, number | undefined, React.ReactNode, string, string?][])
          .map(([label, n, icon, color, suffix]) => (
          <motion.div key={label} variants={fadeUp} className="card" style={{ padding: 16 }}>
            <div className="row between"><span className="faint">{label}</span><span style={{ color }}>{icon}</span></div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>
              {n === undefined ? <Skeleton h={28} w={60} /> : <><AnimatedNumber value={n} />{suffix && <span className="faint" style={{ fontSize: 16 }}> {suffix}</span>}</>}
            </div>
          </motion.div>
        ))}
      </motion.div>

      <div className="row between">
        <Segmented id="market-tab" value={tab} onChange={(v) => { setTab(v); setQ(""); }} options={[
          { value: "overview", label: lang === "fr" ? "Vue d'ensemble" : "Overview" },
          { value: "winners", label: lang === "fr" ? "Concurrents" : "Competitors" },
          { value: "awards", label: lang === "fr" ? "Attributions" : "Awards" },
          { value: "pipeline", label: lang === "fr" ? "À venir" : "Pipeline" },
          { value: "red", label: lang === "fr" ? "Liste rouge" : "Red list" },
        ]} />
        {(tab === "winners" || tab === "awards") && (
          <div style={{ position: "relative", minWidth: 240, flex: "0 1 320px" }}>
            <Search size={15} style={{ position: "absolute", left: 12, top: 12.5, color: "var(--faint)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34 }}
              placeholder={lang === "fr" ? "Entreprise, acheteur, objet…" : "Firm, buyer, subject…"} />
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}>
          {tab === "overview" && (
            !data ? <Skeleton h={320} /> : (
              <div className="grid g-main">
                <div className="stack">
                  <Card title={lang === "fr" ? "Attributions par mois" : "Awards per month"} icon={<Award size={16} color="var(--gold)" />}>
                    {data.awards.by_month.length ? <Bars color="var(--gold)" data={data.awards.by_month.map((m) => ({ label: monthLabel(m.month, lang), value: m.count }))} />
                      : <Empty title={t("noData")} />}
                  </Card>
                  <Card title={lang === "fr" ? "Dernières attributions" : "Latest awards"} icon={<Trophy size={16} color="var(--gold)" />} flush
                    action={<button className="btn ghost sm" onClick={() => setTab("awards")}>{t("viewAll")}</button>}>
                    {data.awards.recent.length ? (
                      <motion.ul className="list" variants={stagger()} initial="hidden" animate="show">
                        {data.awards.recent.map((a) => <AwardItem key={a.opportunity_id} a={a} />)}</motion.ul>
                    ) : <Empty title={t("noData")} />}
                  </Card>
                </div>
                <div className="stack">
                  <Card title={lang === "fr" ? "Entreprises qui gagnent le plus" : "Most frequent winners"} icon={<Users size={16} color="var(--review)" />}
                    action={<button className="btn ghost sm" onClick={() => setTab("winners")}>{t("viewAll")}</button>}>
                    <HBars data={data.top_winners.slice(0, 6).map((f) => ({ label: f.name, value: f.wins }))} />
                  </Card>
                  <Card title={lang === "fr" ? "Acheteurs les plus actifs" : "Most active buyers"} icon={<Building size={16} color="var(--accent)" />}>
                    <HBars data={data.awards.top_buyers.slice(0, 6).map((b) => ({ label: b.name, value: b.count }))} />
                  </Card>
                  <p className="faint">{data.note}</p>
                </div>
              </div>
            )
          )}

          {tab === "winners" && (
            <Card flush>
              {!firms ? <SkeletonList rows={5} /> : firms.items.length ? (
                <motion.ul className="list" variants={stagger(0.03)} initial="hidden" animate="show">
                  {firms.items.map((f, i) => (
                    <motion.li key={f.name} variants={fadeUp} className="item">
                      <span className="num" style={{ width: 34, height: 34, borderRadius: 11, flex: "none", display: "grid", placeItems: "center",
                        fontWeight: 700, background: i < 3 ? "color-mix(in srgb, var(--gold) 16%, transparent)" : "var(--surface-2)",
                        color: i < 3 ? "var(--gold)" : "var(--muted)" }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="item-title row" style={{ gap: 8 }}>{f.name}
                          {f.red_list && <span className="chip HIGH" title={lang === "fr"
                            ? "Même nom qu'une entreprise de la liste rouge de l'ARMP — vérifiez le NIF/NRC avant de conclure."
                            : "Same name as a firm on the ARMP red list — check the tax/registry number before concluding."}>
                            <ShieldAlert size={12} />{lang === "fr" ? "Nom sur la liste rouge ?" : "Name on red list?"}</span>}</div>
                        <div className="faint clamp2">{[f.country, f.categories.map((c) => CAT[c]?.[lang] ?? c).join(", "), f.top_buyers[0]].filter(Boolean).join(" · ")}</div>
                      </div>
                      <div className="col" style={{ alignItems: "flex-end", gap: 2 }}>
                        <b className="num">{f.wins} {lang === "fr" ? "gagnés" : "won"}{f.bids_lost ? <span className="faint"> / {f.bids_lost} {lang === "fr" ? "perdus" : "lost"}</span> : null}</b>
                        {f.totals[0] && <span className="faint num">{money(f.totals[0].amount, f.totals[0].currency, lang)}</span>}
                      </div>
                    </motion.li>
                  ))}
                </motion.ul>
              ) : <Empty title={t("noData")} />}
            </Card>
          )}

          {tab === "awards" && (
            <Card flush>
              {!awards ? <SkeletonList rows={5} /> : awards.items.length ? (
                <motion.ul className="list" variants={stagger(0.03)} initial="hidden" animate="show">
                  {awards.items.map((a) => <AwardItem key={a.opportunity_id} a={a} />)}</motion.ul>
              ) : <Empty title={t("noData")} />}
            </Card>
          )}

          {tab === "pipeline" && (
            !data ? <Skeleton h={320} /> : (
              <div className="grid g-main">
                <Card flush title={lang === "fr" ? "Prochains lancements prévus" : "Next planned launches"} icon={<CalendarRange size={16} color="var(--cond)" />}>
                  {data.pipeline.next.length ? (
                    <motion.ul className="list" variants={stagger(0.03)} initial="hidden" animate="show">
                      {data.pipeline.next.map((p) => (
                        <motion.li key={p.opportunity_id} variants={fadeUp}>
                          <Link href={`/opportunities/${p.opportunity_id}`} className="item">
                            <span className="chip MEDIUM num" style={{ minWidth: 86, justifyContent: "center" }}>{date(p.planned_launch, lang)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="item-title clamp2">{p.title}</div>
                              <div className="faint">{[p.buyer, p.category && (CAT[p.category]?.[lang] ?? p.category), p.method].filter(Boolean).join(" · ")}</div>
                            </div>
                            <ChevronRight size={16} color="var(--faint)" />
                          </Link>
                        </motion.li>
                      ))}
                    </motion.ul>
                  ) : <Empty title={t("noData")} />}
                </Card>
                <div className="stack">
                  <Card title={lang === "fr" ? "Lancements par mois" : "Launches per month"}>
                    <Bars color="var(--cond)" data={data.pipeline.by_month.map((m) => ({ label: monthLabel(m.month, lang), value: m.count }))} />
                  </Card>
                  <Card title={lang === "fr" ? "Qui prévoit d'acheter" : "Who plans to buy"} icon={<Building size={16} color="var(--accent)" />}>
                    <HBars data={data.pipeline.top_planners.slice(0, 6).map((b) => ({ label: b.name, value: b.count }))} />
                  </Card>
                </div>
              </div>
            )
          )}

          {tab === "red" && (
            <div className="grid g-main">
              <Card flush title={lang === "fr" ? "Entreprises exclues des marchés publics" : "Firms excluded from public procurement"}
                icon={<Ban size={16} color="var(--nobid)" />}>
                {!red ? <SkeletonList rows={4} /> : red.items.length ? (
                  <motion.ul className="list" variants={stagger(0.03)} initial="hidden" animate="show">
                    {red.items.map((r) => (
                      <motion.li key={r.id} variants={fadeUp} className="item" style={{ alignItems: "flex-start" }}>
                        <span style={{ width: 34, height: 34, borderRadius: 11, flex: "none", display: "grid", placeItems: "center",
                          background: "var(--nobid-soft)", color: "var(--nobid)" }}><Ban size={16} /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="item-title">{r.entity_name} {r.registry_number && <span className="faint">· NRC {r.registry_number}</span>}</div>
                          <div className="muted" style={{ fontSize: 13 }}>{r.nature}</div>
                          {r.reference && <div className="faint clamp2">{r.reference}</div>}
                        </div>
                        <div className="col" style={{ alignItems: "flex-end", gap: 4 }}>
                          <span className="faint">{date(r.effective_date, lang)}</span>
                          {r.document_url && <a href={r.document_url} target="_blank" rel="noreferrer" className="faint row" style={{ gap: 4 }}>
                            PDF <ExternalLink size={11} /></a>}
                        </div>
                      </motion.li>
                    ))}
                  </motion.ul>
                ) : <Empty title={t("noData")} />}
              </Card>
              <div className="stack">
                <Card title={lang === "fr" ? "Vérification rapide" : "Quick check"} icon={<ShieldCheck size={16} color="var(--accent)" />}>
                  <RedListCheck />
                </Card>
                {red && <p className="faint">{red.note}</p>}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
