"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/** The delete button on a row of the packs list: asks first, then removes the pack with its files. */
export function PackRowActions({ id, label, files }: { id: number; label: string; files: number }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!confirm(`Delete ${label}${files ? ` with its ${files} uploaded file${files === 1 ? "" : "s"}` : ""}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/packs/cases/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast("Could not delete the pack.", "error");
    toast(`${label} deleted.`);
    router.refresh();
  }
  return (
    <button className="btn btn-xs btn-ghost text-red-700" onClick={remove} disabled={busy} title="Delete this pack and its uploaded files">
      <Trash2 size={12} />
    </button>
  );
}
