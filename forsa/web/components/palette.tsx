"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Radar, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAssistant } from "@/lib/assistant";
import { useI18n } from "@/lib/i18n";
import { spring } from "@/lib/motion";

type Opt = { key: string; label: string; hint?: string; icon: React.ReactNode; run: () => void };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { ask, setOpen } = useAssistant();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [opps, setOpps] = useState<{ id: string; title: string; external_ref: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setOpps([]);
      return;
    }
    const h = setTimeout(() => api(`/opportunities?q=${encodeURIComponent(q)}&limit=5&include_closed=true`)
      .then((r) => setOpps(r.items)).catch(() => setOpps([])), 150);
    return () => clearTimeout(h);
  }, [q, open]);

  const pages: [string, string][] = [["/", t("command")], ["/opportunities", t("opportunities")], ["/bids", t("bids")],
    ["/tasks", t("tasks")], ["/company", t("company")], ["/notifications", t("notifications")], ["/team", t("team")],
    ["/sources", t("sources")], ["/settings", t("settings")]];
  const options: Opt[] = useMemo(() => {
    const go = (href: string) => () => { onClose(); router.push(href); };
    const list: Opt[] = [];
    if (q.trim()) list.push({ key: "ask", label: `${t("assistant")} : « ${q.trim()} »`, icon: <Sparkles size={16} />,
      run: () => { onClose(); setOpen(true); ask(q); } });
    opps.forEach((o) => list.push({ key: o.id, label: o.title, hint: o.external_ref, icon: <Radar size={16} />,
      run: go(`/opportunities/${o.id}`) }));
    pages.filter(([, label]) => !q || label.toLowerCase().includes(q.toLowerCase()))
      .forEach(([href, label]) => list.push({ key: href, label, icon: <ArrowUpRight size={16} />, run: go(href) }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, opps, t]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter") options[active]?.run();
    if (e.key === "Escape") onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="palette" role="dialog" aria-label="Command palette" initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={spring}>
            <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
              placeholder={t("search")} aria-label={t("search")} />
            <div style={{ maxHeight: "50vh", overflowY: "auto", padding: "6px 0" }}>
              {options.map((o, i) => (
                <div key={o.key} className="opt" data-active={i === active} onMouseEnter={() => setActive(i)} onClick={o.run}>
                  <span style={{ color: "var(--muted)" }}>{o.icon}</span>
                  <span className="clamp2" style={{ flex: 1 }}>{o.label}</span>
                  {o.hint && <span className="faint mono">{o.hint}</span>}
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
