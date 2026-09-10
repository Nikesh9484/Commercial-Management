import { Construction } from "lucide-react";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";
import { getBondsSummary } from "@/lib/bonds/summary";
import { PageHeader } from "@/components/ui/PageHeader";
import { ExpiringSoonCard } from "@/components/bonds/ExpiringSoonCard";

export const metadata = { title: "Executive Summary" };

export default async function ExecutiveSummaryPage() {
  const mod = getModule("executive-summary")!;
  const ctx = getAppContext();
  const bonds = ctx.programme ? getBondsSummary(listRecords(getRegisterDef("bonds")!)) : null;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`Module ${mod.no}`} title={mod.title} subtitle={mod.description} />
      {bonds && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ExpiringSoonCard items={bonds.expiring} expired={bonds.expired} />
        </div>
      )}
      <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          <Construction size={22} />
        </span>
        <h2 className="text-base font-semibold text-ink">The rest of the executive summary is not built yet</h2>
        <p className="max-w-md text-sm text-muted">Headline KPIs, commentary and minutes of meeting will be added in prompt {mod.no}. The expiring bonds alert above is already live.</p>
      </div>
    </div>
  );
}
