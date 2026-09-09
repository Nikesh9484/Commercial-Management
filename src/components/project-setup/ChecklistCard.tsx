"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import type { ChecklistItem } from "@/lib/checklist";

export function ChecklistCard({ items: initial, canEdit, periodLabel }: { items: ChecklistItem[]; canEdit: boolean; periodLabel: string }) {
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<number | null>(null);
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

  async function update(item: ChecklistItem, patch: { done?: boolean; comment?: string | null }) {
    setBusyId(item.id);
    const res = await fetch(`/api/checklist/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const j = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return toast(j.error ?? "Could not update.", "error");
    setItems((list) => list.map((x) => (x.id === item.id ? j.item : x)));
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <ListChecks size={18} className="text-navy" /> Report checklist
        </h2>
        <Chip tone={done === items.length && items.length > 0 ? "green" : done > 0 ? "amber" : "grey"}>
          {done} of {items.length} done
        </Chip>
      </div>
      <p className="mb-3 text-xs text-muted">Tick each module once its section of {periodLabel} is complete. The checklist is kept per reporting period.</p>
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-page">
        <div className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="overflow-x-auto">
        <table className="data w-full">
          <thead>
            <tr>
              <th className="w-10">#</th>
              <th>Module</th>
              <th>Status</th>
              <th className="hidden md:table-cell">Done by</th>
              <th className="min-w-48">Comment</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="tnum text-muted">{item.module_no}</td>
                <td className="min-w-40 whitespace-normal">
                  <Link href={`/modules/${item.slug}`} className="font-medium text-ink hover:text-accent">
                    {item.title}
                  </Link>
                </td>
                <td>
                  <button
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition ${
                      item.done ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"
                    } ${canEdit ? "hover:brightness-95" : "cursor-default"}`}
                    disabled={!canEdit || busyId === item.id}
                    onClick={() => update(item, { done: !item.done })}
                    title={canEdit ? "Click to toggle" : undefined}
                  >
                    {item.done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                    {item.done ? "Done" : "Not Done"}
                  </button>
                </td>
                <td className="hidden text-xs text-muted md:table-cell">{item.done ? `${item.done_by ?? ""} · ${formatDateTime(item.done_at)}` : "—"}</td>
                <td>
                  <input
                    className="input py-1 text-xs"
                    placeholder={canEdit ? "Optional comment" : ""}
                    defaultValue={item.comment ?? ""}
                    disabled={!canEdit}
                    onBlur={(e) => e.target.value !== (item.comment ?? "") && update(item, { comment: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
