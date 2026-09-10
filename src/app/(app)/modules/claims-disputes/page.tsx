import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";
import { getClaimsSummary } from "@/lib/claims/summary";
import { formatMoney, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { RegisterPage } from "@/components/register/RegisterPage";

export const metadata = { title: "Claims & Disputes" };

export default async function ClaimsPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("claims-disputes")!;
  const ctx = getAppContext();
  const summary = ctx.programme ? getClaimsSummary(ctx.programme.id, listRecords(getRegisterDef("claims")!)) : null;

  return (
    <div className="space-y-5">
      <PageHeader exportSection="claims" eyebrow={`Module ${mod.no}`} title={mod.title} subtitle="Schedule E: every claim with its notice compliance, detailed claim, assessment by each party and the determination." />

      {summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Claims" value={String(summary.total)} sub={`${summary.open} pending · ${summary.byStatus.filter((s) => s.status !== "Pending").map((s) => `${s.n} ${s.status}`).join(" · ") || "none closed"}`} />
            <Stat
              label="EOT days claimed vs granted"
              value={`${formatNumber(summary.eotClaimed, 0)} → ${formatNumber(summary.eotGranted, 0)}`}
              sub={summary.eotClaimed ? `${Math.round((summary.eotGranted / summary.eotClaimed) * 100)}% of days claimed granted` : "no EOT days claimed yet"}
            />
            <Stat
              label="SAR claimed vs determined"
              value={`${formatMoney(summary.costClaimed)} → ${formatMoney(summary.costDetermined)}`}
              sub={summary.costClaimed ? `${Math.round((summary.costDetermined / summary.costClaimed) * 100)}% of value claimed determined` : "no cost claimed yet"}
              small
            />
            <Stat
              label="Cost report – Claims (M)"
              value={formatMoney(summary.costReport)}
              sub={summary.unlinked > 0 ? `${summary.unlinked} claim(s) not linked to a cost line` : "all claims linked to a cost line"}
              tone={summary.unlinked > 0 ? "amber" : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card overflow-hidden lg:col-span-2">
              <div className="px-5 pt-4">
                <h2 className="text-sm font-semibold text-ink">Assessment ladder</h2>
                <p className="text-xs text-muted">Totals across all claims at each step of the assessment.</p>
              </div>
              <div className="overflow-x-auto px-2 pb-2 pt-3">
                <table className="data w-full">
                  <thead>
                    <tr>
                      <th>Party</th>
                      <th className="text-right">Claims</th>
                      <th className="text-right">EOT days</th>
                      <th className="text-right">Compensable days</th>
                      <th className="text-right">Cost (SAR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.parties.map((p, i) => (
                      <tr key={p.label} className={i === summary.parties.length - 1 ? "bg-page font-semibold" : ""}>
                        <td>{p.label}</td>
                        <td className="tnum text-right">{p.claims}</td>
                        <td className="tnum text-right">{formatNumber(p.eot, 0)}</td>
                        <td className="tnum text-right">{formatNumber(p.compensable, 0)}</td>
                        <td className="tnum text-right">{formatMoney(p.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink">Notice compliance</h2>
              <p className="mb-3 text-xs text-muted">Business days use the Sunday–Thursday working week. Public holidays are not excluded.</p>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Notice later than 28 business days</dt>
                  <dd>
                    <Chip tone={summary.noticeLate ? "red" : "green"}>{summary.noticeLate}</Chip>
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Detailed claim later than 42 business days</dt>
                  <dd>
                    <Chip tone={summary.detailLate ? "red" : "green"}>{summary.detailLate}</Chip>
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-muted">
                Column M of the{" "}
                <Link href="/modules/cost-report" className="text-accent hover:underline">
                  cost report
                </Link>{" "}
                carries, per claim: the Determination, else the Employer&apos;s assessment, else the Engineer&apos;s recommendation, else the Contractor&apos;s claim. Rejected
                claims and claims already included in the lump sum carry zero.
              </p>
            </div>
          </div>
        </>
      )}

      {ctx.programme ? (
        <RegisterPage registerKey="claims" isAdmin={user.role === "admin"} />
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
      {sub && <div className="truncate text-xs text-muted" title={sub}>{sub}</div>}
    </div>
  );
}
