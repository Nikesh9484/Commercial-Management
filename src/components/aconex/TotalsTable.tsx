"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import { ACONEX_MEASURES, varianceSources, type AconexMeasureKey, type AconexReconciliation } from "@/lib/recovery/aconex";
import type { LineDetail } from "@/lib/recovery/aconex-detail";

/**
 * The totals of the control-account check, Aconex against the dashboard, with a "Where from" button on
 * every figure: it opens the lines the difference comes from – each cost report line once, the Aconex
 * rows pointing at it added together, largest difference first – and they add up to the total shown.
 */
export function TotalsTable({ rec, detail }: { rec: AconexReconciliation; detail: Record<string, LineDetail> }) {
  const [open, setOpen] = useState<AconexMeasureKey | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const money = (v: number | null | undefined) => (v === null || v === undefined ? "–" : formatMoney(v));
  return (
    <div className="card overflow-x-auto p-0">
      <div className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Totals – Aconex vs dashboard, over the lines both systems hold and compare for each figure</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="px-4 py-2">Figure</th>
            <th className="px-3 py-2 text-right">Aconex</th>
            <th className="px-3 py-2 text-right">Dashboard</th>
            <th className="px-3 py-2 text-right">Difference</th>
            <th className="px-3 py-2 w-28">Where from</th>
            <th className="px-3 py-2">What is compared</th>
          </tr>
        </thead>
        <tbody>
          {ACONEX_MEASURES.map((m) => {
            const diff = rec.totals.diff[m.key];
            const bad = Math.abs(diff) >= rec.counts.tolerance;
            const isOpen = open === m.key;
            const src = isOpen ? varianceSources(rec, m.key) : null;
            return (
              <Fragment key={m.key}>
                <tr className={`border-t border-line ${isOpen ? "bg-sky-50/60" : ""}`}>
                  <td className="px-4 py-1.5 font-medium text-ink">
                    {m.label}
                    <div className="text-[11px] font-normal text-muted">over {rec.totals.lines[m.key]} {m.key === "budget" || m.key === "eac" ? "lines" : "contracts"}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tnum">{money(rec.totals.aconex[m.key])}</td>
                  <td className="px-3 py-1.5 text-right tnum">{money(rec.totals.dashboard[m.key])}</td>
                  <td className={`px-3 py-1.5 text-right tnum ${bad ? "font-semibold text-red-700" : "text-emerald-700"}`}>{money(diff)}</td>
                  <td className="px-3 py-1.5">
                    <button type="button" className={`btn btn-sm ${isOpen ? "btn-primary" : bad ? "btn-secondary" : "btn-ghost"}`} onClick={() => setOpen(isOpen ? null : m.key)} title={bad ? `Show the lines this difference of ${formatMoney(diff)} comes from` : "Every line agrees on this figure – show them anyway"}>
                    {isOpen ? <ChevronUp size={13} /> : <Search size={13} />} {isOpen ? "Hide" : "Where from"}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted">{m.note}</td>
                </tr>
                {isOpen && src && (
                  <tr className="border-t border-line bg-sky-50/40">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                        <span className="font-semibold text-ink">
                          <ChevronDown size={12} className="mr-1 inline" />
                          {m.label}: the difference of {formatMoney(diff)} comes from {src.lines.length} line{src.lines.length === 1 ? "" : "s"}
                        </span>
                        <span>{src.agreeing} line{src.agreeing === 1 ? "" : "s"} agree and are not listed</span>
                        <span>each cost report line counted once; several Aconex rows on one line are added together</span>
                      </div>
                      {src.lines.length === 0 ? (
                        <div className="text-sm text-emerald-700">Every compared line agrees on this figure.</div>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-line bg-white">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-50 text-left text-[11px] text-muted">
                                <th className="px-2 py-1.5">Line</th>
                                <th className="px-2 py-1.5">Contractor</th>
                                <th className="px-2 py-1.5">Aconex row(s)</th>
                                <th className="px-2 py-1.5 text-right">Aconex</th>
                                <th className="px-2 py-1.5 text-right">Dashboard</th>
                                <th className="px-2 py-1.5 text-right">Difference</th>
                                <th className="px-2 py-1.5 text-right">Share of total</th>
                                <th className="px-2 py-1.5">Items</th>
                              </tr>
                            </thead>
                            <tbody>
                              {src.lines.map((l) => {
                                const d = detail[l.code];
                                const lineOpen = openLine === l.code;
                                return (
                                  <Fragment key={l.code}>
                                    <tr className={`border-t border-line ${lineOpen ? "bg-sky-50/60" : ""}`}>
                                      <td className="max-w-[24rem] truncate px-2 py-1" title={`${l.code} – ${l.name}`}>
                                        <span className="font-mono text-[11px]">{l.code}</span> <span className="text-muted">{l.name}</span>
                                      </td>
                                      <td className="max-w-[12rem] truncate px-2 py-1 text-muted">{l.contractor}</td>
                                      <td className="max-w-[14rem] truncate px-2 py-1 font-mono text-[11px] text-muted" title={l.aconexRows.join(", ")}>{l.aconexRows.join(", ")}</td>
                                      <td className="px-2 py-1 text-right tnum">{money(l.aconex)}</td>
                                      <td className="px-2 py-1 text-right tnum">{money(l.dashboard)}</td>
                                      <td className={`px-2 py-1 text-right tnum font-semibold ${l.diff < 0 ? "text-red-700" : "text-amber-700"}`}>{money(l.diff)}</td>
                                      <td className="px-2 py-1 text-right tnum text-muted">{src.total ? `${Math.round((l.diff / src.total) * 1000) / 10}%` : "–"}</td>
                                      <td className="px-2 py-1">
                                        {d ? (
                                          <button type="button" className={`btn btn-sm ${lineOpen ? "btn-primary" : "btn-secondary"}`} onClick={() => setOpenLine(lineOpen ? null : l.code)} title="The PVOs, DVOs, payment certificates and transfers each side holds on this line">
                                            {lineOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {lineOpen ? "Hide" : "Items"}
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                    {lineOpen && d && (
                                      <tr className="border-t border-line bg-sky-50/40">
                                        <td colSpan={8} className="px-3 py-3">
                                          <LineItems d={d} measure={m.key} money={money} />
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 border-line bg-slate-50 font-semibold text-ink">
                                <td className="px-2 py-1.5" colSpan={5}>Total of the lines listed</td>
                                <td className="px-2 py-1.5 text-right tnum">{money(src.total)}</td>
                                <td className="px-2 py-1.5 text-right tnum">100%</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {(rec.aconexOnly.length > 0 || rec.dashboardOnly.length > 0) && (
          <tfoot>
            <tr className="border-t-2 border-line bg-slate-50 text-xs text-muted">
              <td className="px-4 py-1.5 font-medium text-ink">Not compared – only on one side</td>
              <td className="px-3 py-1.5 text-right tnum">{money(rec.unmatched.aconex.eac)}</td>
              <td className="px-3 py-1.5 text-right tnum">{money(rec.unmatched.dashboard.eac)}</td>
              <td className="px-3 py-1.5" />
              <td className="px-3 py-1.5" />
              <td className="px-3 py-1.5">
                Estimate at completion of the {rec.aconexOnly.length} row(s) only in Aconex and the {rec.dashboardOnly.length} line(s) only on the dashboard (commitments {money(rec.unmatched.aconex.commitments)} vs {money(rec.unmatched.dashboard.commitments)}). Added to the totals above they give each system&apos;s grand total.
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** The figures each side builds its total from, then the items behind the figure chosen. */
function LineItems({ d, measure, money }: { d: LineDetail; measure: AconexMeasureKey; money: (v: number | null | undefined) => string }) {
  const parts: { label: string; a: number | null; b: number | null; note?: string }[] =
    measure === "budget"
      ? [
          { label: "Baseline budget", a: d.aconex.baseline, b: d.dashboard.baseline, note: "Aconex baseline vs column E" },
          { label: "Budget transfers", a: d.aconex.transfers, b: d.dashboard.transfers, note: "Aconex approved transfers vs column F" },
          { label: "Budget changes", a: d.aconex.budgetChanges, b: null, note: "Aconex approved budget changes – the dashboard folds these into the transfers" },
          { label: "Approved budget", a: d.aconex.budget, b: d.dashboard.budget, note: "Aconex approved budget vs column G" },
        ]
      : measure === "commitments" || measure === "dvo"
        ? [
            { label: "Awarded contract", a: d.aconex.awarded, b: d.dashboard.awarded, note: "Aconex approved contracts vs column G (award / latest budget)" },
            { label: "Approved changes (DVO)", a: d.aconex.dvo, b: d.dashboard.dvo, note: "Aconex approved downstream contract changes vs column H" },
            { label: "Commitments", a: d.aconex.commitments, b: d.dashboard.commitments, note: "Aconex current commitments vs column I" },
          ]
        : measure === "pvo"
          ? [{ label: "Pending changes (PVO)", a: d.aconex.pvo, b: d.dashboard.pvo, note: "Aconex pending downstream contract changes vs column J" }]
          : measure === "eac"
            ? [
                { label: "Commitments", a: d.aconex.commitments, b: d.dashboard.commitments, note: "column I" },
                { label: "Pending changes (PVO)", a: d.aconex.pvo, b: d.dashboard.pvo, note: "column J" },
                { label: "RFC, early warnings, claims", a: null, b: (d.dashboard.rfc ?? 0) + (d.dashboard.ew ?? 0) + (d.dashboard.claims ?? 0), note: "columns K + L + M – Aconex carries these inside its estimate to complete" },
                { label: "Estimate at completion", a: d.aconex.eac, b: d.dashboard.eac, note: "Aconex EAC vs column N" },
              ]
            : [{ label: "Incurred / certified to date", a: d.aconex.incurred, b: d.dashboard.incurred, note: "Aconex incurred to date vs column P" }];
  const showChanges = measure !== "incurred" && measure !== "budget";
  const showPayments = measure === "incurred";
  const showTransfers = measure === "budget";
  return (
    <div className="space-y-3 text-xs">
      <div>
        <div className="mb-1 font-semibold text-ink">How each side builds the figure</div>
        <table className="w-auto min-w-[36rem] rounded-lg border border-line bg-white">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] text-muted">
              <th className="px-2 py-1">Part</th>
              <th className="px-2 py-1 text-right">Aconex</th>
              <th className="px-2 py-1 text-right">Dashboard</th>
              <th className="px-2 py-1 text-right">Difference</th>
              <th className="px-2 py-1">Compared</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => {
              const diff = p.a !== null && p.b !== null ? Math.round((p.a - p.b) * 100) / 100 : null;
              return (
                <tr key={p.label} className="border-t border-line">
                  <td className="px-2 py-1 font-medium">{p.label}</td>
                  <td className="px-2 py-1 text-right tnum">{money(p.a)}</td>
                  <td className="px-2 py-1 text-right tnum">{money(p.b)}</td>
                  <td className={`px-2 py-1 text-right tnum ${diff !== null && Math.abs(diff) >= 1 ? "font-semibold text-red-700" : "text-emerald-700"}`}>{money(diff)}</td>
                  <td className="px-2 py-1 text-muted">{p.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showChanges && (
        <div>
          <div className="mb-1 font-semibold text-ink">
            Changes on contract {d.contracts.join(", ") || "–"} – the register&apos;s PVOs / DVOs against Aconex&apos;s change events, paired by number ({d.changes.length} item{d.changes.length === 1 ? "" : "s"}; {d.changes.filter((c) => !c.aconex).length} only on the dashboard, {d.changes.filter((c) => !c.register).length} only in Aconex)
          </div>
          {d.changes.length === 0 ? (
            <div className="text-muted">No change on the register and no Aconex event for this line.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-white">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] text-muted">
                    <th className="px-2 py-1" colSpan={4}>Dashboard – change register</th>
                    <th className="border-l border-line px-2 py-1" colSpan={5}>Aconex – change events</th>
                    <th className="border-l border-line px-2 py-1">Finding</th>
                  </tr>
                  <tr className="bg-slate-50 text-left text-[11px] text-muted">
                    <th className="px-2 py-1">Item</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1 text-right">PVO value</th>
                    <th className="px-2 py-1 text-right">DVO value</th>
                    <th className="border-l border-line px-2 py-1">Event</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1 text-right">Cost impact</th>
                    <th className="px-2 py-1 text-right">Approved change</th>
                    <th className="px-2 py-1 text-right">Pending change</th>
                    <th className="border-l border-line px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {d.changes.map((c) => {
                    const tone = !c.register || !c.aconex ? "text-amber-700" : c.finding === "agrees" ? "text-emerald-700" : "text-red-700";
                    return (
                      <tr key={c.key} className="border-t border-line">
                        <td className="max-w-[18rem] truncate px-2 py-1" title={c.register ? `${c.register.item} – ${c.register.label}` : ""}>
                          {c.register ? (
                            <>
                              <span className="font-mono text-[11px]">{c.register.item}</span> <span className="text-muted">{c.register.label}</span>
                            </>
                          ) : (
                            <span className="text-amber-700">– not on the register</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-muted">{c.register?.status || "–"}</td>
                        <td className="px-2 py-1 text-right tnum">{money(c.register?.pvo)}</td>
                        <td className="px-2 py-1 text-right tnum">{money(c.register?.dvo)}</td>
                        <td className="max-w-[18rem] truncate border-l border-line px-2 py-1" title={c.aconex ? `${c.aconex.event} – ${c.aconex.label}` : ""}>
                          {c.aconex ? (
                            <>
                              <span className="font-mono text-[11px]">{c.aconex.event}</span> <span className="text-muted">{c.aconex.label}</span>
                            </>
                          ) : (
                            <span className="text-amber-700">– no Aconex event</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-muted">{c.aconex?.status || "–"}</td>
                        <td className="px-2 py-1 text-right tnum">{money(c.aconex?.impact)}</td>
                        <td className="px-2 py-1 text-right tnum">{money(c.aconex?.approved)}</td>
                        <td className="px-2 py-1 text-right tnum">{money(c.aconex?.pending)}</td>
                        <td className={`max-w-[20rem] border-l border-line px-2 py-1 ${tone}`}>{c.finding}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {showPayments && (
        <div>
          <div className="mb-1 font-semibold text-ink">
            Payment certificates on the dashboard ({d.payments.length}) – certified {money(d.paymentsTotal)} in total, against Aconex incurred to date {money(d.aconex.incurred)}
          </div>
          <div className="mb-1 text-muted">The Aconex exports carry the incurred total only. For the certificate-by-certificate side of Aconex, upload the Aconex contract / payment export and it will be paired here.</div>
          {d.payments.length === 0 ? (
            <div className="text-muted">No payment application on the register for this line&apos;s contracts.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-white">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] text-muted">
                    <th className="px-2 py-1">Contract</th>
                    <th className="px-2 py-1">Application</th>
                    <th className="px-2 py-1">IPC</th>
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1 text-right">Certified – this IPC</th>
                    <th className="px-2 py-1 text-right">Cumulative certified</th>
                  </tr>
                </thead>
                <tbody>
                  {d.payments.map((p, i) => (
                    <tr key={`${p.contract}-${p.ref}-${i}`} className="border-t border-line">
                      <td className="max-w-[16rem] truncate px-2 py-1 text-muted">{p.contract}</td>
                      <td className="px-2 py-1 font-mono text-[11px]">{p.ref || "–"}</td>
                      <td className="px-2 py-1 font-mono text-[11px]">{p.ipc || "–"}</td>
                      <td className="px-2 py-1 text-muted">{p.date ? formatDate(p.date) : "–"}</td>
                      <td className="px-2 py-1 text-right tnum">{money(p.month)}</td>
                      <td className="px-2 py-1 text-right tnum">{money(p.cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {showTransfers && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <div className="mb-1 font-semibold text-ink">Budget transfers on the dashboard touching this line&apos;s package ({d.transfers.register.length})</div>
            <TransferList items={d.transfers.register} money={money} />
          </div>
          <div>
            <div className="mb-1 font-semibold text-ink">Aconex budget transfer events (BTR) on contract {d.contracts.join(", ") || "–"} ({d.transfers.aconex.length})</div>
            <TransferList items={d.transfers.aconex} money={money} />
          </div>
        </div>
      )}
    </div>
  );
}

function TransferList({ items, money }: { items: LineDetail["transfers"]["register"]; money: (v: number | null | undefined) => string }) {
  if (!items.length) return <div className="text-muted">None.</div>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50 text-left text-[11px] text-muted">
            <th className="px-2 py-1">Ref</th>
            <th className="px-2 py-1">Description</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1">Direction</th>
            <th className="px-2 py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t, i) => (
            <tr key={`${t.ref}-${i}`} className="border-t border-line">
              <td className="px-2 py-1 font-mono text-[11px]">{t.ref}</td>
              <td className="max-w-[22rem] truncate px-2 py-1 text-muted" title={t.label}>{t.label}</td>
              <td className="px-2 py-1 text-muted">{t.status || "–"}</td>
              <td className="px-2 py-1 text-muted">{t.direction}</td>
              <td className="px-2 py-1 text-right tnum">{money(t.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
