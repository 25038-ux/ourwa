"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  BadgeCheck, Banknote, Briefcase, CalendarClock, CalendarPlus, ChevronDown, CircleHelp, ExternalLink, FileText, Gauge, History,
  MapPin, Quote as QuoteIcon, ScanText, Share2, ShieldCheck, Sparkles, ThumbsDown, TriangleAlert,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bar, Card, Chip, DemoBadge, ErrorBox, FitRing, Quote, RecChip, Skeleton } from "@/components/ui";
import { api, safeGet } from "@/lib/api";
import { useAssistant } from "@/lib/assistant";
import { date, days, dirOf, money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fadeUp, haptic, stagger } from "@/lib/motion";
import { revalidate, useApi } from "@/lib/store";

type Ev = { epistemic: string; quote: string | null; locator: string | null };
type Reason = { code: string; polarity: string; message: string; evidence: Ev[] };
type R = { low: number; high: number };
type Intel = {
  available?: boolean; match_id?: string; fit_score: number; data_completeness: number; recommendation: string;
  explanation: string; scoring_version: string; recommendation_reasons: Reason[]; conditions: Reason[]; why_now: Reason[];
  gates: { gate: string; outcome: string; truth: string; reason: Reason }[];
  components: { name: string; score: number; weight: number; known: number; reasons: Reason[] }[];
  risks: { category: string; level: string; reason: Reason }[]; unknowns: { gate: string; truth: string; reason: Reason }[];
  economics: { currency: string | null; effort_days: R; bid_cost: R | null; contract_value: R | null; contribution: R | null;
    notes: string[] };
  ai_triage?: { relevant: number; model: string };
};

const KIND_LABEL: Record<string, { fr: string; en: string }> = {
  TENDER: { fr: "Appel d'offres", en: "Tender" }, EOI: { fr: "Manifestation d'intérêt", en: "Expression of interest" },
  RFQ: { fr: "Demande de cotation", en: "Request for quotation" }, RFP: { fr: "Demande de propositions", en: "Request for proposals" },
  PLAN_ITEM: { fr: "Plan de passation (à venir)", en: "Procurement plan (upcoming)" }, AWARD: { fr: "Attribution", en: "Award" },
  INFO: { fr: "Information", en: "Notice" },
};

const COMPONENT_LABEL: Record<string, [string, string]> = {
  eligibility: ["Éligibilité", "Eligibility"], capability: ["Compétences", "Capability"], experience: ["Expérience", "Experience"],
  evidence: ["Preuves", "Evidence"], capacity: ["Capacité", "Capacity"], geography: ["Géographie", "Geography"],
  strategic: ["Stratégie", "Strategic fit"], timeline: ["Calendrier", "Timeline"],
};

/** Native share sheet on phones (WhatsApp, SMS, e-mail…); WhatsApp link as a fallback on desktop. */
async function share(opp: any, lang: string) {
  haptic(8);
  const deadline = opp.deadline_at ? `${lang === "fr" ? "Date limite" : "Deadline"} : ${date(opp.deadline_at, lang)}` : "";
  const text = [opp.title, opp.buyer, deadline].filter(Boolean).join("\n");
  const url = window.location.href;
  try {
    if (navigator.share) return await navigator.share({ title: opp.title, text, url });
  } catch {
    return; // user dismissed the share sheet
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener");
}

function ReasonLine({ r }: { r: Reason }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ev = r.evidence?.filter((e) => e.quote || e.locator) ?? [];
  const tone = r.polarity === "+" ? "var(--bid)" : r.polarity === "-" ? "var(--nobid)" : r.polarity === "!" ? "var(--cond)" : "var(--muted)";
  return (
    <div style={{ padding: "4px 0" }}>
      <div className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: tone, marginTop: 8, flex: "none" }} />
        <span style={{ flex: 1 }}>{r.message}</span>
        {ev.length > 0 && (
          <button className="btn ghost sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            <QuoteIcon size={12} />{t("evidence")}
            <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: "grid" }}><ChevronDown size={12} /></motion.span>
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }} style={{ overflow: "hidden" }}>
            <div className="col" style={{ gap: 6, padding: "8px 0 4px 14px" }}>
              {ev.map((e, i) => <Quote key={i} text={e.quote ?? e.locator} source={`${e.epistemic}${e.locator ? " · " + e.locator : ""}`} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Range({ r, currency }: { r: R | null; currency?: string | null }) {
  const { lang } = useI18n();
  if (!r) return <span className="faint">—</span>;
  if (r.low === r.high) return <b className="num">{money(r.high, currency, lang)}</b>;
  return <b className="num">{money(r.low, null, lang)} – {money(r.high, currency, lang)}</b>;
}

export default function OpportunityPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const router = useRouter();
  const { setOpen, setFocus } = useAssistant();
  const { data: opp, error } = useApi<any>(`/opportunities/${id}?lang=${lang}`);
  const { data: intel } = useApi<Intel>(`/opportunities/${id}/intelligence?lang=${lang}`);
  const { data: reqs } = useApi<{ items: any[] }>(`/opportunities/${id}/requirements`);
  const [summary, setSummary] = useState<{ available: boolean; text?: string; provider?: string } | null>(null);
  const [facts, setFacts] = useState<any[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setFocus(id);
    api(`/opportunities/${id}/ai-summary?lang=${lang}`).then(setSummary).catch(() => setSummary(null));
    return () => setFocus(null);
  }, [id, lang, setFocus]);

  if (error) return <ErrorBox error={error} />;
  if (!opp || !intel) return <div className="col"><Skeleton h={34} w="60%" /><Skeleton h={120} /><Skeleton h={260} /></div>;

  const startBid = async () => {
    haptic(10);
    try {
      const bid = await api("/bids", { method: "POST", json: { opportunity_id: id } });
      revalidate("/bids");
      router.push(`/bids/${bid.id}`);
    } catch {
      const bids = await api("/bids");
      const found = bids.items.find((b: any) => b.opportunity_id === id);
      if (found) router.push(`/bids/${found.id}`);
    }
  };
  const feedback = async (label: string) => {
    if (!intel.match_id) return;
    await api("/feedback", { method: "POST", json: { subject_type: "match", subject_id: intel.match_id, label } });
    if (label === "irrelevant") await api(`/matches/${intel.match_id}`, { method: "PATCH", json: { status: "DISMISSED" } });
    setNotice(label === "irrelevant" ? t("dismissAction") : "✓");
    revalidate("/briefing", "/opportunities");
  };

  return (
    <div className="stack">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="card"
        style={{ padding: 22, background: "radial-gradient(700px 260px at 100% 0%, var(--accent-soft), transparent 70%), var(--surface)" }}>
        <div className="row" style={{ gap: 20, alignItems: "flex-start", flexWrap: "nowrap" }}>
          <div style={{ flex: 1, minWidth: 0 }} dir={dirOf(opp.language)}>
            <div className="row faint" style={{ gap: 8 }}><span className="mono">{opp.attributes?.plan_reference ?? opp.attributes?.reference
              ?? (opp.external_ref.includes(":") ? opp.external_ref.split(":")[0] : opp.external_ref)}</span><span>· {KIND_LABEL[opp.kind]?.[lang] ?? opp.kind}</span>
              <DemoBadge show={opp.is_synthetic} /></div>
            <h1 style={{ fontSize: "clamp(22px, 3vw, 30px)", marginTop: 6 }}>{opp.title}</h1>
            <div className="muted" style={{ marginTop: 6 }}>{opp.buyer ?? "—"}</div>
            {opp.source_detail?.attribution && <div className="faint" style={{ marginTop: 4 }}>{opp.source_detail.attribution}</div>}
          </div>
          {intel.available !== false && <FitRing score={intel.fit_score} rec={intel.recommendation} size={92} stroke={8} label />}
        </div>
        <motion.div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 18 }}
          variants={stagger(0.05)} initial="hidden" animate="show">
          {[[<CalendarClock key="d" size={14} />, opp.attributes?.planned_launch ? (lang === "fr" ? "Lancement prévu" : "Planned launch")
              : t("deadline"), opp.attributes?.planned_launch ? <span key="v">{date(opp.attributes.planned_launch, lang)}</span> : (
              <span key="v">{date(opp.deadline_at, lang)} <span className="faint num">
              {opp.days_left !== null && `· ${days(opp.days_left, t("daysLeft"))}`}</span>
              {opp.deadline_evidence && (
                <span className="chip MEDIUM" style={{ marginLeft: 6 }} title={`« ${opp.deadline_evidence.quote} » (p.${opp.deadline_evidence.page})`}>
                  <ScanText size={11} />{lang === "fr" ? "lue dans l'avis" : "read from notice"}</span>
              )}</span>)],
            [<Banknote key="b" size={14} />, t("value"), money(opp.estimated_value, opp.currency, lang)],
            [<MapPin key="m" size={14} />, t("region"), opp.region ?? "—"],
            [<Briefcase key="p" size={14} />, t("method"), opp.method ?? "—"]].map(([icon, label, v], i) => (
            <motion.div key={i} variants={fadeUp}><h3 className="row" style={{ gap: 6 }}>{icon}{label}</h3><div>{v}</div></motion.div>
          ))}
        </motion.div>
        <div className="row" style={{ marginTop: 18, gap: 8 }}>
          <motion.button className="btn accent" whileTap={{ scale: 0.96 }} onClick={startBid}><Briefcase size={16} />{t("startBid")}</motion.button>
          <motion.button className="btn" whileTap={{ scale: 0.96 }} onClick={() => { setOpen(true); }}>
            <Sparkles size={16} color="var(--accent)" />{lang === "fr" ? "Demander à FORSA" : "Ask FORSA"}</motion.button>
          {opp.deadline_at && (
            <a className="btn" href={`/api/v1/opportunities/${opp.id}/calendar.ics?org=${safeGet("forsa.org") ?? ""}`} onClick={() => haptic(6)}>
              <CalendarPlus size={16} />{t("addToCalendar")}</a>
          )}
          <motion.button className="btn" whileTap={{ scale: 0.96 }} onClick={() => share(opp, lang)}><Share2 size={16} />{t("share")}</motion.button>
          {opp.url && !opp.is_synthetic && (
            <a className="btn ghost" href={opp.url} target="_blank" rel="noreferrer"><ExternalLink size={15} />
              {lang === "fr" ? "Avis officiel" : "Official notice"}</a>
          )}
          {intel.match_id && <button className="btn ghost" onClick={() => feedback("irrelevant")}><ThumbsDown size={15} />{t("irrelevant")}</button>}
          {intel.match_id && <button className="btn ghost" onClick={() => feedback("incorrect")}><TriangleAlert size={15} />{t("reportError")}</button>}
          <AnimatePresence>{notice && <motion.span className="chip BID" initial={{ scale: 0 }} animate={{ scale: 1 }}>{notice}</motion.span>}</AnimatePresence>
        </div>
      </motion.div>

      {intel.available === false ? (
        <Card title={t("company")}><p className="muted">Complete your company profile to get a fit assessment.</p></Card>
      ) : (
        <div className="grid g-main">
          <div className="stack">
            <Card title={t("recommendation")} icon={<Gauge size={16} />} action={<RecChip rec={intel.recommendation} />} delay={0.05}>
              <AnimatePresence>
                {summary?.available && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="quote"
                    style={{ marginBottom: 12, background: "linear-gradient(90deg, var(--accent-soft), transparent)" }}>
                    <b className="row" style={{ gap: 6, color: "var(--accent)" }}><Sparkles size={13} />{t("aiSummary")}</b>
                    <div style={{ marginTop: 4 }}>{summary.text}</div>
                    <span className="src">{t("aiSummaryNote")} · {summary.provider}</span>
                  </motion.div>
                )}
              </AnimatePresence>
              <p>{intel.explanation}</p>
              {intel.ai_triage && (
                <div className="row faint" style={{ marginTop: 10 }}><span className="chip ai">{t("jev")}</span>
                  {Math.round(intel.ai_triage.relevant * 100)} % · {intel.ai_triage.model}</div>
              )}
              {intel.why_now.length > 0 && <><div className="sep" /><h3>{t("whyItMatters")}</h3>
                {intel.why_now.map((r, i) => <ReasonLine key={i} r={r} />)}</>}
              {intel.conditions.length > 0 && <><div className="sep" /><h3>{t("conditions")}</h3>
                {intel.conditions.map((r, i) => <ReasonLine key={i} r={r} />)}</>}
              <p className="faint" style={{ marginTop: 12 }}>{t("notProbability")} · {intel.scoring_version} ·{" "}
                {Math.round(intel.data_completeness * 100)} % {t("completeness")}</p>
            </Card>

            <Card title={t("breakdown")} icon={<BadgeCheck size={16} />} delay={0.1}>
              <div className="col" style={{ gap: 14 }}>
                {intel.components.map((c) => (
                  <details key={c.name}>
                    <summary style={{ listStyle: "none", cursor: "pointer" }}>
                      <div className="row between" style={{ marginBottom: 6 }}>
                        <span style={{ fontWeight: 600 }}>{COMPONENT_LABEL[c.name]?.[lang === "fr" ? 0 : 1] ?? c.name}
                          <span className="faint"> ×{c.weight}</span></span>
                        <span className="num" style={{ fontWeight: 700 }}>{c.known ? c.score : "?"}</span>
                      </div>
                      <Bar value={c.score} known={c.known > 0} />
                    </summary>
                    <div style={{ paddingTop: 8 }}>{c.reasons.map((r, i) => <ReasonLine key={i} r={r} />)}</div>
                  </details>
                ))}
              </div>
            </Card>

            <Card title={t("gates")} icon={<ShieldCheck size={16} />} flush delay={0.15}>
              <motion.div variants={stagger(0.04)} initial="hidden" animate="show">
                {intel.gates.map((g, i) => (
                  <motion.div key={i} variants={fadeUp} className="row" style={{ padding: "10px 18px", borderTop: i ? "1px solid var(--border)" : 0,
                    flexWrap: "nowrap", alignItems: "flex-start", gap: 12 }}>
                    <Chip kind={g.outcome} />
                    <div style={{ flex: 1 }}><ReasonLine r={g.reason} /></div>
                    <span className="hide-m"><Chip kind={g.truth} /></span>
                  </motion.div>
                ))}
              </motion.div>
            </Card>

            <Card title={`${t("requirements")} (${reqs?.items.length ?? 0})`} icon={<FileText size={16} />} delay={0.2}>
              <div className="col" style={{ gap: 12 }}>
                {reqs?.items.map((r) => (
                  <div key={r.id} className="col" style={{ gap: 6 }}>
                    <div className="row" style={{ gap: 6 }}>
                      <Chip kind={r.type === "mandatory" ? "HIGH" : "LOW"}>{r.type}</Chip>
                      <span className="faint">{r.category}</span>
                      {r.extraction_method?.startsWith("ai:") && <span className="chip ai">IA · à vérifier</span>}
                      {r.verification !== "UNVERIFIED" && <Chip kind={r.verification} />}
                    </div>
                    <Quote text={r.text} source={r.evidence ? (r.evidence.section ?? `p.${r.evidence.page ?? "—"}`) : null} />
                  </div>
                ))}
                {!reqs?.items.length && <p className="muted">{t("noData")}</p>}
              </div>
            </Card>
          </div>

          <div className="stack">
            <Card title={t("unknowns")} icon={<CircleHelp size={16} />} delay={0.08}>
              {intel.unknowns.length ? intel.unknowns.map((u, i) => (
                <div key={i} className="row" style={{ gap: 8, padding: "5px 0", flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <Chip kind={u.truth} /><span>{u.reason.message}</span></div>
              )) : <p className="muted">{t("noData")}</p>}
            </Card>
            <Card title={t("risks")} icon={<TriangleAlert size={16} />} delay={0.12}>
              {intel.risks.length ? intel.risks.map((r, i) => (
                <div key={i} className="row" style={{ gap: 8, padding: "5px 0", flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <Chip kind={r.level} /><span><span className="faint">{r.category} · </span>{r.reason.message}</span></div>
              )) : <p className="muted">{t("noData")}</p>}
            </Card>
            <Card title={`${t("economics")}`} icon={<Banknote size={16} />} delay={0.16}>
              <div className="col" style={{ gap: 10 }}>
                <div className="row between"><span className="muted">{t("effort")}</span><Range r={intel.economics.effort_days} /></div>
                <div className="row between"><span className="muted">{t("bidCost")}</span><Range r={intel.economics.bid_cost} currency={intel.economics.currency} /></div>
                <div className="row between"><span className="muted">{t("value")}</span><Range r={intel.economics.contract_value} currency={intel.economics.currency} /></div>
                <div className="row between"><span className="muted">{t("contribution")}</span><Range r={intel.economics.contribution} currency={intel.economics.currency} /></div>
                <p className="faint">{t("range")} · {intel.economics.notes.join(" · ")}</p>
              </div>
            </Card>
            <Card title={t("documents")} icon={<FileText size={16} />} delay={0.2}>
              {opp.documents.length ? opp.documents.map((d: any) => (
                <div key={d.id} className="col" style={{ gap: 4, padding: "6px 0" }}>
                  {d.source_url?.startsWith("http") ? <a href={d.source_url} target="_blank" rel="noreferrer" className="row" style={{ gap: 6 }}>
                    <FileText size={14} />{d.title}<ExternalLink size={12} color="var(--faint)" /></a> : <span>{d.title}</span>}
                  <div className="row faint" style={{ gap: 6 }}><span>{d.extraction_status === "OCR_DONE"
                    ? (lang === "fr" ? "Texte lu par OCR (à vérifier)" : "Text read by OCR (verify)") : d.extraction_status}</span>
                    {d.needs_ocr && <Chip kind="MEDIUM">OCR</Chip>}
                    {d.risk_flags?.map((f: any, i: number) => <Chip key={i} kind="HIGH">{f.code}</Chip>)}</div>
                </div>
              )) : <p className="muted">{t("noData")}</p>}
            </Card>
            <Card title={t("history")} icon={<History size={16} />} delay={0.24}>
              {opp.events.map((e: any, i: number) => (
                <div key={i} className="row between faint" style={{ padding: "3px 0" }}><span>v{e.version} · {e.type}</span><span>{date(e.at, lang)}</span></div>
              ))}
            </Card>
            <Card title={t("facts")} icon={<QuoteIcon size={16} />} delay={0.28}>
              {facts === null ? (
                <button className="btn" onClick={() => api(`/opportunities/${id}/evidence`).then((r) => setFacts(r.items))}>{t("why")}</button>
              ) : (
                <motion.div variants={stagger(0.03)} initial="hidden" animate="show" className="col" style={{ gap: 10 }}>
                  {facts.map((f, i) => (
                    <motion.div key={i} variants={fadeUp}>
                      <div className="row between"><b className="mono">{f.field}</b><Chip kind={f.verification}>{f.epistemic}</Chip></div>
                      <Quote text={f.evidence.quote} source={`${f.evidence.locator ?? ""} · ${date(f.evidence.retrieved_at, lang)}`} />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
