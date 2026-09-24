"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Chip, ErrorBox, Loading, Quote } from "@/components/ui";

type Concept = { id: string; label: string };

function ConceptPicker({ kind, onPick }: { kind: "capability" | "credential"; onPick: (id: string) => void }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Concept[]>([]);
  useEffect(() => {
    const p = new URLSearchParams({ kind, lang });
    if (q) p.set("q", q);
    api(`/meta/taxonomy?${p}`).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [q, kind, lang]);
  return (
    <div className="row">
      <input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
      <select onChange={(e) => e.target.value && onPick(e.target.value)} value="">
        <option value="">{t("add")}…</option>
        {items.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </div>
  );
}

const FIELDS: [string, string, "text" | "number"][] = [
  ["legal_name", "Raison sociale / Legal name", "text"], ["registration_number", "RCCM / NIF", "text"],
  ["currency", "Devise", "text"], ["annual_turnover", "CA annuel / Turnover", "number"],
  ["max_project_value", "Taille max. de projet", "number"], ["staff_count", "Effectif", "number"],
  ["max_parallel_bids", "Offres en parallèle", "number"], ["daily_bid_cost", "Coût journalier d'offre", "number"],
  ["gross_margin_pct", "Marge brute %", "number"],
];

export default function CompanyPage() {
  const { t, lang } = useI18n();
  const [c, setC] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [project, setProject] = useState({ title: "", concept_id: "", value: "", year: "" });

  const load = useCallback(() => {
    api(`/companies/me?lang=${lang}`).then((d) => {
      setC(d);
      setForm(Object.fromEntries(FIELDS.map(([k]) => [k, d[k] ?? ""])));
    }).catch(setError);
    api("/companies/me/suggestions").then((r) => setSuggestions(r.items)).catch(() => undefined);
  }, [lang]);
  useEffect(load, [load]);

  const act = (p: Promise<unknown>) => p.then(() => { setSaved(true); load(); }).catch(setError);
  const save = () => {
    const body: Record<string, any> = {};
    for (const [k, , type] of FIELDS) {
      const v = form[k];
      body[k] = v === "" || v === null ? null : type === "number" ? Number(v) : v;
    }
    act(api("/companies/me", { method: "PUT", json: body }));
  };
  const upload = (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    act(api("/companies/me/documents", { method: "POST", body: fd }));
  };
  const verify = (claim_type: string, claim_id: string, evidence_id: string) =>
    act(api("/companies/me/verify", { method: "POST", json: { claim_type, claim_id, evidence_ids: [evidence_id] } }));
  const firstEvidence = c?.documents?.find((d: any) => d.evidence_id)?.evidence_id as string | undefined;

  if (error && !c) return <ErrorBox error={error} />;
  if (!c) return <Loading />;
  return (
    <div className="stack">
      <div>
        <h1>{t("company")}</h1>
        <p className="muted">FORSA Business Twin — ce que FORSA croit que votre entreprise sait faire. Corrigez-le.</p>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <h2>{t("identity")}</h2>
        <div className="form-grid">
          {FIELDS.map(([k, label, type]) => (
            <label key={k}>{label}<input type={type} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={save}>{t("save")}</button>
          {saved && <span className="faint">✓</span>}
          <span className="faint">Zones : {(c.regions_served || []).join(", ") || "—"} · Exclusions : {(c.excluded_concepts || []).join(", ") || "—"}</span>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>{t("capabilities")}</h2>
          {c.capabilities.map((x: any) => (
            <div key={x.id} className="row between" style={{ marginBottom: 6 }}>
              <span>{x.label}</span>
              <span className="row">
                <Chip kind={x.verification === "VERIFIED" ? "VERIFIED" : "NEEDS_HUMAN"}>{x.verification === "VERIFIED" ? t("verified") : t("claimed")}</Chip>
                {x.verification !== "VERIFIED" && firstEvidence && <button onClick={() => verify("capability", x.id, firstEvidence)}>✓</button>}
                <button className="danger" onClick={() => act(api(`/companies/me/capabilities/${x.id}`, { method: "DELETE" }))}>×</button>
              </span>
            </div>
          ))}
          <ConceptPicker kind="capability" onPick={(id) => act(api("/companies/me/capabilities", { method: "POST", json: { concept_id: id } }))} />
        </div>
        <div className="card">
          <h2>{t("credentials")}</h2>
          {c.credentials.map((x: any) => (
            <div key={x.id} className="row between" style={{ marginBottom: 6 }}>
              <span>{x.label} <span className="faint">{x.valid_until ?? ""}</span></span>
              <span className="row">
                <select value={x.status} onChange={(e) => act(api("/companies/me/credentials", { method: "PUT", json: { credential_id: x.credential_id, status: e.target.value, valid_until: x.valid_until } }))}>
                  <option value="HELD">HELD</option><option value="IN_PROGRESS">IN_PROGRESS</option><option value="ABSENT">ABSENT</option>
                </select>
                <Chip kind={x.verification === "VERIFIED" ? "VERIFIED" : "NEEDS_HUMAN"}>{x.verification === "VERIFIED" ? t("verified") : t("claimed")}</Chip>
              </span>
            </div>
          ))}
          <ConceptPicker kind="credential" onPick={(id) => act(api("/companies/me/credentials", { method: "PUT", json: { credential_id: id, status: "HELD" } }))} />
        </div>
      </div>

      <div className="card">
        <h2>{t("projects")}</h2>
        <table>
          <tbody>
            {c.projects.map((p: any) => (
              <tr key={p.id}>
                <td><b>{p.title}</b><div className="faint">{p.client_name ?? ""} {p.region ? `· ${p.region}` : ""}</div></td>
                <td className="hide-sm">{p.year ?? "—"}</td>
                <td>{money(p.value, p.currency, lang)}</td>
                <td><Chip kind={p.verification === "VERIFIED" ? "VERIFIED" : "NEEDS_HUMAN"}>{p.verification === "VERIFIED" ? t("verified") : t("claimed")}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="Titre / Title" value={project.title} onChange={(e) => setProject({ ...project, title: e.target.value })} />
          <input placeholder="concept (ex. energy.solar_pv)" value={project.concept_id} onChange={(e) => setProject({ ...project, concept_id: e.target.value })} />
          <input type="number" placeholder={t("value")} value={project.value} onChange={(e) => setProject({ ...project, value: e.target.value })} />
          <input type="number" placeholder="Année" value={project.year} onChange={(e) => setProject({ ...project, year: e.target.value })} />
          <button disabled={!project.title} onClick={() => act(api("/companies/me/projects", { method: "POST", json: {
            title: project.title, concept_ids: project.concept_id ? [project.concept_id] : [],
            value: project.value ? Number(project.value) : null, currency: c.currency ?? "MRU", year: project.year ? Number(project.year) : null,
          } }))}>{t("add")}</button>
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>{t("documents")}</h2>
          {c.documents.map((d: any) => (
            <div key={d.id} className="row between" style={{ marginBottom: 6 }}>
              <span>{d.title}</span>
              <span className="row">{d.risk_flags?.length > 0 && <Chip kind="HIGH">injection?</Chip>}<Chip kind="UNKNOWN">{d.scan_status}</Chip></span>
            </div>
          ))}
          <label className="row"><span className="faint">{t("upload")}</span>
            <input type="file" accept=".pdf,.docx,.txt,.html" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        </div>
        <div className="card">
          <h2>{t("suggestions")}</h2>
          {suggestions.length ? suggestions.map((s) => (
            <div key={s.concept_id} style={{ marginBottom: 8 }}>
              <div className="row between"><b>{s.label?.[lang] ?? s.concept_id}</b>
                <button onClick={() => act(api("/companies/me/capabilities", { method: "POST", json: { concept_id: s.concept_id } }))}>{t("confirm")}</button></div>
              <Quote text={s.quote} source={`${s.document} · p.${s.page} · ${s.epistemic}`} />
            </div>
          )) : <p className="muted">{t("noData")}</p>}
        </div>
      </div>
    </div>
  );
}
