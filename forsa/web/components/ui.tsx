"use client";

import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { spring } from "@/lib/motion";

const REC: Record<string, { fr: string; en: string }> = {
  BID: { fr: "Soumissionner", en: "Pursue" },
  BID_WITH_CONDITIONS: { fr: "Sous conditions", en: "With conditions" },
  REVIEW: { fr: "À examiner", en: "Review" },
  NO_BID: { fr: "Ne pas soumissionner", en: "Do not pursue" },
};

export function RecChip({ rec }: { rec?: string | null }) {
  const { lang } = useI18n();
  if (!rec) return <span className="chip neutral">—</span>;
  return <span className={`chip ${rec}`}>{REC[rec]?.[lang] ?? rec}</span>;
}

export function Chip({ kind, children }: { kind: string; children?: ReactNode }) {
  return <span className={`chip ${kind}`}>{children ?? kind.replaceAll("_", " ")}</span>;
}

export function DemoBadge({ show }: { show?: boolean }) {
  const { t } = useI18n();
  return show ? <span className="chip outline" title="Synthetic demo data">{t("demo")}</span> : null;
}

/** Counts up to `value` once visible. Tabular numerals so layouts never jitter. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v).toLocaleString());
  useEffect(() => {
    if (!inView) return;
    const c = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [inView, value, mv]);
  return <motion.span ref={ref} className={`num ${className ?? ""}`}>{rounded}</motion.span>;
}

/** Signature element: the fit ring. Stroke draws in with a spring; colour follows the recommendation. */
export function FitRing({ score, size = 56, stroke = 5, rec, label }: { score?: number | null; size?: number;
  stroke?: number; rec?: string | null; label?: boolean }) {
  const { t } = useI18n();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = rec === "NO_BID" ? "var(--nobid)" : rec === "REVIEW" ? "var(--review)"
    : rec === "BID_WITH_CONDITIONS" ? "var(--cond)" : "var(--accent)";
  const known = score !== null && score !== undefined;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }} title={t("notProbability")}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        {known && (
          <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - (score ?? 0) / 100) }} transition={{ ...spring, stiffness: 120, damping: 20 }} />
        )}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", lineHeight: 1 }}>
        {known ? <b className="num" style={{ fontSize: size * 0.3 }}><AnimatedNumber value={score ?? 0} /></b>
          : <span className="faint">—</span>}
        {label && known && <span className="faint" style={{ fontSize: 9.5, marginTop: -size * 0.18 }}>/100</span>}
      </div>
    </div>
  );
}

export function Bar({ value, known = true }: { value: number; known?: boolean }) {
  return (
    <div className={`bar ${known ? "" : "unknown"}`}>
      <motion.i initial={{ width: 0 }} whileInView={{ width: `${known ? value : 100}%` }} viewport={{ once: true }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
    </div>
  );
}

export function Quote({ text, source }: { text?: string | null; source?: string | null }) {
  if (!text) return null;
  return <div className="quote">“{text}”{source && <span className="src">{source}</span>}</div>;
}

export function Skeleton({ h = 16, w = "100%", r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="col" style={{ padding: 18 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row" style={{ gap: 14, flexWrap: "nowrap" }}>
          <Skeleton h={48} w={48} r={24} />
          <div className="col" style={{ flex: 1, gap: 8 }}><Skeleton h={14} w="70%" /><Skeleton h={11} w="40%" /></div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="col"
      style={{ alignItems: "center", textAlign: "center", padding: "36px 18px", gap: 8 }}>
      {icon && <div style={{ color: "var(--faint)" }}>{icon}</div>}
      <b>{title}</b>
      {hint && <span className="muted" style={{ maxWidth: 360 }}>{hint}</span>}
    </motion.div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="quote"
      style={{ borderColor: "var(--nobid)", color: "var(--nobid)" }}>
      {error instanceof Error ? error.message : String(error)}
    </motion.div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" data-on={on}
      onClick={() => onChange(!on)}>
      <motion.span layout transition={spring} style={{ left: on ? 20 : 2 }} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, id }: { value: T; id: string;
  options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} data-active={o.value === value}
          onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={`seg-${id}`} className="seg-pill" transition={spring} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <motion.div className="page-head" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="row">{actions}</div>}
    </motion.div>
  );
}

export function Card({ title, icon, action, children, flush, className, delay = 0 }: { title?: ReactNode; icon?: ReactNode;
  action?: ReactNode; children: ReactNode; flush?: boolean; className?: string; delay?: number }) {
  return (
    <motion.section className={`card ${flush ? "flush" : ""} ${className ?? ""}`}
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay, ease: [0.22, 1, 0.36, 1] }}>
      {title && (
        <div className={flush ? "card-h" : "row between"} style={flush ? undefined : { marginBottom: 12 }}>
          <h2 className="row" style={{ gap: 8 }}>{icon}{title}</h2>{action}
        </div>
      )}
      {children}
    </motion.section>
  );
}
