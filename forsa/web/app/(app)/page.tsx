"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { date, days } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { DemoBadge, ErrorBox, Fit, Loading, RecChip } from "@/components/ui";

type Item = {
  opportunity_id: string; title: string; fit: number; recommendation: string; deadline_days: number | null;
  blockers: string[]; is_synthetic: boolean; status: string;
};
type Briefing = {
  date: string; counts: Record<string, number>; top_action: (Item & { blocker: string | null }) | null;
  pursue: Item[]; deadlines: Item[]; early_signals: Item[]; missing_items: string[];
  changes: { opportunity_id: string; title: string; type: string }[];
  source_alerts: { key: string; name: string; health: string; detail: string }[]; note: string;
};

function Line({ item }: { item: Item }) {
  const { t } = useI18n();
  return (
    <li className="row between">
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link className="opp-title" href={`/opportunities/${item.opportunity_id}`}>{item.title}</Link>
        <div className="row faint">
          <RecChip rec={item.recommendation} />
          {item.deadline_days !== null && <span>{days(item.deadline_days, t("daysLeft"))}</span>}
          {item.blockers[0] && <span>· {item.blockers[0]}</span>}
          <DemoBadge show={item.is_synthetic} />
        </div>
      </div>
      <Fit score={item.fit} />
    </li>
  );
}

export default function CommandCenter() {
  const { t, lang } = useI18n();
  const [b, setB] = useState<Briefing | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<Briefing>(`/briefing/today?lang=${lang}`).then(setB).catch(setError);
  }, [lang]);
  if (error) return <ErrorBox error={error} />;
  if (!b) return <Loading />;
  const c = b.counts;
  const stats: [string, number][] = [
    [t("newSignals"), c.new_signals], [t("highFit"), c.high_fit], [t("deadlines"), c.deadlines],
    [t("missing"), c.missing_items], [t("early"), c.early_signals], [t("changes"), c.changes],
    [t("approvals"), c.approvals_pending],
  ];
  return (
    <div className="stack">
      <div>
        <h1>{t("goodMorning")} — {date(b.date, lang)}</h1>
        <p className="muted">{t("today")}</p>
      </div>
      {b.source_alerts.map((a) => (
        <div key={a.key} className="alert">
          <b>{t("sourceAlert")} · {a.name}</b> — {a.health}: {a.detail}
        </div>
      ))}
      <div className="stats">
        {stats.map(([label, n]) => (
          <div key={label} className="stat"><b>{n}</b><span>{label}</span></div>
        ))}
      </div>
      {b.top_action && (
        <div className="card top-action">
          <h3>{t("topAction")}</h3>
          <div className="row between">
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link className="opp-title" style={{ fontSize: 16 }} href={`/opportunities/${b.top_action.opportunity_id}`}>
                {b.top_action.title}
              </Link>
              <div className="row muted" style={{ marginTop: 4 }}>
                <RecChip rec={b.top_action.recommendation} />
                {b.top_action.deadline_days !== null && <span>{t("deadline")}: {days(b.top_action.deadline_days, t("daysLeft"))}</span>}
                {b.top_action.blocker && <span>· {b.top_action.blocker}</span>}
                <DemoBadge show={b.top_action.is_synthetic} />
              </div>
            </div>
            <Fit score={b.top_action.fit} />
          </div>
        </div>
      )}
      <div className="grid g-main">
        <div className="stack">
          <div className="card flush">
            <div style={{ padding: "14px 16px 4px" }}><h2>{t("pursue")}</h2></div>
            {b.pursue.length ? <ul className="list">{b.pursue.map((i) => <Line key={i.opportunity_id} item={i} />)}</ul>
              : <p className="muted" style={{ padding: "0 16px 14px" }}>{t("noData")}</p>}
          </div>
          <div className="card flush">
            <div style={{ padding: "14px 16px 4px" }}><h2>{t("earlySignals")}</h2></div>
            {b.early_signals.length ? <ul className="list">{b.early_signals.map((i) => <Line key={i.opportunity_id} item={i} />)}</ul>
              : <p className="muted" style={{ padding: "0 16px 14px" }}>{t("noData")}</p>}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h2>{t("deadlines")}</h2>
            {b.deadlines.length ? b.deadlines.map((i) => (
              <div key={i.opportunity_id} className="row between" style={{ marginBottom: 8 }}>
                <Link href={`/opportunities/${i.opportunity_id}`}>{i.title}</Link>
                <b>{days(i.deadline_days, t("daysLeft"))}</b>
              </div>
            )) : <p className="muted">{t("noData")}</p>}
          </div>
          <div className="card">
            <h2>{t("missingItems")}</h2>
            {b.missing_items.length ? <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {b.missing_items.map((m) => <li key={m}>{m}</li>)}
            </ul> : <p className="muted">{t("noData")}</p>}
          </div>
          <div className="card">
            <h2>{t("changes")}</h2>
            {b.changes.length ? b.changes.map((ch, i) => (
              <div key={i}><Link href={`/opportunities/${ch.opportunity_id}`}>{ch.title}</Link> <span className="faint">{ch.type}</span></div>
            )) : <p className="muted">{t("noData")}</p>}
          </div>
          <p className="faint">{t("notProbability")}</p>
        </div>
      </div>
    </div>
  );
}
