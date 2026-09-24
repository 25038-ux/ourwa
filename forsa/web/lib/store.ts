"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./api";

/** Tiny stale-while-revalidate cache: instant repeat navigation, live revalidation on server events. */
type Entry = { data?: unknown; error?: unknown; at: number; inflight?: Promise<unknown> };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

async function load(key: string): Promise<unknown> {
  const entry = cache.get(key) ?? { at: 0 };
  if (entry.inflight) return entry.inflight;
  const p = api(key)
    .then((data) => {
      cache.set(key, { data, at: Date.now() });
      emit();
      return data;
    })
    .catch((error) => {
      cache.set(key, { ...entry, error, inflight: undefined, at: Date.now() });
      emit();
      throw error;
    });
  cache.set(key, { ...entry, inflight: p });
  return p;
}

/** Revalidate every cached key starting with one of the prefixes (e.g. after a live notification). */
export function revalidate(...prefixes: string[]): void {
  for (const key of cache.keys()) {
    if (prefixes.length === 0 || prefixes.some((p) => key.startsWith(p))) load(key).catch(() => undefined);
  }
}

export function setCached(key: string, data: unknown): void {
  cache.set(key, { data, at: Date.now() });
  emit();
}

export function useApi<T = any>(key: string | null, { maxAgeMs = 15_000 } = {}) {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
  const [, force] = useState(0);
  useEffect(() => {
    if (!key) return;
    const entry = cache.get(key);
    if (!entry || Date.now() - entry.at > maxAgeMs || entry.error) load(key).catch(() => force((n) => n + 1));
  }, [key, maxAgeMs]);
  useEffect(() => {
    if (!key) return;
    const onFocus = () => load(key).catch(() => undefined);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [key]);
  const entry = key ? cache.get(key) : undefined;
  const mutate = useCallback(() => (key ? load(key) : Promise.resolve(undefined)), [key]);
  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: !!key && entry?.data === undefined && !entry?.error,
    mutate,
  };
}
