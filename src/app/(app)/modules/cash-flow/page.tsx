import { AlertTriangle } from "lucide-react";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { PageHeader } from "@/components/ui/PageHeader";
import { CashflowPage } from "@/components/cashflow/CashflowPage";

export const metadata = { title: "Cash Flow" };

export default async function CashFlowModule() {
  const mod = getModule("cash-flow")!;
  const ctx = getAppContext();
  return (
    <div>
      <PageHeader eyebrow={`Module ${mod.no}`} title={mod.title} subtitle="Monthly forecast per contract against the actual payments made, with the cumulative picture and what has been certified but not yet paid." />
      {ctx.programme ? (
        <CashflowPage />
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      )}
    </div>
  );
}
