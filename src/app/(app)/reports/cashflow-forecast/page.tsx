import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { listPeriods } from "@/lib/snapshots";
import { getReportData } from "@/lib/report/data";
import { buildCashflowForecast } from "@/lib/cashflow/forecast";
import { CashflowForecastView } from "@/components/cashflow/CashflowForecastView";

export const metadata = { title: "Cash Flow Forecast" };

/**
 * The Employer's cash flow forecast for the project in the top bar: planned, actual and forecast
 * month by month, by package and by year, with KPIs, observations and the charts – for the report
 * chosen (the current one unless ?period= says otherwise).
 */
export default async function CashflowForecastPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await getCurrentUser();
  const ctx = getAppContext();
  const { period: q } = await searchParams;
  if (!ctx.programme) {
    return (
      <div className="card flex items-center gap-2 p-5 text-sm text-muted">
        <AlertTriangle size={16} /> Select a project in the top bar first.
      </div>
    );
  }
  const periods = listPeriods(ctx.programme.id);
  const period = (q && periods.find((p) => p.id === Number(q))) || ctx.period || periods[0];
  if (!period) {
    return (
      <div className="card flex items-center gap-2 p-5 text-sm text-muted">
        <AlertTriangle size={16} /> No reporting period exists yet.
      </div>
    );
  }
  const data = getReportData(ctx.programme.id, period.id);
  const forecast = buildCashflowForecast(data);
  return <CashflowForecastView forecast={forecast} periodId={period.id} periods={periods.map((p) => ({ id: p.id, label: String(p.label ?? ""), status: String(p.status ?? "") }))} />;
}
