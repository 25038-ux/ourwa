"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { CalendarClock, Circle, CircleCheckBig, CircleDot, Plus, Sparkles, Trash2, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet } from "@/components/sheet";
import { ErrorBox, PageHead, Segmented, Skeleton, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { haptic, spring } from "@/lib/motion";
import { revalidate, setCached, useApi } from "@/lib/store";

type Status = "OPEN" | "IN_PROGRESS" | "DONE";
type Task = { id: string; title: string; description: string | null; status: Status; source: string; due_at: string | null;
  assignee_user_id: string | null; assignee: string | null; bid_id: string | null; bid_title: string | null };
type Team = { members: { user_id: string; full_name: string }[] };

const ORDER: Status[] = ["OPEN", "IN_PROGRESS", "DONE"];
const ICON: Record<Status, ReactNode> = {
  OPEN: <Circle size={15} color="var(--review)" />, IN_PROGRESS: <CircleDot size={15} color="var(--cond)" />,
  DONE: <CircleCheckBig size={15} color="var(--bid)" />,
};

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 1023px)");
    const on = () => setM(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return m;
}

function overdue(t: Task) {
  return t.status !== "DONE" && t.due_at && new Date(t.due_at).getTime() < Date.now();
}

function TaskCard({ task, onMove, onDelete, lanes, mobile }: { task: Task; onMove: (s: Status) => void; onDelete: () => void;
  lanes: React.RefObject<Record<Status, HTMLDivElement | null>>; mobile: boolean }) {
  const { lang } = useI18n();
  const [dragging, setDragging] = useState(false);
  const laneAt = (x: number, y: number): Status | null => {
    for (const s of ORDER) {
      const r = lanes.current?.[s]?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s;
    }
    return null;
  };
  const highlight = (s: Status | null) => ORDER.forEach((k) => lanes.current?.[k]?.setAttribute("data-over", String(k === s && k !== task.status)));
  const idx = ORDER.indexOf(task.status);
  return (
    <motion.div layout layoutId={task.id} className="task" transition={spring}
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
      drag={mobile ? "x" : true} dragSnapToOrigin dragElastic={mobile ? 0.5 : 0.9} dragMomentum={false}
      whileDrag={{ scale: 1.04, rotate: mobile ? 0 : 1.5, boxShadow: "var(--shadow-3)", zIndex: 20, cursor: "grabbing" }}
      style={{ position: "relative", zIndex: dragging ? 20 : 1, touchAction: mobile ? "pan-y" : "none" }}
      onDragStart={() => { setDragging(true); haptic(6); }}
      onDrag={(e, i) => !mobile && highlight(laneAt(i.point.x - window.scrollX, i.point.y - window.scrollY))}
      onDragEnd={(e, i) => {
        setDragging(false);
        if (mobile) {
          if (i.offset.x > 90 && idx < 2) onMove(ORDER[idx + 1]);
          else if (i.offset.x < -90 && idx > 0) onMove(ORDER[idx - 1]);
          return;
        }
        const s = laneAt(i.point.x - window.scrollX, i.point.y - window.scrollY);
        highlight(null);
        if (s && s !== task.status) onMove(s);
      }}>
      <div className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
        <button className="btn icon sm ghost" style={{ marginTop: -4, marginLeft: -6 }} aria-label="Next status"
          onClick={() => onMove(task.status === "DONE" ? "OPEN" : ORDER[idx + 1])}>{ICON[task.status]}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="item-title" style={{ textDecoration: task.status === "DONE" ? "line-through" : undefined,
            color: task.status === "DONE" ? "var(--muted)" : undefined }}>{task.title}</div>
          {task.description && <div className="muted clamp2" style={{ fontSize: 13, marginTop: 2 }}>{task.description}</div>}
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            {task.due_at && <span className={`chip ${overdue(task) ? "HIGH" : "neutral"}`}><CalendarClock size={12} />{date(task.due_at, lang)}</span>}
            {task.assignee && <span className="chip neutral"><User size={12} />{task.assignee.split(" ")[0]}</span>}
            {task.source !== "manual" && <span className="chip ai"><Sparkles size={11} />{task.source === "ai" ? "IA" :
              (lang === "fr" ? "condition" : "condition")}</span>}
          </div>
          {task.bid_id && <Link href={`/bids/${task.bid_id}`} className="faint clamp2" style={{ marginTop: 6, display: "block" }}
            onClick={(e) => e.stopPropagation()}>↳ {task.bid_title}</Link>}
        </div>
        <button className="btn icon sm ghost hide-m" aria-label="Delete" onClick={onDelete} style={{ opacity: 0.5 }}><Trash2 size={14} /></button>
      </div>
    </motion.div>
  );
}

export default function TasksPage() {
  const { t, lang } = useI18n();
  const mobile = useIsMobile();
  const [mine, setMine] = useState(false);
  const key = `/tasks${mine ? "?mine=true" : ""}`;
  const { data, error } = useApi<{ items: Task[] }>(key);
  const { data: team } = useApi<Team>("/team");
  const [lane, setLane] = useState<Status>("OPEN");
  const [sheet, setSheet] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [form, setForm] = useState({ title: "", description: "", due_at: "", assignee_user_id: "" });
  const lanes = useRef<Record<Status, HTMLDivElement | null>>({ OPEN: null, IN_PROGRESS: null, DONE: null });
  const label: Record<Status, string> = { OPEN: t("todo"), IN_PROGRESS: t("inProgress"), DONE: t("doneCol") };
  const items = data?.items ?? [];

  const move = async (task: Task, status: Status) => {
    haptic(status === "DONE" ? [10, 30, 16] : 8);
    setCached(key, { items: items.map((x) => (x.id === task.id ? { ...x, status } : x)) });
    await api(`/tasks/${task.id}`, { method: "PATCH", json: { status } }).catch(setErr);
    revalidate("/tasks");
  };
  const remove = async (task: Task) => {
    setCached(key, { items: items.filter((x) => x.id !== task.id) });
    await api(`/tasks/${task.id}`, { method: "DELETE" }).catch(setErr);
    revalidate("/tasks");
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/tasks", { method: "POST", json: { title: form.title, description: form.description || null,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null, assignee_user_id: form.assignee_user_id || null } });
      setForm({ title: "", description: "", due_at: "", assignee_user_id: "" });
      setSheet(false);
      haptic([8, 30, 8]);
      revalidate("/tasks");
    } catch (x) {
      setErr(x);
    }
  };

  const laneView = (s: Status) => {
    const list = items.filter((x) => x.status === s);
    return (
      <div key={s} className="lane" ref={(el) => { lanes.current[s] = el; }}>
        {!mobile && (
          <div className="row between" style={{ padding: "4px 6px 10px" }}>
            <b className="row" style={{ gap: 8 }}>{ICON[s]}{label[s]}</b>
            <span className="chip neutral num">{list.length}</span>
          </div>
        )}
        <div className="col" style={{ gap: 8 }}>
          <AnimatePresence mode="popLayout" initial={false}>
            {list.map((task) => (
              <TaskCard key={task.id} task={task} lanes={lanes} mobile={mobile} onMove={(st) => move(task, st)} onDelete={() => remove(task)} />
            ))}
          </AnimatePresence>
          {!list.length && data && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="faint" style={{ textAlign: "center", padding: "22px 0" }}>
              {s === "DONE" ? "—" : t("allCaughtUp")}</motion.p>
          )}
        </div>
      </div>
    );
  };

  if (error) return <ErrorBox error={error} />;
  return (
    <div className="stack">
      <PageHead title={t("tasks")} sub={mobile ? (lang === "fr" ? "Glissez une tâche vers la droite pour l'avancer."
        : "Swipe a task right to move it forward.") : (lang === "fr" ? "Glissez-déposez entre les colonnes."
        : "Drag and drop between columns.")} actions={<>
        <label className="row faint" style={{ gap: 8 }}><Switch on={mine} onChange={setMine} label="mine" />
          {lang === "fr" ? "Mes tâches" : "My tasks"}</label>
        <button className="btn accent" onClick={() => setSheet(true)}><Plus size={16} />{t("newTask")}</button></>} />
      <ErrorBox error={err} />
      {mobile && (
        <Segmented id="lanes" value={lane} onChange={setLane} options={ORDER.map((s) => ({ value: s,
          label: <span className="row" style={{ gap: 6 }}>{label[s]}<span className="num faint">{items.filter((x) => x.status === s).length}</span></span> }))} />
      )}
      {!data ? <div className="kanban">{ORDER.map((s) => <div key={s} className="lane col"><Skeleton h={70} /><Skeleton h={70} /></div>)}</div> : (
        <LayoutGroup>
          <div className="kanban">{mobile ? laneView(lane) : ORDER.map(laneView)}</div>
        </LayoutGroup>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} label={t("newTask")}>
        <form className="col" style={{ padding: 20, gap: 14, overflowY: "auto" }} onSubmit={create}>
          <h2 style={{ fontSize: 20 }}>{t("newTask")}</h2>
          <label className="field">{t("title")}
            <input autoFocus required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="field">Description
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="grid g2" style={{ gap: 12 }}>
            <label className="field">{t("dueDate")}
              <input type="date" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} /></label>
            <label className="field">{t("assignee")}
              <select value={form.assignee_user_id} onChange={(e) => setForm({ ...form, assignee_user_id: e.target.value })}>
                <option value="">—</option>
                {team?.members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
              </select></label>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 6 }}>
            <button type="button" className="btn ghost" onClick={() => setSheet(false)}>{t("cancel")}</button>
            <button className="btn accent" disabled={!form.title.trim()}><Plus size={16} />{t("create")}</button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
