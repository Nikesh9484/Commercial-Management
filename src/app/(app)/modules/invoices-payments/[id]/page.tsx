import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getRegisterDef } from "@/lib/registers";
import { getRecord } from "@/lib/registers/engine";
import { getDb } from "@/lib/db";
import { paymentTimeline } from "@/lib/payments/compute";
import { formatMoney, formatPercent, formatDate, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { RegisterPage } from "@/components/register/RegisterPage";
import { PaymentChart } from "@/components/payments/PaymentChart";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getRecord(getRegisterDef("contracts")!, Number(id));
  return { title: c ? `IPC log · ${c.reef_po_no}` : "IPC log" };
}

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const c = getRecord(getRegisterDef("contracts")!, Number(id));
  if (!c || !ctx.programme || Number(c.programme_id) !== ctx.programme.id) notFound();
  const points = paymentTimeline(getDb(), ctx.programme.id, c.id);
  const m = (v: unknown) => formatMoney(v as number);

  return (
    <div className="space-y-5">
      <Link href="/modules/invoices-payments" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={16} /> Contract summary
      </Link>
      <PageHeader
        eyebrow={`Contract SR ${c.sr_no ?? ""} · PO ${c.reef_po_no}`}
        title={String(c.title)}
        subtitle={`${c.contractor_id__label ?? ""}${c.package_id__label ? ` · ${c.package_id__label}` : ""}`}
        actions={<Chip>{String(c.current_status)}</Chip>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink">Contract position</h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <Item k="Original contract" v={m(c.original_contract)} />
            <Item k="Approved VOs" v={m(c.approved_vos)} />
            <Item k="Approved claims" v={m(c.approved_claims)} />
            <Item k="Final account adjustment" v={m(c.final_account_adjustment)} />
            <Item k="Revised contract value" v={m(c.revised_contract_value)} strong />
            <Item k="% certified / balance" v={`${formatPercent(c.pct_certified as number)} / ${formatPercent(c.pct_balance as number)}`} />
            <Item k="Net cumulative applied" v={m(c.net_cum_applied)} />
            <Item k="Net cumulative certified" v={m(c.net_cum_certified)} />
            <Item k="Cumulative payment released" v={m(c.cum_paid)} />
            <Item k="Original completion" v={formatDate(c.original_completion_date as string)} />
            <Item k="EOT granted" v={`${formatNumber(c.eot_granted_days as number, 0) || "0"} days`} />
            <Item k="Revised completion" v={formatDate(c.revised_completion_date as string)} />
          </dl>
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Contract settings</h2>
          <dl className="space-y-2 text-sm">
            <Row k="Advance recovery" v={formatPercent(c.advance_recovery_pct as number) || "0.00%"} />
            <Row k="Retention" v={formatPercent(c.retention_pct as number) || "0.00%"} />
            <Row k="Days to issue IPC" v={`${c.ipc_days ?? "—"} days from application`} />
            <Row k="Days to pay" v={`${c.payment_days ?? "—"} days from IPC`} />
            <Row k="VAT" v={formatPercent(c.vat_pct as number)} />
          </dl>
          <p className="mt-3 text-xs text-muted">Change these in the contract&apos;s form on the summary page (Contract settings section). The IPC log recalculates automatically.</p>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Cumulative claimed vs certified vs paid</h2>
        <p className="mb-3 text-xs text-muted">SAR, excl. VAT.</p>
        <PaymentChart points={points} />
      </div>

      <div>
        <p className="mb-2 text-xs text-muted">
          Rows turn amber when the IPC is overdue and red when payment is overdue. Days late show red, early in green. Gross, advance recovery, retention, net, VAT and cumulative paid are calculated from the cumulative figures you enter.
        </p>
        <RegisterPage registerKey="payment_applications" isAdmin={user.role === "admin"} fixedFilter={{ contract_id: c.id }} hideFields={["contract_id"]} />
      </div>
    </div>
  );
}

function Item({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`tnum text-sm ${strong ? "font-semibold text-navy" : "font-medium text-ink"}`}>{v || "—"}</dd>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="tnum font-medium text-ink">{v}</dd>
    </div>
  );
}
