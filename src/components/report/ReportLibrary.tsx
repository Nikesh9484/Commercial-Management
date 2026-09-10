"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Unlock, Trash2, Pencil, FileUp, LayoutDashboard, FolderDown, Save, X } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime } from "@/lib/format";
import type { LibraryRow } from "@/lib/periods";

export function ReportLibrary({ rows, isAdmin, canEdit }: { rows: LibraryRow[]; isAdmin: boolean; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState<LibraryRow | null>(null);
  const [form, setForm] = useState({ report_no: "", period_end: "", label: "" });

  const j = async (r: Response) => r.json().catch(() => ({}));

  async function open(row: LibraryRow) {
    setBusy(row.id);
    const r = await fetch("/api/context", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period_id: row.id }) });
    setBusy(null);
    if (!r.ok) return toast((await j(r)).error ?? "Could not switch the period.", "error");
    router.push("/");
    router.refresh();
  }

  async function lockToggle(row: LibraryRow) {
    const action = row.status === "Locked" ? "unlock" : "lock";
    if (action === "lock" && !confirm(`Lock and issue ${row.label}? The figures are frozen as the issued report.`)) return;
    if (action === "unlock" && !confirm(`Unlock ${row.label}? Its frozen figures are kept until it is locked again; the dashboard shows live data for it meanwhile.`)) return;
    setBusy(row.id);
    let r = await fetch(`/api/periods/${row.id}/${action}`, { method: "POST" });
    let res = await j(r);
    if (!r.ok && res.fieldErrors?.force === "confirm" && confirm(`${res.error}\n\nLock anyway?`)) {
      r = await fetch(`/api/periods/${row.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      res = await j(r);
    }
    setBusy(null);
    if (!r.ok) return toast(res.error ?? "Action failed.", "error");
    toast(action === "lock" ? `${row.label} locked and issued.` : `${row.label} unlocked.`);
    router.refresh();
  }

  async function reupload(row: LibraryRow) {
    if (row.status === "Locked") {
      if (!isAdmin) return toast(`${row.label} is locked. Ask an Admin to unlock it before re-uploading.`, "error");
      if (!confirm(`${row.label} is locked. Unlock it now and re-upload its workbook? Lock it again after the import (tick "Lock the period after importing").`)) return;
      setBusy(row.id);
      const r = await fetch(`/api/periods/${row.id}/unlock`, { method: "POST" });
      setBusy(null);
      if (!r.ok) return toast((await j(r)).error ?? "Could not unlock.", "error");
    }
    router.push(`/imports/monthly?period=${row.id}`);
  }

  function startEdit(row: LibraryRow) {
    setForm({ report_no: String(row.report_no), period_end: row.period_end, label: row.label });
    setEditing(row);
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(editing.id);
    const r = await fetch(`/api/periods/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report_no: Number(form.report_no), period_end: form.period_end, label: form.label }) });
    const res = await j(r);
    setBusy(null);
    if (!r.ok) return toast(res.error ?? "Could not save.", "error");
    toast(`Saved as ${res.period.label}.`);
    setEditing(null);
    router.refresh();
  }

  async function remove(row: LibraryRow) {
    const typed = prompt(`Delete ${row.label}?\n\nThis removes the report, its issued snapshot (${row.snapshot_records.toLocaleString()} records) and its checklist. The live registers (cost lines, changes, claims …) are NOT changed. Type the report number (${row.report_no}) to confirm.`);
    if (typed === null) return;
    if (typed.trim() !== String(row.report_no)) return toast("The report number did not match – nothing deleted.", "error");
    setBusy(row.id);
    const r = await fetch(`/api/periods/${row.id}`, { method: "DELETE" });
    const res = await j(r);
    setBusy(null);
    if (!r.ok) return toast(res.error ?? "Could not delete.", "error");
    toast(`${res.label} deleted.`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="data w-full text-sm">
          <thead>
            <tr>
              <th>Report</th>
              <th>Cut-off</th>
              <th>Status</th>
              <th>Source</th>
              <th>Issued snapshot</th>
              <th>Last change</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted">
                  No reports yet. Import a workbook or start a month by hand.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <Fragment key={row.id}>
              <tr className={row.current ? "bg-blue-50/60" : ""}>
                <td>
                  <div className="font-medium text-ink">
                    {row.label} {row.current && <Chip tone="blue">in top bar</Chip>}
                  </div>
                  <div className="text-xs text-muted">Report No {row.report_no}</div>
                </td>
                <td className="whitespace-nowrap">{formatDate(row.period_end)}</td>
                <td>
                  <Chip tone={row.status === "Locked" ? "green" : "amber"}>{row.status === "Locked" ? "Issued (locked)" : "Open"}</Chip>
                  {row.locked_at && <div className="mt-1 text-xs text-muted">{formatDate(row.locked_at)} · {row.locked_by}</div>}
                </td>
                <td>
                  <div>{row.source}</div>
                  <div className="text-xs text-muted">
                    {row.source_file && <span className="block truncate max-w-64" title={row.source_file}>{row.source_file}</span>}
                    {row.imported_at && <span>{formatDateTime(row.imported_at)} · {row.imported_by}</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap">{row.status === "Locked" ? `${row.snapshot_records.toLocaleString()} records · ${row.cost_lines} cost lines` : <span className="text-muted">live data</span>}</td>
                <td className="whitespace-nowrap text-xs text-muted">{row.created_at ? formatDate(row.created_at) : "–"}</td>
              </tr>
              <tr className={`${row.current ? "bg-blue-50/60" : ""} border-b-2 border-line`}>
                <td colSpan={6} className="py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-2 text-xs text-muted">Report No {row.report_no}:</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => open(row)} disabled={busy === row.id} title="Select this report in the top bar and open the Executive Summary">
                      <LayoutDashboard size={14} /> Open
                    </button>
                    <Link className="btn btn-secondary btn-sm" href={`/reports?period=${row.id}`} title="Download this report's PDF / Excel / presentation">
                      <FolderDown size={14} /> Downloads
                    </Link>
                    {canEdit && (
                      <button className="btn btn-secondary btn-sm" onClick={() => reupload(row)} disabled={busy === row.id} title="Upload this month's workbook again into this report">
                        <FileUp size={14} /> Re-upload
                      </button>
                    )}
                    {isAdmin && (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(row)} disabled={busy === row.id} title="Change the report number, cut-off date or label">
                          <Pencil size={14} /> Change
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => lockToggle(row)} disabled={busy === row.id}>
                          {row.status === "Locked" ? <Unlock size={14} /> : <Lock size={14} />} {row.status === "Locked" ? "Unlock" : "Lock"}
                        </button>
                        <button className="btn btn-ghost btn-sm text-red-600" onClick={() => remove(row)} disabled={busy === row.id} title="Delete this report">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="card border-l-4 border-l-navy p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Change {editing.label}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
              <X size={14} /> Cancel
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[8rem_12rem_1fr_auto] sm:items-end">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Report No
              <input className="input" inputMode="numeric" value={form.report_no} onChange={(e) => setForm({ ...form, report_no: e.target.value.replace(/\D/g, "") })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Cut-off date
              <input type="date" className="input" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Label (leave blank to rebuild from the number and date)
              <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </label>
            <button className="btn btn-primary" onClick={saveEdit} disabled={busy === editing.id || !form.report_no || !form.period_end}>
              <Save size={16} /> Save
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Changing the number re-orders the reports (the movement is always measured against the report with the next lower number). The issued snapshot, if any, stays attached.</p>
        </div>
      )}

      <p className="text-xs text-muted">
        <b>Re-upload</b> opens the monthly workbook import with this report pre-selected; the workbook&apos;s rows update the existing ones by their references. A locked report is unlocked first (Admin) and should be locked again after the import. <b>Delete</b> removes the report, its issued snapshot and its checklist only; the live registers are not touched.
      </p>
    </div>
  );
}
