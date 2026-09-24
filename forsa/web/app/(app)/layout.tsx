"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AssistantPanel } from "@/components/assistant";
import { CommandPalette } from "@/components/palette";
import { MobileTop, Sidebar, TabBar, Toasts, TopBar } from "@/components/shell";
import { api, safeGet, safeSet } from "@/lib/api";
import { AssistantProvider } from "@/lib/assistant";
import { useI18n } from "@/lib/i18n";
import { LiveProvider } from "@/lib/live";
import { page } from "@/lib/motion";

type Me = { user: { full_name: string; is_platform_admin: boolean };
  memberships: { org_id: string; org_name: string; role: string }[] };

export default function AppLayout({ children }: { children: ReactNode }) {
  const { lang } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    api<Me>("/auth/me").then(async (m) => {
      const saved = safeGet("forsa.org");
      if (!saved || !m.memberships.some((x) => x.org_id === saved)) safeSet("forsa.org", m.memberships[0]?.org_id ?? null);
      const company = await api("/companies/me").catch(() => null);
      if (company && !company.onboarding_completed_at && company.capabilities.length === 0 && !safeGet("forsa.onbSkipped")) {
        router.replace("/onboarding");
        return;
      }
      setMe(m);
    }).catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!me) return <div className="login"><motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.4, repeat: Infinity }}
    className="orb" /></div>;

  return (
    <MotionConfig reducedMotion="user">
      <LiveProvider>
        <AssistantProvider lang={lang}>
          <div className="app">
            <Sidebar me={me} orgId={safeGet("forsa.org")} onSearch={() => setPalette(true)} />
            <div style={{ minWidth: 0 }}>
              <MobileTop />
              <main className="main">
                <TopBar onSearch={() => setPalette(true)} />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={path} variants={page} initial="initial" animate="enter" exit="exit">{children}</motion.div>
                </AnimatePresence>
              </main>
            </div>
            <TabBar />
          </div>
          <AssistantPanel />
          <CommandPalette open={palette} onClose={() => setPalette(false)} />
          <Toasts />
        </AssistantProvider>
      </LiveProvider>
    </MotionConfig>
  );
}
