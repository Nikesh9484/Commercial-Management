import Link from "next/link";
import { Banknote } from "lucide-react";
import type { PaymentTrackerRow } from "@/lib/dashboard/movement";
import { formatMoney } from "@/lib/format";
import { Chip } from "@/components/ui/Chip";

function Bar({ pct, tone }: { pct: number | null; tone: "navy" | "green" }) {
  if (pct === null) return <span className="text-muted">–</span>;
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-12 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${tone === "green" ? "bg-emerald-500" : "bg-navy"}`} style={{ width: `${w}%` }} />
      </div>
      <span className="tnum text-xs">{pct.toFixed(1)}%</span>
    </div>
  );
}

/** Payment status per contract – contract value, certified and paid to date, late IPCs and payments. */
export function PaymentTracker({ rows, previousLabel }: { rows: PaymentTrackerRow[]; previousLabel: string | null }) {
  const sum = (k: "revised" | "certified" | "certifiedPeriod" | "paid") => rows.reduce((t, r) => t + r[k], 0);
  const tRev = sum("revised");
  const tCert = sum("certified");
  const tPaid = sum("paid");
  const late = rows.reduce((t, r) => t + r.lateIpcs + r.latePayments, 0);
  return (
    <div className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-gradient-to-r from-emerald-700 to-emerald-500 px-5 py-3 text-white">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Banknote size={16} /> Payment status tracker
        </h2>
        <span className="flex items-center gap-2 text-xs text-emerald-50">
          {rows.length} contract(s) · certified {tRev ? Math.round((tCert / tRev) * 100) : 0}% of revised value
          {late > 0 && <Chip tone="red">{late} late IPC(s) / payment(s)</Chip>}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="data compact w-full">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Contractor</th>
              <th className="text-right">Revised value</th>
              <th className="text-right">Certified to date</th>
              <th className="text-right" title={previousLabel ? `since ${previousLabel}` : undefined}>This period</th>
              <th>% certified</th>
              <th className="text-right">Paid (net)</th>
              <th>% paid</th>
              <th className="text-right" title="IPCs issued after the contractual due date">Late IPCs</th>
              <th className="text-right" title="Payments made after the contractual due date">Late pay.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-muted">No contracts yet. Add them under Invoices &amp; Payments.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="max-w-[16rem]">
                  <Link href="/modules/invoices-payments" className="font-medium text-ink hover:text-accent">
                    {r.key}
                  </Link>
                  <Chip className="ml-2 text-[10px]">{r.status}</Chip>
                  <div className="truncate text-[11px] text-muted" title={r.title}>{r.title}</div>
                </td>
                <td className="max-w-[10rem] truncate" title={r.contractor}>{r.contractor}</td>
                <td className="tnum text-right">{formatMoney(r.revised)}</td>
                <td className="tnum text-right">{formatMoney(r.certified)}</td>
                <td className={`tnum text-right ${r.certifiedPeriod > 0.5 ? "text-emerald-700" : "text-muted"}`}>{r.certifiedPeriod > 0.5 ? "+" : ""}{formatMoney(r.certifiedPeriod)}</td>
                <td><Bar pct={r.pctCertified} tone="navy" /></td>
                <td className="tnum text-right">{formatMoney(r.paid)}</td>
                <td><Bar pct={r.pctPaid} tone="green" /></td>
                <td className={`tnum text-right ${r.lateIpcs ? "font-semibold text-red-700" : "text-muted"}`}>{r.lateIpcs || "–"}</td>
                <td className={`tnum text-right ${r.latePayments ? "font-semibold text-red-700" : "text-muted"}`}>{r.latePayments || "–"}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-blue-50/60 font-semibold">
                <td colSpan={2}>Total</td>
                <td className="tnum text-right">{formatMoney(tRev)}</td>
                <td className="tnum text-right">{formatMoney(tCert)}</td>
                <td className="tnum text-right">{formatMoney(sum("certifiedPeriod"))}</td>
                <td><Bar pct={tRev ? (tCert / tRev) * 100 : null} tone="navy" /></td>
                <td className="tnum text-right">{formatMoney(tPaid)}</td>
                <td></td>
                <td className="tnum text-right">{rows.reduce((t, r) => t + r.lateIpcs, 0) || "–"}</td>
                <td className="tnum text-right">{rows.reduce((t, r) => t + r.latePayments, 0) || "–"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="px-5 py-2 text-[11px] text-muted">Certified = gross cumulative certified excl. VAT. Paid = net payments released (after advance recovery and retention). Late = IPCs issued or payments made after the contractual due date.</p>
    </div>
  );
}
