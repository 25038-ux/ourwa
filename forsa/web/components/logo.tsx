"use client";

import { useId } from "react";

export function Logo({ size = 30 }: { size?: number }) {
  // "Forsa" (فرصة) = opportunity: a rising path through an open horizon.
  // useId: several logos can be mounted at once (sidebar hidden on phones); a shared gradient id would break them.
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1fc293" />
          <stop offset="1" stopColor="#0a5c47" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${id})`} />
      <path d="M16 44c8-1 12-6 16-14s8-12 16-12" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <circle cx="48" cy="18" r="4.5" fill="#f3c86b" />
      <path d="M14 50h36" stroke="rgba(255,255,255,.45)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
