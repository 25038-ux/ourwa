"use client";

import { motion } from "motion/react";
import { MessageCircle, Sparkles } from "lucide-react";
import { AssistantChat } from "@/components/assistant";
import { PageHead } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/store";

export default function AssistantPage() {
  const { t, lang } = useI18n();
  const { data: status } = useApi<{ mode: string; providers: { name: string; model: string }[]; decision_model: string | null }>(
    "/assistant/status");
  const { data: convs } = useApi<{ items: { id: string; title: string }[] }>("/assistant/conversations");
  return (
    <div className="stack">
      <PageHead title={<span className="row" style={{ gap: 12 }}><motion.span className="orb" animate={{ rotate: [0, 8, -8, 0] }}
        transition={{ duration: 6, repeat: Infinity }}><Sparkles size={20} /></motion.span>{t("assistant")}</span>}
        sub={status ? (status.mode === "llm"
          ? `${status.providers.map((p) => `${p.name} (${p.model})`).join(" → ")}${status.decision_model ? ` · ${status.decision_model}` : ""}`
          : (lang === "fr" ? "Mode déterministe (aucun fournisseur IA configuré) — réponses construites uniquement à partir de vos données."
            : "Deterministic mode (no AI provider configured) — answers built only from your data.")) : " "} />
      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 260px", alignItems: "start" }}>
        <div className="card" style={{ height: "min(72dvh, 760px)", display: "flex", flexDirection: "column" }}>
          <AssistantChat />
        </div>
        <div className="card hide-m">
          <h3>{lang === "fr" ? "Conversations" : "Conversations"}</h3>
          <div className="col" style={{ gap: 4 }}>
            {convs?.items.map((c) => <div key={c.id} className="row faint clamp2" style={{ gap: 6 }}><MessageCircle size={13} />{c.title}</div>)}
            {!convs?.items.length && <span className="faint">{t("noData")}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
