"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

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
  return <span className={`chip ${kind}`}>{children ?? kind}</span>;
}

export function Fit({ score, completeness }: { score?: number | null; completeness?: number | null }) {
  const { t } = useI18n();
  if (score === null || score === undefined) return <span className="faint">—</span>;
  return (
    <span className="fit" title={t("notProbability")}>
      <b>{score}</b>
      <span className="bar"><i style={{ width: `${score}%` }} /></span>
      {completeness !== undefined && completeness !== null && (
        <span className="faint">{Math.round(completeness * 100)}% {t("completeness")}</span>
      )}
    </span>
  );
}

export function DemoBadge({ show }: { show?: boolean }) {
  const { t } = useI18n();
  return show ? <span className="chip demo">{t("demo")}</span> : null;
}

export function Quote({ text, source }: { text?: string | null; source?: string | null }) {
  if (!text) return null;
  return (
    <div className="quote">
      “{text}”{source && <span className="src">{source}</span>}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t("loading")}</p>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="alert bad">{error instanceof Error ? error.message : String(error)}</div>;
}
