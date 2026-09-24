"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Chip, ErrorBox, Loading } from "@/components/ui";

export default function BidsPage() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api("/bids").then((r) => setItems(r.items)).catch(setError); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!items) return <Loading />;
  return (
    <div className="stack">
      <h1>{t("bids")}</h1>
      <div className="card flush">
        <ul className="list">
          {items.map((b) => (
            <li key={b.id} className="row between">
              <Link className="opp-title" href={`/bids/${b.id}`}>{b.title}</Link>
              <span className="row"><Chip kind="neutral">{b.status}</Chip><span className="faint">{date(b.deadline_at, lang)}</span></span>
            </li>
          ))}
          {!items.length && <li className="muted">{t("noData")}</li>}
        </ul>
      </div>
    </div>
  );
}
