import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getDb } from "@/lib/db";
import { getTransferSummary } from "@/lib/budget-transfers/compute";
import { formatMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { RegisterPage } from "@/components/register/RegisterPage";

export const metadata = { title: "Budget Transfers" };

export default async function BudgetTransfersPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("budget-transfers")!;
  const ctx = getAppContext();
  const summary = ctx.programme ? getTransferSummary(getDb(), ctx.programme.id) : null;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`Module ${mod.no}`} title={mod.title} subtitle="Budget moved between packages. Approved transfers reduce the From package and increase the To package in column F of the cost report." />
      {summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Transfers" value={String(summary.total)} sub={`${summary.approved} approved`} />
            <Stat label="Approved amount moved" value={formatMoney(summary.approvedAmount)} sub="total leaving From packages = total arriving in To packages" />
            <Stat label="Pending approval" value={formatMoney(summary.pendingAmount)} sub="not yet in the cost report" tone={summary.pendingAmount > 0 ? "amber" : undefined} />
            <div className="card min-w-0 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Cost report check</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip tone={summary.netsToZero ? "green" : "red"}>
                  {summary.netsToZero ? <CheckCircle2 size={11} className="mr-1" /> : <AlertTriangle size={11} className="mr-1" />}
                  Column F nets to zero
                </Chip>
                <Chip tone={summary.notApplied.length ? "red" : "green"}>{summary.notApplied.length ? `${summary.notApplied.length} approved not applied` : "All approved applied"}</Chip>
              </div>
            </div>
          </div>

          {summary.notApplied.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                These approved transfers are not in the cost report yet:{" "}
                {summary.notApplied.map((n) => `${n.item} (${n.problem})`).join("; ")}. Open the transfer and choose the From / To cost line, or add the missing line on the{" "}
                <Link href="/modules/cost-report" className="underline">
                  Cost Report
                </Link>{" "}
                Line setup tab.
              </span>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-5 pt-4">
              <h2 className="text-sm font-semibold text-ink">Net movement by package (as applied to cost report column F)</h2>
            </div>
            <div className="overflow-x-auto px-2 pb-2 pt-3">
              <table className="data w-full">
                <thead>
                  <tr>
                    <th>Package</th>
                    <th className="text-right">Out</th>
                    <th className="text-right">In</th>
                    <th className="text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.netByPackage.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted">
                        No approved transfers applied yet.
                      </td>
                    </tr>
                  )}
                  {summary.netByPackage.map((p) => (
                    <tr key={p.package_id}>
                      <td className="font-medium">{p.package}</td>
                      <td className="tnum text-right text-red-700">{p.out ? `-${formatMoney(p.out)}` : <span className="text-muted/60">—</span>}</td>
                      <td className="tnum text-right text-emerald-700">{p.in ? `+${formatMoney(p.in)}` : <span className="text-muted/60">—</span>}</td>
                      <td className={`tnum text-right font-semibold ${p.net > 0 ? "text-emerald-700" : p.net < 0 ? "text-red-700" : "text-muted"}`}>{formatMoney(p.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-muted">
            A transfer lands on the package&apos;s Level 2 line automatically. If a package has more than one line (several contractors), pick the line in the form. The <em>In cost report</em> column shows whether each transfer is currently applied. Column F on the{" "}
            <Link href="/modules/cost-report" className="text-accent hover:underline">
              Cost Report
            </Link>{" "}
            is now live.
          </p>
          <RegisterPage registerKey="budget_transfers" isAdmin={user.role === "admin"} />
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
