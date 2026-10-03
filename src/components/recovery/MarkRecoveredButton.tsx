"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/** Marks every tracker row of a contractor as fully recovered (or opens them again); the page refreshes so the summary and the list below agree. */
export function MarkRecoveredButton({ register, contractor, recovered, what }: { register: "customs_recovery" | "accommodation_recovery"; contractor: string; recovered: boolean; what: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    const q = recovered ? `Open ${contractor}'s ${what} again? The rows go back to Open.` : `Mark ${contractor}'s ${what} as fully recovered? Every tracker row of this contractor is set to Recovered and the balance to recover shows as nil.`;
    if (!window.confirm(q)) return;
    setBusy(true);
    const res = await fetch("/api/recovery/mark-recovered", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ register, contractor, recovered: !recovered }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(j.error ?? "Could not update the tracker.");
    toast(recovered ? `${contractor}: ${j.updated} row(s) opened again.` : `${contractor}: ${j.updated} row(s) marked as fully recovered.`);
    router.refresh();
  }
  return recovered ? (
    <span className="inline-flex items-center gap-1">
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Recovered</span>
      <button type="button" className="btn btn-xs btn-ghost" onClick={go} disabled={busy} title="Open this contractor's rows again">
        <RotateCcw size={12} /> Reopen
      </button>
    </span>
  ) : (
    <button type="button" className="btn btn-xs btn-secondary" onClick={go} disabled={busy} title="Mark every tracker row of this contractor as fully recovered – the summary, the list below, the report and the email follow">
      <CheckCircle2 size={12} /> Mark fully recovered
    </button>
  );
}
