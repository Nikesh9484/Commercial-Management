import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { listPeriods } from "@/lib/snapshots";
import { getChecklist } from "@/lib/checklist";
import { REPORT_SCHEDULES } from "@/lib/report/schedules";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReportGenerator } from "@/components/report/ReportGenerator";
import { FileUp, CalendarPlus } from "lucide-react";

export const metadata = { title: "Monthly Report" };

export default async function MonthlyReportPage() {
  const mod = getModule("monthly-report")!;
  const ctx = getAppContext();
  const periods = listPeriods().map((p) => ({ id: p.id, label: p.label, status: p.status, locked_at: p.locked_at }));
  const checklist = ctx.period ? getChecklist(ctx.period.id) : [];
  const p = ctx.period as unknown as Record<string, string | null> | null;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`Module ${mod.no}`} title="Generate Monthly Report" subtitle="Cover, index, minutes of meeting, executive summary and Schedules A to J as PDF or Excel, built from the locked snapshot of the chosen period." />
      {ctx.programme ? (
        <>
          <ReportGenerator periods={periods} currentId={ctx.period?.id ?? null} />
          <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Have the month in Excel already?</h2>
              <p className="text-xs text-muted">Upload your existing monthly report workbook and the app records it against a period. Import past months in order to build the history, then each new month shows its movement.</p>
            </div>
            <Link href="/imports/monthly" className="btn btn-primary shrink-0">
              <FileUp size={16} /> Import monthly workbook
            </Link>
          </div>
          <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Or enter the month by hand</h2>
              <p className="text-xs text-muted">Start the next report number, type the month&apos;s changes, IPCs, claims and so on into the modules, then lock and issue. Same reports, no Excel needed.</p>
            </div>
            <Link href="/modules/monthly-report/new" className="btn btn-secondary shrink-0">
              <CalendarPlus size={16} /> New month (manual entry)
            </Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="mb-2 text-sm font-semibold text-ink">Contents</h2>
              <ol className="space-y-1 text-sm">
                <li className="text-muted">Cover page with project particulars and the Prepared / Reviewed / Approved block</li>
                <li className="text-muted">Index with checklist status and distribution list</li>
                <li className="text-muted">Minutes of Meeting for the period (carried-forward and new items)</li>
                <li className="text-muted">Executive Summary: KPIs, open items, key issues, actions, cost chart</li>
                {REPORT_SCHEDULES.map((s) => {
                  const c = checklist.find((x) => x.module_no === s.moduleNo);
                  return (
                    <li key={s.letter} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 whitespace-nowrap font-semibold text-navy">Schedule {s.letter}</span>
                      <span className="flex-1 text-ink">{s.title}</span>
                      {c && (c.done ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Circle size={14} className="text-red-500" />)}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-xs text-muted">
                Ticks show the report checklist on{" "}
                <Link href="/modules/project-setup" className="text-accent hover:underline">
                  Project Setup
                </Link>{" "}
                for the current period. The schedule order and letters live in one list in the code, so they can be changed to match your workbook exactly.
              </p>
            </div>
            <div className="card p-5">
              <h2 className="mb-2 text-sm font-semibold text-ink">Sign-off block (current period)</h2>
              {p ? (
                <dl className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["Prepared by", p.prepared_by, p.prepared_date],
                      ["Reviewed by", p.reviewed_by, p.reviewed_date],
                      ["Approved by", p.approved_by, p.approved_date],
                    ] as [string, string | null, string | null][]
                  ).map(([k, n, d]) => (
                    <div key={k} className="rounded-lg border border-line bg-page p-3">
                      <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
                      <dd className="text-sm font-medium text-ink">{n || "—"}</dd>
                      <dd className="text-xs text-muted">{d ? formatDate(d) : "no date"}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted">No reporting period selected.</p>
              )}
              <p className="mt-3 text-xs text-muted">
                Fill these in on{" "}
                <Link href="/modules/project-setup" className="text-accent hover:underline">
                  Project Setup → Report control
                </Link>
                . Aconex reference and key issues come from the same place.
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      )}
    </div>
  );
}
