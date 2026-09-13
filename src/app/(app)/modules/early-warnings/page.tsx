import { AlertTriangle, FileText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { recordsForView } from "@/lib/view-mode";
import { getEwSummary, getRiskSummary } from "@/lib/risks/summary";
import { PageHeader } from "@/components/ui/PageHeader";
import { EwRisksPage } from "@/components/risks/EwRisksPage";
import { ExportButtons } from "@/components/ui/ExportButtons";

export const metadata = { title: "Early Warnings & Risks / Opportunities" };

export default async function EarlyWarningsModule({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = (await getCurrentUser())!;
  const mod = getModule("early-warnings")!;
  const ctx = getAppContext();
  const { tab } = await searchParams;
  if (!ctx.programme) {
    return (
      <div>
        <PageHeader exportSection="D" eyebrow={`Module ${mod.no}`} title={mod.title} />
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      </div>
    );
  }
  const ew = getEwSummary(recordsForView(getRegisterDef("early_warnings")!));
  const risks = getRiskSummary(recordsForView(getRegisterDef("risks")!));
  return (
    <div className="space-y-5">
      <PageHeader
        exportSection="D"
        eyebrow={`Module ${mod.no}`}
        title={mod.title}
        subtitle="Early warning notices (feeding column L of the cost report) and the commercial risk & opportunity register with its heat map."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1 shadow-sm" title="Executive report for the month: open exposure, risk heat map summary, ageing and actions">
            <FileText size={14} className="text-navy" />
            <ExportButtons section="ew_report" label="Early warnings & risks report" />
          </span>
        }
      />
      <EwRisksPage ew={ew} risks={risks} isAdmin={user.role === "admin"} initialTab={tab === "risks" ? "risks" : "ew"} />
    </div>
  );
}
