"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Chip, DemoBadge, ErrorBox, Loading, RecChip } from "@/components/ui";

const STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "MISSING", "NEEDS_VERIFICATION", "BLOCKED"];

export default function BidPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const [bid, setBid] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => { api(`/bids/${id}`).then(setBid).catch(setError); }, [id]);
  useEffect(load, [load]);
  const act = (p: Promise<unknown>) => { setError(null); p.then(load).catch(setError); };

  if (!bid) return error ? <ErrorBox error={error} /> : <Loading />;
  const pending = bid.approvals.find((a: any) => a.status === "PENDING");
  const approved = bid.approvals.some((a: any) => a.status === "APPROVED" && a.action === "FINAL_SUBMISSION");
  return (
    <div className="stack">
      <div>
        <div className="row faint"><Link href={`/opportunities/${bid.opportunity_id}`}>← {bid.opportunity?.title}</Link><DemoBadge show={bid.opportunity?.is_synthetic} /></div>
        <h1>{bid.opportunity?.title}</h1>
        <div className="row"><Chip kind="neutral">{bid.status}</Chip><span className="muted">{t("deadline")}: {date(bid.opportunity?.deadline_at, lang)}</span></div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <h2>{t("decision")}</h2>
        {bid.decisions.map((d: any, i: number) => (
          <div key={i} className="row faint">
            <b>{d.decision}</b> · FORSA: <RecChip rec={d.system_recommendation} /> ({d.fit_score ?? "—"}) · {d.rationale ?? ""} · {date(d.at, lang)}
          </div>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          {bid.status === "QUALIFYING" && <>
            <button className="primary" onClick={() => act(api(`/bids/${id}/decision`, { method: "POST", json: { decision: "BID" } }))}>BID</button>
            <button onClick={() => act(api(`/bids/${id}/decision`, { method: "POST", json: { decision: "NO_BID" } }))}>NO-BID</button>
          </>}
          {bid.allowed_transitions.includes("IN_REVIEW") && !pending &&
            <button onClick={() => act(api(`/bids/${id}/approvals`, { method: "POST", json: { action: "FINAL_SUBMISSION" } }))}>{t("requestApproval")}</button>}
          {pending && <>
            <span className="muted">{pending.action} — PENDING</span>
            <button className="primary" onClick={() => act(api(`/approvals/${pending.id}/decision`, { method: "POST", json: { approve: true } }))}>{t("approve")}</button>
            <button onClick={() => act(api(`/approvals/${pending.id}/decision`, { method: "POST", json: { approve: false } }))}>{t("reject")}</button>
          </>}
          {bid.status === "APPROVED" && approved &&
            <button className="primary" onClick={() => act(api(`/bids/${id}/submitted`, { method: "POST" }))}>{t("markSubmitted")}</button>}
          {bid.status === "SUBMITTED" && ["WON", "LOST", "CANCELLED"].map((o) =>
            <button key={o} onClick={() => act(api(`/bids/${id}/outcome`, { method: "POST", json: { outcome: o } }))}>{o}</button>)}
        </div>
        {pending?.payload?.open_mandatory_items?.length > 0 && (
          <div className="alert" style={{ marginTop: 10 }}>
            {pending.payload.open_mandatory_items.length} mandatory item(s) not complete:
            <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>{pending.payload.open_mandatory_items.map((x: string) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
      </div>
      <div className="card flush">
        <div style={{ padding: "14px 16px 4px" }} className="row between">
          <h2>{t("compliance")}</h2>
          <button onClick={() => api(`/bids/${id}/generate-draft`, { method: "POST" }).then(setDraft).catch(setError)}>{t("draft")}</button>
        </div>
        <table>
          <thead><tr><th>Requirement</th><th className="hide-sm">{t("source")}</th><th>{t("status")}</th><th className="hide-sm">Risk</th></tr></thead>
          <tbody>
            {bid.compliance.map((c: any) => (
              <tr key={c.id}>
                <td>{c.text}<div className="faint">{c.type} · {c.category}</div></td>
                <td className="hide-sm faint">{c.source}</td>
                <td>
                  <select value={c.status} onChange={(e) => act(api(`/bids/${id}/compliance/${c.id}`, { method: "PATCH", json: { status: e.target.value } }))}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="hide-sm"><Chip kind={c.risk ?? "LOW"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft && (
        <div className="card">
          <h2>{t("draft")}</h2>
          {draft.sections.map((s: any) => (
            <div key={s.compliance_item_id} style={{ marginBottom: 10 }}>
              <div className="row"><Chip kind={s.classification === "EVIDENCE_BACKED" ? "VERIFIED" : s.classification === "PLACEHOLDER" ? "UNKNOWN" : "NEEDS_HUMAN"}>{s.classification}</Chip><span className="faint">{s.source}</span></div>
              <div><b>{s.requirement}</b></div>
              <div className="muted">{s.text}</div>
            </div>
          ))}
          <p className="faint">{draft.note}</p>
        </div>
      )}
    </div>
  );
}
