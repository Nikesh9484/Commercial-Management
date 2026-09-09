import { getCurrentUser } from "@/lib/auth";
import { getModule } from "@/lib/modules";
import { PageHeader } from "@/components/ui/PageHeader";
import { CostReportPage } from "@/components/cost-report/CostReportPage";

export const metadata = { title: "Cost Report Level 1 & 2" };

export default async function CostReportModule() {
  const user = (await getCurrentUser())!;
  const mod = getModule("cost-report")!;
  return (
    <div>
      <PageHeader eyebrow={`Module ${mod.no}`} title={mod.title} subtitle="Schedule A (Level 1, by asset) and Schedule B (Level 2, by package / contractor). All formulas are calculated by the app." />
      <CostReportPage canEdit={user.role !== "viewer"} isAdmin={user.role === "admin"} />
    </div>
  );
}
