"use client";

import { useEffect, useState } from "react";
import type { AuditEntry } from "@/lib/registers/types";
import { formatDateTime } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";

const ACTION_TONE: Record<string, "green" | "amber" | "red" | "blue" | "grey"> = {
  create: "green",
  import: "blue",
  update: "amber",
  delete: "red",
  lock: "green",
  unlock: "amber",
  login: "grey",
  context: "grey",
};

export function HistoryList({ entries, showRegister = false }: { entries: AuditEntry[]; showRegister?: boolean }) {
  if (!entries.length) return <p className="py-6 text-center text-sm text-muted">No changes recorded yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {entries.map((e) => (
        <li key={e.id} className="py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="tnum">{formatDateTime(e.at)}</span>
            <span>·</span>
            <span className="font-medium text-ink">{e.user_name}</span>
            <Chip tone={ACTION_TONE[e.action] ?? "grey"}>{e.action}</Chip>
            {showRegister && <span className="rounded bg-page px-1.5 py-0.5">{e.register_key.replace(/_/g, " ")}</span>}
          </div>
          <div className="mt-1 text-sm text-ink">{e.summary}</div>
          {e.changes && Object.keys(e.changes).length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
              {Object.entries(e.changes).map(([k, c]) => (
                <li key={k}>
                  <span className="font-medium text-ink/80">{k.replace(/_id$/, "").replace(/_/g, " ")}</span>: {fmt(c.from)} → {fmt(c.to)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function fmt(v: unknown) {
  if (v === null || v === undefined || v === "") return "(blank)";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function RecordHistory({ registerKey, recordId }: { registerKey: string; recordId: number }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/registers/${registerKey}/${recordId}/history`)
      .then((r) => r.json())
      .then((j) => live && setEntries(j.history ?? []))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [registerKey, recordId]);
  if (!entries) return <p className="py-6 text-center text-sm text-muted">Loading…</p>;
  return <HistoryList entries={entries} />;
}
