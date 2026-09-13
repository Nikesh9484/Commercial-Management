import Link from "next/link";
import { AlertTriangle, FileText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { recordsForView } from "@/lib/view-mode";
import { getChangeSummary, MATRIX_STATUSES } from "@/lib/changes/summary";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { RegisterPage } from "@/components/register/RegisterPage";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { SeverityBars } from "@/components/charts/SeverityBars";
import { HorizontalBars } from "@/components/charts/HorizontalBars";

export const metadata = { title: "Change Management Tracker" };

export default async function ChangeManagementPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("change-management")!;
  const ctx = getAppContext();
  const summary = ctx.programme ? getChangeSummary(ctx.programme.id) : null;

  // ageing and category breakdown for the open changes, computed from the same rows the table shows
  const changeRows = ctx.programme ? recordsForView(getRegisterDef("changes")!) : [];
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
  const CLOSED = ["Approved", "Rejected", "Cancelled", "Superseded", "Transferred", "Review Complete"];
  const openChangeRows = changeRows.filter((r) => r.dvo_closed !== true && !CLOSED.includes(String(r.overall_status_id__label ?? "")));
  const stageAmount = (r: (typeof changeRows)[number]) => {
    const stage = String(r.current_stage ?? "");
    const prefix = stage === "DVO" || stage === "Funding" ? "dvo" : stage === "VO" || stage === "EI" ? "vo" : stage === "PVO" ? "pvo" : stage === "RFC" ? "rfc" : null;
    if (!prefix) return 0;
    const v = r[`${prefix}_cr_amount`];
    return Math.abs(v === null || v === undefined ? num(r[`${prefix}_tracker_amount`]) : num(v));
  };
  const ageBuckets: [string, number, number][] = [
    ["Under 30 days", 0, 30],
    ["30 to 60 days", 31, 60],
    ["60 to 90 days", 61, 90],
    ["Over 90 days", 91, Infinity],
  ];
  const changeAgeing = ageBuckets.map(([bucket, lo, hi]) => {
    const inBand = openChangeRows.filter((r) => { const d = num(r.days_open); return d >= lo && d <= hi; });
    return { bucket, n: inBand.length, value: Math.round(inBand.reduce((t, r) => t + stageAmount(r), 0)) };
  });
  const catMap = new Map<string, number>();
  for (const r of openChangeRows) {
    const k = String(r.change_category_id__label ?? "(no category)");
    catMap.set(k, (catMap.get(k) ?? 0) + stageAmount(r));
  }
  const changeByCategory = [...catMap.entries()].map(([label, value]) => ({ label, value: Math.round(value) })).sort((a, b) => b.value - a.value).slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader
        exportSection="changes"
        eyebrow={`Module ${mod.no}`}
        title={mod.title}
        subtitle="Every change in one record, followed from Early Warning → RFC → PVO → VO → EI → DVO → Funding. Approved DVOs, live PVO / VOs and RFCs feed the cost report automatically."
        actions={
          ctx.programme ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1 shadow-sm" title="Executive change management report for the month: stage-by-stage value, ageing, narrative and actions">
              <FileText size={14} className="text-navy" />
              <ExportButtons section="changes_report" label="Change status report" />
            </span>
          ) : undefined
        }
      />

      {summary && ctx.programme && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Changes" value={String(summary.changes)} sub={`${summary.open} open`} />
            <Stat
              label="Pending over 30 / 60 days"
              value={`${summary.overdue30} / ${summary.overdue60}`}
              sub="open items by days since raised"
              tone={summary.overdue60 > 0 ? "red" : summary.overdue30 > 0 ? "amber" : "green"}
            />
            <Stat label="Cost report – DVO (H)" value={formatMoney(summary.costReport.dvo)} sub={`PVO / VO (J) ${formatMoney(summary.costReport.pvo)}`} />
            <Stat
              label="Cost report – RFC (K)"
              value={formatMoney(summary.costReport.rfc)}
              sub={summary.costReport.unlinked > 0 ? `${summary.costReport.unlinked} change(s) not linked to a cost line` : "all changes linked to a cost line"}
              tone={summary.costReport.unlinked > 0 ? "amber" : undefined}
            />
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
              <h2 className="text-sm font-semibold text-ink">Status matrix</h2>
              <span className="text-xs text-muted">Number of changes at each stage by that stage&apos;s status</span>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-3">
              <table className="data w-full">
                <thead>
                  <tr>
                    <th>Stage</th>
                    {MATRIX_STATUSES.map((s) => (
                      <th key={s} className="text-right">
                        {s}
                      </th>
                    ))}
                    <th className="text-right">Other</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.matrix.map((m) => (
                    <tr key={m.stage}>
                      <td className="font-medium">{m.stage}</td>
                      {MATRIX_STATUSES.map((s) => (
                        <td key={s} className={`tnum text-right ${m.counts[s] === 0 ? "text-muted/60" : ""}`}>
                          {m.counts[s]}
                        </td>
                      ))}
                      <td className={`tnum text-right ${m.other === 0 ? "text-muted/60" : ""}`} title="Rejected, Revised & Re-submit">
                        {m.other}
                      </td>
                      <td className="tnum text-right font-semibold">{m.total}</td>
                    </tr>
                  ))}
                  <tr className="bg-page font-semibold">
                    <td>Total</td>
                    {MATRIX_STATUSES.map((s) => (
                      <td key={s} className="tnum text-right">
                        {summary.columnTotals[s]}
                      </td>
                    ))}
                    <td className="tnum text-right">{summary.otherTotal}</td>
                    <td className="tnum text-right">{summary.grandTotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="mb-1 text-sm font-semibold text-ink">Ageing of open changes</h2>
              <p className="mb-3 text-xs text-muted">Days since raised. Colour runs from good to critical with the age band, not the change itself.</p>
              <SeverityBars rows={changeAgeing} valueLabel="value at current stage" />
            </div>
            <div className="card p-5">
              <h2 className="mb-1 text-sm font-semibold text-ink">Open value by category</h2>
              <p className="mb-3 text-xs text-muted">Cost-report value of open changes, grouped by change category.</p>
              <HorizontalBars rows={changeByCategory} valueLabel="open value" />
            </div>
          </div>
        </>
      )}

      {ctx.programme ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Chip tone="amber">Days open &gt; 30</Chip>
            <Chip tone="red">Days open &gt; 60</Chip>
            <span>
              Highlighting applies to open changes only. Link each change to its{" "}
              <Link href="/modules/cost-report" className="text-accent hover:underline">
                cost report line
              </Link>{" "}
              so its value flows into columns H, J and K.
            </span>
          </div>
          <RegisterPage registerKey="changes" isAdmin={user.role === "admin"} />
        </section>
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "red" | "amber" | "green" }) {
  const cls = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-ink";
  return (
    <div className="card min-w-0 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 truncate text-lg font-semibold tnum ${cls}`} title={value}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
