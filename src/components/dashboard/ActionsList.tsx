"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListTodo, Plus } from "lucide-react";
import type { LookupOption, RecordRow, RegisterDef } from "@/lib/registers/types";
import { formatDate } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { RecordForm, type FormValues } from "@/components/register/RecordForm";

export function ActionsList({ actions, canEdit }: { actions: RecordRow[]; canEdit: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [meta, setMeta] = useState<{ def: RegisterDef; lookups: Record<string, LookupOption[]>; scopeDefaults: Record<string, number> } | null>(null);
  const [values, setValues] = useState<FormValues | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function openNew() {
    let m = meta;
    if (!m) {
      const r = await fetch("/api/registers/actions", { cache: "no-store" });
      const j = await r.json();
      m = { def: j.def, lookups: j.lookups, scopeDefaults: j.scopeDefaults ?? {} };
      setMeta(m);
    }
    const v: FormValues = { status: "Open", ...m.scopeDefaults };
    setErrors({});
    setValues(v);
  }

  async function save() {
    if (!values || !meta) return;
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const f of meta.def.fields) if (!f.hideInForm && !f.readonly && !f.virtual) body[f.key] = values[f.key] ?? null;
    const res = await fetch("/api/registers/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setErrors(j.fieldErrors ?? {});
      toast(j.error ?? "Could not save.", "error");
      return;
    }
    toast("Action added.");
    setValues(null);
    router.refresh();
  }

  async function close(a: RecordRow) {
    const res = await fetch(`/api/registers/actions/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Closed", closed_date: new Date().toISOString().slice(0, 10) }) });
    if (!res.ok) return toast("Could not close the action.", "error");
    toast(`${a.item_no} closed.`);
    router.refresh();
  }

  return (
    <div className="card flex h-full flex-col p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ListTodo size={18} className="text-navy" /> Actions
        </h2>
        <div className="flex items-center gap-2">
          <Chip tone={actions.some((a) => (a.days_to_due as number | null) !== null && (a.days_to_due as number) < 0) ? "red" : actions.length ? "amber" : "green"}>{actions.length} open</Chip>
          {canEdit && (
            <button className="btn btn-secondary btn-sm" onClick={openNew}>
              <Plus size={14} /> Add
            </button>
          )}
        </div>
      </div>
      {actions.length === 0 ? (
        <p className="text-sm text-muted">No open actions.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {actions.slice(0, 10).map((a) => {
            const d = a.days_to_due as number | null;
            return (
              <li key={a.id} className="flex items-start gap-3 py-2">
                <span className="mt-0.5 shrink-0 text-xs font-semibold text-muted">{String(a.item_no)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{String(a.topic)}</span>
                  <span className="block truncate text-xs text-muted" title={String(a.action)}>
                    {String(a.action)}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {a.owner ? `${a.owner} · ` : ""}
                    {a.due_date ? `due ${formatDate(a.due_date as string)}` : "no due date"}
                    {a.meeting_id__label ? ` · ${a.meeting_id__label}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {d !== null && d !== undefined ? <Chip tone={d < 0 ? "red" : d <= 7 ? "amber" : "grey"}>{d < 0 ? `${-d}d overdue` : `${d}d`}</Chip> : <Chip>{String(a.status)}</Chip>}
                  {canEdit && (
                    <button className="text-xs text-accent hover:underline" onClick={() => close(a)}>
                      Close
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 text-xs text-muted">
        {actions.length > 10 && `${actions.length - 10} more · `}
        <Link href="/modules/executive-summary/minutes" className="text-accent hover:underline">
          All items in Minutes of Meeting →
        </Link>
      </div>

      <Modal
        open={!!values}
        title="Add action"
        onClose={() => setValues(null)}
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setValues(null)} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {values && meta && <RecordForm def={meta.def} values={values} lookups={meta.lookups} errors={errors} isNew onChange={(k, v) => setValues((s) => (s ? { ...s, [k]: v } : s))} />}
      </Modal>
    </div>
  );
}
