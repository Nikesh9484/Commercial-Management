import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { recordsForView } from "@/lib/view-mode";
import { PageHeader } from "@/components/ui/PageHeader";
import { BondsWorkspace } from "@/components/bonds/BondsWorkspace";

export const metadata = { title: "Bonds & Insurance" };

export default async function BondsPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("bonds-insurance")!;
  const ctx = getAppContext();
  const bondRows = ctx.programme ? recordsForView(getRegisterDef("bonds")!) : [];

  return (
    <div className="space-y-5">
      {/* the downloads live in the filter card below, so every one of them follows the filter on screen */}
      <PageHeader
        eyebrow={`Module ${mod.no}`}
        title={mod.title}
        subtitle="Every bond and insurance policy: what the contract requires, what has been provided, and when it expires."
      />
      {ctx.programme ? (
        <BondsWorkspace rows={bondRows} isAdmin={user.role === "admin"} hasPeriod={!!ctx.period} />
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      )}
    </div>
  );
}
