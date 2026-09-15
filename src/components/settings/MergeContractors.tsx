"use client";

import { useCallback, useEffect, useState } from "react";
import { Merge, CheckCircle2, Loader2, Users } from "lucide-react";

interface Group {
  key: string;
  keep: { id: number; name: string; links: number };
  merge: { id: number; name: string; links: number }[];
  moves: number;
}

/**
 * The same company entered twice. Shown with what will happen before it happens – which spelling is
 * kept, which go, and how many records move – because merging cannot be undone from the page.
 */
export function MergeContractors() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/contractors/duplicates")
      .then((r) => r.json())
      .then((j) => setGroups(j.groups ?? []))
      .catch(() => setError("Could not read the contractor list."));
  }, []);

  useEffect(load, [load]);

  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/contractors/duplicates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const j = await r.json();
      if (!r.ok) setError(j.error ?? "The merge did not run.");
      else {
        setDone(`${j.removed} duplicate record${j.removed === 1 ? "" : "s"} merged into ${j.groups} ${j.groups === 1 ? "company" : "companies"}. ${j.moved} record${j.moved === 1 ? "" : "s"} moved.`);
        load();
      }
    } catch {
      setError("The merge did not run.");
    } finally {
      setBusy(false);
    }
  };

  if (groups === null) return null;

  if (!groups.length) {
    return (
      <div className="card flex items-start gap-3 border border-emerald-200 p-5">
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Every company appears once</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {done ?? "No contractor is recorded twice under different spellings. Imports are checked for this automatically, so it stays that way."}
          </p>
        </div>
      </div>
    );
  }

  const total = groups.reduce((t, g) => t + g.merge.length, 0);
  const moves = groups.reduce((t, g) => t + g.moves, 0);

  return (
    <div className="card border border-amber-200 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Users size={18} className="text-amber-600" />
        {groups.length} {groups.length === 1 ? "company is" : "companies are"} recorded more than once
      </h2>
      <p className="mb-3 mt-0.5 text-xs leading-relaxed text-muted">
        The same company has been entered under spellings that differ only in full stops, spaces or capitals – usually because a register was filled from two places. It splits every contractor-wise
        summary in two. Merging keeps the record carrying the most work and moves everything onto it.
      </p>

      <div className="mb-3 max-h-72 overflow-y-auto pr-1">
        {groups.map((g) => (
          <div key={g.key} className="mb-2 rounded-lg border border-line p-2.5 last:mb-0">
            <p className="text-sm font-medium text-ink">
              {g.keep.name} <span className="text-xs font-normal text-muted">is kept ({g.keep.links} record{g.keep.links === 1 ? "" : "s"})</span>
            </p>
            {g.merge.map((m) => (
              <p key={m.id} className="mt-0.5 text-xs text-muted">
                ← {m.name} <span className="text-[11px]">({m.links} record{m.links === 1 ? "" : "s"} move{m.links === 1 ? "s" : ""} across)</span>
              </p>
            ))}
          </div>
        ))}
      </div>

      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={merge}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />}
          Merge {total} duplicate record{total === 1 ? "" : "s"}
        </button>
        <span className="text-[11px] leading-relaxed text-muted">
          {moves} record{moves === 1 ? "" : "s"} will move. This cannot be undone here – the audit log keeps what was merged into what, and the database is backed up within 20 seconds of the change.
        </span>
      </div>
    </div>
  );
}
