import Link from "next/link";
import { AlertTriangle, Mail, Upload } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";
import { getAccommodationSummary, getCustomsSummary } from "@/lib/recovery/summary";
import { formatDate, formatMoney, formatMonthYear } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterPage } from "@/components/register/RegisterPage";
import { ExportButtons } from "@/components/ui/ExportButtons";

export const metadata = { title: "Cost Recovery – Accommodation & Customs" };

type Tab = "accommodation" | "customs";

/**
 * Module 13 – what contractors owe RSG: staff accommodation charges (the construction village
 * invoice tracker) and customs duties RSG paid on their imports (the customs recovery tracker),
 */
export default async function CostRecoveryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = (await getCurrentUser())!;
  const mod = getModule("cost-recovery")!;
  const ctx = getAppContext();
  const { tab: tabParam } = await searchParams;
  const tab: Tab = tabParam === "customs" ? "customs" : "accommodation";
  const canImport = user.role === "admin" || user.role === "editor";
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
  const acc = getAccommodationSummary(listRecords(getRegisterDef("accommodation_recovery")!), listRecords(getRegisterDef("accommodation_invoices")!));
  const cus = getCustomsSummary(listRecords(getRegisterDef("customs_recovery")!), listRecords(getRegisterDef("changes")!), listRecords(getRegisterDef("customs_declarations")!));
  const tabs: { key: Tab; label: string; count: string }[] = [
    { key: "accommodation", label: "Accommodation cost recovery", count: `${acc.totals.rows}` },
    { key: "customs", label: "Customs duty recovery", count: `${cus.totals.rows}` },
  ];
  const money = (v: number) => formatMoney(v);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Module ${mod.no}`}
        title={mod.title}
        subtitle="Money owed back to RSG by contractors: accommodation charges invoiced under the construction village lease agreements, and customs duties RSG paid on their imports. Both trackers are uploaded when they change, not every month, so the figures here are as of the tracker's own date and do not depend on the report selected in the top bar."
        actions={
          <span className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1 shadow-sm">
            <ExportButtons section="recovery_report" label="Cost recovery report" />
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <Link key={t.key} href={`/modules/cost-recovery?tab=${t.key}`} className={`btn btn-sm ${tab === t.key ? "btn-primary" : "btn-secondary"}`}>
            {t.label} <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[11px]">{t.count}</span>
          </Link>
        ))}
        {canImport && (
          <span className="ml-auto inline-flex gap-1.5">
            <Link href="/imports/accommodation" className="btn btn-sm btn-secondary">
              <Upload size={14} /> Upload accommodation tracker
            </Link>
            <Link href="/imports/customs" className="btn btn-sm btn-secondary">
              <Upload size={14} /> Upload customs tracker
            </Link>
          </span>
        )}
      </div>

      {tab === "accommodation" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Invoiced to date (incl. VAT)" value={money(acc.totals.invoiced)} sub={`${acc.totals.rows} lease agreement(s) · ${acc.totals.open} open${acc.asOf ? ` · tracker as of ${formatDate(acc.asOf)}` : ""}`} />
            <Stat label="Received + recovered" value={money(acc.totals.received)} sub={`${money(acc.totals.offset)} of it offset through IPCs`} tone="green" />
            <Stat label="Outstanding" value={money(acc.totals.outstanding)} sub={`${money(acc.totals.withheld)} withheld under IPCs against it`} tone={acc.totals.outstanding > 0.5 ? "red" : "green"} />
            <Stat label="Not covered by an IPC withholding" value={money(acc.totals.exposed)} sub={`${money(acc.totals.settleInFa)} deemed settled within the final account`} tone={acc.totals.exposed > 0.5 ? "amber" : "green"} />
          </div>
          {acc.totals.rows === 0 ? (
            <Empty what="accommodation invoice tracker" href="/imports/accommodation" canImport={canImport} />
          ) : (
            <>
              <div className="card overflow-x-auto p-0">
                <div className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Outstanding by contractor</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-4 py-2">Contractor</th>
                      <th className="px-3 py-2 text-right">Invoiced</th>
                      <th className="px-3 py-2 text-right">Received + recovered</th>
                      <th className="px-3 py-2 text-right">Outstanding</th>
                      <th className="px-3 py-2 text-right">Withheld in IPC</th>
                      <th className="px-3 py-2 text-right">To settle in FA</th>
                      <th className="px-3 py-2">Tracker note</th>
                      <th className="px-3 py-2">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acc.byContractor.map((c) => (
                      <tr key={c.contractor} className="border-t border-line">
                        <td className="px-4 py-1.5 font-medium text-ink">{c.contractor}</td>
                        <td className="px-3 py-1.5 text-right tnum">{money(c.totals.invoiced)}</td>
                        <td className="px-3 py-1.5 text-right tnum">{money(c.totals.received)}</td>
                        <td className={`px-3 py-1.5 text-right tnum ${c.totals.outstanding > 0.5 ? "font-semibold text-red-700" : ""}`}>{money(c.totals.outstanding)}</td>
                        <td className="px-3 py-1.5 text-right tnum">{money(c.totals.withheld)}</td>
                        <td className="px-3 py-1.5 text-right tnum">{money(c.totals.settleInFa)}</td>
                        <td className="max-w-[22rem] truncate px-3 py-1.5 text-xs text-muted" title={c.note}>{c.note}</td>
                        <td className="px-3 py-1.5">
                          {c.totals.outstanding > 0.5 && ctx.period && (
                            <a className="btn btn-xs btn-secondary" href={`/api/email-report?format=eml&kind=accommodation&period=${ctx.period.id}&contractor=${encodeURIComponent(c.contractor)}`} title="Download a ready-to-send email draft (.eml) chasing this contractor's outstanding accommodation charges – opens in Outlook">
                              <Mail size={12} /> Email draft
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line bg-slate-50 font-semibold">
                      <td className="px-4 py-1.5">Total</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(acc.totals.invoiced)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(acc.totals.received)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(acc.totals.outstanding)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(acc.totals.withheld)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(acc.totals.settleInFa)}</td>
                      <td />
                      <td className="px-3 py-1.5">
                        {acc.totals.outstanding > 0.5 && ctx.period && (
                          <a className="btn btn-xs btn-secondary" href={`/api/email-report?format=eml&kind=accommodation&period=${ctx.period.id}`} title="One email draft covering every contractor with an outstanding balance">
                            <Mail size={12} /> All in one
                          </a>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="card p-0">
                <div className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Invoices behind each contractor – as on the tracker&apos;s invoice sets</div>
                {acc.byContractor.every((c) => !c.detail.invoices.length) ? (
                  <p className="px-4 py-3 text-sm text-muted">No invoice-level detail is held yet: upload the accommodation invoice tracker again and each lease agreement&apos;s invoices are read from its Invoice Set columns.</p>
                ) : (
                  acc.byContractor.map((c) => (
                    <details key={c.contractor} className="border-b border-line last:border-b-0" open={c.detail.unpaid.length > 0}>
                      <summary className="cursor-pointer px-4 py-2 text-sm">
                        <span className="font-medium text-ink">{c.contractor}</span>
                        <span className="ml-2 text-xs text-muted">
                          {c.detail.invoices.length} invoice(s) · {c.detail.unpaid.length} unpaid or part-paid ({money(c.detail.unpaid.reduce((t, i) => t + Number(i.balance_due ?? 0), 0))})
                          {c.detail.notYetInvoiced > 0.5 ? ` · ${money(c.detail.notYetInvoiced)} assessed, not yet invoiced` : ""}
                          {c.detail.lateHistory.count ? ` · earlier invoices settled ${c.detail.lateHistory.min === c.detail.lateHistory.max ? `${c.detail.lateHistory.max}` : `${c.detail.lateHistory.min}–${c.detail.lateHistory.max}`} days late` : ""}
                        </span>
                      </summary>
                      {c.detail.invoices.length > 0 && (
                        <div className="overflow-x-auto px-2 pb-2">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-[11px] text-muted">
                                <th className="px-2 py-1">Lease agreement</th>
                                <th className="px-2 py-1">Invoice no</th>
                                <th className="px-2 py-1">Occupancy period</th>
                                <th className="px-2 py-1">Invoice date</th>
                                <th className="px-2 py-1">Issued on</th>
                                <th className="px-2 py-1">Due date</th>
                                <th className="px-2 py-1 text-right">Amount incl. VAT</th>
                                <th className="px-2 py-1 text-right">Received</th>
                                <th className="px-2 py-1 text-right">Unpaid</th>
                                <th className="px-2 py-1 text-right">Days overdue</th>
                                <th className="px-2 py-1">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.detail.invoices.map((i) => (
                                <tr key={String(i.id)} className={`border-t border-line ${i.status === "Unpaid" || i.status === "Part-paid" ? "" : "text-muted"}`}>
                                  <td className="max-w-[14rem] truncate px-2 py-1" title={String(i.tracker_name ?? "")}>{String(i.tracker_name ?? "")}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{String(i.invoice_no ?? "")}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{formatMonthYear(i.invoice_period as string)}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{formatDate(i.invoice_date as string)}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{formatDate(i.issued_date as string)}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{formatDate(i.due_date as string)}</td>
                                  <td className="whitespace-nowrap px-2 py-1 text-right tnum">{money(Number(i.amount_gross ?? 0))}</td>
                                  <td className="whitespace-nowrap px-2 py-1 text-right tnum">{money(Number(i.received ?? 0))}</td>
                                  <td className={`whitespace-nowrap px-2 py-1 text-right tnum ${Number(i.balance_due ?? 0) > 0.5 ? "font-semibold text-red-700" : ""}`}>{money(Number(i.balance_due ?? 0))}</td>
                                  <td className={`whitespace-nowrap px-2 py-1 text-right tnum ${Number(i.days_overdue ?? 0) > 0 && (i.status === "Unpaid" || i.status === "Part-paid") ? "font-semibold text-red-700" : ""}`}>{i.days_overdue === null || i.days_overdue === undefined ? "–" : String(i.days_overdue)}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{String(i.status ?? "")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </details>
                  ))
                )}
              </div>
              <RegisterPage registerKey="accommodation_recovery" isAdmin={user.role === "admin"} />
            </>
          )}
        </>
      )}

      {tab === "customs" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Customs paid by RSG" value={money(cus.totals.rsgPaid)} sub={`${cus.totals.rows} contract / vendor row(s)${cus.asOf ? ` · tracker as of ${formatDate(cus.asOf)}` : ""}`} />
            <Stat label="RSG / AMAALA to recover" value={money(cus.totals.toRecover)} sub={`${money(cus.totals.contractorPaid)} paid by the contractors themselves`} tone={cus.totals.toRecover > 0.5 ? "amber" : "green"} />
            <Stat label="Recovered by DVO" value={money(cus.totals.recoveredByDvo)} sub="determined variation orders recorded for the customs recovery – deducted automatically" tone="green" />
            <Stat label="Still to recover" value={money(cus.totals.stillToRecover)} sub={`${money(cus.totals.ewn)} notified in early warning notices · ${money(cus.totals.unrecoverable)} unrecoverable`} tone={cus.totals.stillToRecover > 0.5 ? "red" : "green"} />
          </div>
          {cus.totals.rows === 0 ? (
            <Empty what="customs recovery tracker" href="/imports/customs" canImport={canImport} />
          ) : (
            <>
              <div className="card overflow-x-auto p-0">
                <div className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Customs duty by contractor</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-4 py-2">Contractor</th>
                      <th className="px-3 py-2">Who pays per contract</th>
                      <th className="px-3 py-2 text-right">Paid by RSG</th>
                      <th className="px-3 py-2 text-right">To recover</th>
                      <th className="px-3 py-2 text-right">Recovered by DVO</th>
                      <th className="px-3 py-2 text-right">Still to recover</th>
                      <th className="px-3 py-2 text-right">EWN</th>
                      <th className="px-3 py-2 text-right">Remaining to pay</th>
                      <th className="px-3 py-2">DVO</th>
                      <th className="px-3 py-2">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cus.byContractor.map((c) => (
                      <tr key={c.contractor} className="border-t border-line">
                        <td className="px-4 py-1.5 font-medium text-ink">{c.contractor}</td>
                        <td className="px-3 py-1.5 text-xs text-muted">{c.payer}</td>
                        <td className="px-3 py-1.5 text-right tnum">{money(c.totals.rsgPaid)}</td>
                        <td className="px-3 py-1.5 text-right tnum">{money(c.totals.toRecover)}</td>
                        <td className="px-3 py-1.5 text-right tnum text-emerald-700">{money(c.totals.recoveredByDvo)}</td>
                        <td className={`px-3 py-1.5 text-right tnum ${c.totals.stillToRecover > 0.5 ? "font-semibold text-red-700" : ""}`}>{money(c.totals.stillToRecover)}</td>
                        <td className="px-3 py-1.5 text-right tnum">{money(c.totals.ewn)}</td>
                        <td className="px-3 py-1.5 text-right tnum">{money(c.totals.remainingToPay)}</td>
                        <td className="max-w-[16rem] truncate px-3 py-1.5 text-xs text-muted" title={c.dvoNote}>{c.dvoNote}</td>
                        <td className="px-3 py-1.5">
                          {c.totals.stillToRecover > 0.5 && ctx.period && (
                            <a className="btn btn-xs btn-secondary" href={`/api/email-report?format=eml&kind=customs&period=${ctx.period.id}&contractor=${encodeURIComponent(c.contractor)}`} title="Download a ready-to-send email draft (.eml) with the customs declarations RSG paid on this contractor's imports and the balance to recover – opens in Outlook">
                              <Mail size={12} /> Email draft
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line bg-slate-50 font-semibold">
                      <td className="px-4 py-1.5">Total</td>
                      <td />
                      <td className="px-3 py-1.5 text-right tnum">{money(cus.totals.rsgPaid)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(cus.totals.toRecover)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(cus.totals.recoveredByDvo)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(cus.totals.stillToRecover)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(cus.totals.ewn)}</td>
                      <td className="px-3 py-1.5 text-right tnum">{money(cus.totals.remainingToPay)}</td>
                      <td />
                      <td className="px-3 py-1.5">
                        {cus.totals.stillToRecover > 0.5 && ctx.period && (
                          <a className="btn btn-xs btn-secondary" href={`/api/email-report?format=eml&kind=customs&period=${ctx.period.id}`} title="One email draft covering every contractor with customs duties still to recover">
                            <Mail size={12} /> All in one
                          </a>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="card p-0">
                <div className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Customs declarations paid by RSG – per contractor, from the tracker&apos;s Breakdown sheet</div>
                {cus.byContractor.every((c) => !c.declarations.length) ? (
                  <p className="px-4 py-3 text-sm text-muted">No declaration-level detail is held yet: upload the customs recovery tracker again and each contractor&apos;s customs declarations are read from its Breakdown sheet.</p>
                ) : (
                  cus.byContractor.map((c) => (
                    <details key={c.contractor} className="border-b border-line last:border-b-0" open={c.rsgPaidList.length > 0 && c.totals.stillToRecover > 0.5}>
                      <summary className="cursor-pointer px-4 py-2 text-sm">
                        <span className="font-medium text-ink">{c.contractor}</span>
                        <span className="ml-2 text-xs text-muted">{c.rsgPaidList.length} declaration(s) paid by RSG · {money(c.rsgPaidListed)} · {c.declarations.length - c.rsgPaidList.length} paid by the contractor or unknown</span>
                      </summary>
                      {c.declarations.length > 0 && (
                        <div className="overflow-x-auto px-2 pb-2">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-[11px] text-muted">
                                <th className="px-2 py-1">Payment date</th>
                                <th className="px-2 py-1">Bayan no</th>
                                <th className="px-2 py-1">Port</th>
                                <th className="px-2 py-1">Supplier</th>
                                <th className="px-2 py-1">Invoice no</th>
                                <th className="px-2 py-1 text-right">Goods value</th>
                                <th className="px-2 py-1 text-right">Customs duty</th>
                                <th className="px-2 py-1">Who paid</th>
                                <th className="px-2 py-1 text-right">Paid by RSG</th>
                                <th className="px-2 py-1">SNB status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.declarations.map((d) => (
                                <tr key={String(d.id)} className={`border-t border-line ${d.paid_by === "RSG" ? "" : "text-muted"}`}>
                                  <td className="whitespace-nowrap px-2 py-1">{formatDate((d.payment_date ?? d.statement_date) as string)}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{String(d.bayan_no ?? "")}</td>
                                  <td className="max-w-[10rem] truncate px-2 py-1" title={String(d.port ?? "")}>{String(d.port ?? "")}</td>
                                  <td className="max-w-[14rem] truncate px-2 py-1" title={String(d.supplier ?? "")}>{String(d.supplier ?? "")}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{String(d.invoice_no ?? "")}</td>
                                  <td className="whitespace-nowrap px-2 py-1 text-right tnum">{money(Number(d.goods_value ?? 0))}</td>
                                  <td className="whitespace-nowrap px-2 py-1 text-right tnum">{money(Number(d.customs_duty ?? 0))}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{String(d.paid_by ?? "")}</td>
                                  <td className={`whitespace-nowrap px-2 py-1 text-right tnum ${Number(d.rsg_paid ?? 0) > 0.5 ? "font-semibold text-red-700" : ""}`}>{money(Number(d.rsg_paid ?? 0))}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{String(d.snb_status ?? "")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </details>
                  ))
                )}
              </div>
              <p className="text-xs text-muted">
                A determined variation order recorded in the Change Management Tracker for a contractor&apos;s customs recovery (its description mentions customs) is deducted from that contractor&apos;s amount to recover as soon as it is entered; where no DVO is in the tracker yet, the PVO / DVO approved on the customs tracker itself counts.
              </p>
              {cus.noFigures.length > 0 && (
                <p className="text-xs text-muted">
                  {cus.noFigures.length} contract(s) are annotated on the tracker without customs figures yet (the vendor&apos;s figures could not be tied to them in the tracker): only their contract details are shown.
                </p>
              )}
              <RegisterPage registerKey="customs_recovery" isAdmin={user.role === "admin"} />
            </>
          )}
        </>
      )}

    </div>
  );
}

function Empty({ what, href, canImport }: { what: string; href: string; canImport: boolean }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-muted">
      <span>Nothing uploaded yet for this project. Upload the {what} and its rows for this project appear here.</span>
      {canImport && (
        <Link href={href} className="btn btn-sm btn-primary">
          <Upload size={14} /> Upload
        </Link>
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
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
