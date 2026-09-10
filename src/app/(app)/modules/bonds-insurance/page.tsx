import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";
import { getBondsSummary } from "@/lib/bonds/summary";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { RegisterPage } from "@/components/register/RegisterPage";
import { ExpiringSoonCard } from "@/components/bonds/ExpiringSoonCard";

export const metadata = { title: "Bonds & Insurance" };

export default async function BondsPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("bonds-insurance")!;
  const ctx = getAppContext();
  const summary = ctx.programme ? getBondsSummary(listRecords(getRegisterDef("bonds")!)) : null;

  return (
    <div className="space-y-5">
      <PageHeader exportSection="bonds" eyebrow={`Module ${mod.no}`} title={mod.title} subtitle="Every bond and insurance policy: what the contract requires, what has been provided, and when it expires." />
      {summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Bonds & policies" value={String(summary.total)} sub={`${summary.expired} expired · ${summary.red} within 30 days · ${summary.amber} within 60 days${summary.released ? ` · ${summary.released} released (contract closed)` : ""}${summary.superseded ? ` · ${summary.superseded} superseded` : ""}`} tone={summary.expired + summary.red > 0 ? "red" : summary.amber > 0 ? "amber" : undefined} />
            <Stat label="Provided vs required" value={`${formatMoney(summary.provided)} / ${formatMoney(summary.required)}`} sub="total face value held vs total contract requirement" small />
            <Stat label="Shortfalls" value={String(summary.shortfall)} sub={summary.shortfall ? `${formatMoney(summary.shortfallValue)} below requirement in total` : "every item meets its requirement"} tone={summary.shortfall ? "red" : "green"} />
            <div className="card min-w-0 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Checks outstanding</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip tone={summary.notApproved ? "amber" : "green"}>Not approved {summary.notApproved}</Chip>
                <Chip tone={summary.notVerified ? "amber" : "green"}>Bank not verified {summary.notVerified}</Chip>
              </div>
            </div>
          </div>
          <ExpiringSoonCard items={summary.expiring} expired={summary.expired} released={summary.released} superseded={summary.superseded} />
          <p className="text-xs text-muted">
            Rows turn amber within 60 days of expiry and red within 30 days or once expired. A bond whose contract is closed shows as Released and is not flagged: the Final Account Status decides first (Closed, Not Required or Direct Payment – No FA), Payment Tracking (Closed, Completed, Terminated) decides where there is no final account, and &quot;Contract closed&quot; can be ticked on the row. Contracts are recognised by their code (031C02), so a closed contract releases the bonds on every one of its cost lines. An older policy replaced by a newer one of the same type on the same contract shows as Superseded. Contract requirement = the % entered × revised contract value (or the original sum if no cost line is linked), or the fixed SAR amount. Types are managed under Settings → Insurance / Bond Types.
          </p>
          <RegisterPage registerKey="bonds" isAdmin={user.role === "admin"} />
        </>
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone, small }: { label: string; value: string; sub?: string; tone?: "red" | "amber" | "green"; small?: boolean }) {
  const cls = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-ink";
  return (
    <div className="card min-w-0 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 truncate font-semibold tnum ${small ? "text-sm" : "text-lg"} ${cls}`} title={value}>
        {value}
      </div>
      {sub && (
        <div className="truncate text-xs text-muted" title={sub}>
          {sub}
        </div>
      )}
    </div>
  );
}
