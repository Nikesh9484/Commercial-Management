import { ChevronDown } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import type { AconexChangeCheck, AconexContractorBlock, AconexEventLine } from "@/lib/recovery/aconex-changes";

/**
 * The Aconex change events against the change register, contractor by contractor: one row per contractor
 * with the approved and pending values each system holds and the variance, and under it (opened with a
 * click) every event with its register entry, the two values and the difference.
 */
export function ChangeEventsCheck({ check }: { check: AconexChangeCheck }) {
  const money = (v: number | null | undefined) => (v === null || v === undefined ? "–" : formatMoney(v));
  const bad = (v: number) => Math.abs(v) >= check.counts.tolerance;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Events compared" value={String(check.counts.matched)} sub={`${check.counts.events} Aconex events · ${check.counts.changes} register entries with a PVO / RFC number${check.asOf ? ` · export uploaded ${formatDate(check.asOf)}` : ""}`} />
        <Stat label="Events with a difference" value={String(check.counts.differing)} sub={check.counts.differing ? "value or status differs – listed under each contractor" : "every matched event agrees"} tone={check.counts.differing ? "red" : "green"} />
        <Stat label="Approved changes – variance" value={formatMoney(check.totals.variance.approved)} sub={`Aconex ${formatMoney(check.totals.aconex.approved)} vs register ${formatMoney(check.totals.dashboard.approved)}`} tone={bad(check.totals.variance.approved) ? "amber" : "green"} />
        <Stat label="Only on one side" value={String(check.counts.aconexOnly + check.counts.dashboardOnly)} sub={`${check.counts.aconexOnly} only in Aconex · ${check.counts.dashboardOnly} only on the register`} tone={check.counts.aconexOnly + check.counts.dashboardOnly ? "amber" : "green"} />
      </div>
      <div className="card overflow-x-auto p-0">
        <div className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Contractor-wise variance – Aconex change events vs the change register (open a contractor for the breakdown)</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-4 py-2">Contractor</th>
              <th className="px-3 py-2 text-right">Approved – Aconex</th>
              <th className="px-3 py-2 text-right">Approved – register</th>
              <th className="px-3 py-2 text-right">Variance</th>
              <th className="px-3 py-2 text-right">Pending – Aconex</th>
              <th className="px-3 py-2 text-right">Pending – register</th>
              <th className="px-3 py-2 text-right">Variance</th>
              <th className="px-3 py-2 text-right">Transfers in – Aconex</th>
              <th className="px-3 py-2 text-right">Transfers in – register</th>
              <th className="px-3 py-2 text-right">Variance</th>
              <th className="px-3 py-2 text-right">Items</th>
            </tr>
          </thead>
          <tbody>
            {check.contractors.map((b) => (
              <ContractorRows key={b.contractor} b={b} money={money} bad={bad} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-slate-50 font-semibold text-ink">
              <td className="px-4 py-2">Total</td>
              <td className="px-3 py-2 text-right tnum">{money(check.totals.aconex.approved)}</td>
              <td className="px-3 py-2 text-right tnum">{money(check.totals.dashboard.approved)}</td>
              <td className={`px-3 py-2 text-right tnum ${bad(check.totals.variance.approved) ? "text-red-700" : "text-emerald-700"}`}>{money(check.totals.variance.approved)}</td>
              <td className="px-3 py-2 text-right tnum">{money(check.totals.aconex.pending)}</td>
              <td className="px-3 py-2 text-right tnum">{money(check.totals.dashboard.pending)}</td>
              <td className={`px-3 py-2 text-right tnum ${bad(check.totals.variance.pending) ? "text-red-700" : "text-emerald-700"}`}>{money(check.totals.variance.pending)}</td>
              <td className="px-3 py-2 text-right tnum">{money(check.totals.aconex.transfers)}</td>
              <td className="px-3 py-2 text-right tnum">{money(check.totals.dashboard.transfers)}</td>
              <td className={`px-3 py-2 text-right tnum ${bad(check.totals.variance.transfers) ? "text-amber-700" : "text-emerald-700"}`}>{money(check.totals.variance.transfers)}</td>
              <td className="px-3 py-2 text-right tnum">{check.totals.aconex.items} / {check.totals.dashboard.items}</td>
            </tr>
          </tfoot>
        </table>
        <div className="border-t border-line px-4 py-2 text-xs text-muted">
          Approved: the approved cost impact of Aconex events marked approved, against the register&apos;s changes with status Approved or Closed (the DVO value once there is one, else the PVO value). Pending: Aconex events in planning or potential, against the register&apos;s Pending, Review Complete and Revised entries. Transfers in: approved BTR events under the contractor&apos;s contracts, against the register&apos;s approved budget transfers into the contractor&apos;s packages – for information, the two systems log transfers differently. Differences under SAR {check.counts.tolerance} are rounding.
        </div>
      </div>
    </div>
  );
}

function ContractorRows({ b, money, bad }: { b: AconexContractorBlock; money: (v: number | null | undefined) => string; bad: (v: number) => boolean }) {
  const flagged = b.differing + b.onlyAconex + b.onlyDashboard;
  return (
    <>
      <tr className="border-t border-line align-top">
        <td className="px-4 py-2" colSpan={11}>
          <details className="group" open={flagged > 0 && b.lines.length <= 40}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex min-w-[18rem] items-center gap-1.5 font-medium text-ink">
                <ChevronDown size={14} className="text-muted transition group-open:rotate-180" /> {b.contractor}
                <span className="text-xs font-normal text-muted">{b.contracts.length ? `(${b.contracts.join(", ")})` : ""}</span>
              </span>
              <span className="text-xs text-muted">
                {b.differing ? <span className="mr-2 rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700">{b.differing} differ</span> : null}
                {b.onlyAconex ? <span className="mr-2 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{b.onlyAconex} only in Aconex</span> : null}
                {b.onlyDashboard ? <span className="mr-2 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{b.onlyDashboard} only on register</span> : null}
                {!flagged && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">agrees</span>}
              </span>
              <span className="ml-auto grid grid-cols-10 gap-x-3 text-right text-xs tnum">
                <Cell v={money(b.aconex.approved)} />
                <Cell v={money(b.dashboard.approved)} />
                <Cell v={money(b.variance.approved)} tone={bad(b.variance.approved) ? "red" : "green"} />
                <Cell v={money(b.aconex.pending)} />
                <Cell v={money(b.dashboard.pending)} />
                <Cell v={money(b.variance.pending)} tone={bad(b.variance.pending) ? "red" : "green"} />
                <Cell v={money(b.aconex.transfers)} />
                <Cell v={money(b.dashboard.transfers)} />
                <Cell v={money(b.variance.transfers)} tone={bad(b.variance.transfers) ? "amber" : "green"} />
                <Cell v={`${b.aconex.items} / ${b.dashboard.items}`} />
              </span>
            </summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] text-muted">
                    <th className="px-2 py-1.5">Aconex event</th>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Aconex status</th>
                    <th className="px-2 py-1.5 text-right">Aconex value</th>
                    <th className="px-2 py-1.5">Register entry</th>
                    <th className="px-2 py-1.5">Register status</th>
                    <th className="px-2 py-1.5 text-right">PVO value</th>
                    <th className="px-2 py-1.5 text-right">DVO value</th>
                    <th className="px-2 py-1.5 text-right">Difference</th>
                    <th className="px-2 py-1.5">Finding</th>
                  </tr>
                </thead>
                <tbody>
                  {b.lines.map((l, i) => (
                    <EventRow key={`${l.eventNo}-${l.changeItems.join("+")}-${i}`} l={l} money={money} />
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </td>
      </tr>
    </>
  );
}

function Cell({ v, tone }: { v: string; tone?: "red" | "green" | "amber" }) {
  const cls = tone === "red" ? "font-semibold text-red-700" : tone === "amber" ? "font-semibold text-amber-700" : tone === "green" ? "text-emerald-700" : "text-muted";
  return <span className={`min-w-[6.5rem] ${cls}`}>{v}</span>;
}

function EventRow({ l, money }: { l: AconexEventLine; money: (v: number | null | undefined) => string }) {
  const tone = l.status !== "matched" ? "text-amber-700" : l.differs ? "text-red-700" : "text-emerald-700";
  const finding = l.status === "aconex_only" ? (l.kind === "BTR" ? "transfer" : "only in Aconex") : l.status === "dashboard_only" ? "only on register" : l.differs ? "differs" : "agrees";
  return (
    <tr className="border-t border-line">
      <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px]">{l.eventNo || "–"}</td>
      <td className="max-w-[20rem] truncate px-2 py-1" title={l.name}>
        {l.name}
      </td>
      <td className="px-2 py-1 text-muted">{l.aconexStatus || "–"}</td>
      <td className="px-2 py-1 text-right tnum">{money(l.aconexValue)}</td>
      <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px]">{l.changeItems.join(" + ") || "–"}</td>
      <td className="px-2 py-1 text-muted">{l.changeStatus || "–"}</td>
      <td className="px-2 py-1 text-right tnum text-muted">{money(l.dashboardPvo)}</td>
      <td className="px-2 py-1 text-right tnum text-muted">{money(l.dashboardDvo)}</td>
      <td className={`px-2 py-1 text-right tnum ${l.differs ? "font-semibold text-red-700" : ""}`}>{money(l.diff)}</td>
      <td className={`max-w-[22rem] px-2 py-1 ${tone}`}>
        <span className="font-medium">{finding}</span>
        {l.note && <span className="text-muted"> – {l.note}</span>}
      </td>
    </tr>
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
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
