"use client";

import { motion } from "motion/react";
import { Briefcase, CalendarClock, CalendarPlus, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Card, DemoBadge, Empty, ErrorBox, FitRing, PageHead, RecChip, Segmented, SkeletonList } from "@/components/ui";
import { safeGet } from "@/lib/api";
import { date } from "@/lib/format";
import { BID_ACTIVE, BID_STATUS } from "@/lib/labels";
import { useI18n } from "@/lib/i18n";
import { fadeUp, stagger } from "@/lib/motion";
import { useApi } from "@/lib/store";

type BidRow = { id: string; status: string; outcome: string | null; title: string; deadline_at: string | null; opportunity_id: string;
  is_synthetic: boolean; fit_score: number | null; recommendation: string | null; compliance: { total: number; complete: number } };

function daysTo(iso: string | null) {
  return iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null;
}

export default function BidsPage() {
  const { t, lang } = useI18n();
  const { data, error } = useApi<{ items: BidRow[] }>("/bids");
  const [tab, setTab] = useState<"active" | "closed">("active");
  if (error) return <ErrorBox error={error} />;
  const items = (data?.items ?? []).filter((b) => (tab === "active") === BID_ACTIVE.has(b.status));
  return (
    <div className="stack">
      <PageHead title={t("bids")} sub={lang === "fr" ? "Chaque offre : décision, conformité, approbation humaine, résultat."
        : "Every bid: decision, compliance, human approval, outcome."}
        actions={<>
          <a className="btn" href={`/api/v1/calendar.ics?org=${safeGet("forsa.org") ?? ""}`}><CalendarPlus size={16} />
            <span className="hide-m">{t("exportCalendar")}</span></a>
          <Segmented id="bids-tab" value={tab} onChange={setTab} options={[
            { value: "active", label: lang === "fr" ? "En cours" : "Active" }, { value: "closed", label: lang === "fr" ? "Clôturées" : "Closed" }]} />
        </>} />
      <Card flush>
        {!data ? <SkeletonList rows={4} /> : items.length ? (
          <motion.ul className="list" variants={stagger()} initial="hidden" animate="show" key={tab}>
            {items.map((b) => {
              const d = daysTo(b.deadline_at);
              const pct = b.compliance.total ? Math.round((100 * b.compliance.complete) / b.compliance.total) : 0;
              return (
                <motion.li key={b.id} variants={fadeUp}>
                  <Link href={`/bids/${b.id}`} className="item">
                    <FitRing score={b.fit_score} rec={b.recommendation} size={46} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="item-title clamp2">{b.title}</div>
                      <div className="row faint" style={{ gap: 8, marginTop: 4 }}>
                        <span className={`chip ${b.status === "WON" ? "BID" : b.status === "LOST" || b.status === "NO_BID" ? "NO_BID" : "neutral"}`}>
                          {BID_STATUS[b.status]?.[lang] ?? b.status}</span>
                        <RecChip rec={b.recommendation} />
                        {d !== null && <span className="row num" style={{ gap: 4, color: d <= 7 && d >= 0 ? "var(--cond)" : undefined }}>
                          <CalendarClock size={12} />{d >= 0 ? `${d} ${t("daysLeft")}` : date(b.deadline_at, lang)}</span>}
                        <DemoBadge show={b.is_synthetic} />
                      </div>
                      {b.compliance.total > 0 && (
                        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "nowrap" }}>
                          <div className="bar" style={{ flex: 1, maxWidth: 240 }}><motion.i initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} /></div>
                          <span className="faint num">{b.compliance.complete}/{b.compliance.total}</span>
                        </div>
                      )}
                    </div>
                    <ChevronRight size={18} color="var(--faint)" />
                  </Link>
                </motion.li>
              );
            })}
          </motion.ul>
        ) : <Empty icon={<Briefcase size={28} />} title={t("noData")} hint={lang === "fr"
          ? "Ouvrez un espace d'offre depuis une opportunité pour démarrer." : "Open a bid workspace from an opportunity to start."} />}
      </Card>
    </div>
  );
}
