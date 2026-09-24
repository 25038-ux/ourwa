"use client";

import { motion } from "motion/react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { ErrorBox, Skeleton } from "@/components/ui";
import { api, safeSet } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { spring } from "@/lib/motion";

type Peek = { email: string; role: string; org_name: string; has_account: boolean };
type Me = { memberships: { org_id: string; org_name: string }[] };

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { t, lang } = useI18n();
  const router = useRouter();
  const [peek, setPeek] = useState<Peek | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<Peek>(`/invites/${token}`).then(setPeek).catch(setError); }, [token]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/invites/${token}/accept`, { method: "POST", json: { password, full_name: peek?.has_account ? null : name } });
      const me = await api<Me>("/auth/me");
      safeSet("forsa.org", (me.memberships.find((m) => m.org_name === peek?.org_name) ?? me.memberships[0])?.org_id ?? null);
      router.replace("/");
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <motion.form className="card col" onSubmit={accept} style={{ width: "min(420px, 100%)", padding: 28, gap: 16, borderRadius: "var(--r-xl)",
        boxShadow: "var(--shadow-3)" }} initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
        <Logo size={44} />
        {!peek && !error && <><Skeleton h={28} w="80%" /><Skeleton h={16} w="60%" /></>}
        {peek && (
          <>
            <div>
              <h1 style={{ fontSize: 24 }}>{lang === "fr" ? `Rejoindre ${peek.org_name}` : `Join ${peek.org_name}`}</h1>
              <p className="muted" style={{ marginTop: 6 }}>{peek.email} · {peek.role}</p>
            </div>
            {!peek.has_account && (
              <label className="field">{t("fullName")}
                <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            )}
            <label className="field">{peek.has_account ? t("password") : (lang === "fr" ? "Choisissez un mot de passe (10+ caractères)" : "Choose a password (10+ characters)")}
              <input type="password" required minLength={peek.has_account ? 1 : 10} value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete={peek.has_account ? "current-password" : "new-password"} /></label>
          </>
        )}
        <ErrorBox error={error} />
        {peek && <button className="btn accent lg" disabled={busy}>{lang === "fr" ? "Accepter l'invitation" : "Accept invitation"}<ArrowRight size={18} /></button>}
        <p className="faint row" style={{ gap: 6 }}><ShieldCheck size={14} />{lang === "fr" ? "Lien à usage unique, valable 7 jours." : "Single-use link, valid for 7 days."}</p>
      </motion.form>
    </div>
  );
}
