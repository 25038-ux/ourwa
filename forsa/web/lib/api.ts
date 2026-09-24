export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

type Init = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit };

/** Same-origin API client. Sends the CSRF header required for cookie-authenticated writes. */
export async function api<T = any>(path: string, init: Init = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "forsa");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const orgId = typeof window !== "undefined" ? safeGet("forsa.org") : null;
  if (orgId) headers.set("X-Org-Id", orgId);
  const res = await fetch(`/api/v1${path}`, { ...init, headers, body, credentials: "same-origin" });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/login")) {
    window.location.href = "/login";
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? data?.detail ?? res.statusText);
  }
  return data as T;
}

export function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — preferences simply do not persist */
  }
}
