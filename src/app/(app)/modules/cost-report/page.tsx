import { getCurrentUser } from "@/lib/auth";
import { getModule } from "@/lib/modules";
import { PageHeader } from "@/components/ui/PageHeader";
import { CostReportPage } from "@/components/cost-report/CostReportPage";
import { Level02R1View } from "@/components/cost-report/Level02R1";
import { getAppContext } from "@/lib/context";
import { getReportData } from "@/lib/report/data";

export const metadata = { title: "Cost Report Level 1 & 2" };

export default async function CostReportModule({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = (await getCurrentUser())!;
  const mod = getModule("cost-report")!;
  const { tab } = await searchParams;
  const titles: Record<string, string> = { level1: "Cost Report – Level 1 (Executive Summary by category)", level2: "Cost Report – Level 2 (Detailed by line)", level02r1: "Cost Report – Level 02 (R1) – head office Budget EAC layout", setup: "Cost Report – Line setup" };
  if (tab === "level02r1") {
    const app = getAppContext();
    const data = app.programme && app.period ? getReportData(app.programme.id, app.period.id) : null;
    return (
      <div>
        <PageHeader eyebrow={`Module ${mod.no}`} title={titles.level02r1} subtitle="The Level 02 tab of the head office 'Programme XX Budget EAC' workbook (consolidated Uncommitted Costs and Early Warnings), filled from this report's registers: the head office columns, the site forecast and how the uncommitted budget is used." exportSection="level02r1" exportName="Level 02 (R1)" />
        {data ? <Level02R1View data={data} /> : <div className="card p-6 text-sm text-muted">Select a project and a reporting period in the top bar first.</div>}
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        eyebrow={`Module ${mod.no}`}
        title={titles[tab ?? ""] ?? mod.title}
        subtitle="Schedule A (Level 1, by asset and cost category) and Schedule B (Level 2, by package / contractor). All formulas are calculated by the app."
        exportSection={tab === "level1" ? "level1" : tab === "setup" ? undefined : "level2"}
        exportName={tab === "level1" ? "Level 1" : "Level 2"}
      />
      <CostReportPage key={tab ?? "level2"} canEdit={user.role === "admin" || user.role === "editor"} isAdmin={user.role === "admin"} initialTab={tab} />
    </div>
  );
}
