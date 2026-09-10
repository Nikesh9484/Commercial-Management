import Link from "next/link";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getPeriod } from "@/lib/snapshots";
import { getChecklist } from "@/lib/checklist";
import { computeCostReport } from "@/lib/cost-report/compute";
import { proposeNextPeriod, MONTH_STEPS, monthActivity } from "@/lib/month";
import { PageHeader } from "@/components/ui/PageHeader";
import { NewMonthWizard } from "@/components/report/NewMonthWizard";

export const metadata = { title: "New monthly report (manual entry)" };

export default async function NewMonthPage() {
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const proposal = proposeNextPeriod();
  const current = ctx.period ? getPeriod(ctx.period.id) : null;
  const activity = current ? monthActivity(getDb(), current) : {};
  const steps = MONTH_STEPS.map((s) => ({ module_no: s.module_no, title: s.title, href: s.href, what: s.what, feeds: s.feeds, activity: s.registers.reduce((t, k) => t + (activity[k] ?? 0), 0) }));
  const checklist = current ? getChecklist(current.id) : [];
  const checkOk = ctx.programme ? computeCostReport(ctx.programme.id, current?.id ?? null).checkOk : true;
  return (
    <div className="space-y-4">
      <Link href="/modules/monthly-report" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={16} /> Monthly Report
      </Link>
      <PageHeader eyebrow="Module 12" title="New monthly report – manual entry" subtitle="Start the next month without an Excel file, enter it module by module, then lock and issue it. The reports, exports and emails are identical to an imported month because they are built from the same registers." />
      {!ctx.programme ? (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      ) : (
        <NewMonthWizard
          proposal={proposal}
          current={current ? { id: current.id, label: current.label, status: current.status, period_end: current.period_end } : null}
          steps={steps}
          checklist={checklist}
          checkOk={checkOk}
          isAdmin={user.role === "admin"}
          canEdit={user.role === "admin" || user.role === "editor"}
        />
      )}
    </div>
  );
}
