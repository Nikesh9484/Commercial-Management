import Link from "next/link";
import { AlertTriangle, Mail, Upload } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getModule } from "@/lib/modules";
import { getRegisterDef } from "@/lib/registers";
import { listRecords } from "@/lib/registers/engine";
import { getAccommodationSummary, getCustomsSummary } from "@/lib/recovery/summary";
import { formatDate, formatMoney } from "@/lib/format";
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
  const acc = getAccommodationSummary(listRecords(getRegisterDef("accommodation_recovery")!));
  const cus = getCustomsSummary(listRecords(getRegisterDef("customs_recovery")!), listRecords(getRegisterDef("changes")!));
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
                    </tr>
                  </tfoot>
                </table>
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
