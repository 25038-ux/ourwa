"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { date, days, dirOf, money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Chip, DemoBadge, ErrorBox, Fit, Loading, Quote, RecChip } from "@/components/ui";

type Ev = { epistemic: string; quote: string | null; locator: string | null; evidence_id: string | null };
type Reason = { code: string; polarity: string; message: string; evidence: Ev[]; epistemic: string };
type Intel = {
  available?: boolean; persisted: boolean; match_id?: string; fit_score: number; data_completeness: number;
  recommendation: string; headline: string; explanation: string; scoring_version: string;
  recommendation_reasons: Reason[]; conditions: Reason[]; why_now: Reason[];
  gates: { gate: string; outcome: string; truth: string; mandatory: boolean; reason: Reason }[];
  components: { name: string; score: number; weight: number; known: number; reasons: Reason[] }[];
  risks: { category: string; level: string; reason: Reason }[];
  unknowns: { gate: string; truth: string; reason: Reason }[];
  economics: { currency: string | null; effort_days: R; bid_cost: R | null; contract_value: R | null; contribution: R | null; notes: string[] };
};
type R = { low: number; high: number };

function EvidenceList({ evidence }: { evidence: Ev[] }) {
  const items = evidence.filter((e) => e.quote || e.locator);
  if (!items.length) return null;
  return <div className="stack" style={{ marginTop: 6 }}>{items.map((e, i) => (
    <Quote key={i} text={e.quote ?? e.locator} source={`${e.epistemic}${e.locator ? " · " + e.locator : ""}`} />
  ))}</div>;
}

function ReasonLine({ r }: { r: Reason }) {
  const { t } = useI18n();
  const mark = r.polarity === "+" ? "✓" : r.polarity === "-" ? "✕" : r.polarity === "!" ? "!" : "?";
  return (
    <div style={{ marginBottom: 6 }}>
      <span className="mono" aria-hidden>{mark}</span> {r.message}
      {r.evidence?.some((e) => e.quote || e.locator) && (
        <details><summary>{t("evidence")}</summary><EvidenceList evidence={r.evidence} /></details>
      )}
    </div>
  );
}

function RangeText({ r, currency }: { r: R | null; currency?: string | null }) {
  const { lang } = useI18n();
  if (!r) return <span className="faint">—</span>;
  return <span>{money(r.low, null, lang)} – {money(r.high, currency, lang)}</span>;
}

export default function OpportunityPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const router = useRouter();
  const [opp, setOpp] = useState<any>(null);
  const [intel, setIntel] = useState<Intel | null>(null);
  const [reqs, setReqs] = useState<any[]>([]);
  const [facts, setFacts] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api(`/opportunities/${id}?lang=${lang}`), api(`/opportunities/${id}/intelligence?lang=${lang}`),
      api(`/opportunities/${id}/requirements`),
    ]).then(([o, i, r]) => { setOpp(o); setIntel(i); setReqs(r.items); }).catch(setError);
  }, [id, lang]);

  if (error) return <ErrorBox error={error} />;
  if (!opp || !intel) return <Loading />;

  const startBid = async () => {
    try {
      const bid = await api("/bids", { method: "POST", json: { opportunity_id: id } });
      router.push(`/bids/${bid.id}`);
    } catch (e) { setError(e); }
  };
  const feedback = async (label: string) => {
    if (!intel.match_id) return;
    await api("/feedback", { method: "POST", json: { subject_type: "match", subject_id: intel.match_id, label } });
    if (label === "irrelevant") await api(`/matches/${intel.match_id}`, { method: "PATCH", json: { status: "DISMISSED" } });
    setNotice("✓");
  };
  const loadFacts = () => api(`/opportunities/${id}/evidence`).then((r) => setFacts(r.items)).catch(setError);

  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }} dir={dirOf(opp.language)}>
          <div className="row faint"><span>{opp.external_ref}</span><span>· {opp.kind}</span><DemoBadge show={opp.is_synthetic} /></div>
          <h1>{opp.title}</h1>
          <div className="muted">{opp.buyer ?? "—"}</div>
        </div>
        <div className="row">
          <button className="primary" onClick={startBid}>{t("startBid")}</button>
          {intel.match_id && <button onClick={() => feedback("irrelevant")}>{t("irrelevant")}</button>}
          {intel.match_id && <button onClick={() => feedback("incorrect")}>{t("reportError")}</button>}
          {notice && <span className="faint">{notice}</span>}
        </div>
      </div>

      <div className="card">
        <div className="grid g3">
          <div><h3>{t("deadline")}</h3>{date(opp.deadline_at, lang)} <span className="faint">{opp.days_left !== null && `· ${days(opp.days_left, t("daysLeft"))}`}</span></div>
          <div><h3>{t("value")}</h3>{money(opp.estimated_value, opp.currency, lang)}</div>
          <div><h3>{t("region")}</h3>{opp.region ?? "—"}</div>
          <div><h3>{t("method")}</h3>{opp.method ?? "—"}</div>
          <div><h3>{t("published")}</h3>{date(opp.published_at, lang)}</div>
          <div><h3>{t("source")}</h3>{opp.source} <span className="faint">v{opp.version} · {opp.status}</span></div>
        </div>
        {opp.description && <><div className="sep" /><p dir={dirOf(opp.language)}>{opp.description}</p></>}
      </div>

      {intel.available === false ? (
        <div className="alert">Complete your company profile to get a fit assessment. <Link href="/company">→</Link></div>
      ) : (
        <div className="grid g-main">
          <div className="stack">
            <div className="card">
              <div className="row between">
                <div>
                  <h3>{t("recommendation")}</h3>
                  <div className="row"><RecChip rec={intel.recommendation} /><span className="faint">{intel.scoring_version}</span></div>
                </div>
                <Fit score={intel.fit_score} completeness={intel.data_completeness} />
              </div>
              <div className="sep" />
              <h3>{t("whyItMatters")}</h3>
              <p>{intel.explanation}</p>
              {intel.why_now.map((r, i) => <ReasonLine key={i} r={r} />)}
              {intel.conditions.length > 0 && <><div className="sep" /><h3>{t("conditions")}</h3>
                {intel.conditions.map((r, i) => <ReasonLine key={i} r={r} />)}</>}
              <p className="faint" style={{ marginTop: 8 }}>{t("notProbability")}</p>
            </div>

            <div className="card">
              <h2>{t("breakdown")}</h2>
              {intel.components.map((c) => (
                <div key={c.name} style={{ marginBottom: 10 }}>
                  <div className="row between">
                    <span><b>{c.name}</b> <span className="faint">×{c.weight}</span></span>
                    <span className="mono">{c.known ? c.score : "?"}</span>
                  </div>
                  <div className={`bar ${c.known ? "" : "unknown"}`}><i style={{ width: `${c.known ? c.score : 100}%` }} /></div>
                  <details><summary>{t("why")}</summary><div style={{ marginTop: 6 }}>{c.reasons.map((r, i) => <ReasonLine key={i} r={r} />)}</div></details>
                </div>
              ))}
            </div>

            <div className="card flush">
              <div style={{ padding: "14px 16px 4px" }}><h2>{t("gates")}</h2></div>
              <table>
                <tbody>
                  {intel.gates.map((g, i) => (
                    <tr key={i}>
                      <td style={{ width: 90 }}><Chip kind={g.outcome} /></td>
                      <td><ReasonLine r={g.reason} /></td>
                      <td className="hide-sm" style={{ width: 110 }}><Chip kind={g.truth} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h2>{t("requirements")} <span className="faint">({reqs.length})</span></h2>
              {reqs.map((r) => (
                <div key={r.id} style={{ marginBottom: 10 }}>
                  <div className="row"><Chip kind={r.type === "mandatory" ? "HIGH" : "LOW"}>{r.type}</Chip><span className="faint">{r.category} · {r.extraction_method} · {r.verification}</span></div>
                  <Quote text={r.text} source={r.evidence ? (r.evidence.section ?? `p.${r.evidence.page ?? "—"}`) : null} />
                </div>
              ))}
              {!reqs.length && <p className="muted">{t("noData")}</p>}
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <h2>{t("unknowns")}</h2>
              {intel.unknowns.length ? intel.unknowns.map((u, i) => (
                <div key={i} className="row" style={{ marginBottom: 6 }}><Chip kind={u.truth} /><span>{u.reason.message}</span></div>
              )) : <p className="muted">{t("noData")}</p>}
            </div>
            <div className="card">
              <h2>{t("risks")}</h2>
              {intel.risks.length ? intel.risks.map((r, i) => (
                <div key={i} className="row" style={{ marginBottom: 6 }}><Chip kind={r.level} /><span className="faint">{r.category}</span><span>{r.reason.message}</span></div>
              )) : <p className="muted">{t("noData")}</p>}
            </div>
            <div className="card">
              <h2>{t("economics")} <span className="faint">({t("range")})</span></h2>
              <div className="stack">
                <div className="row between"><span className="muted">{t("effort")}</span><RangeText r={intel.economics.effort_days} /></div>
                <div className="row between"><span className="muted">{t("bidCost")}</span><RangeText r={intel.economics.bid_cost} currency={intel.economics.currency} /></div>
                <div className="row between"><span className="muted">{t("value")}</span><RangeText r={intel.economics.contract_value} currency={intel.economics.currency} /></div>
                <div className="row between"><span className="muted">{t("contribution")}</span><RangeText r={intel.economics.contribution} currency={intel.economics.currency} /></div>
                <p className="faint">{intel.economics.notes.join(" · ")}</p>
              </div>
            </div>
            <div className="card">
              <h2>{t("documents")}</h2>
              {opp.documents.length ? opp.documents.map((d: any) => (
                <div key={d.id} style={{ marginBottom: 8 }}>
                  <div>{d.title}</div>
                  <div className="row faint"><span>{d.extraction_status}</span>{d.needs_ocr && <Chip kind="MEDIUM">OCR</Chip>}
                    {d.risk_flags?.map((f: any, i: number) => <Chip key={i} kind="HIGH">{f.code}</Chip>)}</div>
                </div>
              )) : <p className="muted">{t("noData")}</p>}
            </div>
            <div className="card">
              <h2>{t("history")}</h2>
              {opp.events.map((e: any, i: number) => (
                <div key={i} className="row between faint"><span>v{e.version} · {e.type}</span><span>{date(e.at, lang)}</span></div>
              ))}
            </div>
            <div className="card">
              <h2>{t("facts")}</h2>
              {facts === null ? <button onClick={loadFacts}>{t("why")}</button> : facts.map((f, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div className="row between"><b className="mono">{f.field}</b><Chip kind={f.verification}>{f.epistemic}</Chip></div>
                  <Quote text={f.evidence.quote} source={`${f.evidence.locator ?? ""} · ${f.evidence.source_url ?? ""} · ${date(f.evidence.retrieved_at, lang)}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
