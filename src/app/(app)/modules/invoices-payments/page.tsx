import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";
import { getDb } from "@/lib/db";
import { paymentTimeline } from "@/lib/payments/compute";
import { formatMoney, formatPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterPage } from "@/components/register/RegisterPage";
import { PaymentChart } from "@/components/payments/PaymentChart";

export const metadata = { title: "Invoice & Payment Tracking" };

export default async function PaymentsPage() {
  const user = (await getCurrentUser())!;
  const mod = getModule("invoices-payments")!;
  const ctx = getAppContext();
  if (!ctx.programme) {
    return (
      <div>
        <PageHeader exportSection="H" eyebrow={`Module ${mod.no}`} title={mod.title} />
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a programme in the top bar first.
        </div>
      </div>
    );
  }
  const contracts = listRecords(getRegisterDef("contracts")!);
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
  const revised = contracts.reduce((t, r) => t + num(r.revised_contract_value), 0);
  const certified = contracts.reduce((t, r) => t + num(r.latest_cum_certified), 0);
  const applied = contracts.reduce((t, r) => t + num(r.net_cum_applied), 0);
  const paid = contracts.reduce((t, r) => t + num(r.cum_paid), 0);
  const points = paymentTimeline(getDb(), ctx.programme.id);

  return (
    <div className="space-y-5">
      <PageHeader exportSection="H" eyebrow={`Module ${mod.no}`} title={mod.title} subtitle="Contract summary (one row per contract) and, behind each contract, its IPC log of payment applications, certificates and payments." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Revised contract value" value={formatMoney(revised)} sub={`${contracts.length} contract(s)`} />
        <Stat label="Net cumulative applied" value={formatMoney(applied)} sub="after advance recovery and retention" />
        <Stat label="Certified to date (gross)" value={formatMoney(certified)} sub={revised ? `${formatPercent((certified / revised) * 100)} of revised value` : "no contract value yet"} />
        <Stat label="Paid to date (net)" value={formatMoney(paid)} sub={certified ? `${formatPercent((paid / certified) * 100)} of net certified released` : "nothing certified yet"} />
      </div>
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Cumulative claimed vs certified vs paid – all contracts</h2>
        <p className="mb-3 text-xs text-muted">SAR, excl. VAT. Claimed and certified are gross cumulative figures; paid is the net amount released.</p>
        <PaymentChart points={points} />
      </div>
      <p className="text-xs text-muted">
        Approved VOs, approved claims and % certified are calculated from the Change Tracker, Claims and the IPC log. Set advance recovery %, retention % and the contractual IPC / payment days in each contract&apos;s form (Contract settings section). Press <em>IPC log</em> on a row to open its payment applications.
      </p>
      <RegisterPage registerKey="contracts" isAdmin={user.role === "admin"} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card min-w-0 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold tnum text-ink" title={value}>
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
