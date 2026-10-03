import type { RecordRow } from "../registers/types";
import { changeContribution } from "../dashboard/movement";
import { contractorKey } from "../bonds/name-key";

/**
 * The cost-recovery figures behind the Cost Recovery page, its PDF / Excel and the
 * "Uncommitted Costs and Early Warnings" table: what each contractor owes for its staff
 * accommodation, what customs duties RSG paid on its imports, and how both sit against the
 * contract in the cost report.
 */
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface AccommodationTotals {
  rows: number;
  open: number;
  leaseSum: number;
  invoiced: number;
  received: number;
  offset: number;
  outstanding: number;
  withheld: number;
  settleInFa: number;
  /** outstanding and neither withheld nor offset: still to chase */
  exposed: number;
}

/** What the invoices of one contractor say, beyond the lease totals. */
export interface AccommodationInvoiceDetail {
  /** every invoice of the contractor's lease agreements, oldest due first */
  invoices: RecordRow[];
  /** the ones still unpaid or part-paid, oldest due first */
  unpaid: RecordRow[];
  /** assessed but not yet invoiced (net of VAT), from the lease rows */
  notYetInvoiced: number;
  /** how late the settled invoices were paid */
  lateHistory: { count: number; min: number; max: number };
  /** invoices paid more than their amount (a credit the contractor holds) */
  overpaid: number;
}

export interface AccommodationSummary {
  asOf: string | null;
  totals: AccommodationTotals;
  /** one line per contractor, largest outstanding first */
  byContractor: { contractor: string; rows: RecordRow[]; totals: AccommodationTotals; note: string; detail: AccommodationInvoiceDetail }[];
  /** the rows still owing, largest first */
  outstanding: RecordRow[];
}

function accTotals(rows: RecordRow[]): AccommodationTotals {
  const t: AccommodationTotals = { rows: rows.length, open: 0, leaseSum: 0, invoiced: 0, received: 0, offset: 0, outstanding: 0, withheld: 0, settleInFa: 0, exposed: 0 };
  for (const r of rows) {
    // a row marked as fully recovered has nothing outstanding any more: what was owed counts as received
    const done = r.status === "Recovered";
    if (r.status !== "Closed" && !done) t.open++;
    t.leaseSum += n(r.lease_sum);
    t.invoiced += n(r.invoiced_gross);
    t.received += n(r.received_total) + (done ? Math.max(0, n(r.outstanding)) : 0);
    t.offset += n(r.offset_via_ipc);
    t.outstanding += done ? 0 : n(r.outstanding);
    t.withheld += done ? 0 : n(r.withheld_in_ipc);
    t.settleInFa += done ? 0 : n(r.deemed_settled_fa);
  }
  t.exposed = Math.max(0, t.outstanding - t.withheld);
  for (const k of Object.keys(t) as (keyof AccommodationTotals)[]) t[k] = r2(t[k]);
  return t;
}

function invoiceDetail(leases: RecordRow[], invoices: RecordRow[]): AccommodationInvoiceDetail {
  const byDue = (a: RecordRow, b: RecordRow) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")) || String(a.invoice_no ?? "").localeCompare(String(b.invoice_no ?? ""));
  const list = [...invoices].sort(byDue);
  const unpaid = list.filter((i) => i.status === "Unpaid" || i.status === "Part-paid");
  const late = list.filter((i) => i.status === "Paid" && n(i.days_overdue) > 0).map((i) => n(i.days_overdue));
  return {
    invoices: list,
    unpaid,
    notYetInvoiced: r2(leases.reduce((t, r) => t + n(r.not_yet_invoiced), 0)),
    lateHistory: { count: late.length, min: late.length ? Math.min(...late) : 0, max: late.length ? Math.max(...late) : 0 },
    overpaid: r2(list.reduce((t, i) => t + (n(i.balance_due) < -0.5 ? -n(i.balance_due) : 0), 0)),
  };
}

export function getAccommodationSummary(rows: RecordRow[], invoices: RecordRow[] = []): AccommodationSummary {
  const asOf = rows.map((r) => String(r.tracker_date ?? "")).filter(Boolean).sort().pop() ?? null;
  const groups = new Map<string, RecordRow[]>();
  for (const r of rows) {
    const name = String(r.contractor_id__label ?? r.tracker_name ?? "");
    groups.set(name, [...(groups.get(name) ?? []), r]);
  }
  const invoicesOf = new Map<string, RecordRow[]>();
  for (const i of invoices) {
    const name = String(i.contractor_id__label ?? i.tracker_name ?? "");
    invoicesOf.set(name, [...(invoicesOf.get(name) ?? []), i]);
  }
  const byContractor = [...groups]
    .map(([contractor, list]) => ({ contractor, rows: list, totals: accTotals(list), note: [...new Set(list.map((r) => String(r.note ?? "").trim()).filter(Boolean))].join(" · "), detail: invoiceDetail(list, invoicesOf.get(contractor) ?? []) }))
    .sort((a, b) => b.totals.outstanding - a.totals.outstanding);
  const outstanding = rows.filter((r) => r.status !== "Recovered" && Math.abs(n(r.outstanding)) >= 0.5).sort((a, b) => n(b.outstanding) - n(a.outstanding));
  return { asOf, totals: accTotals(rows), byContractor, outstanding };
}

export interface CustomsTotals {
  rows: number;
  open: number;
  rsgPaid: number;
  contractorPaid: number;
  toRecover: number;
  unrecoverable: number;
  recoverable: number;
  pvo: number;
  ewn: number;
  remainingToPay: number;
  /** recovered already: the DVOs recorded for the customs recovery (in the change tracker, or approved on the tracker itself) */
  recoveredByDvo: number;
  /** still to recover after the DVOs */
  stillToRecover: number;
}

export interface CustomsSummary {
  asOf: string | null;
  totals: CustomsTotals;
  byContractor: { contractor: string; rows: RecordRow[]; totals: CustomsTotals; payer: string; dvoNote: string; declarations: RecordRow[]; rsgPaidList: RecordRow[]; rsgPaidListed: number }[];
  /** rows with customs paid by RSG still to recover, largest first */
  toRecover: RecordRow[];
  /** contracts the tracker annotates but with no customs figures yet */
  noFigures: RecordRow[];
}

/** A change in the tracker that records the customs recovery: a DVO (column H) whose wording says so. */
export function isCustomsChange(c: RecordRow): boolean {
  return /custom/i.test(`${c.description ?? ""} ${c.title ?? ""} ${c.notes ?? ""}`);
}

/**
 * Per customs row: the DVO value already recorded for its recovery, and what is still to recover.
 * The DVO comes from the change tracker (a determined variation order mentioning customs on the same
 * cost report line or contractor – recorded there as soon as it is issued) or, failing that, from the
 * PVO / DVO approved on the tracker itself. It is taken off the contractor's total once, not per row:
 * the DVO is matched to the row with the largest amount to recover.
 */
export function customsWithDvo(rows: RecordRow[], changes: RecordRow[]): (RecordRow & { recovered_by_dvo: number; still_to_recover: number; dvo_source: string })[] {
  const dvoByLine = new Map<number, { amount: number; refs: string[] }>();
  const dvoByContractor = new Map<string, { amount: number; refs: string[] }>();
  for (const c of changes) {
    if (!isCustomsChange(c)) continue;
    const v = changeContribution(c);
    if (!v || v.col !== "H" || !v.amount) continue;
    const ref = String(c.item_no ?? c.id);
    const lineId = Number(c.cost_line_id);
    if (lineId) {
      const cur = dvoByLine.get(lineId) ?? { amount: 0, refs: [] };
      cur.amount += Math.abs(v.amount);
      cur.refs.push(ref);
      dvoByLine.set(lineId, cur);
    }
    const ck = contractorKey(c.contractor_id__label);
    if (ck) {
      const cur = dvoByContractor.get(ck) ?? { amount: 0, refs: [] };
      cur.amount += Math.abs(v.amount);
      cur.refs.push(ref);
      dvoByContractor.set(ck, cur);
    }
  }
  const usedLine = new Set<number>();
  const usedContractor = new Set<string>();
  const out = [...rows]
    .sort((a, b) => n(b.to_recover) - n(a.to_recover))
    .map((r) => {
      let recovered = 0;
      let source = "";
      const lineId = Number(r.cost_line_id);
      const ck = contractorKey(r.contractor_id__label ?? r.vendor);
      if (lineId && dvoByLine.has(lineId) && !usedLine.has(lineId)) {
        const d = dvoByLine.get(lineId)!;
        recovered = d.amount;
        source = `DVO ${d.refs.join(", ")} (change tracker)`;
        usedLine.add(lineId);
        usedContractor.add(ck);
      } else if (ck && dvoByContractor.has(ck) && !usedContractor.has(ck)) {
        const d = dvoByContractor.get(ck)!;
        recovered = d.amount;
        source = `DVO ${d.refs.join(", ")} (change tracker)`;
        usedContractor.add(ck);
      } else if (n(r.pvo_value) && (r.pvo_date || r.pvo_ref)) {
        recovered = Math.abs(n(r.pvo_value));
        source = `${String(r.pvo_ref ?? "PVO / DVO on the tracker")}${r.pvo_date ? ` approved ${String(r.pvo_date)}` : ""}`;
      }
      const toRecover = n(r.to_recover) || n(r.recoverable_via_contractor);
      if (r.status === "Recovered") {
        // marked as fully recovered on the summary: the whole amount is back, whatever the DVOs say
        recovered = Math.max(recovered, toRecover);
        source = source ? `${source}; marked as fully recovered` : "marked as fully recovered";
      }
      return { ...r, recovered_by_dvo: r2(recovered), still_to_recover: r2(Math.max(0, toRecover - recovered)), dvo_source: source };
    });
  return out;
}

function custTotals(rows: ReturnType<typeof customsWithDvo>): CustomsTotals {
  const t: CustomsTotals = { rows: rows.length, open: 0, rsgPaid: 0, contractorPaid: 0, toRecover: 0, unrecoverable: 0, recoverable: 0, pvo: 0, ewn: 0, remainingToPay: 0, recoveredByDvo: 0, stillToRecover: 0 };
  for (const r of rows) {
    if (r.status !== "Closed" && r.status !== "Recovered") t.open++;
    t.rsgPaid += n(r.customs_rsg_paid);
    t.contractorPaid += n(r.customs_contractor_paid);
    t.toRecover += n(r.to_recover);
    t.unrecoverable += n(r.unrecoverable);
    t.recoverable += n(r.recoverable_via_contractor);
    t.pvo += n(r.pvo_value);
    t.ewn += n(r.ewn_value);
    t.remainingToPay += n(r.remaining_to_pay);
    t.recoveredByDvo += r.recovered_by_dvo;
    t.stillToRecover += r.still_to_recover;
  }
  for (const k of Object.keys(t) as (keyof CustomsTotals)[]) t[k] = r2(t[k]);
  return t;
}

export function getCustomsSummary(rawRows: RecordRow[], changes: RecordRow[] = [], declarations: RecordRow[] = []): CustomsSummary {
  const rows = customsWithDvo(rawRows, changes);
  const asOf = rows.map((r) => String(r.tracker_date ?? "")).filter(Boolean).sort().pop() ?? null;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const name = String(r.contractor_id__label ?? r.vendor ?? "");
    groups.set(name, [...(groups.get(name) ?? []), r]);
  }
  const declOf = new Map<string, RecordRow[]>();
  for (const d of declarations) {
    const name = String(d.contractor_id__label ?? d.vendor ?? "");
    declOf.set(name, [...(declOf.get(name) ?? []), d]);
  }
  const byDate = (a: RecordRow, b: RecordRow) => String(a.payment_date ?? a.statement_date ?? "").localeCompare(String(b.payment_date ?? b.statement_date ?? ""));
  const byContractor = [...groups]
    .map(([contractor, list]) => {
      const decl = [...(declOf.get(contractor) ?? [])].sort(byDate);
      const rsgPaidList = decl.filter((d) => d.paid_by === "RSG" || n(d.rsg_paid) > 0);
      return {
        contractor,
        rows: list as RecordRow[],
        totals: custTotals(list),
        payer: [...new Set(list.map((r) => String(r.customs_payer ?? "").trim()).filter(Boolean))].join(" · "),
        dvoNote: [...new Set(list.map((r) => r.dvo_source).filter(Boolean))].join("; "),
        declarations: decl,
        rsgPaidList,
        rsgPaidListed: r2(rsgPaidList.reduce((t, d) => t + (n(d.rsg_paid) || n(d.customs_duty)), 0)),
      };
    })
    .sort((a, b) => b.totals.stillToRecover - a.totals.stillToRecover || b.totals.toRecover - a.totals.toRecover);
  const toRecover = rows.filter((r) => r.still_to_recover > 0.5).sort((a, b) => b.still_to_recover - a.still_to_recover);
  const noFigures = rows.filter((r) => (r.customs_rsg_paid === null || r.customs_rsg_paid === undefined) && (r.to_recover === null || r.to_recover === undefined));
  return { asOf, totals: custTotals(rows), byContractor, toRecover, noFigures };
}
