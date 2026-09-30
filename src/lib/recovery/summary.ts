import type { RecordRow } from "../registers/types";
import type { ReportData } from "../report/data";
import type { CostLineRow } from "../cost-report/columns";
import { claimCostReportAmount } from "../registers/defs/claims";
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

export interface AccommodationSummary {
  asOf: string | null;
  totals: AccommodationTotals;
  /** one line per contractor, largest outstanding first */
  byContractor: { contractor: string; rows: RecordRow[]; totals: AccommodationTotals; note: string }[];
  /** the rows still owing, largest first */
  outstanding: RecordRow[];
}

function accTotals(rows: RecordRow[]): AccommodationTotals {
  const t: AccommodationTotals = { rows: rows.length, open: 0, leaseSum: 0, invoiced: 0, received: 0, offset: 0, outstanding: 0, withheld: 0, settleInFa: 0, exposed: 0 };
  for (const r of rows) {
    if (r.status !== "Closed") t.open++;
    t.leaseSum += n(r.lease_sum);
    t.invoiced += n(r.invoiced_gross);
    t.received += n(r.received_total);
    t.offset += n(r.offset_via_ipc);
    t.outstanding += n(r.outstanding);
    t.withheld += n(r.withheld_in_ipc);
    t.settleInFa += n(r.deemed_settled_fa);
  }
  t.exposed = Math.max(0, t.outstanding - t.withheld);
  for (const k of Object.keys(t) as (keyof AccommodationTotals)[]) t[k] = r2(t[k]);
  return t;
}

export function getAccommodationSummary(rows: RecordRow[]): AccommodationSummary {
  const asOf = rows.map((r) => String(r.tracker_date ?? "")).filter(Boolean).sort().pop() ?? null;
  const groups = new Map<string, RecordRow[]>();
  for (const r of rows) {
    const name = String(r.contractor_id__label ?? r.tracker_name ?? "");
    groups.set(name, [...(groups.get(name) ?? []), r]);
  }
  const byContractor = [...groups]
    .map(([contractor, list]) => ({ contractor, rows: list, totals: accTotals(list), note: [...new Set(list.map((r) => String(r.note ?? "").trim()).filter(Boolean))].join(" · ") }))
    .sort((a, b) => b.totals.outstanding - a.totals.outstanding);
  const outstanding = rows.filter((r) => Math.abs(n(r.outstanding)) >= 0.5).sort((a, b) => n(b.outstanding) - n(a.outstanding));
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
  byContractor: { contractor: string; rows: RecordRow[]; totals: CustomsTotals; payer: string; dvoNote: string }[];
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
      return { ...r, recovered_by_dvo: r2(recovered), still_to_recover: r2(Math.max(0, toRecover - recovered)), dvo_source: source };
    });
  return out;
}

function custTotals(rows: ReturnType<typeof customsWithDvo>): CustomsTotals {
  const t: CustomsTotals = { rows: rows.length, open: 0, rsgPaid: 0, contractorPaid: 0, toRecover: 0, unrecoverable: 0, recoverable: 0, pvo: 0, ewn: 0, remainingToPay: 0, recoveredByDvo: 0, stillToRecover: 0 };
  for (const r of rows) {
    if (r.status !== "Closed") t.open++;
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

export function getCustomsSummary(rawRows: RecordRow[], changes: RecordRow[] = []): CustomsSummary {
  const rows = customsWithDvo(rawRows, changes);
  const asOf = rows.map((r) => String(r.tracker_date ?? "")).filter(Boolean).sort().pop() ?? null;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const name = String(r.contractor_id__label ?? r.vendor ?? "");
    groups.set(name, [...(groups.get(name) ?? []), r]);
  }
  const byContractor = [...groups]
    .map(([contractor, list]) => ({
      contractor,
      rows: list as RecordRow[],
      totals: custTotals(list),
      payer: [...new Set(list.map((r) => String(r.customs_payer ?? "").trim()).filter(Boolean))].join(" · "),
      dvoNote: [...new Set(list.map((r) => r.dvo_source).filter(Boolean))].join("; "),
    }))
    .sort((a, b) => b.totals.stillToRecover - a.totals.stillToRecover || b.totals.toRecover - a.totals.toRecover);
  const toRecover = rows.filter((r) => r.still_to_recover > 0.5).sort((a, b) => b.still_to_recover - a.still_to_recover);
  const noFigures = rows.filter((r) => (r.customs_rsg_paid === null || r.customs_rsg_paid === undefined) && (r.to_recover === null || r.to_recover === undefined));
  return { asOf, totals: custTotals(rows), byContractor, toRecover, noFigures };
}

/* ------------------------------------------------------------------ the Level 5 table */

/** One row of the consolidated "Uncommitted Costs and Early Warnings" table, in the programme's Level 5 layout. */
export interface UncommittedRow {
  kind: "line" | "category" | "total";
  /** 1TB01031.01.CN.031C15.00 – programme, asset, section and contract, as the consolidated sheet codes them */
  code: string;
  name: string;
  contractor: string;
  category: string;
  budget: number;
  commitments: number;
  voUnderProcess: number;
  eotClaims: number;
  otherClaims: number;
  uncommittedScope: number;
  earlyWarnings: number;
  accommodationRecovery: number;
  customsRecovery: number;
  totalUncommitted: number;
  notRequired: number;
  eac: number;
  /** what the recovery figures are made of, for the note column */
  note: string;
}

export interface UncommittedTable {
  rows: UncommittedRow[];
  total: UncommittedRow;
  /** recovery rows that could not be tied to a cost report line, listed under the table */
  unlinked: { source: "accommodation" | "customs"; label: string; amount: number }[];
  asOf: { accommodation: string | null; customs: string | null };
}

const MONEY_KEYS = ["budget", "commitments", "voUnderProcess", "eotClaims", "otherClaims", "uncommittedScope", "earlyWarnings", "accommodationRecovery", "customsRecovery", "totalUncommitted", "notRequired", "eac"] as const;

function blank(kind: UncommittedRow["kind"], code: string, name: string, contractor = "", category = ""): UncommittedRow {
  return { kind, code, name, contractor, category, budget: 0, commitments: 0, voUnderProcess: 0, eotClaims: 0, otherClaims: 0, uncommittedScope: 0, earlyWarnings: 0, accommodationRecovery: 0, customsRecovery: 0, totalUncommitted: 0, notRequired: 0, eac: 0, note: "" };
}

/**
 * The consolidated table for the programme: every cost report line with its budget, commitments,
 * the uncommitted amounts by kind (VOs under process, EOT and other claims, RFCs, early warnings)
 * and the two recoveries, the way the programme-wide "Uncommitted Costs and Early Warnings" sheet
 * lays them out. Claims and changes are attributed to the line they are linked to; the recoveries
 * to the line of their contract (accommodation: the contractor's contract; customs: the contract
 * code on the tracker).
 */
export function buildUncommittedTable(data: ReportData): UncommittedTable {
  const lines = data.costReport.lines;
  const claims = data.registers.claims?.rows ?? [];
  const byLine = new Map<number, UncommittedRow>();
  const lineIdByContractor = new Map<string, number[]>();
  const lineIdByFrag = new Map<string, number>();
  const asset = data.asset?.code ?? `${data.programme.code}.01`;
  const frag = (code: string) => {
    const m = String(code).match(/(\d{3}[A-Z]\d{2,3})/i);
    return m ? m[1].toUpperCase() : null;
  };
  for (const l of lines) {
    const row = blank("line", `${asset}.${l.code}`, l.name, l.contractor, l.category);
    row.budget = l.G;
    row.commitments = l.I;
    row.voUnderProcess = l.J;
    row.uncommittedScope = l.K;
    row.earlyWarnings = l.L;
    row.otherClaims = l.M; // split into EOT / other below, from the claims register
    row.eac = l.N;
    byLine.set(l.id, row);
    const ck = contractorKey(l.contractor);
    if (ck && !l.is_budget_hold) lineIdByContractor.set(ck, [...(lineIdByContractor.get(ck) ?? []), l.id]);
    const f = frag(l.code);
    if (f && !lineIdByFrag.has(f) && !l.is_budget_hold) lineIdByFrag.set(f, l.id);
  }
  // EOT claims apart from the other claims, from the claims register (same amounts as column M)
  for (const c of claims) {
    const id = Number(c.cost_line_id);
    const row = byLine.get(id);
    if (!row) continue;
    const amount = claimCostReportAmount(c);
    if (!amount) continue;
    if (c.type_eot === true || c.type_eot === 1 || c.type_prolongation === true || c.type_prolongation === 1) {
      row.eotClaims += amount;
      row.otherClaims -= amount;
    }
  }
  const unlinked: UncommittedTable["unlinked"] = [];
  const lineFor = (costLineId: unknown, contractorLabel: unknown, contractCode?: unknown): number | null => {
    const direct = Number(costLineId);
    if (direct && byLine.has(direct)) return direct;
    const f = contractCode ? frag(String(contractCode)) : null;
    if (f && lineIdByFrag.has(f)) return lineIdByFrag.get(f)!;
    const ids = lineIdByContractor.get(contractorKey(contractorLabel)) ?? [];
    // the contractor's main contract: the line with the largest commitment
    if (ids.length) return ids.sort((a, b) => (byLine.get(b)!.commitments || 0) - (byLine.get(a)!.commitments || 0))[0];
    return null;
  };
  for (const r of data.recovery.accommodation) {
    const amount = n(r.outstanding);
    if (Math.abs(amount) < 0.5) continue;
    const id = lineFor(r.cost_line_id, r.contractor_id__label ?? r.tracker_name);
    if (id === null) {
      unlinked.push({ source: "accommodation", label: String(r.contractor_id__label ?? r.tracker_name ?? ""), amount });
      continue;
    }
    const row = byLine.get(id)!;
    row.accommodationRecovery += amount;
    row.note = [row.note, `accommodation outstanding ${String(r.tracker_name ?? "")}`].filter(Boolean).join("; ");
  }
  for (const r of customsWithDvo(data.recovery.customs, data.registers.changes?.rows ?? [])) {
    const amount = r.still_to_recover;
    if (Math.abs(amount) < 0.5) continue;
    const id = lineFor(r.cost_line_id, r.contractor_id__label ?? r.vendor, r.contract_code);
    if (id === null) {
      unlinked.push({ source: "customs", label: String(r.contractor_id__label ?? r.vendor ?? ""), amount });
      continue;
    }
    const row = byLine.get(id)!;
    row.customsRecovery += amount;
    row.note = [row.note, `customs to recover ${String(r.vendor ?? "")}${r.ewn_ref ? ` (${String(r.ewn_ref)})` : ""}`].filter(Boolean).join("; ");
  }

  // totals and the category sub-totals, in the cost report's own order
  const finish = (row: UncommittedRow) => {
    row.totalUncommitted = row.voUnderProcess + row.eotClaims + row.otherClaims + row.uncommittedScope + row.earlyWarnings;
    row.notRequired = row.budget - row.commitments;
    for (const k of MONEY_KEYS) row[k] = r2(row[k]);
  };
  const rows: UncommittedRow[] = [];
  const total = blank("total", data.programme.code, `${data.programme.name} – total`);
  for (const cat of data.costReport.categories) {
    const sub = blank("category", cat.key, `${cat.asset_code} · ${cat.label}`, "", cat.category);
    const members = cat.lines.map((l) => byLine.get(l.id)!).filter(Boolean);
    if (!members.length) continue;
    for (const m of members) {
      finish(m);
      for (const k of MONEY_KEYS) if (k !== "totalUncommitted" && k !== "notRequired") sub[k] += m[k];
    }
    finish(sub);
    rows.push(sub, ...members);
    for (const k of MONEY_KEYS) if (k !== "totalUncommitted" && k !== "notRequired") total[k] += sub[k];
  }
  finish(total);
  return {
    rows,
    total,
    unlinked,
    asOf: { accommodation: getAccommodationSummary(data.recovery.accommodation).asOf, customs: getCustomsSummary(data.recovery.customs).asOf },
  };
}

export type { CostLineRow };
