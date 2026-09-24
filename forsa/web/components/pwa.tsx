"use client";

import { useEffect } from "react";
import { api } from "@/lib/api";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}

function urlB64ToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Subscribe this device to Web Push. Returns a status the UI can show honestly. */
export async function enablePush(): Promise<"on" | "denied" | "unsupported" | "server-off"> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const cfg = await api<{ enabled: boolean; public_key: string | null }>("/push/public-key");
  if (!cfg.enabled || !cfg.public_key) return "server-off";
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(cfg.public_key) as BufferSource,
  }));
  const json = sub.toJSON();
  await api("/push/subscriptions", { method: "POST", json: { endpoint: json.endpoint, keys: json.keys } });
  return "on";
}
