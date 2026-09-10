import { getCurrentUser } from "@/lib/auth";
import { getModule } from "@/lib/modules";
import { PageHeader } from "@/components/ui/PageHeader";
import { CostReportPage } from "@/components/cost-report/CostReportPage";

export const metadata = { title: "Cost Report Level 1 & 2" };

export default async function CostReportModule({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = (await getCurrentUser())!;
  const mod = getModule("cost-report")!;
  const { tab } = await searchParams;
  const titles: Record<string, string> = { level1: "Cost Report – Level 1 (Executive Summary by category)", level2: "Cost Report – Level 2 (Detailed by line)", setup: "Cost Report – Line setup" };
  return (
    <div>
      <PageHeader
        eyebrow={`Module ${mod.no}`}
        title={titles[tab ?? ""] ?? mod.title}
        subtitle="Schedule A (Level 1, by asset and cost category) and Schedule B (Level 2, by package / contractor). All formulas are calculated by the app."
        exportSection={tab === "level1" ? "level1" : tab === "setup" ? undefined : "level2"}
      />
      <CostReportPage key={tab ?? "level2"} canEdit={user.role === "admin" || user.role === "editor"} isAdmin={user.role === "admin"} initialTab={tab} />
    </div>
  );
}
