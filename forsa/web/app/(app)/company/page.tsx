"use client";

import { AnimatePresence, motion } from "motion/react";
import { BadgeCheck, Building2, Check, FileText, FolderKanban, Lightbulb, Plus, ShieldAlert, UploadCloud, X } from "lucide-react";
import { useState } from "react";
import { ConceptSearch } from "@/components/concepts";
import { Sheet } from "@/components/sheet";
import { Card, Chip, Empty, ErrorBox, FitRing, PageHead, Quote, Segmented, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { fadeUp, haptic, spring, stagger } from "@/lib/motion";
import { revalidate, useApi } from "@/lib/store";

type Claim = { id: string; verification: string; epistemic: string; evidence_ids: string[] };
type Company = Record<string, any> & {
  capabilities: (Claim & { concept_id: string; label: string })[];
  credentials: (Claim & { credential_id: string; label: string; status: string; valid_until: string | null })[];
  projects: (Claim & { title: string; client_name: string | null; value: number | null; currency: string | null; year: number | null;
    region: string | null })[];
  documents: { id: string; title: string; evidence_id: string | null; risk_flags: unknown[]; scan_status: string; pages: number | null }[];
  regions_served: string[] | null;
};
type Suggestion = { concept_id: string; label: Record<string, string>; quote: string; document: string; page: number; epistemic: string };

const FIELDS: [string, { fr: string; en: string }, "text" | "number"][] = [
  ["legal_name", { fr: "Raison sociale", en: "Legal name" }, "text"], ["registration_number", { fr: "RCCM / NIF", en: "Registration no." }, "text"],
  ["currency", { fr: "Devise", en: "Currency" }, "text"], ["annual_turnover", { fr: "CA annuel", en: "Annual turnover" }, "number"],
  ["max_project_value", { fr: "Taille max. de projet", en: "Max project size" }, "number"], ["staff_count", { fr: "Effectif", en: "Staff" }, "number"],
  ["max_parallel_bids", { fr: "Offres en parallèle", en: "Parallel bids" }, "number"],
  ["daily_bid_cost", { fr: "Coût journalier d'offre", en: "Daily bid cost" }, "number"], ["gross_margin_pct", { fr: "Marge brute %", en: "Gross margin %" }, "number"],
];

/** Profile strength: how much FORSA can rely on. Verified claims weigh more than declared ones. */
function strength(c: Company) {
  const filled = FIELDS.filter(([k]) => c[k] !== null && c[k] !== undefined && c[k] !== "").length / FIELDS.length;
  const claims = [...c.capabilities, ...c.credentials, ...c.projects];
  const verified = claims.length ? claims.filter((x) => x.verification === "VERIFIED").length / claims.length : 0;
  const breadth = Math.min(1, c.capabilities.length / 3) * 0.5 + Math.min(1, c.projects.length / 2) * 0.5;
  return Math.round(100 * (0.35 * filled + 0.35 * breadth + 0.3 * verified));
}

function VerChip({ v }: { v: string }) {
  const { t } = useI18n();
  return v === "VERIFIED" ? <span className="chip VERIFIED"><BadgeCheck size={12} />{t("verified")}</span>
    : <span className="chip NEEDS_HUMAN">{t("claimed")}</span>;
}

export default function CompanyPage() {
  const { t, lang } = useI18n();
  const { data: c, error } = useApi<Company>(`/companies/me?lang=${lang}`);
  const { data: sug } = useApi<{ items: Suggestion[] }>("/companies/me/suggestions");
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [projSheet, setProjSheet] = useState(false);
  const [project, setProject] = useState({ title: "", concept_id: "", value: "", year: "", client_name: "" });

  const vals = form ?? (c ? Object.fromEntries(FIELDS.map(([k]) => [k, c[k]?.toString() ?? ""])) : {});
  const act = async (p: Promise<unknown>) => {
    setErr(null);
    try {
      await p;
      revalidate("/companies/me");
      return true;
    } catch (x) {
      setErr(x);
      return false;
    }
  };
  const save = async () => {
    const body: Record<string, unknown> = {};
    for (const [k, , type] of FIELDS) body[k] = vals[k] === "" ? null : type === "number" ? Number(vals[k]) : vals[k];
    if (await act(api("/companies/me", { method: "PUT", json: body }))) {
      setSaved(true);
      setForm(null);
      haptic([8, 30, 8]);
      setTimeout(() => setSaved(false), 1800);
    }
  };
  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    await act(api("/companies/me/documents", { method: "POST", body: fd }));
    setUploading(false);
    revalidate("/companies/me/suggestions");
  };
  const firstEvidence = c?.documents.find((d) => d.evidence_id)?.evidence_id;
  const verify = (type: string, id: string) => firstEvidence &&
    act(api("/companies/me/verify", { method: "POST", json: { claim_type: type, claim_id: id, evidence_ids: [firstEvidence] } }));
  const addProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await act(api("/companies/me/projects", { method: "POST", json: { title: project.title, client_name: project.client_name || null,
      concept_ids: project.concept_id ? [project.concept_id] : [], value: project.value ? Number(project.value) : null,
      currency: c?.currency ?? "MRU", year: project.year ? Number(project.year) : null } }))) {
      setProjSheet(false);
      setProject({ title: "", concept_id: "", value: "", year: "", client_name: "" });
    }
  };

  if (error) return <ErrorBox error={error} />;
  if (!c) return <div className="stack"><Skeleton h={60} w="50%" /><Skeleton h={220} /><div className="grid g2"><Skeleton h={200} /><Skeleton h={200} /></div></div>;
  const score = strength(c);
  const suggestions = (sug?.items ?? []).filter((s) => !c.capabilities.some((x) => x.concept_id === s.concept_id));

  return (
    <div className="stack">
      <PageHead title={t("company")} sub={lang === "fr" ? "Le jumeau numérique de votre entreprise — ce que FORSA croit que vous savez faire. Corrigez-le, prouvez-le."
        : "Your Business Twin — what FORSA believes your company can do. Correct it, prove it."} actions={
        <div className="row" style={{ gap: 12 }}>
          <FitRing score={score} size={54} rec={score >= 70 ? "BID" : score >= 40 ? "BID_WITH_CONDITIONS" : "REVIEW"} />
          <div><b>{lang === "fr" ? "Solidité du profil" : "Profile strength"}</b>
            <div className="faint">{lang === "fr" ? "Les preuves vérifiées comptent davantage" : "Verified evidence counts more"}</div></div>
        </div>} />
      <ErrorBox error={err} />

      <Card title={t("identity")} icon={<Building2 size={16} color="var(--accent)" />} action={
        <motion.button className="btn primary sm" onClick={save} disabled={!form} whileTap={{ scale: 0.95 }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={saved ? "ok" : "save"} className="row" style={{ gap: 6 }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}>{saved ? <><Check size={14} />{t("saved")}</> : t("save")}</motion.span>
          </AnimatePresence>
        </motion.button>}>
        <div className="form-grid">
          {FIELDS.map(([k, label, type]) => (
            <label key={k} className="field">{label[lang]}
              <input inputMode={type === "number" ? "decimal" : undefined} value={vals[k] ?? ""}
                onChange={(e) => setForm({ ...vals, [k]: type === "number" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value })} /></label>
          ))}
        </div>
        <p className="faint" style={{ marginTop: 12 }}>{t("regions")} : {c.regions_served?.includes("*") ? (lang === "fr" ? "Tout le pays" : "Nationwide") : (c.regions_served ?? []).join(", ") || "—"}</p>
      </Card>

      <div className="grid g2">
        <Card title={<>{t("capabilities")} <span className="chip neutral num">{c.capabilities.length}</span></>} icon={<FolderKanban size={16} color="var(--accent)" />} delay={0.05}>
          <motion.div className="row" style={{ gap: 8, marginBottom: 14 }} variants={stagger(0.03)} initial="hidden" animate="show">
            <AnimatePresence initial={false}>
              {c.capabilities.map((x) => (
                <motion.span key={x.id} layout variants={fadeUp} exit={{ opacity: 0, scale: 0.8 }} className="pick" style={{ cursor: "default", paddingRight: 6 }}>
                  {x.verification === "VERIFIED" ? <BadgeCheck size={14} color="var(--bid)" /> : null}{x.label}
                  {x.verification !== "VERIFIED" && firstEvidence && (
                    <button className="btn icon sm ghost" title={t("verified")} style={{ width: 24, height: 24 }}
                      onClick={() => verify("capability", x.id)}><BadgeCheck size={14} /></button>)}
                  <button className="btn icon sm ghost" aria-label="Remove" style={{ width: 24, height: 24 }}
                    onClick={() => act(api(`/companies/me/capabilities/${x.id}`, { method: "DELETE" }))}><X size={14} /></button>
                </motion.span>
              ))}
            </AnimatePresence>
          </motion.div>
          <ConceptSearch kind="capability" onAdd={(x) => act(api("/companies/me/capabilities", { method: "POST", json: { concept_id: x.id } }))} />
        </Card>

        <Card title={t("credentials")} icon={<BadgeCheck size={16} color="var(--gold)" />} delay={0.1}>
          <div className="col" style={{ gap: 10, marginBottom: 14 }}>
            {c.credentials.map((x) => (
              <motion.div key={x.id} layout className="row between" style={{ gap: 8 }}>
                <span style={{ minWidth: 0 }}><b>{x.label}</b>{x.valid_until && <span className="faint"> · {x.valid_until}</span>}</span>
                <span className="row" style={{ gap: 6 }}>
                  <Segmented id={`cred-${x.id}`} value={x.status} onChange={(s) => act(api("/companies/me/credentials", { method: "PUT",
                    json: { credential_id: x.credential_id, status: s, valid_until: x.valid_until } }))}
                    options={[{ value: "HELD", label: lang === "fr" ? "Détenu" : "Held" }, { value: "IN_PROGRESS", label: lang === "fr" ? "En cours" : "Pending" },
                      { value: "ABSENT", label: lang === "fr" ? "Absent" : "None" }]} />
                  <VerChip v={x.verification} />
                </span>
              </motion.div>
            ))}
            {!c.credentials.length && <p className="muted">{t("noData")}</p>}
          </div>
          <ConceptSearch kind="credential" onAdd={(x) => act(api("/companies/me/credentials", { method: "PUT", json: { credential_id: x.id, status: "HELD" } }))} />
        </Card>
      </div>

      <Card title={t("projects")} icon={<FolderKanban size={16} color="var(--review)" />} flush delay={0.12}
        action={<button className="btn sm" onClick={() => setProjSheet(true)}><Plus size={14} />{t("add")}</button>}>
        {c.projects.length ? (
          <motion.ul className="list" variants={stagger()} initial="hidden" animate="show">
            {c.projects.map((p) => (
              <motion.li key={p.id} variants={fadeUp} className="item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="item-title clamp2">{p.title}</div>
                  <div className="faint">{[p.client_name, p.region, p.year].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <b className="num hide-m">{money(p.value, p.currency, lang)}</b>
                <VerChip v={p.verification} />
              </motion.li>
            ))}
          </motion.ul>
        ) : <Empty icon={<FolderKanban size={26} />} title={t("noData")} hint={lang === "fr"
          ? "Les références similaires renforcent l'adéquation — ajoutez vos marchés passés." : "Similar references strengthen fit — add past contracts."} />}
      </Card>

      <div className="grid g2">
        <Card title={t("documents")} icon={<FileText size={16} color="var(--accent)" />} delay={0.14}>
          <motion.label className="col" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
            animate={{ scale: drag ? 1.02 : 1, borderColor: drag ? "var(--accent)" : "var(--border-strong)" }} transition={spring}
            style={{ alignItems: "center", gap: 8, padding: 22, borderRadius: 16, border: "1.5px dashed var(--border-strong)",
              background: drag ? "var(--accent-soft)" : "var(--surface-2)", cursor: "pointer", textAlign: "center" }}>
            <motion.span animate={uploading ? { y: [0, -6, 0] } : { y: 0 }} transition={{ duration: 0.9, repeat: uploading ? Infinity : 0 }}>
              <UploadCloud size={28} color="var(--accent)" /></motion.span>
            <b>{uploading ? t("loading") : t("upload")}</b>
            <span className="faint">PDF, DOCX, TXT, HTML · {lang === "fr" ? "glissez-déposez ou touchez" : "drag & drop or tap"}</span>
            <input type="file" accept=".pdf,.docx,.txt,.html" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </motion.label>
          <div className="col" style={{ gap: 8, marginTop: 14 }}>
            {c.documents.map((d) => (
              <div key={d.id} className="row between" style={{ flexWrap: "nowrap" }}>
                <span className="row" style={{ gap: 8, minWidth: 0, flexWrap: "nowrap" }}><FileText size={15} color="var(--faint)" />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</span></span>
                <span className="row" style={{ gap: 6 }}>
                  {d.risk_flags?.length > 0 && <span className="chip HIGH" title="Prompt-injection markers found; treated as data only"><ShieldAlert size={12} />!</span>}
                  <Chip kind={d.scan_status === "CLEAN" ? "VERIFIED" : "UNKNOWN"}>{d.scan_status}</Chip></span>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t("suggestions")} icon={<Lightbulb size={16} color="var(--gold)" />} delay={0.18}>
          {suggestions.length ? (
            <div className="col">
              <AnimatePresence initial={false}>
                {suggestions.map((s) => (
                  <motion.div key={s.concept_id} layout exit={{ opacity: 0, x: 40, height: 0 }} className="col" style={{ gap: 6 }}>
                    <div className="row between"><b>{s.label?.[lang] ?? s.concept_id}</b>
                      <button className="btn sm accent" onClick={() => act(api("/companies/me/capabilities", { method: "POST", json: { concept_id: s.concept_id } }))
                        .then(() => revalidate("/companies/me/suggestions"))}><Check size={14} />{t("confirm")}</button></div>
                    <Quote text={s.quote} source={`${s.document} · p.${s.page} · ${s.epistemic}`} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : <Empty title={t("noData")} hint={lang === "fr" ? "Téléversez une plaquette ou une attestation : FORSA proposera des compétences, citations à l'appui."
            : "Upload a brochure or certificate: FORSA will suggest capabilities, with quotes."} />}
        </Card>
      </div>

      <Sheet open={projSheet} onClose={() => setProjSheet(false)} label={t("projects")}>
        <form className="col" style={{ padding: 20, gap: 14, overflowY: "auto" }} onSubmit={addProject}>
          <h2 style={{ fontSize: 20 }}>{lang === "fr" ? "Nouvelle référence" : "New reference"}</h2>
          <label className="field">{t("title")}<input required value={project.title} onChange={(e) => setProject({ ...project, title: e.target.value })} /></label>
          <label className="field">{lang === "fr" ? "Client" : "Client"}<input value={project.client_name} onChange={(e) => setProject({ ...project, client_name: e.target.value })} /></label>
          <label className="field">{t("capabilities")}
            <select value={project.concept_id} onChange={(e) => setProject({ ...project, concept_id: e.target.value })}>
              <option value="">—</option>
              {c.capabilities.map((x) => <option key={x.concept_id} value={x.concept_id}>{x.label}</option>)}
            </select></label>
          <div className="grid g2" style={{ gap: 12 }}>
            <label className="field">{t("value")} ({c.currency ?? "MRU"})<input inputMode="decimal" value={project.value}
              onChange={(e) => setProject({ ...project, value: e.target.value.replace(/[^\d.]/g, "") })} /></label>
            <label className="field">{t("year")}<input inputMode="numeric" value={project.year}
              onChange={(e) => setProject({ ...project, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></label>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost" onClick={() => setProjSheet(false)}>{t("cancel")}</button>
            <button className="btn accent" disabled={!project.title.trim()}><Plus size={16} />{t("add")}</button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
