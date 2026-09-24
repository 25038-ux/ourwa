"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, ClipboardCheck, FileText, Gavel, ListTodo, ShieldCheck, Sparkles, Trophy, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Card, Chip, DemoBadge, ErrorBox, FitRing, PageHead, RecChip, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { BID_STAGES, BID_STATUS } from "@/lib/labels";
import { fadeUp, haptic, spring, stagger } from "@/lib/motion";
import { revalidate, useApi } from "@/lib/store";

type Item = { id: string; text: string; type: string; category: string; source: string | null; status: string; response: string | null;
  risk: string | null };
type Bid = { id: string; status: string; outcome: string | null; opportunity_id: string; allowed_transitions: string[];
  opportunity: { title: string; deadline_at: string | null; is_synthetic: boolean } | null; compliance: Item[];
  decisions: { decision: string; system_recommendation: string | null; fit_score: number | null; rationale: string | null; at: string }[];
  approvals: { id: string; action: string; status: string; payload: any; at: string }[] };
type Draft = { sections: { compliance_item_id: string; requirement: string; source: string | null; classification: string; text: string;
  ai_polished: boolean }[]; note: string };

const STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "MISSING", "NEEDS_VERIFICATION", "BLOCKED"];
const ST: Record<string, { fr: string; en: string; kind: string }> = {
  NOT_STARTED: { fr: "À faire", en: "Not started", kind: "neutral" }, IN_PROGRESS: { fr: "En cours", en: "In progress", kind: "IN_PROGRESS" },
  COMPLETE: { fr: "Complet", en: "Complete", kind: "DONE" }, MISSING: { fr: "Manquant", en: "Missing", kind: "HIGH" },
  NEEDS_VERIFICATION: { fr: "À vérifier", en: "Verify", kind: "NEEDS_REVIEW" }, BLOCKED: { fr: "Bloqué", en: "Blocked", kind: "BLOCKED" },
};

function Stepper({ status }: { status: string }) {
  const { lang } = useI18n();
  const idx = BID_STAGES.indexOf(status as (typeof BID_STAGES)[number]);
  const final = ["WON", "LOST", "CANCELLED"].includes(status);
  const current = final ? BID_STAGES.length : idx;
  return (
    <div className="row" style={{ gap: 0, flexWrap: "nowrap", overflowX: "auto", paddingBottom: 4 }}>
      {BID_STAGES.map((s, i) => (
        <div key={s} className="row" style={{ gap: 0, flexWrap: "nowrap", flex: i < BID_STAGES.length - 1 ? 1 : "none" }}>
          <div className="col" style={{ alignItems: "center", gap: 6, minWidth: 74 }}>
            <motion.span initial={false} animate={{ scale: i === current ? 1.12 : 1,
              background: i < current ? "var(--accent)" : i === current ? "var(--accent-soft)" : "var(--surface-3)" }}
              transition={spring} style={{ width: 28, height: 28, borderRadius: 14, display: "grid", placeItems: "center",
                color: i < current ? "var(--accent-ink)" : "var(--accent)", border: i === current ? "2px solid var(--accent)" : "none" }}>
              {i < current ? <Check size={14} /> : <b className="num" style={{ fontSize: 12 }}>{i + 1}</b>}
            </motion.span>
            <span className="faint" style={{ fontWeight: i === current ? 700 : 500, color: i === current ? "var(--text)" : undefined,
              whiteSpace: "nowrap" }}>{BID_STATUS[s]?.[lang]}</span>
          </div>
          {i < BID_STAGES.length - 1 && (
            <div className="bar" style={{ flex: 1, height: 3, marginTop: -20, minWidth: 16 }}>
              <motion.i initial={{ width: 0 }} animate={{ width: i < current ? "100%" : "0%" }} transition={{ duration: 0.6, delay: i * 0.08 }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ItemRow({ item, onPatch }: { item: Item; onPatch: (body: Partial<Item>) => void }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [resp, setResp] = useState(item.response ?? "");
  const s = ST[item.status] ?? ST.NOT_STARTED;
  return (
    <motion.li variants={fadeUp} layout>
      <div className="item" style={{ alignItems: "flex-start", cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <motion.button className="btn icon sm ghost" aria-label="Toggle complete" whileTap={{ scale: 0.8 }}
          onClick={(e) => { e.stopPropagation(); haptic(8); onPatch({ status: item.status === "COMPLETE" ? "IN_PROGRESS" : "COMPLETE" }); }}
          style={{ marginTop: -4, borderRadius: 10, border: "1.5px solid", borderColor: item.status === "COMPLETE" ? "var(--bid)" : "var(--border-strong)",
            background: item.status === "COMPLETE" ? "var(--bid)" : "transparent", color: "var(--accent-ink)", width: 26, height: 26 }}>
          <AnimatePresence>{item.status === "COMPLETE" && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
            style={{ display: "grid" }}><Check size={15} /></motion.span>}</AnimatePresence>
        </motion.button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 560 }}>{item.text}</div>
          <div className="row faint" style={{ gap: 6, marginTop: 4 }}>
            <span className={`chip ${s.kind}`}>{s[lang]}</span>
            <span>{item.type} · {item.category}</span>
            {item.risk && item.risk !== "LOW" && <Chip kind={item.risk} />}
          </div>
        </div>
        <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: "grid", color: "var(--faint)" }}><ChevronDown size={18} /></motion.span>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: "hidden" }}>
            <div className="col" style={{ padding: "0 18px 16px 58px", gap: 10 }}>
              {item.source && <span className="faint">{lang === "fr" ? "Source" : "Source"} : {item.source}</span>}
              <div className="row" style={{ gap: 6 }}>
                {STATUSES.map((k) => (
                  <button key={k} className="pick" data-on={item.status === k} style={{ height: 30, fontSize: 12.5 }}
                    onClick={() => onPatch({ status: k })}>{ST[k][lang]}</button>
                ))}
              </div>
              <textarea rows={3} value={resp} onChange={(e) => setResp(e.target.value)}
                placeholder={lang === "fr" ? "Votre réponse / justificatif…" : "Your response / evidence…"} />
              <button className="btn sm primary" style={{ alignSelf: "flex-end" }} disabled={resp === (item.response ?? "")}
                onClick={() => onPatch({ response: resp })}>{lang === "fr" ? "Enregistrer la réponse" : "Save response"}</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export default function BidPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { data: bid, error } = useApi<Bid>(`/bids/${id}`);
  const { data: tasks } = useApi<{ items: { id: string; title: string; status: string; bid_id: string | null; due_at: string | null }[] }>("/tasks");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const act = async (p: Promise<unknown>, feedback = true) => {
    setErr(null);
    try {
      await p;
      if (feedback) haptic([8, 30, 8]);
      revalidate(`/bids/${id}`, "/bids", "/tasks");
    } catch (x) {
      setErr(x);
    }
  };
  const patch = (itemId: string, body: Partial<Item>) =>
    act(api(`/bids/${id}/compliance/${itemId}`, { method: "PATCH", json: body }), false);
  const makeDraft = async () => {
    setDrafting(true);
    await api<Draft>(`/bids/${id}/generate-draft`, { method: "POST" }).then(setDraft).catch(setErr);
    setDrafting(false);
  };

  if (error) return <ErrorBox error={error} />;
  if (!bid) return <div className="stack"><Skeleton h={40} w="60%" /><Skeleton h={80} /><Skeleton h={300} /></div>;
  const pending = bid.approvals.find((a) => a.status === "PENDING");
  const approved = bid.approvals.some((a) => a.status === "APPROVED" && a.action === "FINAL_SUBMISSION");
  const done = bid.compliance.filter((c) => c.status === "COMPLETE").length;
  const pct = bid.compliance.length ? Math.round((100 * done) / bid.compliance.length) : 0;
  const last = bid.decisions[0];
  const bidTasks = (tasks?.items ?? []).filter((x) => x.bid_id === bid.id);

  return (
    <div className="stack">
      <PageHead title={bid.opportunity?.title ?? t("bids")} sub={<span className="row" style={{ gap: 8 }}>
        <Link href={`/opportunities/${bid.opportunity_id}`} className="chip neutral">↗ {t("opportunities")}</Link>
        {bid.opportunity?.deadline_at && <span>{t("deadline")} · <b>{date(bid.opportunity.deadline_at, lang)}</b></span>}
        <DemoBadge show={bid.opportunity?.is_synthetic} /></span>} />
      <Card><Stepper status={bid.status} /></Card>
      <ErrorBox error={err} />

      <div className="grid g-main">
        <div className="stack">
          <Card title={t("decision")} icon={<Gavel size={16} color="var(--accent)" />}>
            {last && (
              <div className="row" style={{ gap: 12, marginBottom: 14, flexWrap: "nowrap" }}>
                <FitRing score={last.fit_score} rec={last.system_recommendation} size={52} />
                <div>
                  <div><b>{last.decision === "BID" ? (lang === "fr" ? "Décision : soumissionner" : "Decision: bid") : (lang === "fr" ? "Décision : ne pas soumissionner" : "Decision: no bid")}</b></div>
                  <div className="faint row" style={{ gap: 6 }}>FORSA : <RecChip rec={last.system_recommendation} /> · {date(last.at, lang)}</div>
                  {last.rationale && <div className="muted" style={{ marginTop: 4 }}>{last.rationale}</div>}
                </div>
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              {bid.status === "QUALIFYING" && <>
                <motion.button whileTap={{ scale: 0.95 }} className="btn accent" onClick={() => act(api(`/bids/${id}/decision`, { method: "POST", json: { decision: "BID" } }))}>
                  <Check size={16} />{lang === "fr" ? "Soumissionner" : "Bid"}</motion.button>
                <button className="btn" onClick={() => act(api(`/bids/${id}/decision`, { method: "POST", json: { decision: "NO_BID" } }))}>
                  <X size={16} />{lang === "fr" ? "Ne pas soumissionner" : "No bid"}</button>
              </>}
              {bid.allowed_transitions.includes("IN_REVIEW") && !pending &&
                <button className="btn primary" onClick={() => act(api(`/bids/${id}/approvals`, { method: "POST", json: { action: "FINAL_SUBMISSION" } }))}>
                  <ShieldCheck size={16} />{t("requestApproval")}</button>}
              {bid.status === "APPROVED" && approved &&
                <button className="btn accent" onClick={() => act(api(`/bids/${id}/submitted`, { method: "POST" }))}><Check size={16} />{t("markSubmitted")}</button>}
              {bid.status === "SUBMITTED" && (["WON", "LOST", "CANCELLED"] as const).map((o) => (
                <button key={o} className={`btn ${o === "WON" ? "accent" : ""}`} onClick={() => act(api(`/bids/${id}/outcome`, { method: "POST", json: { outcome: o } }))}>
                  {o === "WON" && <Trophy size={16} />}{BID_STATUS[o][lang]}</button>
              ))}
              {bid.outcome && <span className={`chip ${bid.outcome === "WON" ? "BID" : "neutral"}`}>{BID_STATUS[bid.outcome]?.[lang] ?? bid.outcome}</span>}
            </div>
            <AnimatePresence>
              {pending && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="quote"
                  style={{ marginTop: 14, borderColor: "var(--cond)" }}>
                  <b>{lang === "fr" ? "Approbation humaine requise" : "Human approval required"}</b> — {pending.action}
                  {pending.payload?.open_mandatory_items?.length > 0 && (
                    <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
                      {pending.payload.open_mandatory_items.map((x: string) => <li key={x}>{x}</li>)}</ul>
                  )}
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <button className="btn sm accent" onClick={() => act(api(`/approvals/${pending.id}/decision`, { method: "POST", json: { approve: true } }))}>
                      <Check size={14} />{t("approve")}</button>
                    <button className="btn sm" onClick={() => act(api(`/approvals/${pending.id}/decision`, { method: "POST", json: { approve: false } }))}>
                      <X size={14} />{t("reject")}</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>

          <Card flush title={<>{t("compliance")} <span className="chip neutral num">{done}/{bid.compliance.length}</span></>}
            icon={<ClipboardCheck size={16} color="var(--accent)" />}
            action={<motion.button className="btn sm" onClick={makeDraft} disabled={drafting} whileTap={{ scale: 0.95 }}>
              {drafting ? <span className="spin" style={{ display: "inline-flex" }}><Sparkles size={14} /></span> : <FileText size={14} />}{t("draft")}</motion.button>}>
            <div style={{ padding: "0 18px 12px" }}>
              <div className="bar"><motion.i initial={false} animate={{ width: `${pct}%` }} transition={spring} /></div>
            </div>
            <motion.ul className="list" variants={stagger(0.03)} initial="hidden" animate="show">
              {bid.compliance.map((c) => <ItemRow key={c.id} item={c} onPatch={(b) => patch(c.id, b)} />)}
            </motion.ul>
          </Card>
        </div>

        <div className="stack">
          <Card title={t("tasks")} icon={<ListTodo size={16} color="var(--review)" />} delay={0.08}
            action={<Link href="/tasks" className="btn ghost sm">{t("viewAll")}</Link>}>
            {bidTasks.length ? bidTasks.map((x) => (
              <div key={x.id} className="row between" style={{ padding: "6px 0", flexWrap: "nowrap" }}>
                <span className="clamp2" style={{ textDecoration: x.status === "DONE" ? "line-through" : undefined }}>{x.title}</span>
                {x.due_at && <span className="faint num" style={{ whiteSpace: "nowrap" }}>{date(x.due_at, lang)}</span>}
              </div>
            )) : <p className="muted">{lang === "fr" ? "Les conditions deviennent des tâches dès la décision de soumissionner."
              : "Conditions become tasks as soon as you decide to bid."}</p>}
          </Card>
          <AnimatePresence>
            {draft && (
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Card title={t("draft")} icon={<FileText size={16} color="var(--gold)" />}>
                  <div className="col">
                    {draft.sections.map((s) => (
                      <div key={s.compliance_item_id} className="col" style={{ gap: 4 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <Chip kind={s.classification === "EVIDENCE_BACKED" ? "VERIFIED" : s.classification === "PLACEHOLDER" ? "UNKNOWN" : "NEEDS_HUMAN"}>
                            {s.classification.replaceAll("_", " ")}</Chip>
                          {s.ai_polished && <span className="chip ai"><Sparkles size={11} />IA</span>}
                        </div>
                        <b style={{ fontSize: 13.5 }}>{s.requirement}</b>
                        <div className="muted" style={{ fontSize: 13.5 }}>{s.text}</div>
                      </div>
                    ))}
                    <p className="faint">{draft.note}</p>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
