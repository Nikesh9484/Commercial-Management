import type { ReportData } from "./data";
import type { CostLineRow } from "../cost-report/columns";
import type { RecordRow } from "../registers/types";
import { CHANGE_STAGES, DEAD_STATUSES, APPROVED_STATUSES } from "../registers/defs/changes";
import { claimCostReportAmount } from "../registers/defs/claims";
import { ewBucket, type EwBucket } from "./uncommitted-ew";

/**
 * The head office "Programme XX Budget EAC" workbook (Peter Ayliffe's consolidated Uncommitted
 * Costs and Early Warnings format, September 2026) built from one report's own registers:
 *
 *  - Level 02: one row per cost report line with the Head Office columns (previous budget, transfers,
 *    current budget, contracts, DVOs, committed, uncommitted, PVOs) and the site forecast (early
 *    warnings, budget to release, final account, variance), then how the uncommitted budget is used:
 *    VO under process, EOT claims, other claims, final account adjustment, identified uncommitted
 *    scope, plant supply, FF&E, BT to other asset, uncommitted / not required.
 *  - Level 01: the summary per asset the workbook derives from Level 02.
 *  - DVOs / PVOs: the approved and potential changes per vendor, as the SUMIFs on Level 02 need them.
 *  - UC: pending contracts – the dashboard keeps no register of contracts under approval, so empty.
 *  - Early Warning Breakdown: every early warning, claim and RFC the cost report carries, with its
 *    amount in the column its wording names.
 *
 * The budget per line is the awarded contract plus its approved DVOs, as the head office report shows
 * it; the budget hold line of each asset + category carries the remainder, so the uncommitted budget
 * sits on the hold – and the early warnings, claims and RFCs of the group are listed against the hold,
 * with the contract they relate to named beside them, which is how the template's own example reads.
 */
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface EacLine {
  lineId: number;
  program: string;
  asset: string;
  assetCode: string;
  subCategory: string;
  contractCode: string;
  /** the vendor / contract name – unique on the sheet, the SUMIF key of the schedules */
  name: string;
  isHold: boolean;
  previousBudget: number;
  currentBudget: number;
  contracts: number;
  /** the DVOs the cost report carries (what the DVOs schedule sums to for this name) */
  dvos: number;
  /** the PVOs / VOs under process the cost report carries */
  pvos: number;
  /** last month's anticipated final account, when the previous report is there */
  lastMonthEac: number | null;
  /** the dashboard's own anticipated final account, for the reader's check */
  dashboardEac: number;
}

export interface EacAsset {
  code: string;
  name: string;
  lines: EacLine[];
  lastMonthEac: number | null;
}

export interface EacScheduleRow {
  asset: string;
  subCategory: string;
  vendor: string;
  ref: string;
  value: number;
  description: string;
  notes: string;
}

export type EacColumn = "voUnderProcess" | "eotClaims" | "otherClaims" | "finalAccount" | "uncommittedScope" | "plantSupply" | "ffe" | "btOtherAsset" | "notRequired";
export const EAC_COLUMNS: { key: EacColumn; label: string }[] = [
  { key: "voUnderProcess", label: "VO Under Process" },
  { key: "eotClaims", label: "EOT Claims" },
  { key: "otherClaims", label: "Other Claims" },
  { key: "finalAccount", label: "Final Account Adjustment" },
  { key: "uncommittedScope", label: "Identified Uncommited Scope" },
  { key: "plantSupply", label: "Plant Supply" },
  { key: "ffe", label: "FF&E" },
  { key: "btOtherAsset", label: "BT to other Asset" },
  { key: "notRequired", label: "UNCOMMITED/ NOT REQUIRED" },
];

export interface EacEwRow {
  asset: string;
  subCategory: string;
  /** the Level 02 name the amount is listed against (the budget hold of the group when there is one) */
  vendor: string;
  ref: string;
  value: number;
  description: string;
  notes: string;
  /** the contract the warning, claim or request relates to */
  relatedContract: string;
  column: EacColumn;
  source: "early warning" | "claim" | "RFC";
}

export interface BudgetEac {
  portfolio: string;
  programme: { code: string; name: string };
  /** "Sep-26" */
  month: string;
  /** "202609" */
  yyyymm: string;
  periodLabel: string;
  assets: EacAsset[];
  dvos: EacScheduleRow[];
  pvos: EacScheduleRow[];
  ews: EacEwRow[];
  notes: string[];
}

const bucketToColumn: Record<EwBucket, EacColumn> = {
  eotClaims: "eotClaims",
  otherClaims: "otherClaims",
  uncommittedScope: "uncommittedScope",
  plantSupply: "plantSupply",
  ffe: "ffe",
  earlyWarnings: "uncommittedScope",
};

function monthOf(d: ReportData): { month: string; yyyymm: string } {
  const end = String(d.period.period_end ?? "").slice(0, 10);
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(end) ? new Date(`${end}T00:00:00Z`) : new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth();
  return { month: `${months[m]}-${String(y).slice(2)}`, yyyymm: `${y}${String(m + 1).padStart(2, "0")}` };
}

/** The vendor name of a line as it goes on the sheet: contractor and name, made unique with the code when two lines read the same. */
function sheetNames(lines: CostLineRow[]): Map<number, string> {
  const base = (l: CostLineRow) => {
    const nm = String(l.name ?? "").trim();
    const c = String(l.contractor ?? "").trim();
    // the name already says who the contractor is when it carries the contractor's first word
    const first = c.split(/[\s,.-]+/).find((w) => w.length >= 3) ?? c;
    if (!c || !nm || nm.toLowerCase().includes(first.toLowerCase())) return nm || c || l.code;
    return `${c} - ${nm}`;
  };
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(base(l), (counts.get(base(l)) ?? 0) + 1);
  const out = new Map<number, string>();
  for (const l of lines) {
    const b = base(l);
    out.set(l.id, (counts.get(b) ?? 0) > 1 ? `${b} [${l.code}]` : b);
  }
  return out;
}

export function buildBudgetEac(d: ReportData): BudgetEac {
  const lines = d.costReport.lines;
  const names = sheetNames(lines);
  const prevById = new Map<number, CostLineRow>();
  for (const l of d.previousCostReport?.lines ?? []) prevById.set(l.id, l);
  const program = d.programme.code;
  const codeOf = (l: CostLineRow) => `${l.asset_code || d.programme.code}.${l.code}`;

  // the hold of each asset + category: where the group's early warnings, claims and RFCs are listed
  const holdOf = new Map<string, CostLineRow>();
  for (const l of lines) if (l.is_budget_hold) holdOf.set(`${l.asset_id}|${l.category}`, l);

  const assets: EacAsset[] = [];
  const assetOf = (l: CostLineRow) => {
    let a = assets.find((x) => x.code === (l.asset_code || program));
    if (!a) {
      a = { code: l.asset_code || program, name: l.asset_name || d.programme.name, lines: [], lastMonthEac: null };
      assets.push(a);
    }
    return a;
  };
  for (const l of lines) {
    const prev = prevById.get(l.id);
    const row: EacLine = {
      lineId: l.id,
      program,
      asset: l.asset_name || d.programme.name,
      assetCode: l.asset_code || program,
      subCategory: l.category,
      contractCode: codeOf(l),
      name: names.get(l.id) ?? l.name,
      isHold: l.is_budget_hold,
      // the budget as the head office report shows it: the award plus its approved changes; the hold keeps the remainder
      previousBudget: r2(l.E),
      currentBudget: r2(l.G + l.H),
      contracts: l.is_budget_hold ? 0 : r2(l.G),
      dvos: l.is_budget_hold ? 0 : r2(l.H),
      pvos: l.is_budget_hold ? 0 : r2(l.J),
      lastMonthEac: prev ? r2(prev.N) : null,
      dashboardEac: r2(l.N),
    };
    const a = assetOf(l);
    a.lines.push(row);
  }
  for (const a of assets) {
    const prevs = a.lines.map((l) => l.lastMonthEac);
    a.lastMonthEac = prevs.some((v) => v !== null) ? r2(prevs.reduce<number>((t, v) => t + (v ?? 0), 0)) : null;
  }

  // the schedules: the changes the cost report carries, under the same rules as its columns H and J
  const byId = new Map<number, CostLineRow>(lines.map((l) => [l.id, l]));
  const dvos: EacScheduleRow[] = [];
  const pvos: EacScheduleRow[] = [];
  const changes = d.registers.changes?.rows ?? [];
  const statusOf = (c: RecordRow, p: string) => String(c[`${p}_status_id__label`] ?? "");
  const has = (c: RecordRow, p: string) => !!(c[`${p}_ref`] || c[`${p}_date`] || c[`${p}_status_id`] || (c[`${p}_cr_amount`] !== null && c[`${p}_cr_amount`] !== undefined));
  const live = (c: RecordRow, p: string) => !DEAD_STATUSES.includes(statusOf(c, p));
  for (const c of changes) {
    const line = byId.get(Number(c.cost_line_id));
    if (!line || line.is_budget_hold) continue;
    if (DEAD_STATUSES.includes(String(c.overall_status_id__label ?? ""))) continue;
    const common = { asset: line.asset_name || d.programme.name, subCategory: line.category, vendor: names.get(line.id) ?? line.name, description: String(c.description ?? "").trim() };
    if (APPROVED_STATUSES.includes(statusOf(c, "dvo"))) {
      dvos.push({ ...common, ref: String(c.dvo_avi_ref || c.dvo_ref || c.item_no || "").trim(), value: r2(n(c.dvo_cr_amount)), notes: [statusOf(c, "dvo"), c.dvo_date ? String(c.dvo_date) : ""].filter(Boolean).join(" · ") });
      continue;
    }
    const potential = [...CHANGE_STAGES].reverse().find((s) => (s.prefix === "vo" || s.prefix === "pvo") && has(c, s.prefix) && live(c, s.prefix) && n(c[`${s.prefix}_cr_amount`]) !== 0);
    if (potential) {
      const p = potential.prefix;
      pvos.push({ ...common, ref: String(c[`${p}_ref`] || c.item_no || "").trim(), value: r2(n(c[`${p}_cr_amount`])), notes: [`${potential.short} ${statusOf(c, p) || "pending"}`.trim(), c[`${p}_date`] ? String(c[`${p}_date`]) : ""].filter(Boolean).join(" · ") });
    }
  }

  // the early warning breakdown: early warnings, claims and RFCs, against the hold of their group
  const ews: EacEwRow[] = [];
  const listedAgainst = (line: CostLineRow) => holdOf.get(`${line.asset_id}|${line.category}`) ?? line;
  const put = (line: CostLineRow, row: Omit<EacEwRow, "asset" | "subCategory" | "vendor" | "relatedContract">) => {
    const against = listedAgainst(line);
    ews.push({ asset: line.asset_name || d.programme.name, subCategory: line.category, vendor: names.get(against.id) ?? against.name, relatedContract: against.id === line.id ? "" : (names.get(line.id) ?? line.name), ...row });
  };
  for (const e of d.registers.early_warnings?.rows ?? []) {
    const line = byId.get(Number(e.cost_line_id));
    if (!line || String(e.status ?? "") !== "Open") continue;
    const amount = r2(n(e.cost_impact));
    if (!amount) continue;
    const bucket = ewBucket(String(e.description ?? ""), line.category);
    put(line, { ref: String(e.ew_no ?? ""), value: amount, description: String(e.description ?? "").trim(), notes: [String(e.likelihood ?? ""), e.date_raised ? `raised ${String(e.date_raised)}` : ""].filter(Boolean).join(" · "), column: bucketToColumn[bucket], source: "early warning" });
  }
  for (const c of d.registers.claims?.rows ?? []) {
    const line = byId.get(Number(c.cost_line_id));
    if (!line) continue;
    const amount = r2(claimCostReportAmount(c));
    if (!amount) continue;
    const eot = c.type_eot === true || c.type_eot === 1 || c.type_prolongation === true || c.type_prolongation === 1;
    put(line, { ref: String(c.claim_no ?? c.item_no ?? ""), value: amount, description: String(c.description ?? c.title ?? "").trim(), notes: String(c.status ?? ""), column: eot ? "eotClaims" : "otherClaims", source: "claim" });
  }
  for (const c of changes) {
    const line = byId.get(Number(c.cost_line_id));
    if (!line || line.is_budget_hold) continue;
    if (DEAD_STATUSES.includes(String(c.overall_status_id__label ?? ""))) continue;
    if (APPROVED_STATUSES.includes(statusOf(c, "dvo"))) continue;
    const potential = [...CHANGE_STAGES].reverse().find((s) => (s.prefix === "vo" || s.prefix === "pvo") && has(c, s.prefix) && live(c, s.prefix) && n(c[`${s.prefix}_cr_amount`]) !== 0);
    if (potential) continue;
    if (has(c, "rfc") && live(c, "rfc") && n(c.rfc_cr_amount)) {
      put(line, { ref: String(c.rfc_ref || c.item_no || "").trim(), value: r2(n(c.rfc_cr_amount)), description: String(c.description ?? "").trim(), notes: `RFC ${statusOf(c, "rfc") || "pending"}`.trim(), column: "uncommittedScope", source: "RFC" });
    }
  }
  const order = (a: EacEwRow, b: EacEwRow) => a.asset.localeCompare(b.asset) || a.vendor.localeCompare(b.vendor) || Math.abs(b.value) - Math.abs(a.value);
  ews.sort(order);
  dvos.sort((a, b) => a.asset.localeCompare(b.asset) || a.vendor.localeCompare(b.vendor) || a.ref.localeCompare(b.ref));
  pvos.sort((a, b) => a.asset.localeCompare(b.asset) || a.vendor.localeCompare(b.vendor) || a.ref.localeCompare(b.ref));

  const { month, yyyymm } = monthOf(d);
  const notes = [
    "Currently Approved Budget per line = awarded contract + approved DVOs (cost report columns G + H); the budget hold of each asset and category carries the remainder, so the uncommitted budget sits on the hold line.",
    "Contracts = cost report column G of each awarded line; DVOs and PVOs come from the DVOs and PVOs tabs (the changes the cost report carries in columns H and J), summed by vendor name.",
    "The Early Warning Breakdown lists every open early warning (column L), claim (column M) and request for change (column K) against the budget hold of its asset and category, with the contract it relates to in column H; each amount sits in the column its wording names.",
    "UNCOMMITED / NOT REQUIRED is left for your decision: it starts at zero on every line (nothing released yet). Final Account Adjustment and BT to other Asset are not kept on the dashboard and start at zero.",
    "UC (pending contracts) is empty: the dashboard keeps no register of contracts under approval.",
    "Last Month Anticipated EAC on Level 01 is the previous issued report's anticipated final account per asset.",
  ];
  return { portfolio: "Triple Bay Portfolio", programme: { code: d.programme.code, name: d.programme.name }, month, yyyymm, periodLabel: d.period.label, assets, dvos, pvos, ews, notes };
}

/* ------------------------------------------------------------------ */
/* Level 02 as a table: every figure the sheet's formulas give, for the page, the PDF and the sheets */

export interface Level02Row {
  kind: "line" | "subtotal" | "total";
  program: string;
  asset: string;
  subCategory: string;
  contractCode: string;
  name: string;
  isHold: boolean;
  previousBudget: number;
  transfers: number;
  currentBudget: number;
  contracts: number;
  dvos: number;
  committed: number;
  uncommitted: number;
  pvos: number;
  earlyWarnings: number;
  budgetToRelease: number;
  finalAccount: number;
  variance: number;
  use: Record<EacColumn, number>;
  totalUse: number;
}

export const LEVEL02_MONEY: { key: keyof Omit<Level02Row, "kind" | "program" | "asset" | "subCategory" | "contractCode" | "name" | "isHold" | "use">; label: string; group: "ho" | "site" }[] = [
  { key: "previousBudget", label: "Previous Approved Budget", group: "ho" },
  { key: "transfers", label: "Approved Budget Transfers", group: "ho" },
  { key: "currentBudget", label: "Currently Approved Budget", group: "ho" },
  { key: "contracts", label: "Contracts", group: "ho" },
  { key: "dvos", label: "DVO's", group: "ho" },
  { key: "committed", label: "Committed", group: "ho" },
  { key: "uncommitted", label: "Uncommitted", group: "ho" },
  { key: "pvos", label: "PVO's", group: "ho" },
  { key: "earlyWarnings", label: "Early Warnings", group: "site" },
  { key: "budgetToRelease", label: "Budget to Release [Not Required]", group: "site" },
  { key: "finalAccount", label: "Final Account", group: "site" },
  { key: "variance", label: "Variance", group: "site" },
  { key: "totalUse", label: "Total Uncommitted Utilisation", group: "site" },
];

const zeroUse = (): Record<EacColumn, number> => ({ voUnderProcess: 0, eotClaims: 0, otherClaims: 0, finalAccount: 0, uncommittedScope: 0, plantSupply: 0, ffe: 0, btOtherAsset: 0, notRequired: 0 });

/** The rows of Level 02 with the sheet's own arithmetic applied, one sub-total per asset and a grand total. */
export function level02Table(e: BudgetEac): { rows: Level02Row[]; total: Level02Row } {
  const blank = (kind: Level02Row["kind"], name: string, asset = "", subCategory = ""): Level02Row => ({ kind, program: e.programme.code, asset, subCategory, contractCode: "", name, isHold: false, previousBudget: 0, transfers: 0, currentBudget: 0, contracts: 0, dvos: 0, committed: 0, uncommitted: 0, pvos: 0, earlyWarnings: 0, budgetToRelease: 0, finalAccount: 0, variance: 0, use: zeroUse(), totalUse: 0 });
  const add = (into: Level02Row, r: Level02Row) => {
    for (const m of LEVEL02_MONEY) if (m.key !== "variance") into[m.key] = r2(into[m.key] + r[m.key]);
    for (const c of EAC_COLUMNS) into.use[c.key] = r2(into.use[c.key] + r.use[c.key]);
    into.variance = r2(into.finalAccount - into.currentBudget);
  };
  const rows: Level02Row[] = [];
  const total = blank("total", "GRAND TOTAL");
  for (const a of e.assets) {
    const sub = blank("subtotal", "Sub-Total Development Cost", a.name);
    for (const l of a.lines) {
      const use = zeroUse();
      for (const w of e.ews) if (w.vendor === l.name) use[w.column] = r2(use[w.column] + w.value);
      const used = EAC_COLUMNS.reduce((t, c) => t + (c.key === "notRequired" ? 0 : use[c.key]), 0);
      const totalUse = r2(used + use.notRequired);
      const committed = r2(l.contracts + l.dvos);
      const row: Level02Row = {
        kind: "line",
        program: l.program,
        asset: l.asset,
        subCategory: l.subCategory,
        contractCode: l.contractCode,
        name: l.name,
        isHold: l.isHold,
        previousBudget: l.previousBudget,
        transfers: r2(l.currentBudget - l.previousBudget),
        currentBudget: l.currentBudget,
        contracts: l.contracts,
        dvos: l.dvos,
        committed,
        uncommitted: r2(l.currentBudget - committed),
        pvos: l.pvos,
        // the sheet's own formulas: N = (AC − AA) × −1, O = AA × −1, P = SUM(K:O), Q = P − H
        earlyWarnings: r2(-used),
        budgetToRelease: r2(-use.notRequired),
        finalAccount: 0,
        variance: 0,
        use,
        totalUse,
      };
      row.finalAccount = r2(committed + row.uncommitted + l.pvos + row.earlyWarnings + row.budgetToRelease);
      row.variance = r2(row.finalAccount - l.currentBudget);
      rows.push(row);
      add(sub, row);
    }
    rows.push(sub);
    add(total, sub);
  }
  return { rows, total };
}
