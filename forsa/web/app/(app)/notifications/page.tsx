"use client";

import { AnimatePresence, motion } from "motion/react";
import { BellOff, BellRing, CheckCheck, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { enablePush } from "@/components/pwa";
import { Empty, PageHead, Segmented, SkeletonList } from "@/components/ui";
import { api } from "@/lib/api";
import { CATEGORY_LABEL, useI18n } from "@/lib/i18n";
import { useLive } from "@/lib/live";
import { spring } from "@/lib/motion";
import { revalidate, useApi } from "@/lib/store";

type N = { id: string; category: string; title: string; payload: any; priority: string; read: boolean; at: string };

function when(iso: string, lang: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (d < 60) return rtf.format(-Math.round(d), "second");
  if (d < 3600) return rtf.format(-Math.round(d / 60), "minute");
  if (d < 86400) return rtf.format(-Math.round(d / 3600), "hour");
  return rtf.format(-Math.round(d / 86400), "day");
}

export default function Notifications() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { refreshUnread } = useLive();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [push, setPush] = useState<string | null>(null);
  const { data } = useApi<{ items: N[] }>("/notifications");
  useEffect(() => { refreshUnread(); }, [data, refreshUnread]);
  const items = (data?.items ?? []).filter((n) => filter === "all" || !n.read);

  const open = async (n: N) => {
    if (!n.read) await api(`/notifications/${n.id}/read`, { method: "POST" }).catch(() => undefined);
    revalidate("/notifications");
    const p = n.payload ?? {};
    router.push(p.opportunity_id ? `/opportunities/${p.opportunity_id}` : p.bid_id ? `/bids/${p.bid_id}` :
      n.category === "task_assignment" ? "/tasks" : "/notifications");
  };
  const readAll = async () => {
    await api("/notifications/read-all", { method: "POST" });
    revalidate("/notifications");
    refreshUnread();
  };
  const turnOnPush = async () => setPush(await enablePush().catch(() => "unsupported"));

  return (
    <div className="stack">
      <PageHead title={t("notifications")} actions={<>
        <Segmented id="nf" value={filter} onChange={setFilter} options={[{ value: "all", label: t("all") },
          { value: "unread", label: lang === "fr" ? "Non lues" : "Unread" }]} />
        <button className="btn" onClick={readAll}><CheckCheck size={16} />{t("markAllRead")}</button></>} />
      <motion.div className="card row between" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: 14 }}>
        <span className="row" style={{ gap: 10 }}><Smartphone size={18} color="var(--accent)" />
          {push === "on" ? t("pushOn") : push === "server-off" ? t("pushUnavailable") : push === "denied"
            ? (lang === "fr" ? "Permission refusée dans le navigateur" : "Permission denied by the browser")
            : push === "unsupported" ? (lang === "fr" ? "Non pris en charge sur ce navigateur" : "Not supported on this browser")
              : t("enablePush")}</span>
        {push !== "on" && <button className="btn accent sm" onClick={turnOnPush}><BellRing size={14} />OK</button>}
      </motion.div>
      <div className="card flush">
        {!data ? <SkeletonList /> : items.length === 0 ? <Empty icon={<BellOff size={28} />} title={t("allCaughtUp")} /> : (
          <ul className="list">
            <AnimatePresence initial={false}>
              {items.map((n) => (
                <motion.li key={n.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }} transition={spring}>
                  <button className="item" style={{ width: "100%", border: 0, background: n.read ? "transparent" : "var(--accent-soft)",
                    textAlign: "left", cursor: "pointer" }} onClick={() => open(n)}>
                    <span className="dot" style={{ background: n.read ? "transparent" : n.priority === "high" ? "var(--nobid)" : "var(--accent)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="faint" style={{ fontWeight: 600 }}>{CATEGORY_LABEL[n.category]?.[lang] ?? n.category}</div>
                      <div className="item-title clamp2">{n.title}</div>
                      {n.payload?.changes && <div className="faint">{n.payload.changes.join(" · ")}</div>}
                    </div>
                    <span className="faint" style={{ flex: "none" }}>{when(n.at, lang)}</span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}
