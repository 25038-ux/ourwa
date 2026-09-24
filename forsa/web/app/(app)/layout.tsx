"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, safeGet, safeSet } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Me = { user: { email: string; full_name: string }; memberships: { org_id: string; org_name: string; role: string }[] };

export default function AppLayout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>("/auth/me").then((m) => {
      setMe(m);
      const saved = safeGet("forsa.org");
      if (!saved || !m.memberships.some((x) => x.org_id === saved)) safeSet("forsa.org", m.memberships[0]?.org_id ?? null);
    }).catch(() => router.replace("/login"));
  }, [router]);

  const org = me?.memberships.find((m) => m.org_id === safeGet("forsa.org")) ?? me?.memberships[0];
  const links: [string, string][] = [
    ["/", t("command")], ["/opportunities", t("opportunities")], ["/company", t("company")], ["/bids", t("bids")],
    ["/sources", t("sources")],
  ];
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    safeSet("forsa.org", null);
    router.replace("/login");
  };
  return (
    <div className="shell">
      <aside className="side">
      <nav className="nav" aria-label="Main">
        <div className="brand">FORSA<small>{org?.org_name ?? "…"}</small></div>
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={(href === "/" ? path === "/" : path.startsWith(href)) ? "active" : ""}>
            {label}
          </Link>
        ))}
        <div className="spacer" />
        <div className="who">
          {me?.user.full_name}
          <br />
          <span className="faint">{org?.role}</span>
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => setLang(lang === "fr" ? "en" : "fr")} aria-label="Language">
              {lang === "fr" ? "EN" : "FR"}
            </button>
            <button onClick={logout}>{t("logout")}</button>
          </div>
        </div>
      </nav>
      </aside>
      <main className="main">{me ? children : null}</main>
    </div>
  );
}
