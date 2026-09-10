"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, TriangleAlert } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/** Admin-only: wipe the project data to start again (for example after a test import). */
export function StartOverCard() {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [periods, setPeriods] = useState(false);
  const [lookups, setLookups] = useState(false);
  const [team, setTeam] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await fetch("/api/admin/clear-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm, periods, lookups, team }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(j.error ?? "Could not clear the data.", "error");
    toast("Project data cleared. You can import or enter the first month again.");
    setOpen(false);
    setConfirm("");
    router.refresh();
  }

  return (
    <div className="card border-red-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <TriangleAlert size={18} className="text-red-600" /> Start over
        </h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)}>
          <Trash2 size={14} /> {open ? "Cancel" : "Clear all project data…"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        Removes every cost line, change, claim, early warning, risk, provisional sum, bond, contract, payment, budget transfer, meeting and all locked snapshots.
        Users, programmes, assets and the login stay. Use it after a test import to begin again cleanly. Download the database first if you may want it back.
      </p>
      {open && (
        <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={periods} onChange={(e) => setPeriods(e.target.checked)} /> Also remove the reporting periods (you will create Report No 1 again)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={lookups} onChange={(e) => setLookups(e.target.checked)} /> Also remove packages, contractors and the other dropdown lists
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={team} onChange={(e) => setTeam(e.target.checked)} /> Also remove the distribution / project team list
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span>
              Type <strong>DELETE</strong> to confirm:
            </span>
            <input className="input w-32" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="btn btn-danger btn-sm" onClick={run} disabled={busy || confirm !== "DELETE"}>
              <Trash2 size={14} /> {busy ? "Clearing…" : "Clear the data"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
