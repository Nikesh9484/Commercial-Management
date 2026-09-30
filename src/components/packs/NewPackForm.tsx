"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import type { SourceOption } from "@/lib/packs/data";

/** Picks the register item a new pack is filled from (or none), and starts it. */
export function NewPackForm({ type, short, sourceLabel, sources }: { type: string; short: string; sourceLabel: string; sources: SourceOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [sourceId, setSourceId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? sources.filter((s) => `${s.label} ${s.sub}`.toLowerCase().includes(t)) : sources;
    return list.slice(0, 200);
  }, [q, sources]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/packs/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, sourceId: sourceId ? Number(sourceId) : null, title }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "could not start the pack");
      toast(`${short} ${j.case?.ref ?? ""} started – the register values are filled in.`);
      router.push(`/packs/${type}/${j.case.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 text-xs">
      <label className="block text-muted">
        Pick the {sourceLabel} ({sources.length})
        <input className="input mt-0.5 w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by number, description or contractor…" />
      </label>
      <select className="input w-full" size={Math.min(6, Math.max(2, shown.length + 1))} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
        <option value="">— No register item: blank {short}, project details only —</option>
        {shown.map((s) => (
          <option key={s.id} value={String(s.id)} title={s.sub}>
            {s.label}
            {s.sub ? ` · ${s.sub}` : ""}
          </option>
        ))}
      </select>
      <label className="block text-muted">
        Title (optional – the register description is used when blank)
        <input className="input mt-0.5 w-full" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`e.g. ${short} title as it appears on the form`} />
      </label>
      <button className="btn btn-sm btn-primary" onClick={create} disabled={busy}>
        <Plus size={14} /> {busy ? "Starting…" : `Start ${short}`}
      </button>
    </div>
  );
}
