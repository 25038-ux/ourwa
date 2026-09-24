"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, safeSet } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ErrorBox } from "@/components/ui";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ memberships: { org_id: string }[] }>("/auth/login", { method: "POST", json: { email, password } });
      safeSet("forsa.org", res.memberships[0]?.org_id ?? null);
      router.replace("/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <div>
          <h1>FORSA</h1>
          <p className="muted">Intelligence commerciale fondée sur les preuves.</p>
        </div>
        <ErrorBox error={error} />
        <label className="stack">
          <span className="faint">{t("email")}</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="stack">
          <span className="faint">{t("password")}</span>
          <input type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="primary" type="submit" disabled={busy}>{t("signin")}</button>
      </form>
    </div>
  );
}
