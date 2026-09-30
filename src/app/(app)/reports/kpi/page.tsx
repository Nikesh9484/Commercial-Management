import Link from "next/link";
import { AlertTriangle, FileSpreadsheet, Lock, Unlock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listPeriods } from "@/lib/snapshots";
import { loadKpi } from "@/lib/kpi/load";
import { defaultPackName } from "@/lib/kpi/model";
import { canManageKpi, listKpiDocs, listKpiItemDetails } from "@/lib/kpi/store";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { KpiWorkspace, type KpiRow } from "@/components/kpi/KpiWorkspace";

export const metadata = { title: "KPI Report – F1 Variation Orders" };

/**
 * The monthly Commercial KPI (F1 – VOs) for one report: Closed KPIs (DVO recorded as Approved) and
 * Open KPIs (PVO or VO recorded, DVO pending), each compared with the previous report, with the
 * supporting documents uploaded against it and its PDF pack made in one click.
 */
export default async function KpiPage({ searchParams }: { searchParams: Promise<{ period?: string; tab?: string }> }) {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const { period: q, tab: tabParam } = await searchParams;
  const periods = listPeriods();
  const period = periods.find((p) => String(p.id) === q) ?? periods.find((p) => p.id === ctx.period?.id) ?? periods[0] ?? null;
  if (!ctx.programme || !period) {
    return (
      <div className="card flex items-center gap-2 p-5 text-sm text-muted">
        <AlertTriangle size={16} /> {ctx.programme ? "No reporting period exists yet." : "Select a project in the top bar first."}
      </div>
    );
  }
  const tab = tabParam === "open" ? "open" : "closed";
  const { kpi } = loadKpi(ctx.programme.id, period.id);
  const ids = kpi.items.map((i) => i.changeId);
  const details = listKpiItemDetails(ids);
  const docs = listKpiDocs(ids);
  const toRow = (it: (typeof kpi.items)[number]): KpiRow => {
    const det = details.get(it.changeId);
    return { item: it, sn: det?.sn ?? "", fileName: det?.file_name ?? "", rootCause: det?.root_cause ?? "", remarks: det?.remarks ?? "", defaultFileName: defaultPackName(it, det?.sn ?? ""), docs: docs.filter((d) => d.change_id === it.changeId) };
  };
  const rows = (tab === "closed" ? kpi.closed : kpi.open).map(toRow);
  const earlier = tab === "closed" ? kpi.closedEarlier.map(toRow) : [];
  const excelHref = `/api/export?section=kpi_register&format=xlsx&period=${period.id}`;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${ctx.programme.code} · ${period.label}`}
        title="KPI Report – F1 Variation Orders"
        subtitle="The head office's monthly KPI on variation orders: a Closed KPI is a change whose DVO is recorded as Approved on this report; an Open KPI is one with a PVO or VO recorded and the DVO still pending. Each entry shows its movement since the previous report, holds its supporting documents and makes its PDF pack in one click."
        actions={
          <a className="btn btn-sm btn-excel" href={excelHref} title="The F1 Open VO Register rows for this report, in the head office layout, with a sheet of what moved">
            <FileSpreadsheet size={14} /> KPI Excel (Open VO Register)
          </a>
        }
      />

      <div className="card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Report</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {periods.map((p) => (
            <Link key={p.id} href={`/reports/kpi?period=${p.id}&tab=${tab}`} className={`btn btn-sm ${p.id === period.id ? "btn-primary" : "btn-secondary"}`}>
              {p.status === "Locked" ? <Lock size={12} /> : <Unlock size={12} />} {p.label}
            </Link>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Chip tone={period.status === "Locked" ? "green" : "amber"}>{period.status === "Locked" ? "Issued (locked)" : "Draft – live data"}</Chip> cut-off {formatDate(period.period_end)} ·{" "}
          {kpi.previousLabel ? `movement against ${kpi.previousLabel}` : "no earlier report to compare with"}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Closed KPI – DVO approved this report" value={String(kpi.counts.closed)} note={`AVV ${formatMoney(kpi.totals.closedAvv)} · PVO ${formatMoney(kpi.totals.closedPvo)}`} tone="green" />
        <Tile label="Open KPI – DVO pending" value={String(kpi.counts.open)} note={`PVO value ${formatMoney(kpi.totals.openPvo)}`} tone="amber" />
        <Tile label="Open over the 90-day norm" value={String(kpi.counts.open90)} note="root cause required by the head office" tone={kpi.counts.open90 ? "red" : "grey"} />
        <Tile label="Entries that moved this report" value={String(kpi.counts.moved)} note={kpi.previousLabel ? `since ${kpi.previousLabel}` : "first report"} tone="blue" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/reports/kpi?period=${period.id}&tab=closed`} className={`btn ${tab === "closed" ? "btn-primary" : "btn-secondary"}`}>
          Closed KPI <span className="ml-1 rounded bg-white/20 px-1.5 text-[11px]">{kpi.counts.closed}</span>
        </Link>
        <Link href={`/reports/kpi?period=${period.id}&tab=open`} className={`btn ${tab === "open" ? "btn-primary" : "btn-secondary"}`}>
          Open KPI <span className="ml-1 rounded bg-white/20 px-1.5 text-[11px]">{kpi.counts.open}</span>
        </Link>
      </div>

      <KpiWorkspace key={`${period.id}-${tab}`} periodId={period.id} category={tab} rows={rows} earlier={earlier} canManage={canManageKpi(user)} previousLabel={kpi.previousLabel} />
    </div>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone: "green" | "amber" | "red" | "blue" | "grey" }) {
  const color = { green: "text-emerald-700", amber: "text-amber-700", red: "text-red-700", blue: "text-navy", grey: "text-ink" }[tone];
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tnum ${color}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{note}</div>
    </div>
  );
}
