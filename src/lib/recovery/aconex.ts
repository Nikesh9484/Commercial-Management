import type { RecordRow } from "../registers/types";
import type { ReportData } from "../report/data";
import { isDirectPaymentLine, contractKey } from "./aconex-codes";

/**
 * The Aconex cost check: every contract and budget hold in the Aconex control account export set
 * against its cost report line on the dashboard, figure by figure, with the difference. Lines only
 * one side knows about are listed as well, so nothing is silently left out of the comparison.
 */
const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The figures compared, in the order they are shown. Only some of them decide whether a line
 * "differs": the two systems hold budgets and changes on different bases – the dashboard keeps the
 * unallocated budget on the "Remaining budget" hold lines and folds historic variations into the
 * award, while Aconex re-bases each contract's approved budget and lists its changes separately – so
 * budget, DVO and PVO are shown for information on a contract line and only commitments, estimate
 * at completion and incurred to date decide. A budget hold has no commitments: there budget and
 * estimate at completion decide.
 */
export const ACONEX_MEASURES = [
  { key: "budget", label: "Approved budget", aconex: "approved_budget", dashboard: "G", decides: "hold", note: "Aconex approved budget vs cost report column G (awarded / latest budget incl. transfers) – decides for budget holds; on a contract the dashboard keeps unallocated budget on the hold line, so it is for information" },
  { key: "commitments", label: "Commitments", aconex: "current_commitments", dashboard: "I", decides: "contract", note: "Aconex current commitments vs column I (committed costs) – decides for contracts" },
  { key: "dvo", label: "Approved changes (DVO)", aconex: "approved_changes", dashboard: "H", decides: "none", note: "Aconex approved downstream contract changes vs column H (determined variation orders) – for information: the dashboard folds historic variations into the award" },
  { key: "pvo", label: "Pending changes (PVO)", aconex: "pending_changes", dashboard: "J", decides: "none", note: "Aconex pending downstream contract changes vs column J (potential variation orders) – for information" },
  { key: "hold", label: "Budget on hold (unspent, unallocated)", aconex: "eac", dashboard: "I", decides: "hold", note: "The .98 rows of Aconex Cost (PS, MS, CM, CN budget holds): their estimate at completion, the unspent and unallocated budget, vs Schedule B's budget-hold lines after the approved drawdowns (column E of Schedule B, committed costs – the latest budget less the DVOs drawn from the hold; Aconex moves that budget to the contract when the DVO is approved). Pending PVOs and early warnings only reach column J – decides for budget holds" },
  { key: "ew", label: "Early warnings", aconex: "approved_early_warnings_rsg", dashboard: "L", decides: "none", note: "Aconex approved + pending early warnings (RSG columns) on the contract rows vs column L (early warnings) – for information; the budget-hold row's figure is budget on hold, shown above" },
  { key: "eac", label: "Estimate at completion", aconex: "eac", dashboard: "N", decides: "contract", note: "Aconex estimate at completion (the standard Aconex figure: the approved budget) vs column N (anticipated final account) – decides for contracts; a budget hold is decided by its budget and by the Budget on hold row" },
  { key: "eac_rsg", label: "EAC after early warnings (RSG 1115)", aconex: "eac_rsg", dashboard: "N", decides: "none", note: "RSG's own estimate at completion 1115 (the approved budget less RSG's approved early warnings) on the contract rows vs column N – for information; on a budget hold the standard figure is used" },
  { key: "incurred", label: "Incurred to date", aconex: "incurred_to_date", dashboard: "P", decides: "contract", note: "Aconex incurred to date vs column P (certified to date) – decides for contracts" },
] as const;

/** Does this figure decide whether a line of this kind differs? */
export function measureDecides(m: (typeof ACONEX_MEASURES)[number], rowType: string): boolean {
  const hold = /hold/i.test(rowType);
  const d: string = m.decides;
  return d === "both" || (d === "hold" && hold) || (d === "contract" && !hold);
}

export type AconexMeasureKey = (typeof ACONEX_MEASURES)[number]["key"];

export interface AconexLine {
  status: "matched" | "aconex_only" | "dashboard_only";
  code: string;
  aconexCode: string;
  name: string;
  contractor: string;
  category: string;
  rowType: string;
  aconex: Record<AconexMeasureKey, number | null>;
  dashboard: Record<AconexMeasureKey, number | null>;
  diff: Record<AconexMeasureKey, number | null>;
  /** the largest absolute difference on the line */
  worst: number;
  /** which figures differ, for the note column */
  differs: AconexMeasureKey[];
}

export interface AconexReconciliation {
  asOf: string | null;
  lines: AconexLine[];
  /** matched lines with at least one difference, largest first */
  discrepancies: AconexLine[];
  aconexOnly: AconexLine[];
  dashboardOnly: AconexLine[];
  /** over the matched lines only – the same contracts and holds on both sides, each cost report line counted once */
  totals: { aconex: Record<AconexMeasureKey, number>; dashboard: Record<AconexMeasureKey, number>; diff: Record<AconexMeasureKey, number>; lines: Record<AconexMeasureKey, number> };
  /** what sits on one side only, so the matched totals can be tied back to each system's grand total */
  unmatched: { aconex: Record<AconexMeasureKey, number>; dashboard: Record<AconexMeasureKey, number> };
  counts: { aconex: number; dashboard: number; matched: number; differing: number; tolerance: number; directRows: number };
}

/** Differences under one SAR are rounding, not discrepancies. */
export const TOLERANCE = 1;

function blankMeasures(): Record<AconexMeasureKey, number | null> {
  return { budget: null, commitments: null, dvo: null, pvo: null, hold: null, ew: null, eac: null, eac_rsg: null, incurred: null };
}

export function buildAconexReconciliation(data: ReportData): AconexReconciliation {
  const rows = data.recovery.aconex;
  const asOf = rows.map((r) => String(r.tracker_date ?? "")).filter(Boolean).sort().pop() ?? null;
  const lines: AconexLine[] = [];
  const usedLine = new Set<number>();
  const byLine = new Map<number, (typeof data.costReport.lines)[number]>();
  for (const l of data.costReport.lines) byLine.set(l.id, l);
  // the .98 rows (budget holds) are unspent, unallocated budget: RSG's early-warning columns and EAC 1115 on them are
  // not read (the figure RSG keeps there is not an early warning); their budget on hold is their estimate at completion
  const hold = (r: RecordRow) => String(r.row_type ?? "") === "Budget hold";
  const ewOf = (r: RecordRow) => (r.approved_early_warnings_rsg === null || r.approved_early_warnings_rsg === undefined ? (r.pending_early_warnings_rsg === null || r.pending_early_warnings_rsg === undefined ? null : n(r.pending_early_warnings_rsg)) : r2(n(r.approved_early_warnings_rsg) + n(r.pending_early_warnings_rsg)));
  const aconexOf = (r: RecordRow): Record<AconexMeasureKey, number | null> => ({
    budget: r.approved_budget === null || r.approved_budget === undefined ? null : n(r.approved_budget),
    commitments: r.current_commitments === null || r.current_commitments === undefined ? null : n(r.current_commitments),
    dvo: r.approved_changes === null || r.approved_changes === undefined ? null : n(r.approved_changes),
    pvo: r.pending_changes === null || r.pending_changes === undefined ? null : n(r.pending_changes),
    hold: hold(r) ? (r.eac === null || r.eac === undefined ? null : n(r.eac)) : null,
    ew: hold(r) ? null : ewOf(r),
    // the standard Aconex estimate at completion (the approved budget) decides; RSG's own 1115 is shown beside it
    eac: r.eac === null || r.eac === undefined ? null : n(r.eac),
    eac_rsg: hold(r) ? (r.eac === null || r.eac === undefined ? null : n(r.eac)) : r.eac_rsg === null || r.eac_rsg === undefined ? null : n(r.eac_rsg),
    incurred: r.incurred_to_date === null || r.incurred_to_date === undefined ? null : n(r.incurred_to_date),
  });
  const dashOf = (l: (typeof data.costReport.lines)[number]): Record<AconexMeasureKey, number | null> => ({ budget: l.G, commitments: l.I, dvo: l.H, pvo: l.J, hold: l.is_budget_hold ? l.I : null, ew: l.L, eac: l.N, eac_rsg: l.N, incurred: l.P });
  const finish = (line: AconexLine) => {
    for (const m of ACONEX_MEASURES) {
      const a = line.aconex[m.key];
      const d = line.dashboard[m.key];
      line.diff[m.key] = a === null && d === null ? null : r2((a ?? 0) - (d ?? 0));
      if (line.status === "matched" && measureDecides(m, line.rowType) && Math.abs(line.diff[m.key] ?? 0) >= TOLERANCE) line.differs.push(m.key);
    }
    line.worst = Math.max(0, ...ACONEX_MEASURES.filter((m) => measureDecides(m, line.rowType)).map((m) => Math.abs(line.diff[m.key] ?? 0)));
    return line;
  };
  // Aconex carries one row per contract; the cost report may split that contract over several lines
  // (preliminaries, the main works, each provisional-sum allowance – CN.031C02, CN.031C02-2 … -18), so
  // a contract row is compared with the sum of every line carrying its contract code
  // the contract code with its section (MS.003F02 and FFEOSE.003F02 are two contracts)
  const accOf = (code: string) => contractKey(code)?.key ?? null;
  // a cost report line tied to an Aconex row of another code (NSCC's piling, coded CN.003C13-3 on the
  // report and 003C14 in Aconex) belongs to that row alone, not to the group of the code it is filed under
  const explicit = new Set<number>();
  for (const r of rows) {
    const l = byLine.get(Number(r.cost_line_id));
    if (l && String(r.row_type ?? "") !== "Budget hold" && accOf(String(r.code ?? "")) !== accOf(l.code)) explicit.add(l.id);
  }
  const groups = new Map<string, (typeof data.costReport.lines)[number][]>();
  const keysOfFrag = new Map<string, Set<string>>();
  for (const l of data.costReport.lines) {
    const ck = contractKey(l.code);
    if (!ck || l.is_budget_hold || explicit.has(l.id)) continue;
    groups.set(ck.key, [...(groups.get(ck.key) ?? []), l]);
    keysOfFrag.set(ck.frag, new Set([...(keysOfFrag.get(ck.frag) ?? []), ck.key]));
  }
  // the group of a row's code: the same section and code, else – when one side carries no section – the code's only group
  const groupOf = (code: string) => {
    const ck = contractKey(code);
    if (!ck) return undefined;
    const own = groups.get(ck.key);
    if (own) return own;
    const keys = [...(keysOfFrag.get(ck.frag) ?? [])];
    return keys.length === 1 && (!ck.section || !keys[0].includes(".")) ? groups.get(keys[0]) : undefined;
  };
  const sumOf = (members: (typeof data.costReport.lines)[number][]): Record<AconexMeasureKey, number | null> => {
    const out = blankMeasures();
    for (const m of members) for (const k of Object.keys(out) as AconexMeasureKey[]) out[k] = r2((out[k] ?? 0) + (dashOf(m)[k] ?? 0));
    return out;
  };
  const directRows = rows.filter((r) => String(r.row_type ?? "") === "Direct payment");
  for (const r of rows) {
    if (String(r.row_type ?? "") === "Direct payment") continue;
    const lineId = Number(r.cost_line_id);
    const l = lineId ? byLine.get(lineId) : undefined;
    const acc = String(r.row_type ?? "") === "Budget hold" ? null : accOf(String(r.code ?? ""));
    const grp = acc ? groupOf(String(r.code ?? "")) : undefined;
    const members = grp && grp.length ? grp : l ? [l] : [];
    for (const m of members) usedLine.add(m.id);
    const lead = members.find((m) => m.id === l?.id) ?? members[0];
    lines.push(
      finish({
        status: lead ? "matched" : "aconex_only",
        code: lead ? `${lead.code}${members.length > 1 ? ` (+${members.length - 1} lines)` : ""}` : "",
        aconexCode: String(r.code ?? ""),
        name: lead ? (members.length > 1 ? `${lead.name} – with ${members.length - 1} more line(s) of contract ${acc}` : lead.name) : String(r.name ?? r.description ?? ""),
        contractor: lead ? lead.contractor : "",
        category: lead ? lead.category : String(r.row_type ?? ""),
        rowType: String(r.row_type ?? ""),
        aconex: aconexOf(r),
        dashboard: lead ? sumOf(members) : blankMeasures(),
        diff: blankMeasures(),
        worst: 0,
        differs: [],
      }),
    );
  }
  // the direct payments on behalf of the main contractor: Aconex's rows (one per vendor and month) added
  // together against the cost report's "Direct Payment" lines, as one line of the check
  if (directRows.length) {
    const members = data.costReport.lines.filter((l) => !l.is_budget_hold && !usedLine.has(l.id) && isDirectPaymentLine(l.code, l.name));
    for (const m of members) usedLine.add(m.id);
    const aconex = blankMeasures();
    for (const r of directRows) {
      const a = aconexOf(r);
      for (const k of Object.keys(aconex) as AconexMeasureKey[]) if (a[k] !== null) aconex[k] = r2((aconex[k] ?? 0) + (a[k] ?? 0));
    }
    const first = members[0];
    lines.push(
      finish({
        status: first ? "matched" : "aconex_only",
        code: first ? `Direct payments (${members.length} lines)` : "",
        aconexCode: `${directRows.length} Aconex rows`,
        name: `Direct payments on behalf of the main contractor – ${directRows.length} Aconex row(s)${first ? ` against the cost report's ${members.length} Direct Payment line(s)` : ""}`,
        contractor: "",
        category: first ? first.category : "Direct payment",
        rowType: "Direct payment",
        aconex,
        dashboard: first ? sumOf(members) : blankMeasures(),
        diff: blankMeasures(),
        worst: 0,
        differs: [],
      }),
    );
  }
  for (const l of data.costReport.lines) {
    if (usedLine.has(l.id)) continue;
    lines.push(finish({ status: "dashboard_only", code: l.code, aconexCode: "", name: l.name, contractor: l.contractor, category: l.category, rowType: l.is_budget_hold ? "Budget hold" : "Contract", aconex: blankMeasures(), dashboard: dashOf(l), diff: blankMeasures(), worst: 0, differs: [] }));
  }
  const zero = () => ({ budget: 0, commitments: 0, dvo: 0, pvo: 0, hold: 0, ew: 0, eac: 0, eac_rsg: 0, incurred: 0 });
  // The comparison is only meaningful over the lines both systems hold: an Aconex row with no
  // cost report line, or a cost report line Aconex does not carry, would otherwise be read as a
  // difference – and a cost report line that several Aconex rows point at must be counted once.
  // Each figure is totalled over the lines it is compared on: commitments and incurred over the
  // contracts (a budget hold has no commitment), budget over the holds and the contracts alike for
  // information, estimate at completion over every line. A budget hold's "commitments" on the
  // dashboard is the hold's own arithmetic and would only muddy the contract comparison.
  const totals = { aconex: zero(), dashboard: zero(), diff: zero(), lines: zero() };
  const unmatched = { aconex: zero(), dashboard: zero() };
  const countedLines = new Set<string>();
  // budget and estimate at completion over every line; commitments, changes and incurred over the contracts only
  const counts = (m: (typeof ACONEX_MEASURES)[number], rowType: string) => (m.key === "hold" ? rowType === "Budget hold" : m.key === "budget" || m.key === "eac" || m.key === "eac_rsg" || m.key === "ew" || rowType !== "Budget hold");
  for (const line of lines) {
    for (const m of ACONEX_MEASURES) {
      if (!counts(m, line.rowType)) continue;
      if (line.status === "matched") {
        totals.aconex[m.key] += line.aconex[m.key] ?? 0;
        if (!countedLines.has(`${m.key}|${line.code}`)) {
          totals.dashboard[m.key] += line.dashboard[m.key] ?? 0;
          totals.lines[m.key]++;
        }
      } else if (line.status === "aconex_only") unmatched.aconex[m.key] += line.aconex[m.key] ?? 0;
      else unmatched.dashboard[m.key] += line.dashboard[m.key] ?? 0;
    }
    if (line.status === "matched") for (const m of ACONEX_MEASURES) countedLines.add(`${m.key}|${line.code}`);
  }
  for (const m of ACONEX_MEASURES) {
    totals.aconex[m.key] = r2(totals.aconex[m.key]);
    totals.dashboard[m.key] = r2(totals.dashboard[m.key]);
    totals.diff[m.key] = r2(totals.aconex[m.key] - totals.dashboard[m.key]);
    unmatched.aconex[m.key] = r2(unmatched.aconex[m.key]);
    unmatched.dashboard[m.key] = r2(unmatched.dashboard[m.key]);
  }
  const matched = lines.filter((l) => l.status === "matched");
  const discrepancies = matched.filter((l) => l.differs.length).sort((a, b) => b.worst - a.worst);
  return {
    asOf,
    lines: lines.sort((a, b) => (a.category || "").localeCompare(b.category || "") || (a.code || a.aconexCode).localeCompare(b.code || b.aconexCode)),
    discrepancies,
    aconexOnly: lines.filter((l) => l.status === "aconex_only"),
    dashboardOnly: lines.filter((l) => l.status === "dashboard_only"),
    totals,
    unmatched,
    counts: { aconex: rows.length, dashboard: data.costReport.lines.length, matched: matched.length, differing: discrepancies.length, tolerance: TOLERANCE, directRows: directRows.length },
  };
}

export interface VarianceSource {
  code: string;
  name: string;
  contractor: string;
  rowType: string;
  aconex: number;
  dashboard: number;
  diff: number;
  /** the Aconex rows behind the line, when several point at one cost report line */
  aconexRows: string[];
}

/**
 * Where a total's difference comes from: the matched lines that carry it, built the way the total is –
 * each cost report line once, the Aconex rows pointing at it added together – so the listed differences
 * add up exactly to the figure in the totals table. Largest first; lines that agree are left out.
 */
export function varianceSources(rec: AconexReconciliation, key: AconexMeasureKey): { lines: VarianceSource[]; total: number; agreeing: number } {
  const counts = (rowType: string) => (key === "hold" ? rowType === "Budget hold" : key === "budget" || key === "eac" || key === "eac_rsg" || key === "ew" || rowType !== "Budget hold");
  const groups = new Map<string, VarianceSource>();
  for (const l of rec.lines) {
    if (l.status !== "matched" || !counts(l.rowType)) continue;
    let g = groups.get(l.code);
    if (!g) {
      g = { code: l.code, name: l.name, contractor: l.contractor, rowType: l.rowType, aconex: 0, dashboard: l.dashboard[key] ?? 0, diff: 0, aconexRows: [] };
      groups.set(l.code, g);
    }
    g.aconex = r2(g.aconex + (l.aconex[key] ?? 0));
    g.aconexRows.push(l.aconexCode);
  }
  let agreeing = 0;
  const lines: VarianceSource[] = [];
  for (const g of groups.values()) {
    g.diff = r2(g.aconex - g.dashboard);
    if (Math.abs(g.diff) < TOLERANCE) agreeing++;
    else lines.push(g);
  }
  lines.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { lines, total: r2(lines.reduce((t, l) => t + l.diff, 0)), agreeing };
}
