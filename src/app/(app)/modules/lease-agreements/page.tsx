import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";
import { formatMoney } from "@/lib/format";
import { getLeaseSummary } from "@/lib/leases/summary";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterPage } from "@/components/register/RegisterPage";
import { AddFromDocuments } from "@/components/changes/AddFromDocuments";
import { LeaseAlertsCard } from "@/components/recovery/LeaseAlertsCard";
import { LeaseTimeline } from "@/components/recovery/LeaseTimeline";

export const metadata = { title: "Accommodation Lease Agreements" };

/**
 * Module 14 – the Labour Accommodation Lease Agreements and their amendments, kept apart from the
 * cost recovery trackers: each lease with its amendments beneath it, the position today, and the
 * registers to add or edit by hand.
 */
export default async function LeaseAgreementsPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("lease-agreements")!;
  const ctx = getAppContext();
  const canUpload = ["admin", "editor", "contributor", "reporter"].includes(user.role);
  if (!ctx.programme) {
    return (
      <div>
        <PageHeader eyebrow={`Module ${mod.no}`} title={mod.title} />
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      </div>
    );
  }
  const leaseRows = listRecords(getRegisterDef("lease_agreements")!);
  const leases = getLeaseSummary(leaseRows);
  const leaseAmendments = listRecords(getRegisterDef("lease_amendments")!);
  const money = (v: number) => formatMoney(v);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={`Module ${mod.no}`} title={mod.title} subtitle={mod.description} />
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm text-muted">
              The Labour Accommodation Lease Agreements behind the accommodation charges: the tenant, the works contract they serve, the term, the lease fee, the deposit and the room rates, with every amendment logged and the current fee and expiry carried forward. Each agreement is tied to the accommodation invoice tracker rows of the same contractor, so what has been invoiced, what is outstanding and what is overdue sit beside the lease itself.
            </div>
            {canUpload && (
              <AddFromDocuments
                endpoint="/api/leases/from-documents"
                title="Add a lease agreement or an amendment from its documents"
                button="Upload lease agreement / amendment"
                intro="Drop the signed Labour Accommodation Lease Agreement, or an Agreement Amendment, for one tenant or several at once (a folder is fine). The agreement number and date, the tenant, the works contract, the term and commencement, the lease fee, the security deposit, the room rates and the monthly fee histogram are read and the tracker is written; the document is filed in the Contract Library under the contractor."
                tip="An amendment is matched to its agreement by tenant and works contract (else by agreement number): it is logged under the agreement and moves the current fee and expiry on. An agreement already on the tracker stops the upload with the old and the new side by side for you to replace or keep."
              />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Lease agreements" value={String(leases.total)} sub={`${leases.active} active · ${leases.expired} expired · ${leases.total - leases.active - leases.expired} closed / terminated`} tone={leases.expired ? "red" : undefined} />
            <Stat label="Current lease fees (active)" value={money(leases.currentFee)} sub={`${money(leases.invoiced)} invoiced to date on the tracker · ${money(leases.outstanding)} outstanding`} />
            <Stat label="Expiring or to extend" value={String(leases.expiring + leases.extensionNeeded)} sub={`${leases.expiring} within 60 days · ${leases.extensionNeeded} where the works run past the lease`} tone={leases.extensionNeeded ? "red" : leases.expiring ? "amber" : "green"} />
            <Stat label="Deposits and invoices" value={`${leases.depositMissing} · ${leases.overdueInvoices}`} sub={`${leases.depositMissing} deposit(s) not received · ${leases.overdueInvoices} invoice(s) overdue${leases.overdueValue ? ` (${money(leases.overdueValue)})` : ""}`} tone={leases.overdueInvoices || leases.depositMissing ? "amber" : "green"} />
          </div>
          <LeaseAlertsCard s={leases} />
          {leases.total === 0 && (
            <div className="card p-5 text-sm text-muted">No lease agreement on the tracker yet. Upload the signed agreements (and their amendments) with the button above – or drop them on the Feed documents page – and each one is read and listed here.</div>
          )}
          {leases.total > 0 && (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-ink">Each lease with its amendments</h2>
                <span className="text-xs text-muted">The original agreement first, then every amendment beneath it, then the position today. Edit either in the registers below.</span>
              </div>
              <LeaseTimeline agreements={leaseRows} amendments={leaseAmendments} />
            </>
          )}
          <details className="card p-0" open={leases.total === 0}>
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-ink">Registers – add, edit, copy or paste agreements and amendments</summary>
            <div className="space-y-4 border-t border-line p-3">
              <RegisterPage registerKey="lease_agreements" isAdmin={user.role === "admin"} />
              <RegisterPage registerKey="lease_amendments" isAdmin={user.role === "admin"} />
            </div>
          </details>
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
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
