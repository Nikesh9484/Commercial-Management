import { AlertTriangle, FileText } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { recordsForView } from "@/lib/view-mode";
import { getBondsSummary } from "@/lib/bonds/summary";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { RegisterPage } from "@/components/register/RegisterPage";
import { ExpiringSoonCard } from "@/components/bonds/ExpiringSoonCard";
import { ExportButtons } from "@/components/ui/ExportButtons";
import { HorizontalBars } from "@/components/charts/HorizontalBars";

export const metadata = { title: "Bonds & Insurance" };

export default async function BondsPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("bonds-insurance")!;
  const ctx = getAppContext();
  const bondRows = ctx.programme ? recordsForView(getRegisterDef("bonds")!) : [];
  const summary = ctx.programme ? getBondsSummary(bondRows) : null;
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
  const byType = new Map<string, number>();
  for (const r of bondRows) {
    if (r.status === "Released" || r.status === "Superseded") continue;
    const k = String(r.type_id__label ?? "(no type)");
    byType.set(k, (byType.get(k) ?? 0) + num(r.amount_provided));
  }
  const byTypeChart = [...byType.entries()].map(([label, value]) => ({ label, value: Math.round(value) })).sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-5">
      <PageHeader
        exportSection="bonds"
        eyebrow={`Module ${mod.no}`}
        title={mod.title}
        subtitle="Every bond and insurance policy: what the contract requires, what has been provided, and when it expires."
        actions={
          ctx.programme ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1 shadow-sm" title="Executive report for the month: cover vs requirement, expiry timeline, compliance checks and actions">
              <FileText size={14} className="text-navy" />
              <ExportButtons section="bonds_report" label="Bonds & insurance report" />
            </span>
          ) : undefined
        }
      />
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
          {byTypeChart.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-1 text-sm font-semibold text-ink">Cover provided by type</h2>
              <p className="mb-3 text-xs text-muted">Face value held, active and expiring items only.</p>
              <HorizontalBars rows={byTypeChart} valueLabel="provided" />
            </div>
          )}
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
