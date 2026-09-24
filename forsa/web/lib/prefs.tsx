"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { safeGet, safeSet } from "./api";

export type Theme = "system" | "light" | "dark";
type Prefs = { theme: Theme; voice: boolean; autoSpeak: boolean; voiceURI: string | null };
const DEFAULT: Prefs = { theme: "system", voice: true, autoSpeak: false, voiceURI: null };

const Ctx = createContext<{ prefs: Prefs; set: (p: Partial<Prefs>) => void }>({ prefs: DEFAULT, set: () => {} });

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0c0f11" : "#f5f3ee");
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  useEffect(() => {
    try {
      const saved = JSON.parse(safeGet("forsa.prefs") || "{}");
      setPrefs({ ...DEFAULT, ...saved });
    } catch {
      /* corrupted prefs: keep defaults */
    }
  }, []);
  useEffect(() => {
    apply(prefs.theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(prefs.theme);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [prefs.theme]);
  const set = (p: Partial<Prefs>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...p };
      safeSet("forsa.prefs", JSON.stringify(next));
      return next;
    });
  return <Ctx.Provider value={{ prefs, set }}>{children}</Ctx.Provider>;
}

export const usePrefs = () => useContext(Ctx);

/** Inline, render-blocking script: sets the theme before first paint (no flash). */
export const themeBootScript = `try{var p=JSON.parse(localStorage.getItem("forsa.prefs")||"{}");var t=p.theme||"system";
var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.dataset.theme=d?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;
