"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Link2, MailPlus, Trash2, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { Card, Empty, ErrorBox, PageHead, SkeletonList } from "@/components/ui";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fadeUp, haptic, spring, stagger } from "@/lib/motion";
import { revalidate, useApi } from "@/lib/store";

type Member = { membership_id: string; user_id: string; email: string; full_name: string; role: string; is_me: boolean;
  since: string };
type Team = { members: Member[]; invites: { id: string; email: string; role: string; expires_at: string }[];
  can_manage: boolean; roles: string[] };

const ROLE_LABEL: Record<string, { fr: string; en: string }> = {
  OWNER: { fr: "Propriétaire", en: "Owner" }, ADMIN: { fr: "Administrateur", en: "Admin" },
  BID_MANAGER: { fr: "Responsable d'offres", en: "Bid manager" }, SALES: { fr: "Commercial", en: "Sales" },
  TECHNICAL: { fr: "Technique", en: "Technical" }, FINANCE: { fr: "Finance", en: "Finance" },
  LEGAL: { fr: "Juridique", en: "Legal" }, REVIEWER: { fr: "Relecteur", en: "Reviewer" },
};

function Avatar({ name, hue }: { name: string; hue: number }) {
  return (
    <div style={{ width: 40, height: 40, borderRadius: 14, flex: "none", display: "grid", placeItems: "center", fontWeight: 700,
      color: `hsl(${hue} 55% 32%)`, background: `hsl(${hue} 60% 90%)` }}>
      {name.split(/\s+/).filter((p) => /^\p{L}/u.test(p)).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "·"}
    </div>
  );
}

const hueOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export default function TeamPage() {
  const { t, lang } = useI18n();
  const { data, error } = useApi<Team>("/team");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("BID_MANAGER");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const label = (r: string) => ROLE_LABEL[r]?.[lang] ?? r;

  const run = async (p: Promise<unknown>) => {
    setErr(null);
    try {
      await p;
      revalidate("/team");
    } catch (e) {
      setErr(e);
    }
  };
  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ path: string }>("/team/invites", { method: "POST", json: { email, role } });
      setLink(`${window.location.origin}${r.path}`);
      setEmail("");
      haptic([8, 30, 8]);
      revalidate("/team");
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!link) return;
    await navigator.clipboard?.writeText(link).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  if (error) return <ErrorBox error={error} />;
  return (
    <div className="stack">
      <PageHead title={t("team")} sub={lang === "fr"
        ? "Les droits sont vérifiés par le serveur à chaque action. Un lien d'invitation n'est affiché qu'une fois."
        : "Permissions are enforced server-side on every action. An invitation link is shown only once."} />
      <ErrorBox error={err} />
      <div className="grid g-main">
        <Card title={<>{t("members")} {data && <span className="chip neutral num">{data.members.length}</span>}</>}
          icon={<Users size={16} color="var(--accent)" />} flush>
          {!data ? <SkeletonList rows={3} /> : (
            <motion.ul className="list" variants={stagger()} initial="hidden" animate="show">
              {data.members.map((m) => (
                <motion.li key={m.membership_id} variants={fadeUp} layout className="item" style={{ flexWrap: "wrap" }}>
                  <Avatar name={m.full_name || m.email} hue={hueOf(m.email)} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div className="item-title">{m.full_name} {m.is_me && <span className="chip neutral">{lang === "fr" ? "vous" : "you"}</span>}</div>
                    <div className="faint">{m.email} · {lang === "fr" ? "depuis" : "since"} {date(m.since, lang)}</div>
                  </div>
                  {data.can_manage && !m.is_me ? (
                    <div className="row" style={{ gap: 6 }}>
                      <select value={m.role} style={{ width: "auto", height: 34 }} aria-label={t("role")}
                        onChange={(e) => run(api(`/team/members/${m.membership_id}`, { method: "PATCH", json: { role: e.target.value } }))}>
                        {data.roles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                      </select>
                      <button className="btn icon sm ghost danger" aria-label="Remove"
                        onClick={() => confirm(lang === "fr" ? `Retirer ${m.full_name} ?` : `Remove ${m.full_name}?`) &&
                          run(api(`/team/members/${m.membership_id}`, { method: "DELETE" }))}>
                        <UserMinus size={16} /></button>
                    </div>
                  ) : <span className="chip neutral">{label(m.role)}</span>}
                </motion.li>
              ))}
            </motion.ul>
          )}
        </Card>

        <div className="stack">
          {data?.can_manage && (
            <Card title={t("invite")} icon={<MailPlus size={16} color="var(--accent)" />} delay={0.08}>
              <form className="col" onSubmit={invite}>
                <label className="field">{t("email")}
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@entreprise.mr" /></label>
                <label className="field">{t("role")}
                  <select value={role} onChange={(e) => setRole(e.target.value)}>
                    {data.roles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                  </select></label>
                <button className="btn accent" disabled={busy || !email}>{busy ? <span className="spin">◌</span> : <MailPlus size={16} />}
                  {t("invite")}</button>
              </form>
              <AnimatePresence>
                {link && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    transition={spring} style={{ overflow: "hidden" }}>
                    <div className="quote" style={{ marginTop: 14 }}>
                      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                        <Link2 size={16} color="var(--accent)" style={{ flex: "none" }} />
                        <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{link}</span>
                        <motion.button className="btn sm" onClick={copy} whileTap={{ scale: 0.92 }}>
                          {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? t("copied") : t("copyLink")}</motion.button>
                      </div>
                      <span className="src">{lang === "fr" ? "Valable 7 jours, usage unique. Partagez-le par un canal de confiance."
                        : "Valid 7 days, single use. Share it over a trusted channel."}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          )}
          <Card title={t("pendingInvites")} delay={0.14} flush>
            {data?.invites.length ? (
              <ul className="list">
                <AnimatePresence initial={false}>
                  {data.invites.map((i) => (
                    <motion.li key={i.id} layout exit={{ opacity: 0, x: 40 }} className="item">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="item-title" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{i.email}</div>
                        <div className="faint">{label(i.role)} · {lang === "fr" ? "expire" : "expires"} {date(i.expires_at, lang)}</div>
                      </div>
                      {data.can_manage && (
                        <button className="btn icon sm ghost danger" aria-label="Revoke"
                          onClick={() => run(api(`/team/invites/${i.id}`, { method: "DELETE" }))}><Trash2 size={15} /></button>
                      )}
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            ) : <Empty title={t("empty")} />}
          </Card>
        </div>
      </div>
    </div>
  );
}
