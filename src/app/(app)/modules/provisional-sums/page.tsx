import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { recordsForView } from "@/lib/view-mode";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { RegisterPage } from "@/components/register/RegisterPage";

export const metadata = { title: "Provisional Sums" };

export default async function ProvisionalSumsPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("provisional-sums")!;
  const ctx = getAppContext();
  const rows = ctx.programme ? recordsForView(getRegisterDef("provisional_sums")!) : [];
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
  const budget = rows.reduce((t, r) => t + num(r.budget), 0);
  const instructed = rows.reduce((t, r) => t + num(r.contract_value), 0);
  const savingExtra = rows.reduce((t, r) => t + num(r.saving_extra), 0);
  const byStatus = new Map<string, number>();
  for (const r of rows) {
    const k = String(r.status_id__label ?? "No status");
    byStatus.set(k, (byStatus.get(k) ?? 0) + 1);
  }
  const withValue = rows.filter((r) => r.contract_value !== null && r.contract_value !== undefined).length;

  return (
    <div className="space-y-5">
      <PageHeader exportSection="provisional_sums" eyebrow={`Module ${mod.no}`} title={mod.title} subtitle="Provisional sum allowances, what has been instructed against each, and the saving or extra that results." />

      {ctx.programme ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Total budget" value={formatMoney(budget)} sub={`${rows.length} provisional sum(s)`} />
            <Stat label="Total instructed" value={formatMoney(instructed)} sub={`${withValue} of ${rows.length} item(s) with a contract value`} />
            <Stat
              label={savingExtra < 0 ? "Total saving" : "Total extra"}
              value={formatMoney(Math.abs(savingExtra))}
              sub={savingExtra < 0 ? "instructed value below budget" : savingExtra > 0 ? "instructed value above budget" : "instructed value equals budget"}
              tone={savingExtra > 0.004 ? "red" : savingExtra < -0.004 ? "green" : undefined}
            />
            <div className="card min-w-0 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">By status</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {byStatus.size === 0 && <span className="text-xs text-muted">No items yet.</span>}
                {[...byStatus.entries()].map(([k, n]) => (
                  <Chip key={k}>
                    {k} {n}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted">
            (Saving) / Extra = Contract value − Budget. Savings show in green with a minus sign, extras in red. The totals row at the bottom of the table follows your search and filters. Statuses are managed under Settings → Provisional Sum Statuses.
          </p>
          <RegisterPage registerKey="provisional_sums" isAdmin={user.role === "admin"} />
        </>
      ) : (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "red" | "amber" | "green" }) {
  const cls = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : "text-ink";
  return (
    <div className="card min-w-0 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 truncate text-lg font-semibold tnum ${cls}`} title={value}>
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
