"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Unlink } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/**
 * Ties a contractor's customs recovery to its Change Management entry (RFC / EI → PVO → VO → DVO),
 * or removes the tie. The options are the project's change items, the contractor's own first.
 */
export function LinkChangeButton({ contractor, currentId, options }: { contractor: string; currentId: number | null; options: { id: number; label: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(currentId ? String(currentId) : "");
  const [busy, setBusy] = useState(false);
  async function save(changeId: number | null) {
    setBusy(true);
    const res = await fetch("/api/recovery/link-change", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contractor, changeId }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(j.error ?? "Could not link the change item.");
    toast(changeId ? `${contractor}: linked to the change item on ${j.updated} tracker row(s).` : `${contractor}: change item link removed.`);
    setOpen(false);
    router.refresh();
  }
  if (!open) {
    return (
      <span className="inline-flex items-center gap-1">
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => setOpen(true)} title="Choose the Change Management entry (RFC / EI → PVO → VO → DVO) that recovers this contractor's customs duty">
          <Link2 size={12} /> {currentId ? "Change link" : "Link change item"}
        </button>
        {currentId && (
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => save(null)} disabled={busy} title="Remove the link">
            <Unlink size={12} />
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select className="input h-7 w-72 min-w-[16rem] py-0 text-xs" value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="">– choose the change item –</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-xs btn-primary" disabled={busy || !choice} onClick={() => save(Number(choice))}>
        Link
      </button>
      <button type="button" className="btn btn-xs btn-ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}
