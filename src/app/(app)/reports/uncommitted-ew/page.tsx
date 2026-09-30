import Link from "next/link";
import { AlertTriangle, Lock, Unlock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listPeriods } from "@/lib/snapshots";
import { getReportData } from "@/lib/report/data";
import { buildUncommittedTable, type UncommittedRow } from "@/lib/report/uncommitted-ew";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { Chip } from "@/components/ui/Chip";

export const metadata = { title: "Uncommitted Costs and Early Warnings" };

const COLS: { key: keyof UncommittedRow; label: string; letter: string }[] = [
  { key: "budget", label: "Approved budget", letter: "G" },
  { key: "commitments", label: "Commitments", letter: "I" },
  { key: "voUnderProcess", label: "VOs under process", letter: "J" },
  { key: "eotClaims", label: "EOT claims", letter: "M" },
  { key: "otherClaims", label: "Other claims", letter: "M" },
  { key: "uncommittedScope", label: "Identified uncommitted scope", letter: "K" },
  { key: "plantSupply", label: "Plant supply", letter: "" },
  { key: "ffe", label: "FF&E", letter: "" },
  { key: "totalUncommitted", label: "Total uncommitted", letter: "" },
  { key: "notRequired", label: "Uncommitted / not required", letter: "G−I" },
  { key: "earlyWarnings", label: "Early warnings", letter: "L" },
  { key: "eac", label: "Estimate at completion", letter: "N" },
];

/**
 * The "Uncommitted Costs and Early Warnings" table for one report, in the programme-wide Level 5
 * layout: every cost report line of that report with its budget, commitments, the uncommitted amounts
 * by kind, the early warnings behind column L and the estimate at completion – read from that report's
 * own registers (the workbook's cost report, claims and Early Warning sheets), so a locked report shows
 * the figures it was issued with.
 */
export default async function UncommittedEwPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await getCurrentUser();
  const ctx = getAppContext();
  const { period: q } = await searchParams;
  const periods = listPeriods();
  const period = periods.find((p) => String(p.id) === q) ?? periods.find((p) => p.id === ctx.period?.id) ?? periods[0] ?? null;
  if (!ctx.programme || !period) {
    return (
      <div className="card flex items-center gap-2 p-5 text-sm text-muted">
        <AlertTriangle size={16} /> {ctx.programme ? "No reporting period exists yet." : "Select a project in the top bar first."}
      </div>
    );
  }
  const table = buildUncommittedTable(getReportData(ctx.programme.id, period.id));
  const money = (v: number) => (Math.abs(v) < 0.005 ? <span className="text-muted">–</span> : formatMoney(v));
  const withEws = table.rows.filter((r) => r.kind === "line" && r.ews.length);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${ctx.programme.code} · ${period.label}`}
        title="Uncommitted Costs and Early Warnings"
        subtitle="Every cost report line of this report with its budget, commitments, VOs under process, claims, uncommitted scope, early warnings and estimate at completion – the Level 5 layout, with the early warnings behind column L listed contract by contract."
        actions={<ExportButtons section="uncommitted_ew" params={`period=${period.id}`} title="Uncommitted Costs and Early Warnings" />}
      />

      <div className="card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Report</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {periods.map((p) => (
            <Link key={p.id} href={`/reports/uncommitted-ew?period=${p.id}`} className={`btn btn-sm ${p.id === period.id ? "btn-primary" : "btn-secondary"}`}>
              {p.status === "Locked" ? <Lock size={12} /> : <Unlock size={12} />} {p.label}
            </Link>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Chip tone={period.status === "Locked" ? "green" : "amber"}>{period.status === "Locked" ? "Issued (locked)" : "Draft – live data"}</Chip> cut-off {formatDate(period.period_end)} · {table.counts.lines} cost report lines · {table.counts.ews} early warnings ({table.counts.openEws} open)
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <div className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Uncommitted costs and early warnings – {period.label}</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Contract / line</th>
              <th className="px-3 py-2">Contractor</th>
              {COLS.map((c) => (
                <th key={c.key} className="px-2 py-2 text-right">
                  {c.label}
                  {c.letter && <span className="ml-1 font-normal opacity-60">({c.letter})</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={`${r.code}-${i}`} className={r.kind === "category" ? "border-t border-line bg-slate-100 font-semibold text-ink" : "border-t border-line"}>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px]">{r.kind === "category" ? "" : r.code}</td>
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="max-w-[16rem] truncate px-3 py-1.5 text-muted" title={r.contractor}>{r.contractor}</td>
                {COLS.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 text-right tnum ${c.key === "earlyWarnings" && r.earlyWarnings ? "font-semibold text-amber-700" : ""}`}>
                    {money(r[c.key] as number)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-navy bg-slate-50 font-semibold text-ink">
              <td className="px-3 py-2" colSpan={3}>
                {table.total.name}
              </td>
              {COLS.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-2 py-2 text-right tnum">
                  {money(table.total[c.key] as number)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card overflow-x-auto p-0">
        <div className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Early warnings behind column L – from the report&apos;s Early Warning sheet, each carried in the column its wording names</div>
        {withEws.length === 0 && table.unlinkedEws.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">No early warnings are recorded on this report.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                <th className="px-3 py-2">EW No</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Contractor</th>
                <th className="px-3 py-2">Raised</th>
                <th className="px-3 py-2">Likelihood</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Counted under</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {withEws.map((r) => (
                <EwGroup key={r.code} code={r.code} name={r.name} total={r.earlyWarnings} ews={r.ews} />
              ))}
              {table.unlinkedEws.length > 0 && <EwGroup code="" name="Not linked to a cost report line (not in column L)" total={0} ews={table.unlinkedEws} />}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EwGroup({ code, name, total, ews }: { code: string; name: string; total: number; ews: UncommittedRow["ews"] }) {
  return (
    <>
      <tr className="border-t border-line bg-slate-100 font-semibold text-ink">
        <td className="px-3 py-1.5" colSpan={7}>
          {code && <span className="mr-2 font-mono text-[11px] font-normal text-muted">{code}</span>}
          {name}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-right tnum" title="What stays under the early warnings column after the amounts carried in EOT claims, other claims, uncommitted scope, plant supply and FF&E">{Math.abs(total) < 0.005 ? "" : formatMoney(total)}</td>
      </tr>
      {ews.map((e, i) => (
        <tr key={`${e.ewNo}-${i}`} className="border-t border-line">
          <td className="whitespace-nowrap px-3 py-1.5">{e.ewNo}</td>
          <td className="max-w-[36rem] px-3 py-1.5">{e.description}</td>
          <td className="max-w-[14rem] truncate px-3 py-1.5 text-muted" title={e.contractor}>{e.contractor}</td>
          <td className="whitespace-nowrap px-3 py-1.5">{formatDate(e.raised)}</td>
          <td className="px-3 py-1.5">{e.likelihood}</td>
          <td className="px-3 py-1.5">
            <Chip tone={e.status === "Open" ? "amber" : "grey"}>{e.status || "–"}</Chip>
          </td>
          <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted">{e.bucketLabel}</td>
          <td className="whitespace-nowrap px-3 py-1.5 text-right tnum">{e.amount ? formatMoney(e.amount) : <span className="text-muted">–</span>}</td>
        </tr>
      ))}
    </>
  );
}
