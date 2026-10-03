import Link from "next/link";
import { FileText } from "lucide-react";
import type { ReportData } from "@/lib/report/data";
import { buildBudgetEac, level02Table, LEVEL02_MONEY, EAC_COLUMNS, type Level02Row } from "@/lib/report/budget-eac";
import { formatMoney } from "@/lib/format";

/**
 * Cost Report – Level 02 (R1): the head office "Budget EAC" layout (Peter Ayliffe's consolidated
 * Uncommitted Costs and Early Warnings format), filled from this report's own registers – the same
 * rows and arithmetic as the Level 02 tab of the Budget EAC workbook on the Reports page.
 */
export function CostReportTabs({ active }: { active: string }) {
  const tabs: [string, string][] = [
    ["level1", "Level 1 – Executive"],
    ["level2", "Level 2 – Detailed"],
    ["level02r1", "Level 02 (R1)"],
    ["setup", "Line setup"],
  ];
  return (
    <div className="flex gap-1 border-b border-line">
      {tabs.map(([k, label]) => (
        <Link key={k} href={`/modules/cost-report?tab=${k}`} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active === k ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"}`}>
          {label}
        </Link>
      ))}
    </div>
  );
}

const money = (v: number) => (Math.abs(v) < 0.005 ? "-" : formatMoney(v));

export function Level02R1View({ data }: { data: ReportData }) {
  const e = buildBudgetEac(data);
  const t = level02Table(e);
  const ho = LEVEL02_MONEY.filter((c) => c.group === "ho");
  const site = LEVEL02_MONEY.filter((c) => c.group === "site" && c.key !== "totalUse");
  const cell = (r: Level02Row, key: (typeof LEVEL02_MONEY)[number]["key"]) => (
    <td key={key} className={`tnum text-right ${key === "variance" && r[key] > 0.005 ? "text-red-700" : ""}`}>
      {money(r[key])}
    </td>
  );
  const rowCls = (r: Level02Row) => (r.kind === "subtotal" ? "bg-amber-50 font-semibold text-amber-900" : r.kind === "total" ? "bg-slate-100 font-semibold text-navy" : r.isHold ? "text-muted" : "");
  const put = (r: Level02Row) => (
    <tr key={`${r.kind}-${r.asset}-${r.contractCode}-${r.name}`} className={rowCls(r)}>
      <td className="sticky left-0 z-[1] bg-inherit whitespace-nowrap">{r.kind === "line" ? r.asset : r.kind === "subtotal" ? "Sub-Total" : ""}</td>
      <td className="whitespace-nowrap">{r.kind === "line" ? r.subCategory : r.kind === "subtotal" ? r.asset : ""}</td>
      <td className="whitespace-nowrap font-semibold">{r.contractCode}</td>
      <td className="min-w-[260px]">{r.name}</td>
      {ho.map((c) => cell(r, c.key))}
      {site.map((c) => cell(r, c.key))}
      {EAC_COLUMNS.map((c) => (
        <td key={c.key} className="tnum text-right">
          {money(r.use[c.key])}
        </td>
      ))}
      {cell(r, "totalUse")}
    </tr>
  );
  return (
    <div className="space-y-4">
      <CostReportTabs active="level02r1" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-xs text-muted">
          {e.month} · {e.periodLabel} · {t.rows.filter((r) => r.kind === "line").length} line(s) in {e.assets.length} asset(s) · the Level 02 tab of the head office &quot;Programme XX Budget EAC&quot; workbook, filled from this report&apos;s registers
        </span>
        <Link className="btn btn-sm btn-secondary" href="/reports">
          <FileText size={14} /> Full Budget EAC workbook (Reports page)
        </Link>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data w-full text-xs">
            <thead>
              <tr className="text-[11px]">
                <th colSpan={4} />
                <th colSpan={ho.length} className="bg-yellow-100 text-center">
                  As per Head Office Cost Report
                </th>
                <th colSpan={site.length} className="bg-sky-100 text-center">
                  Site forecast
                </th>
                <th colSpan={EAC_COLUMNS.length + 1} className="bg-emerald-50 text-center">
                  Early warnings (known but not committed) – how the uncommitted budget is used
                </th>
              </tr>
              <tr>
                <th className="sticky left-0 z-[2] bg-[#f7f8fb]">Asset</th>
                <th>Sub-category</th>
                <th>Contract Code</th>
                <th>Name</th>
                {ho.map((c) => (
                  <th key={c.key} className="text-right">
                    {c.label}
                  </th>
                ))}
                {site.map((c) => (
                  <th key={c.key} className="text-right">
                    {c.label}
                  </th>
                ))}
                {EAC_COLUMNS.map((c) => (
                  <th key={c.key} className="text-right">
                    {c.label}
                  </th>
                ))}
                <th className="text-right">Total Uncommitted Utilisation</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map(put)}
              {put(t.total)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card p-4 text-xs text-muted">
        <div className="mb-1 font-semibold text-ink">How the figures are filled</div>
        <ul className="list-disc space-y-1 pl-5">
          {e.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            The sheet&apos;s own arithmetic is kept: Committed = Contracts + DVO&apos;s, Uncommitted = budget − committed, Early Warnings = −(utilisation except not required), Budget to Release = −(not required), Final Account = Committed + Uncommitted + PVO&apos;s + Early Warnings + Budget to Release, Variance = Final Account − budget.
          </li>
          <li>Download it as PDF or Excel with the buttons above; the Reports page has the full six-tab workbook with the DVO and PVO schedules and the early warning breakdown.</li>
        </ul>
      </div>
    </div>
  );
}
