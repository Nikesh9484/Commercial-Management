"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, CheckCircle2, Circle, ArrowRight, Lock, FolderDown, LayoutDashboard, PencilLine } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import type { ChecklistItem } from "@/lib/checklist";
import type { PeriodProposal } from "@/lib/month";

export interface StepView {
  module_no: number;
  title: string;
  href: string;
  what: string;
  feeds?: string;
  activity: number;
}

export function NewMonthWizard({
  proposal,
  current,
  steps,
  checklist,
  checkOk,
  isAdmin,
  canEdit,
}: {
  proposal: PeriodProposal;
  current: { id: number; label: string; status: string; period_end: string } | null;
  steps: StepView[];
  checklist: ChecklistItem[];
  checkOk: boolean;
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [reportNo, setReportNo] = useState(String(proposal.report_no));
  const [periodEnd, setPeriodEnd] = useState(proposal.period_end);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState(checklist);
  const working = current && current.status === "Open" ? current : null;
  const done = items.filter((i) => i.done).length;

  async function start() {
    setBusy(true);
    const r = await fetch("/api/periods/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report_no: Number(reportNo), period_end: periodEnd }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? "Could not start the month.", "error");
    toast(`${j.period.label} started. It is now the current period.`);
    router.refresh();
  }

  async function tick(item: ChecklistItem, value: boolean) {
    const r = await fetch(`/api/checklist/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error ?? "Could not update.", "error");
    setItems((list) => list.map((x) => (x.id === item.id ? j.item : x)));
  }

  async function lock() {
    if (!working) return;
    if (!confirm(`Lock and issue ${working.label}? The figures are frozen as the issued report and every module becomes read-only for that month.`)) return;
    setBusy(true);
    const r = await fetch(`/api/periods/${working.id}/lock`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(j.error ?? "Could not lock the period.", "error");
    toast(`${working.label} locked and issued.`);
    router.push("/reports");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* Step 1 */}
      <div className="card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-navy text-xs text-white">1</span> Start the month
        </h2>
        {working ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Chip tone="amber">Open</Chip>
            <span>
              You are working on <b>{working.label}</b> (cut-off {working.period_end}). Everything you type in the modules below belongs to this report.
            </span>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">
              {proposal.previous ? `The last report is ${proposal.previous.label} (${proposal.previous.status.toLowerCase()}). ` : "No reporting period exists yet. "}
              The next one is proposed below; change the number or the cut-off date if needed, then press Start. Nothing is imported: the cost report lines, contracts and open items carry forward, and you update them by hand.
            </p>
            <div className="grid gap-3 sm:grid-cols-[8rem_12rem_auto] sm:items-end">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Report No
                <input className="input" inputMode="numeric" value={reportNo} onChange={(e) => setReportNo(e.target.value.replace(/\D/g, ""))} disabled={!canEdit} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Cut-off date (month end)
                <input type="date" className="input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={!canEdit} />
              </label>
              <button className="btn btn-primary" onClick={start} disabled={busy || !canEdit || !reportNo || !periodEnd}>
                <CalendarPlus size={16} /> {busy ? "Starting…" : `Start Report No ${reportNo || "?"}`}
              </button>
            </div>
            {!canEdit && <p className="mt-2 text-xs text-muted">Only Editors and Admins can start a month.</p>}
          </>
        )}
      </div>

      {/* Step 2 */}
      <div className={`card p-5 ${working ? "" : "opacity-60"}`}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-navy text-xs text-white">2</span> Enter the month, module by module
          </h2>
          <Chip tone={done === items.length && items.length > 0 ? "green" : done > 0 ? "amber" : "grey"}>
            {done} of {items.length} ticked
          </Chip>
        </div>
        <p className="mb-3 text-xs text-muted">Open each module with its arrow, add or update the rows, come back and tick it. The &quot;this month&quot; count shows rows added or changed since the period started. The cost report columns each step feeds are shown on the right.</p>
        <ul className="divide-y divide-line">
          {steps.map((s) => {
            const item = items.find((i) => i.module_no === s.module_no);
            return (
              <li key={s.module_no} className="flex flex-wrap items-center gap-3 py-2.5">
                <button type="button" className="shrink-0" onClick={() => item && working && canEdit && tick(item, !item.done)} disabled={!item || !working || !canEdit} title={item?.done ? "Ticked – click to untick" : "Click when this module is complete for the month"}>
                  {item?.done ? <CheckCircle2 size={22} className="text-emerald-600" /> : <Circle size={22} className="text-slate-300" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-medium ${item?.done ? "text-muted line-through" : "text-ink"}`}>{s.title}</span>
                    {s.feeds && <Chip tone="blue">column {s.feeds}</Chip>}
                    {working && <Chip tone={s.activity ? "green" : "grey"}>{s.activity} this month</Chip>}
                  </div>
                  <div className="text-xs text-muted">{s.what}</div>
                </div>
                <Link href={s.href} className="btn btn-secondary btn-sm shrink-0">
                  <PencilLine size={14} /> Open <ArrowRight size={14} />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Step 3 */}
      <div className={`card p-5 ${working ? "" : "opacity-60"}`}>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-navy text-xs text-white">3</span> Review, then lock and issue
        </h2>
        <p className="mb-3 text-xs text-muted">Check the Executive Summary and the movement since last month. When the figures are right, an Admin locks the period: the report is frozen as issued, and all the PDF, Excel and email outputs are produced from it, exactly as for an imported month.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/" className="btn btn-secondary btn-sm">
            <LayoutDashboard size={14} /> Executive Summary
          </Link>
          <Link href="/modules/cost-report?tab=level1" className="btn btn-secondary btn-sm">
            Level 1 <ArrowRight size={14} />
          </Link>
          <Chip tone={checkOk ? "green" : "red"}>L1 − L2 check {checkOk ? "OK" : "FAILED"}</Chip>
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={lock} disabled={busy || !working}>
              <Lock size={14} /> Lock &amp; issue {working ? working.label.replace("Monthly Report ", "") : ""}
            </button>
          )}
          <Link href="/reports" className="btn btn-secondary btn-sm">
            <FolderDown size={14} /> Reports &amp; downloads
          </Link>
        </div>
        {!isAdmin && <p className="mt-2 text-xs text-muted">Locking is done by an Admin.</p>}
      </div>
    </div>
  );
}
