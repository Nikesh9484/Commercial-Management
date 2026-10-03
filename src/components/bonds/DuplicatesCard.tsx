"use client";

import { useState } from "react";
import { CopyX, Merge } from "lucide-react";
import type { DuplicateGroup } from "@/lib/bonds/duplicates";
import { formatDate, formatMoney } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";

/**
 * The same bond or policy entered more than once. Each group is shown side by side: pick the entry
 * to keep (the original – its start date is when the bond was first put in place), say whether the
 * other copies are renewals, and merge. The copies' documents move to the entry kept.
 */
export function DuplicatesCard({ groups: initial, canMerge }: { groups: DuplicateGroup[]; canMerge: boolean }) {
  const [groups, setGroups] = useState(initial);
  const [keep, setKeep] = useState<Record<string, number>>({});
  const [carry, setCarry] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const toast = useToast();
  if (!groups.length) return null;

  async function merge(g: DuplicateGroup) {
    const keepId = keep[g.key] ?? g.suggestedKeep;
    const remove = g.rows.filter((r) => r.id !== keepId).map((r) => r.id);
    const kept = g.rows.find((r) => r.id === keepId)!;
    if (!window.confirm(`Keep Ref ${kept.ref} and remove ${remove.length === 1 ? `Ref ${g.rows.find((r) => r.id === remove[0])?.ref}` : `${remove.length} copies`}? The copies' documents move to the entry kept. This cannot be undone.`)) return;
    setBusy(g.key);
    try {
      const res = await fetch("/api/bonds/duplicates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keep: keepId, remove, carryExpiry: carry[g.key] ?? expiriesDiffer(g) }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string; groups?: DuplicateGroup[] };
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      toast(`Ref ${kept.ref} kept – ${remove.length} cop${remove.length === 1 ? "y" : "ies"} merged into it.`);
      setGroups(j.groups ?? groups.filter((x) => x.key !== g.key));
      window.location.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong.", "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card space-y-3 border-amber-300 bg-amber-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <CopyX size={15} /> Duplicate entries – {groups.length} bond{groups.length === 1 ? "" : "s"} entered more than once
        </h2>
        <span className="text-xs text-amber-900/80">
          {canMerge ? "Keep the original entry and merge the copies into it. A renewal or extension only moves the expiry date on – the start date stays the date the bond was first put in place." : "Ask the admin or an editor to merge them – the copies are removed."}
        </span>
      </div>
      {groups.map((g) => {
        const keepId = keep[g.key] ?? g.suggestedKeep;
        const differ = expiriesDiffer(g);
        const carryIt = carry[g.key] ?? differ;
        return (
          <div key={g.key} className="rounded-xl border border-amber-200 bg-white p-3">
            <div className="mb-2 text-xs text-muted">
              <span className="font-semibold text-ink">{g.rows[0].contractor}</span> · {g.rows[0].type} · {g.reason}
            </div>
            <div className="overflow-x-auto">
              <table className="data w-full text-xs">
                <thead>
                  <tr>
                    {canMerge && <th>Keep</th>}
                    <th>Ref</th>
                    <th>Contract</th>
                    <th>Policy / bond no</th>
                    <th>Issued by</th>
                    <th className="text-right">Amount</th>
                    <th>Start</th>
                    <th>Expiry</th>
                    <th>Approved</th>
                    <th>Docs</th>
                    <th>Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id} className={r.id === keepId ? "bg-emerald-50 font-medium" : "text-muted"}>
                      {canMerge && (
                        <td>
                          <input type="radio" name={`keep-${g.key}`} checked={r.id === keepId} onChange={() => setKeep((k) => ({ ...k, [g.key]: r.id }))} title="Keep this entry" />
                        </td>
                      )}
                      <td className="whitespace-nowrap">
                        {r.ref}
                        {r.id === g.suggestedKeep && <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">original</span>}
                      </td>
                      <td className="max-w-[16rem] truncate" title={r.contract}>
                        {r.contract || "–"}
                      </td>
                      <td className="whitespace-nowrap">{r.policy_no || "–"}</td>
                      <td className="max-w-[12rem] truncate" title={r.issuer}>
                        {r.issuer || "–"}
                      </td>
                      <td className="tnum whitespace-nowrap text-right">{r.amount ? formatMoney(r.amount) : "–"}</td>
                      <td className="whitespace-nowrap">{r.start_date ? formatDate(r.start_date) : "–"}</td>
                      <td className="whitespace-nowrap">{r.expiry_date ? formatDate(r.expiry_date) : "–"}</td>
                      <td>{r.approved ? "Yes" : "No"}</td>
                      <td className="tnum">{r.documents || "–"}</td>
                      <td className="whitespace-nowrap">{r.created_at ? formatDate(r.created_at) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canMerge && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <label className={`flex items-center gap-2 text-xs ${differ ? "text-ink" : "text-muted"}`}>
                  <input type="checkbox" checked={carryIt} disabled={!differ} onChange={(e) => setCarry((c) => ({ ...c, [g.key]: e.target.checked }))} />
                  The other cop{g.rows.length > 2 ? "ies are renewals" : "y is a renewal"} / extension – carry the latest expiry ({g.latestExpiry ? formatDate(g.latestExpiry) : "–"}) to the entry kept
                </label>
                <button className="btn btn-sm btn-primary" disabled={busy === g.key} onClick={() => merge(g)}>
                  <Merge size={14} /> {busy === g.key ? "Merging…" : `Keep Ref ${g.rows.find((r) => r.id === keepId)?.ref} and merge the rest`}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const expiriesDiffer = (g: DuplicateGroup) => new Set(g.rows.map((r) => r.expiry_date)).size > 1;
