"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { date, days, dirOf, money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { DemoBadge, ErrorBox, Fit, Loading, RecChip } from "@/components/ui";

type Opp = {
  id: string; external_ref: string; kind: string; title: string; buyer: string | null; region: string | null;
  category: string | null; status: string; currency: string | null; estimated_value: number | null;
  deadline_at: string | null; days_left: number | null; language: string | null; is_synthetic: boolean;
  concepts: { concept_id: string; label: string }[];
  match: { fit_score: number; recommendation: string; data_completeness: number } | null;
};

export default function Explorer() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [minFit, setMinFit] = useState("");
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [sort, setSort] = useState("fit");
  const [data, setData] = useState<{ total: number; items: Opp[] } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ lang, sort });
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (recommendation) p.set("recommendation", recommendation);
    if (minFit) p.set("min_fit", minFit);
    if (matchedOnly) p.set("matched_only", "true");
    return p.toString();
  }, [q, category, recommendation, minFit, matchedOnly, sort, lang]);

  useEffect(() => {
    const handle = setTimeout(() => api(`/opportunities?${query}`).then(setData).catch(setError), 200);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="stack">
      <div className="row between">
        <h1>{t("opportunities")}</h1>
        {data && <span className="muted">{data.total}</span>}
      </div>
      <div className="filters">
        <input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search")} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="category">
          <option value="">{t("all")}</option>
          <option value="works">Travaux / Works</option>
          <option value="goods">Fournitures / Goods</option>
          <option value="services">Services</option>
          <option value="consulting">Prestations intellectuelles</option>
        </select>
        <select value={recommendation} onChange={(e) => setRecommendation(e.target.value)} aria-label={t("recommendation")}>
          <option value="">{t("recommendation")}: {t("all")}</option>
          <option value="BID">BID</option>
          <option value="BID_WITH_CONDITIONS">BID WITH CONDITIONS</option>
          <option value="REVIEW">REVIEW</option>
          <option value="NO_BID">NO-BID</option>
        </select>
        <input type="number" min={0} max={100} placeholder={t("minFit")} value={minFit} onChange={(e) => setMinFit(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("sort")}>
          <option value="fit">{t("sort")}: {t("fitSort")}</option>
          <option value="deadline">{t("sort")}: {t("deadlineSort")}</option>
          <option value="recent">{t("sort")}: {t("recentSort")}</option>
        </select>
        <label className="row faint"><input type="checkbox" checked={matchedOnly} onChange={(e) => setMatchedOnly(e.target.checked)} />{t("matchedOnly")}</label>
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <div className="card flush">
          <ul className="list">
            {data.items.map((o) => (
              <li key={o.id}>
                <div className="row between" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }} dir={dirOf(o.language)}>
                    <Link className="opp-title" href={`/opportunities/${o.id}`}>{o.title}</Link>
                    <div className="faint">
                      {o.external_ref} · {o.kind} · {o.buyer ?? "—"} · {o.region ?? "—"} · {money(o.estimated_value, o.currency, lang)}
                    </div>
                    <div className="row" style={{ marginTop: 4 }}>
                      <RecChip rec={o.match?.recommendation} />
                      {o.status === "PLANNED" && <span className="chip REVIEW">{t("early")}</span>}
                      {o.concepts.map((c) => <span key={c.concept_id} className="chip neutral">{c.label}</span>)}
                      <DemoBadge show={o.is_synthetic} />
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <Fit score={o.match?.fit_score} />
                    <div className="faint">{o.deadline_at ? `${date(o.deadline_at, lang)} · ${days(o.days_left, t("daysLeft"))}` : "—"}</div>
                  </div>
                </div>
              </li>
            ))}
            {!data.items.length && <li className="muted">{t("noData")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
