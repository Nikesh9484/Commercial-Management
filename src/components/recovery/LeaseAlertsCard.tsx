import Link from "next/link";
import { KeyRound } from "lucide-react";
import type { LeaseSummary } from "@/lib/leases/summary";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * What the accommodation lease agreements need: an expiry coming up or passed, a lease that ends
 * before the works do, a security deposit not received, invoices overdue, a fee overrun.
 */
export function LeaseAlertsCard({ s, compact = false }: { s: LeaseSummary; compact?: boolean }) {
  if (!s.alerts.length) return null;
  const shown = compact ? s.alerts.slice(0, 6) : s.alerts;
  return (
    <div className="card p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <KeyRound size={15} className="text-navy" /> Accommodation lease agreements – attention
        </h2>
        <span className="text-xs text-muted">
          {s.expired} expired · {s.extensionNeeded} need extending · {s.expiring} expiring within 60 days · {s.depositMissing} deposit(s) not received · {s.overdueInvoices} invoice(s) overdue{s.overdueValue ? ` (${formatMoney(s.overdueValue)})` : ""}
        </span>
      </div>
      <ul className="divide-y divide-line text-sm">
        {shown.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${a.tone === "red" ? "bg-red-500" : "bg-amber-500"}`} />
            <span className="font-medium text-ink">{a.contractor}</span>
            <span className="font-mono text-xs text-muted">{a.agreement_no}{a.contract_code ? ` · ${a.contract_code}` : ""}</span>
            {a.expiry && <span className="text-xs text-muted">ends {formatDate(a.expiry)}</span>}
            <span className={`basis-full text-xs ${a.tone === "red" ? "text-red-700" : "text-amber-800"}`}>{a.message}</span>
          </li>
        ))}
      </ul>
      {compact && s.alerts.length > shown.length && (
        <Link href="/modules/lease-agreements" className="mt-2 inline-block text-xs text-accent hover:underline">
          {s.alerts.length - shown.length} more on the lease tracker
        </Link>
      )}
      {compact && (
        <Link href="/modules/lease-agreements" className="mt-2 ml-3 inline-block text-xs text-accent hover:underline">
          Open the lease tracker
        </Link>
      )}
    </div>
  );
}
