"use client";

import { AnimatePresence, motion, useDragControls } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { spring } from "@/lib/motion";

/** Right panel on desktop, draggable bottom sheet on phones (drag down to dismiss). */
export function Sheet({ open, onClose, children, side = "right", label }: { open: boolean; onClose: () => void;
  children: ReactNode; side?: "right" | "bottom"; label: string }) {
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const mobile = typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
  const fromBottom = side === "bottom" || mobile;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div role="dialog" aria-modal aria-label={label} className={`sheet ${side}`}
            initial={fromBottom ? { y: "100%" } : { x: "110%" }} animate={fromBottom ? { y: 0 } : { x: 0 }}
            exit={fromBottom ? { y: "100%" } : { x: "110%" }} transition={spring}
            drag={fromBottom ? "y" : false} dragListener={false} dragControls={drag} dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }} onDragEnd={(_, i) => { if (i.offset.y > 120 || i.velocity.y > 600) onClose(); }}>
            {fromBottom && <div className="grab" onPointerDown={(e) => drag.start(e)} style={{ touchAction: "none" }} />}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
