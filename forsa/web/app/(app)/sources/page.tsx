"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Chip, ErrorBox, Loading } from "@/components/ui";

export default function SourcesPage() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api("/sources").then((r) => setItems(r.items)).catch(setError); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!items) return <Loading />;
  return (
    <div className="stack">
      <h1>{t("sources")}</h1>
      <p className="muted">Aucune source ne tourne sans entrée vérifiée dans le registre. Les données périmées sont signalées, jamais masquées.</p>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("source")}</th><th>{t("health")}</th><th className="hide-sm">Type</th><th>Dernière exécution</th></tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.key}>
                <td><b>{s.name}</b><div className="faint">{s.key} · {s.status}</div>{s.notes && <div className="faint">{s.notes}</div>}</td>
                <td><Chip kind={s.health} /><div className="faint">{s.health_detail}</div></td>
                <td className="hide-sm">{s.access_type}</td>
                <td>{s.last_run ? <>{s.last_run.status} · {date(s.last_run.finished_at ?? s.last_run.started_at, lang)}
                  <div className="faint mono">{JSON.stringify(s.last_run.stats)}</div></> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
