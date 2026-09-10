import type { CostReport, CostLineRow } from "./columns";

/**
 * Level 1 – Executive, laid out as on the Excel "Level 01" sheet: one column per cost category
 * (Professional Services, Management Supervision, Commercial Management, Early Works, Construction
 * Works, FF&E …), a Total column, the previous report and the movement, and the report lines down the
 * side: Development Budget, Commitments, Potential Out-Turn Costs, Balance to Procure, Anticipated
 * Final Account, Variance to Budget, previous report and difference, then the reasons for the
 * variance this month and the comparison with last month's anticipated final account.
 *
 * Executive view: the budget rows include the unallocated "remaining budget" (budget hold) lines;
 * every other row excludes them, so the unallocated budget shows in the variance as under budget –
 * exactly as the Excel sub-totals do. Browser-safe (no database imports).
 */
export interface L1Column {
  key: string;
  label: string;
  asset_code: string;
  category: string;
}
export type L1RowKind = "group" | "money" | "strong" | "muted";
export interface L1Row {
  key: string;
  label: string;
  kind: L1RowKind;
  /** one value per column; empty for group rows */
  values: number[];
  total: number;
  /** the same line in the previous issued report (null when there is none) */
  previous: number | null;
  movement: number | null;
  /** positive is adverse (over budget / increase) – shown red */
  signed?: boolean;
  /** what the figure is, for the Excel formulas: money column + filters */
  source?: { col: string; hold?: "No"; section?: "Committed" | "Uncommitted" };
  /** for rows that are a formula of other rows (Excel) */
  formula?: { plus: string[]; minus: string[] };
}
export interface L1Reason {
  col: string;
  title: string;
  amount: number;
  remark: string;
}
export interface Level1Matrix {
  columns: L1Column[];
  rows: L1Row[];
  reasons: L1Reason[];
  netMovement: number;
  previousLabel: string | null;
  previousAvailable: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
type Filter = { col: keyof CostLineRow; hold?: "No"; section?: "Committed" | "Uncommitted" };
const pick = (lines: CostLineRow[], f: Filter) => r2(lines.filter((l) => (f.hold ? !l.is_budget_hold : true) && (f.section ? l.section === f.section : true)).reduce((t, l) => t + Number(l[f.col] ?? 0), 0));

export function level1Matrix(report: CostReport, prev: CostReport | null, keyMovements?: { col: string; label: string; items: { title: string; delta: number; note: string }[] }[] | null): Level1Matrix {
  // columns: asset + category, in report order
  const cols = new Map<string, L1Column>();
  const many = new Set(report.lines.map((l) => l.asset_id)).size > 1;
  for (const l of report.lines) {
    const key = `${l.asset_code}|${l.category}`;
    if (!cols.has(key)) cols.set(key, { key, label: many ? `${l.asset_code} · ${l.category || "(no category)"}` : l.category || "(no category)", asset_code: l.asset_code, category: l.category });
  }
  const columns = [...cols.values()];
  const byCol = (lines: CostLineRow[], c: L1Column) => lines.filter((l) => l.asset_code === c.asset_code && l.category === c.category);
  const prevLines = prev?.lines ?? [];
  const havePrev = !!prev && prevLines.length > 0;

  const rows: L1Row[] = [];
  const group = (key: string, label: string) => rows.push({ key, label, kind: "group", values: [], total: 0, previous: null, movement: null });
  const money = (key: string, label: string, f: Filter, opts: Partial<L1Row> = {}) => {
    const values = columns.map((c) => pick(byCol(report.lines, c), f));
    const total = r2(values.reduce((a, b) => a + b, 0));
    const previous = havePrev ? r2(columns.reduce((t, c) => t + pick(byCol(prevLines, c), f), 0)) : null;
    const row: L1Row = { key, label, kind: "money", values, total, previous, movement: previous === null ? null : r2(total - previous), source: { col: String(f.col), hold: f.hold, section: f.section }, ...opts };
    rows.push(row);
    return row;
  };
  const derived = (key: string, label: string, plus: L1Row[], minus: L1Row[], opts: Partial<L1Row> = {}) => {
    const values = columns.map((_, i) => r2(plus.reduce((t, r) => t + r.values[i], 0) - minus.reduce((t, r) => t + r.values[i], 0)));
    const total = r2(values.reduce((a, b) => a + b, 0));
    const prevOk = [...plus, ...minus].every((r) => r.previous !== null);
    const previous = prevOk ? r2(plus.reduce((t, r) => t + (r.previous ?? 0), 0) - minus.reduce((t, r) => t + (r.previous ?? 0), 0)) : null;
    const row: L1Row = { key, label, kind: "money", values, total, previous, movement: previous === null ? null : r2(total - previous), formula: { plus: plus.map((r) => r.key), minus: minus.map((r) => r.key) }, ...opts };
    rows.push(row);
    return row;
  };

  group("budget", "Development Budget");
  const E = money("E", "Previous Approved Budget", { col: "E" }, { kind: "muted" });
  const F = money("F", "Approved Budget Transfers", { col: "F" }, { kind: "muted" });
  const G = derived("G", "Development Budget (currently approved)", [E, F], [], { kind: "strong" });
  group("commitments", "Commitments");
  const awards = money("awards", "Contract Awards", { col: "G", hold: "No", section: "Committed" });
  const dvo = money("H", "DVO's (Determined Variation Orders)", { col: "H", hold: "No" });
  const committed = derived("committed", "Committed", [awards, dvo], [], { kind: "strong" });
  group("outturn", "Potential Out-Turn Costs");
  const pvo = money("J", "PVO's (Potential Variation Orders)", { col: "J", hold: "No" });
  const rfc = money("K", "RFC's (Requests for Change)", { col: "K", hold: "No" });
  const ew = money("L", "Early Warnings", { col: "L", hold: "No" });
  const claims = money("M", "Claims", { col: "M", hold: "No" });
  group("procure", "Balance to Procure");
  const uncommitted = money("uncommitted", "Uncommitted Packages", { col: "G", hold: "No", section: "Uncommitted" });
  const afa = derived("N", "Anticipated Final Account", [committed, uncommitted, pvo, rfc, ew, claims], [], { kind: "strong" });
  const variance = derived("O", "Variance to Budget", [afa], [G], { kind: "strong", signed: true });
  const prevVariance: L1Row = { key: "prevVariance", label: `Previous Report${prev ? ` (${prev.period?.label ?? ""})` : ""}`, kind: "muted", values: variance.previous === null ? columns.map(() => 0) : columns.map((c) => r2(pick(byCol(prevLines, c), { col: "N", hold: "No" }) - pick(byCol(prevLines, c), { col: "G" }))), total: variance.previous ?? 0, previous: null, movement: null, signed: true };
  if (havePrev) {
    rows.push(prevVariance);
    derived("difference", "Difference", [variance], [prevVariance], { kind: "strong", signed: true });
  }
  group("cash", "Cash Position");
  const certified = money("P", "Certified to Date", { col: "P", hold: "No" });
  derived("Q", "Works to Complete", [afa], [certified], {});
  if (havePrev) {
    group("lastmonth", "Comparison with Last Month");
    const lastAfa: L1Row = { key: "lastAfa", label: `Last Month Anticipated Final Account (${prev?.period?.label ?? ""})`, kind: "muted", values: columns.map((c) => pick(byCol(prevLines, c), { col: "N", hold: "No" })), total: afa.previous ?? 0, previous: null, movement: null };
    rows.push(lastAfa);
    derived("S", "Variance to Last Month (period movement)", [afa], [lastAfa], { kind: "strong", signed: true });
  }

  const reasons: L1Reason[] = (havePrev ? (keyMovements ?? []) : []).flatMap((k) => k.items.filter((i) => i.delta !== 0).map((i) => ({ col: k.col, title: i.title, amount: r2(i.delta), remark: i.note })));
  reasons.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const netMovement = afa.previous === null ? 0 : r2(afa.total - afa.previous);
  return { columns, rows, reasons, netMovement, previousLabel: prev?.period?.label ?? null, previousAvailable: havePrev };
}
