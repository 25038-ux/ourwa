"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { haptic } from "./motion";
import { revalidate } from "./store";

export type LiveEvent = { id: string; category: string; title: string; priority: string; org_id: string };
export type Toast = LiveEvent & { key: number; href: string };

type Ctx = { status: "connecting" | "live" | "offline"; unread: number; toasts: Toast[]; dismiss: (key: number) => void;
  refreshUnread: () => void; push: (t: Omit<Toast, "key">) => void };
const LiveCtx = createContext<Ctx>({ status: "offline", unread: 0, toasts: [], dismiss: () => {}, refreshUnread: () => {},
  push: () => {} });

function hrefFor(e: { category: string }): string {
  if (e.category === "task_assignment") return "/tasks";
  return "/notifications";
}

/** One EventSource per tab on /api/v1/live (Postgres NOTIFY → SSE). Reconnects automatically. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Ctx["status"]>("connecting");
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const refreshUnread = useCallback(() => {
    api<{ unread: number }>("/notifications/unread-count").then((r) => setUnread(r.unread)).catch(() => undefined);
  }, []);
  const dismiss = useCallback((key: number) => setToasts((t) => t.filter((x) => x.key !== key)), []);
  const push = useCallback((t: Omit<Toast, "key">) => {
    const key = ++seq.current;
    setToasts((cur) => [{ ...t, key }, ...cur].slice(0, 3));
    setTimeout(() => dismiss(key), 6500);
  }, [dismiss]);

  useEffect(() => {
    refreshUnread();
    const orgId = (() => {
      try {
        return localStorage.getItem("forsa.org");
      } catch {
        return null;
      }
    })();
    const es = new EventSource(`/api/v1/live${orgId ? `?org=${orgId}` : ""}`, { withCredentials: true });
    es.addEventListener("ready", () => setStatus("live"));
    es.addEventListener("notification", (msg) => {
      const e = JSON.parse((msg as MessageEvent).data) as LiveEvent;
      setUnread((n) => n + 1);
      if (e.category !== "daily_briefing") {
        push({ ...e, href: hrefFor(e) });
        haptic(e.priority === "high" ? [10, 40, 10] : 8);
      }
      revalidate("/briefing", "/notifications", "/opportunities", "/matches", "/tasks", "/bids");
    });
    es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? "offline" : "connecting");
    return () => es.close();
  }, [refreshUnread, push]);

  return <LiveCtx.Provider value={{ status, unread, toasts, dismiss, refreshUnread, push }}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);
