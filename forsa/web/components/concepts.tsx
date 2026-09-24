"use client";

import { motion } from "motion/react";
import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export type Concept = { id: string; label: string };

/** Type-ahead over the FORSA ontology (never free text: every profile claim maps to a known concept). */
export function ConceptSearch({ kind, onAdd }: { kind: "capability" | "credential"; onAdd: (c: Concept) => void }) {
  const { lang } = useI18n();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Concept[]>([]);
  useEffect(() => {
    if (q.length < 2) return setItems([]);
    const id = setTimeout(() => api(`/meta/taxonomy?${new URLSearchParams({ kind, lang, q })}`).then((r) => setItems(r.items))
      .catch(() => setItems([])), 180);
    return () => clearTimeout(id);
  }, [q, kind, lang]);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: 12, top: 12.5, color: "var(--faint)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34 }}
          placeholder={lang === "fr" ? "Ajouter (ex. forage, BTP, informatique…)" : "Add (e.g. borehole, IT, construction…)"} />
      </div>
      <div className="row" style={{ gap: 6 }}>
        {items.slice(0, 8).map((c) => (
          <motion.button key={c.id} type="button" className="pick" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            onClick={() => { onAdd(c); setQ(""); }}><Plus size={14} />{c.label}</motion.button>
        ))}
      </div>
    </div>
  );
}

