import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getReportData } from "@/lib/report/data";
import { buildPeriodSummary } from "@/lib/report/period-summary";
import { PeriodSummaryView } from "@/components/report/PeriodSummaryView";

export const metadata = { title: "Period Summary" };

/** The month's key period movements, on screen – for whichever project and period the top bar shows. */
export default async function PeriodSummaryPage() {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  if (!ctx.programme || !ctx.period) {
    return (
      <div className="card flex items-center gap-2 p-5 text-sm text-muted">
        <AlertTriangle size={16} /> {ctx.programme ? "No reporting period exists yet." : "Select a project in the top bar first."}
      </div>
    );
  }
  const data = getReportData(ctx.programme.id, ctx.period.id);
  const summary = buildPeriodSummary(data, { name: user.name });
  return <PeriodSummaryView summary={summary} periodId={ctx.period.id} />;
}
