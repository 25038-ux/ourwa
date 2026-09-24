"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Mic, Quote as QuoteIcon, Sparkles, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Waveform } from "@/components/assistant";
import { ConceptSearch as AddConcept } from "@/components/concepts";
import { Logo } from "@/components/logo";
import { ErrorBox, Segmented } from "@/components/ui";
import { api, safeSet } from "@/lib/api";
import { useDictation } from "@/lib/assistant";
import { useI18n } from "@/lib/i18n";
import { haptic, spring } from "@/lib/motion";

type Hit = { id: string; label: string; quote: string | null; source: "ontology" | "ai" };
type Analysis = { capabilities: Hit[]; credentials: Hit[]; regions: string[]; ai_used: boolean };

const REGIONS = ["Nouakchott-Nord", "Nouakchott-Ouest", "Nouakchott-Sud", "Dakhlet Nouadhibou", "Trarza", "Brakna", "Gorgol",
  "Assaba", "Guidimaka", "Hodh Ech Chargui", "Hodh El Gharbi", "Tagant", "Adrar", "Inchiri", "Tiris Zemmour"];
const EXAMPLE = {
  fr: "Nous installons des systèmes solaires photovoltaïques et des forages équipés de pompes solaires à Nouakchott, au Trarza et au Brakna, pour des ONG et des ministères. Nous avons l'attestation CNSS et le quitus fiscal.",
  en: "We install solar PV systems and boreholes with solar pumps in Nouakchott, Trarza and Brakna for NGOs and ministries. We hold the CNSS certificate and tax clearance.",
};

const slide = {
  enter: (d: number) => ({ opacity: 0, x: d * 48, filter: "blur(6px)" }),
  center: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: (d: number) => ({ opacity: 0, x: d * -48, filter: "blur(6px)" }),
};

function Pick({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <motion.button type="button" layout className="pick" data-on={on} title={title} whileTap={{ scale: 0.93 }}
      onClick={() => { haptic(5); onClick(); }} transition={spring}>
      <AnimatePresence initial={false}>
        {on && <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: 14, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
          style={{ display: "inline-flex", overflow: "hidden" }}><Check size={14} /></motion.span>}
      </AnimatePresence>
      {children}
    </motion.button>
  );
}

export default function Onboarding() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [caps, setCaps] = useState<Record<string, Hit & { on: boolean }>>({});
  const [creds, setCreds] = useState<Record<string, Hit & { on: boolean }>>({});
  const [regions, setRegions] = useState<string[]>([]);
  const [form, setForm] = useState({ legal_name: "", annual_turnover: "", max_project_value: "", staff_count: "" });
  const [project, setProject] = useState({ title: "", value: "", year: "" });

  useEffect(() => {
    api("/companies/me").then((c) => setForm((f) => ({ ...f, legal_name: c.legal_name ?? "",
      annual_turnover: c.annual_turnover?.toString() ?? "", max_project_value: c.max_project_value?.toString() ?? "",
      staff_count: c.staff_count?.toString() ?? "" }))).catch(() => undefined);
  }, []);

  const onFinal = useCallback((s: string) => setText((cur) => (cur ? `${cur.trimEnd()} ${s}` : s)), []);
  const dict = useDictation(lang, onFinal);
  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(n); haptic(6); };

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Analysis>("/onboarding/analyze", { method: "POST", json: { text, lang } });
      setAnalysis(r);
      setCaps(Object.fromEntries(r.capabilities.map((c) => [c.id, { ...c, on: true }])));
      setCreds(Object.fromEntries(r.credentials.map((c) => [c.id, { ...c, on: true }])));
      setRegions(r.regions);
      go(2);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    const num = (v: string) => (v.trim() ? Number(v) : undefined);
    const capIds = Object.values(caps).filter((c) => c.on).map((c) => c.id);
    try {
      await api("/onboarding/complete", { method: "POST", json: {
        legal_name: form.legal_name, description: text || undefined, regions_served: regions, currency: "MRU",
        annual_turnover: num(form.annual_turnover), max_project_value: num(form.max_project_value), staff_count: num(form.staff_count),
        capabilities: capIds, credentials: Object.values(creds).filter((c) => c.on).map((c) => ({ id: c.id, status: "HELD" })),
        project: project.title ? { title: project.title, concept_ids: capIds.slice(0, 1), value: num(project.value),
          currency: "MRU", year: num(project.year) } : undefined,
      } });
      haptic([10, 40, 10, 40, 20]);
      go(4);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const nCaps = Object.values(caps).filter((c) => c.on).length;
  const steps = 5;
  return (
    <MotionConfig reducedMotion="user">
      <div className="onb">
        <div className="onb-card">
          <div className="row between" style={{ marginBottom: 18 }}>
            <span className="row" style={{ gap: 10 }}><Logo size={30} /><b style={{ letterSpacing: "0.14em" }}>FORSA</b></span>
            <Segmented id="onb-lang" value={lang} onChange={setLang} options={[{ value: "fr", label: "FR" }, { value: "en", label: "EN" }]} />
          </div>
          <div className="steps" aria-hidden>
            {Array.from({ length: steps }, (_, i) => (
              <i key={i}><motion.b initial={false} animate={{ scaleX: i <= step ? 1 : 0 }} transition={{ ...spring, stiffness: 200 }} /></i>
            ))}
          </div>
          <div className="card" style={{ padding: "clamp(20px, 4vw, 34px)", borderRadius: "var(--r-xl)", boxShadow: "var(--shadow-3)",
            overflow: "hidden", position: "relative", minHeight: 420 }}>
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div key={step} custom={dir} variants={slide} initial="enter" animate="center" exit="exit"
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }} className="col" style={{ gap: 18 }}>
                {step === 0 && (
                  <>
                    <motion.div initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
                      transition={{ ...spring, stiffness: 180, delay: 0.1 }} style={{ width: 84 }}><Logo size={84} /></motion.div>
                    <h1 style={{ fontSize: "clamp(30px, 5vw, 44px)" }}>{t("onbWelcome")}</h1>
                    <p className="muted" style={{ fontSize: 17, maxWidth: 520 }}>{t("onbWelcomeSub")}</p>
                    <div className="col" style={{ gap: 10, marginTop: 6 }}>
                      {(lang === "fr"
                        ? ["Décrivez votre activité — à la voix ou par écrit", "Confirmez ce que FORSA a compris", "Recevez les marchés qui vous correspondent, avec les preuves"]
                        : ["Describe your business — by voice or text", "Confirm what FORSA understood", "Get the tenders that fit you, with the evidence"]
                      ).map((s, i) => (
                        <motion.div key={s} className="row" style={{ gap: 12, flexWrap: "nowrap" }} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.25 + i * 0.08 }}>
                          <span className="num" style={{ flex: "none", width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center",
                            background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 700 }}>{i + 1}</span>{s}
                        </motion.div>
                      ))}
                    </div>
                    <button className="btn accent lg" style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={() => go(1)}>
                      {t("start")}<ArrowRight size={18} /></button>
                  </>
                )}

                {step === 1 && (
                  <>
                    <div><h1>{t("onbDescribe")}</h1><p className="muted" style={{ marginTop: 6 }}>{t("onbDescribeSub")}</p></div>
                    <div style={{ position: "relative" }}>
                      <textarea rows={7} value={dict.listening && dict.interim ? `${text} ${dict.interim}` : text}
                        onChange={(e) => setText(e.target.value)} style={{ fontSize: 16, paddingBottom: 56 }}
                        placeholder={EXAMPLE[lang]} />
                      <div className="row" style={{ position: "absolute", left: 10, right: 10, bottom: 10, gap: 10, flexWrap: "nowrap" }}>
                        {dict.supported && (
                          <motion.button type="button" className={dict.listening ? "btn danger" : "orb"} whileTap={{ scale: 0.9 }}
                            style={dict.listening ? { borderRadius: 999 } : { width: 40, height: 40 }}
                            onClick={() => (dict.listening ? dict.stop() : dict.start())} aria-label={t("listening")}>
                            {dict.listening ? <Square size={14} /> : <Mic size={18} />}
                          </motion.button>
                        )}
                        {dict.listening ? <><Waveform level={dict.level} active /><span className="faint">{t("listening")}</span></>
                          : !text && <button type="button" className="btn sm ghost" onClick={() => setText(EXAMPLE[lang])}>
                            {lang === "fr" ? "Utiliser un exemple" : "Use an example"}</button>}
                      </div>
                    </div>
                    <ErrorBox error={error} />
                    <div className="row between">
                      <button className="btn ghost" onClick={() => go(0)}><ArrowLeft size={16} />{t("back")}</button>
                      <button className="btn accent lg" disabled={text.trim().length < 10 || busy} onClick={analyze}>
                        {busy ? <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          style={{ display: "inline-flex" }}><Sparkles size={18} /></motion.span> : <Sparkles size={18} />}
                        {t("analyze")}</button>
                    </div>
                  </>
                )}

                {step === 2 && analysis && (
                  <>
                    <div><h1>{t("onbConfirm")}</h1><p className="muted" style={{ marginTop: 6 }}>{t("onbConfirmSub")}</p></div>
                    <section className="col" style={{ gap: 10 }}>
                      <h3>{t("capabilities")} · <span className="num">{nCaps}</span></h3>
                      <motion.div className="row" style={{ gap: 8 }} initial="hidden" animate="show"
                        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}>
                        {Object.values(caps).map((c) => (
                          <motion.span key={c.id} variants={{ hidden: { opacity: 0, scale: 0.8 }, show: { opacity: 1, scale: 1 } }}>
                            <Pick on={c.on} title={c.quote ?? undefined} onClick={() => setCaps({ ...caps, [c.id]: { ...c, on: !c.on } })}>
                              {c.label}{c.source === "ai" && <span className="chip ai" style={{ height: 18, padding: "0 6px" }}>IA</span>}
                            </Pick>
                          </motion.span>
                        ))}
                        {!Object.keys(caps).length && <span className="muted">{lang === "fr" ? "Aucune compétence reconnue — ajoutez-en ci-dessous." : "No capability recognised — add some below."}</span>}
                      </motion.div>
                      {Object.values(caps).filter((c) => c.on && c.quote).slice(0, 2).map((c) => (
                        <div key={c.id} className="faint row" style={{ gap: 6, flexWrap: "nowrap" }}><QuoteIcon size={12} style={{ flex: "none" }} />
                          <span><b>{c.label}</b> ← “{c.quote}”</span></div>
                      ))}
                      <AddConcept kind="capability" onAdd={(c) => setCaps({ ...caps, [c.id]: { ...c, quote: null, source: "ontology", on: true } })} />
                    </section>
                    <section className="col" style={{ gap: 10 }}>
                      <h3>{t("credentials")}</h3>
                      <div className="row" style={{ gap: 8 }}>
                        {Object.values(creds).map((c) => (
                          <Pick key={c.id} on={c.on} onClick={() => setCreds({ ...creds, [c.id]: { ...c, on: !c.on } })}>{c.label}</Pick>
                        ))}
                      </div>
                      <AddConcept kind="credential" onAdd={(c) => setCreds({ ...creds, [c.id]: { ...c, quote: null, source: "ontology", on: true } })} />
                    </section>
                    <section className="col" style={{ gap: 10 }}>
                      <h3>{t("regions")}</h3>
                      <div className="row" style={{ gap: 8 }}>
                        {REGIONS.map((r) => (
                          <Pick key={r} on={regions.includes(r)} onClick={() => setRegions(regions.includes(r) ? regions.filter((x) => x !== r) : [...regions, r])}>{r}</Pick>
                        ))}
                      </div>
                    </section>
                    {analysis.ai_used && <p className="faint row" style={{ gap: 6 }}><Sparkles size={12} />
                      {lang === "fr" ? "Certaines suggestions viennent de l'IA (marquées IA) — limitées au référentiel FORSA." : "Some suggestions come from AI (marked AI) — limited to the FORSA catalogue."}</p>}
                    <div className="row between">
                      <button className="btn ghost" onClick={() => go(1)}><ArrowLeft size={16} />{t("back")}</button>
                      <button className="btn accent lg" disabled={!nCaps} onClick={() => go(3)}>{t("next")}<ArrowRight size={18} /></button>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <div><h1>{t("onbCapacity")}</h1><p className="muted" style={{ marginTop: 6 }}>{lang === "fr"
                      ? "Ces chiffres servent aux critères de capacité. Laissez vide si inconnu : FORSA l'indiquera comme inconnu, jamais comme négatif."
                      : "These figures feed capacity gates. Leave blank if unknown: FORSA shows it as unknown, never as negative."}</p></div>
                    <label className="field">{t("legalName")}
                      <input value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} required /></label>
                    <div className="grid g3" style={{ gap: 12 }}>
                      <label className="field">{t("turnover")} (MRU)
                        <input inputMode="numeric" value={form.annual_turnover} onChange={(e) => setForm({ ...form, annual_turnover: e.target.value.replace(/[^\d.]/g, "") })} /></label>
                      <label className="field">{t("maxProject")} (MRU)
                        <input inputMode="numeric" value={form.max_project_value} onChange={(e) => setForm({ ...form, max_project_value: e.target.value.replace(/[^\d.]/g, "") })} /></label>
                      <label className="field">{t("staff")}
                        <input inputMode="numeric" value={form.staff_count} onChange={(e) => setForm({ ...form, staff_count: e.target.value.replace(/\D/g, "") })} /></label>
                    </div>
                    <h3 style={{ marginTop: 6 }}>{t("onbReference")}</h3>
                    <div className="grid" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 0.7fr)", gap: 12 }}>
                      <input placeholder={t("title")} value={project.title} onChange={(e) => setProject({ ...project, title: e.target.value })} />
                      <input inputMode="numeric" placeholder={`${t("value")} (MRU)`} value={project.value}
                        onChange={(e) => setProject({ ...project, value: e.target.value.replace(/[^\d.]/g, "") })} />
                      <input inputMode="numeric" placeholder={t("year")} value={project.year}
                        onChange={(e) => setProject({ ...project, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
                    </div>
                    <ErrorBox error={error} />
                    <div className="row between">
                      <button className="btn ghost" onClick={() => go(2)}><ArrowLeft size={16} />{t("back")}</button>
                      <button className="btn accent lg" disabled={busy || form.legal_name.trim().length < 2} onClick={finish}>
                        {busy ? <span className="spin" style={{ display: "inline-flex" }}><Sparkles size={18} /></span> : <Check size={18} />}{t("finish")}</button>
                    </div>
                  </>
                )}

                {step === 4 && (
                  <div className="col" style={{ alignItems: "center", textAlign: "center", gap: 16, paddingTop: 20 }}>
                    <div style={{ position: "relative", width: 120, height: 120 }}>
                      {Array.from({ length: 12 }, (_, i) => (
                        <motion.span key={i} style={{ position: "absolute", left: 56, top: 56, width: 8, height: 8, borderRadius: 4,
                          background: i % 3 === 0 ? "var(--gold)" : i % 3 === 1 ? "var(--accent-2)" : "var(--accent)" }}
                          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                          animate={{ x: Math.cos((i / 12) * Math.PI * 2) * 74, y: Math.sin((i / 12) * Math.PI * 2) * 74, opacity: 0, scale: 0.4 }}
                          transition={{ duration: 0.9, delay: 0.25, ease: [0.22, 1, 0.36, 1] }} />
                      ))}
                      <motion.div className="orb" style={{ width: 120, height: 120 }} initial={{ scale: 0 }} animate={{ scale: 1 }}
                        transition={{ ...spring, stiffness: 260, damping: 14 }}>
                        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                            transition={{ duration: 0.5, delay: 0.3 }} />
                        </svg>
                      </motion.div>
                    </div>
                    <h1>{t("onbDone")}</h1>
                    <p className="muted" style={{ fontSize: 16, maxWidth: 440 }}>{t("onbDoneSub")}</p>
                    <div className="row" style={{ gap: 8, justifyContent: "center" }}>
                      <span className="chip BID num">{nCaps} {t("capabilities").toLowerCase()}</span>
                      <span className="chip neutral num">{regions.length} {t("regions").toLowerCase()}</span>
                    </div>
                    <button className="btn accent lg" onClick={() => router.replace("/")}>{t("goToday")}<ArrowRight size={18} /></button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          {step > 0 && step < 4 && (
            <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={() => { safeSet("forsa.onbSkipped", "1"); router.replace("/company"); }}>
              <X size={14} />{lang === "fr" ? "Passer — je remplirai mon profil moi-même" : "Skip — I'll fill in my profile myself"}</button>
          )}
        </div>
      </div>
    </MotionConfig>
  );
}
