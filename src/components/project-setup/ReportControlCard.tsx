"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Lock, Unlock, Save, Settings } from "lucide-react";
import { FieldWrap } from "@/components/ui/Field";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";

export interface PeriodControl {
  id: number;
  report_no: number;
  label: string;
  period_start: string | null;
  period_end: string;
  status: "Open" | "Locked";
  locked_at: string | null;
  locked_by: string | null;
  aconex_ref: string | null;
  prepared_by: string | null;
  prepared_date: string | null;
  reviewed_by: string | null;
  reviewed_date: string | null;
  approved_by: string | null;
  approved_date: string | null;
}

type Editable = Pick<PeriodControl, "aconex_ref" | "prepared_by" | "prepared_date" | "reviewed_by" | "reviewed_date" | "approved_by" | "approved_date">;

export function ReportControlCard({ period, canEdit, isAdmin }: { period: PeriodControl | null; canEdit: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Editable>({
    aconex_ref: period?.aconex_ref ?? "",
    prepared_by: period?.prepared_by ?? "",
    prepared_date: period?.prepared_date ?? "",
    reviewed_by: period?.reviewed_by ?? "",
    reviewed_date: period?.reviewed_date ?? "",
    approved_by: period?.approved_by ?? "",
    approved_date: period?.approved_date ?? "",
  });

  if (!period) {
    return (
      <div className="card p-5">
        <h2 className="text-base font-semibold text-ink">Report control</h2>
        <p className="mt-2 text-sm text-muted">
          No reporting period exists yet. <Link href="/settings/reporting_periods" className="text-accent hover:underline">Add one under Settings</Link>.
        </p>
      </div>
    );
  }

  const set = (k: keyof Editable, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    setErrors({});
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]));
    const res = await fetch(`/api/periods/${period!.id}/control`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setErrors(j.fieldErrors ?? {});
      toast(j.error ?? "Could not save.", "error");
      return;
    }
    toast("Report control saved.");
    router.refresh();
  }

  async function lockToggle() {
    const action = period!.status === "Locked" ? "unlock" : "lock";
    if (action === "lock" && !window.confirm(`Lock ${period!.label}? A snapshot of every module register will be stored for this period.`)) return;
    setBusy(true);
    const res = await fetch(`/api/periods/${period!.id}/${action}`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(j.error ?? "Action failed.", "error");
    toast(action === "lock" ? `Period locked. Snapshot stored (${j.records ?? 0} record(s)).` : "Period unlocked.");
    router.refresh();
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <FileText size={18} className="text-navy" /> Report control
        </h2>
        <div className="flex items-center gap-2">
          <Chip tone={period.status === "Locked" ? "green" : "amber"}>
            {period.status === "Locked" ? <Lock size={11} className="mr-1" /> : <Unlock size={11} className="mr-1" />}
            {period.status}
          </Chip>
          {isAdmin && (
            <button className={`btn btn-sm ${period.status === "Locked" ? "btn-secondary" : "btn-primary"}`} onClick={lockToggle} disabled={busy}>
              {period.status === "Locked" ? <Unlock size={14} /> : <Lock size={14} />} {period.status === "Locked" ? "Unlock period" : "Lock period"}
            </button>
          )}
        </div>
      </div>

      <dl className="mb-4 grid gap-x-6 gap-y-2 sm:grid-cols-4">
        <Item k="Report No" v={String(period.report_no)} />
        <Item k="Reporting period" v={period.label} />
        <Item k="Period" v={`${period.period_start ? formatDate(period.period_start) + " – " : ""}${formatDate(period.period_end)}`} />
        <Item k="Locked" v={period.locked_at ? `${formatDate(period.locked_at)} by ${period.locked_by ?? ""}` : "—"} />
      </dl>
      <p className="mb-4 text-xs text-muted">
        Report number and dates come from the period selected in the top bar.{" "}
        {isAdmin && (
          <Link href="/settings/reporting_periods" className="inline-flex items-center gap-1 text-accent hover:underline">
            <Settings size={12} /> Manage reporting periods
          </Link>
        )}
      </p>

      <div className="space-y-4">
        <FieldWrap label="Aconex reference" error={errors.aconex_ref} help="Document / transmittal reference for this month's report.">
          <input className="input" value={form.aconex_ref ?? ""} disabled={!canEdit} onChange={(e) => set("aconex_ref", e.target.value)} placeholder="e.g. RSG-1TB01031-MCR-049" />
        </FieldWrap>
        <div className="grid gap-3 sm:grid-cols-3">
        <SignOff title="Prepared by" name={form.prepared_by ?? ""} date={form.prepared_date ?? ""} canEdit={canEdit} onName={(v) => set("prepared_by", v)} onDate={(v) => set("prepared_date", v)} err={errors.prepared_date} />
        <SignOff title="Reviewed by" name={form.reviewed_by ?? ""} date={form.reviewed_date ?? ""} canEdit={canEdit} onName={(v) => set("reviewed_by", v)} onDate={(v) => set("reviewed_date", v)} err={errors.reviewed_date} />
        <SignOff title="Approved by" name={form.approved_by ?? ""} date={form.approved_date ?? ""} canEdit={canEdit} onName={(v) => set("approved_by", v)} onDate={(v) => set("approved_date", v)} err={errors.approved_date} />
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              <Save size={15} /> {saving ? "Saving…" : "Save report control"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="text-sm font-medium text-ink">{v}</dd>
    </div>
  );
}

function SignOff({ title, name, date, canEdit, onName, onDate, err }: { title: string; name: string; date: string; canEdit: boolean; onName: (v: string) => void; onDate: (v: string) => void; err?: string }) {
  return (
    <div className="rounded-lg border border-line bg-page p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="space-y-2">
        <input className="input" placeholder="Name" value={name} disabled={!canEdit} onChange={(e) => onName(e.target.value)} />
        <input className="input" type="date" value={date} disabled={!canEdit} onChange={(e) => onDate(e.target.value)} aria-invalid={err ? true : undefined} />
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    </div>
  );
}
