"use client";

import { motion } from "motion/react";
import { Globe, Radio } from "lucide-react";
import { Card, Chip, Empty, ErrorBox, PageHead, SkeletonList } from "@/components/ui";
import { date } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fadeUp, stagger } from "@/lib/motion";
import { useApi } from "@/lib/store";

type Source = { key: string; name: string; status: string; notes: string | null; health: string; health_detail: string | null;
  access_type: string; base_url?: string | null;
  last_run: { status: string; started_at: string; finished_at: string | null; stats: Record<string, number> } | null };

const HEALTH_COLOR: Record<string, string> = { UP: "var(--bid)", DEGRADED: "var(--cond)", STALE: "var(--cond)", DOWN: "var(--nobid)",
  AUTH_REQUIRED: "var(--unknown)", UNKNOWN: "var(--unknown)" };

export default function SourcesPage() {
  const { t, lang } = useI18n();
  const { data, error } = useApi<{ items: Source[] }>("/sources");
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="stack">
      <PageHead title={t("sources")} sub={lang === "fr"
        ? "Aucune source ne tourne sans entrée vérifiée dans le registre. Les données périmées sont signalées, jamais masquées."
        : "No source runs without a verified registry entry. Stale data is flagged, never hidden."} />
      <Card flush>
        {!data ? <SkeletonList rows={3} /> : data.items.length ? (
          <motion.ul className="list" variants={stagger()} initial="hidden" animate="show">
            {data.items.map((s) => (
              <motion.li key={s.key} variants={fadeUp} className="item" style={{ alignItems: "flex-start" }}>
                <span style={{ position: "relative", width: 38, height: 38, borderRadius: 12, flex: "none", display: "grid", placeItems: "center",
                  background: "var(--surface-2)", color: HEALTH_COLOR[s.health] ?? "var(--faint)" }}>
                  {s.access_type === "api" ? <Radio size={18} /> : <Globe size={18} />}
                  {s.health === "UP" && <motion.span style={{ position: "absolute", inset: 0, borderRadius: 12, border: "2px solid var(--bid)" }}
                    animate={{ opacity: [0.6, 0], scale: [1, 1.35] }} transition={{ duration: 2, repeat: Infinity }} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}><b>{s.name}</b><Chip kind={s.health} /><span className="chip neutral">{s.status}</span></div>
                  <div className="faint" style={{ marginTop: 2 }}>{s.key} · {s.access_type}{s.health_detail ? ` · ${s.health_detail}` : ""}</div>
                  {s.notes && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{s.notes}</div>}
                  {s.last_run && (
                    <div className="row faint" style={{ gap: 8, marginTop: 6 }}>
                      <span>{lang === "fr" ? "Dernière exécution" : "Last run"} : <b>{s.last_run.status}</b> · {date(s.last_run.finished_at ?? s.last_run.started_at, lang)}</span>
                      {Object.entries(s.last_run.stats ?? {}).slice(0, 4).map(([k, v]) => <span key={k} className="chip neutral num">{k} {v}</span>)}
                    </div>
                  )}
                </div>
              </motion.li>
            ))}
          </motion.ul>
        ) : <Empty title={t("noData")} />}
      </Card>
    </div>
  );
}
