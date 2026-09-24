"use client";

import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { haptic } from "@/lib/motion";

export type DeckItem = { id: string; node: React.ReactNode };

/** Tinder-style triage: drag right to pursue, left to dismiss. Buttons do the same for accessibility. */
export function SwipeDeck({ items, onDecide }: { items: DeckItem[]; onDecide: (id: string, choice: "pursue" | "dismiss") => void }) {
  const { t } = useI18n();
  const [gone, setGone] = useState<{ id: string; dir: number }[]>([]);
  const visible = items.filter((i) => !gone.some((g) => g.id === i.id));
  const decide = (id: string, dir: number) => {
    haptic(dir > 0 ? [8, 30, 8] : 10);
    setGone((g) => [...g, { id, dir }]);
    onDecide(id, dir > 0 ? "pursue" : "dismiss");
  };
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="deck">
        <AnimatePresence>
          {visible.slice(0, 3).reverse().map((item, idxFromBack, arr) => {
            const depth = arr.length - 1 - idxFromBack;
            return <Card key={item.id} item={item} depth={depth} onDecide={decide} exitDir={gone.find((g) => g.id === item.id)?.dir ?? 0} />;
          })}
        </AnimatePresence>
        {visible.length === 0 && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="swipe-card"
            style={{ alignItems: "center", justifyContent: "center", textAlign: "center", cursor: "default" }}>
            <motion.div className="orb" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }}><Check /></motion.div>
            <b style={{ fontSize: 18 }}>{t("allCaughtUp")}</b>
          </motion.div>
        )}
      </div>
      {visible.length > 0 && (
        <div className="row" style={{ justifyContent: "center", gap: 28 }}>
          <motion.button className="btn icon" whileTap={{ scale: 0.85 }} onClick={() => decide(visible[0].id, -1)}
            style={{ width: 64, height: 64, borderRadius: 32, color: "var(--nobid)" }} aria-label={t("dismissAction")}><X size={28} /></motion.button>
          <motion.button className="btn icon accent" whileTap={{ scale: 0.85 }} onClick={() => decide(visible[0].id, 1)}
            style={{ width: 64, height: 64, borderRadius: 32 }} aria-label={t("pursueAction")}><Check size={28} /></motion.button>
        </div>
      )}
    </div>
  );
}

function Card({ item, depth, onDecide, exitDir }: { item: DeckItem; depth: number; exitDir: number;
  onDecide: (id: string, dir: number) => void }) {
  const { t } = useI18n();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-14, 14]);
  const yes = useTransform(x, [30, 140], [0, 1]);
  const no = useTransform(x, [-140, -30], [1, 0]);
  const onEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 120 || info.velocity.x > 700) onDecide(item.id, 1);
    else if (info.offset.x < -120 || info.velocity.x < -700) onDecide(item.id, -1);
  };
  return (
    <motion.div className="swipe-card" style={{ x, rotate, zIndex: 10 - depth }} drag={depth === 0 ? "x" : false}
      dragSnapToOrigin onDragEnd={onEnd} whileDrag={{ cursor: "grabbing", scale: 1.02 }}
      initial={{ scale: 0.9, y: 30, opacity: 0 }} animate={{ scale: 1 - depth * 0.05, y: depth * 14, opacity: depth > 2 ? 0 : 1 }}
      exit={{ x: exitDir >= 0 ? 520 : -520, rotate: exitDir >= 0 ? 24 : -24, opacity: 0, transition: { duration: 0.35 } }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}>
      <motion.span className="stamp" style={{ opacity: yes, left: 22, color: "var(--bid)", borderColor: "var(--bid)", rotate: -12 }}>
        {t("pursueAction").toUpperCase()}</motion.span>
      <motion.span className="stamp" style={{ opacity: no, right: 22, color: "var(--nobid)", borderColor: "var(--nobid)", rotate: 12 }}>
        {t("dismissAction").toUpperCase()}</motion.span>
      {item.node}
    </motion.div>
  );
}
