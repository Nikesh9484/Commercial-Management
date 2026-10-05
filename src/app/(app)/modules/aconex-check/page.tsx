import Link from "next/link";
import { AlertTriangle, Upload } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getReportData } from "@/lib/report/data";
import { buildAconexReconciliation, ACONEX_MEASURES, measureDecides, type AconexLine } from "@/lib/recovery/aconex";

// the line-by-line table compares like for like; RSG's own early-warning columns are on the totals table, on request
const LINE_MEASURES = ACONEX_MEASURES.filter((m) => m.key !== "ew" && m.key !== "eac_rsg" && m.key !== "hold");
import { buildAconexChangeCheck } from "@/lib/recovery/aconex-changes";
import { ChangeEventsCheck } from "@/components/aconex/ChangeEventsCheck";
import { TotalsTable } from "@/components/aconex/TotalsTable";
import { varianceDetail } from "@/lib/recovery/aconex-detail";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterPage } from "@/components/register/RegisterPage";

export const metadata = { title: "Aconex Cost Check" };

/**
 * Module 14 – the Aconex control account export reconciled against the dashboard's cost report:
 * budget, commitments, changes and estimate at completion per contract, with every difference listed.
 */
export default async function AconexCheckPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = (await getCurrentUser())!;
  const mod = getModule("aconex-check")!;
  const ctx = getAppContext();
  const { tab } = await searchParams;
  const canImport = user.role === "admin" || user.role === "editor";
  if (!ctx.programme || !ctx.period) {
    return (
      <div>
        <PageHeader eyebrow={`Module ${mod.no}`} title={mod.title} />
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> {ctx.programme ? "Choose a reporting period in the top bar first." : "Select a programme in the top bar first."}
        </div>
      </div>
    );
  }
  const reportData = getReportData(ctx.programme.id, ctx.period.id);
  const rec = buildAconexReconciliation(reportData);
  const events = buildAconexChangeCheck(reportData);
  const money = (v: number | null) => (v === null ? "–" : formatMoney(v));
  const showAll = tab === "all";
  const listed = showAll ? rec.lines : [...rec.discrepancies, ...rec.aconexOnly, ...rec.dashboardOnly];

  return (
    <div className="space-y-5">
      <PageHeader
        exportSection="aconex_report"
        eyebrow={`Module ${mod.no}`}
        title={mod.title}
        subtitle={`Every contract and budget hold in the Aconex control account export set against its cost report line in ${ctx.period.label}. A contract differs when its commitments, estimate at completion or incurred to date disagree; a budget hold when its budget or estimate at completion does. Approved budget, DVOs and PVOs on a contract are shown for information, because the two systems hold them on different bases. Differences under SAR ${rec.counts.tolerance} are rounding.`}
        actions={
          canImport ? (
            <Link href="/imports/aconex" className="btn btn-sm btn-secondary">
              <Upload size={14} /> Upload Aconex export
            </Link>
          ) : undefined
        }
      />
      <h2 className="text-base font-semibold text-ink">1. Control accounts – budget, commitments and estimate at completion per contract</h2>
      {rec.counts.aconex === 0 ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-muted">
          <span>No Aconex control account export has been uploaded for this project yet. Upload the export (one file per project) and the check appears here.</span>
          {canImport && (
            <Link href="/imports/aconex" className="btn btn-sm btn-primary">
              <Upload size={14} /> Upload
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Lines compared" value={String(rec.counts.matched)} sub={`${rec.counts.aconex} Aconex rows · ${rec.counts.dashboard} cost report lines${rec.asOf ? ` · export uploaded ${formatDate(rec.asOf)}` : ""}`} />
            <Stat label="Lines with a difference" value={String(rec.counts.differing)} sub={rec.counts.differing ? "largest first below" : "every compared figure agrees"} tone={rec.counts.differing ? "red" : "green"} />
            <Stat label="Estimate at completion – difference" value={formatMoney(rec.totals.diff.eac)} sub={`Aconex ${formatMoney(rec.totals.aconex.eac)} vs dashboard ${formatMoney(rec.totals.dashboard.eac)}`} tone={Math.abs(rec.totals.diff.eac) >= rec.counts.tolerance ? "amber" : "green"} />
            <Stat label="Only on one side" value={String(rec.aconexOnly.length + rec.dashboardOnly.length)} sub={`${rec.aconexOnly.length} only in Aconex · ${rec.dashboardOnly.length} only on the dashboard`} tone={rec.aconexOnly.length + rec.dashboardOnly.length ? "amber" : "green"} />
          </div>

          <TotalsTable rec={rec} detail={varianceDetail(reportData, rec)} />

          <div className="flex flex-wrap items-center gap-2">
            <Link href="/modules/aconex-check" className={`btn btn-sm ${showAll ? "btn-secondary" : "btn-primary"}`}>
              Discrepancies only <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[11px]">{rec.discrepancies.length + rec.aconexOnly.length + rec.dashboardOnly.length}</span>
            </Link>
            <Link href="/modules/aconex-check?tab=all" className={`btn btn-sm ${showAll ? "btn-primary" : "btn-secondary"}`}>
              Every line <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[11px]">{rec.lines.length}</span>
            </Link>
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full whitespace-nowrap text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="px-2 py-2">Line</th>
                  <th className="px-2 py-2">Contractor</th>
                  <th className="px-2 py-2">Status</th>
                  {LINE_MEASURES.map((m) => (
                    <th key={m.key} className="px-2 py-2 text-right" colSpan={3}>
                      {m.label}
                    </th>
                  ))}
                </tr>
                <tr className="text-left text-[10px] text-muted">
                  <th colSpan={3} />
                  {LINE_MEASURES.map((m) => (
                    <th key={`${m.key}-sub`} className="px-2 py-1 text-right" colSpan={3}>
                      Aconex · dashboard · difference
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listed.length === 0 && (
                  <tr>
                    <td className="px-4 py-3 text-sm text-emerald-700" colSpan={3 + LINE_MEASURES.length * 3}>
                      Every compared figure agrees with the dashboard within SAR {rec.counts.tolerance}.
                    </td>
                  </tr>
                )}
                {listed.map((l) => (
                  <LineRow key={`${l.status}-${l.code}-${l.aconexCode}`} l={l} tolerance={rec.counts.tolerance} money={money} />
                ))}
              </tbody>
            </table>
          </div>

          <RegisterPage registerKey="aconex_control_accounts" isAdmin={user.role === "admin"} />
        </>
      )}

      <h2 className="pt-2 text-base font-semibold text-ink">2. Change events – PVOs, RFCs and budget transfers against the change register, contractor by contractor</h2>
      {events.counts.events === 0 ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-muted">
          <span>No Aconex change-event export has been uploaded for this project yet. Upload it on the same import page and the contractor-wise variance appears here.</span>
          {canImport && (
            <Link href="/imports/aconex" className="btn btn-sm btn-primary">
              <Upload size={14} /> Upload
            </Link>
          )}
        </div>
      ) : (
        <>
          <ChangeEventsCheck check={events} />
          <RegisterPage registerKey="aconex_change_events" isAdmin={user.role === "admin"} />
        </>
      )}
    </div>
  );
}

function LineRow({ l, tolerance, money }: { l: AconexLine; tolerance: number; money: (v: number | null) => string }) {
  const status = l.status === "matched" ? (l.differs.length ? "differs" : "agrees") : l.status === "aconex_only" ? "only in Aconex" : "only on dashboard";
  const tone = l.status !== "matched" ? "text-amber-700" : l.differs.length ? "text-red-700" : "text-emerald-700";
  return (
    <tr className="border-t border-line">
      <td className="max-w-[22rem] truncate px-2 py-1" title={`${l.code || l.aconexCode} – ${l.name}`}>
        <span className="font-mono text-[11px]">{l.code || l.aconexCode}</span> <span className="text-muted">{l.name}</span>
      </td>
      <td className="max-w-[12rem] truncate px-2 py-1 text-muted">{l.contractor}</td>
      <td className={`px-2 py-1 font-medium ${tone}`}>{status}</td>
      {LINE_MEASURES.map((m) => {
        const d = l.diff[m.key];
        const bad = d !== null && Math.abs(d) >= tolerance && l.status === "matched" && measureDecides(m, l.rowType);
        return (
          <FragmentCells key={m.key} a={money(l.aconex[m.key])} b={money(l.dashboard[m.key])} d={money(d)} bad={bad} />
        );
      })}
    </tr>
  );
}

function FragmentCells({ a, b, d, bad }: { a: string; b: string; d: string; bad: boolean }) {
  return (
    <>
      <td className="px-2 py-1 text-right tnum text-muted">{a}</td>
      <td className="px-2 py-1 text-right tnum text-muted">{b}</td>
      <td className={`px-2 py-1 text-right tnum ${bad ? "font-semibold text-red-700" : ""}`}>{d}</td>
    </>
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
