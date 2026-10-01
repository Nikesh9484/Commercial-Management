import type { ReportData } from "../report/data";
import type { CostLineRow } from "../cost-report/columns";
import type { RecordRow } from "../registers/types";
import { formatMoney } from "../format";
import { addMonths, monthKey, monthLabel } from "./months";

/**
 * The Employer's cash flow forecast, built from what the dashboard already holds – no separate
 * grid to fill in. For every cost report line: the approved budget (column G) is laid out as a
 * planned S-curve between the line's first payment application and its contracts' revised
 * completion date; what has been certified (column P, month by month from the IPC log) is the
 * actual spend; the works still to complete (anticipated final account N less certified P) are
 * spread over the months left to completion. Packages are grouped the way a Project Controls
 * cash flow reads (design & consultancy, enabling, infrastructure, buildings, MEP, procurement,
 * testing & commissioning, contingency) and the whole thing is summarised for an Employer
 * executive review: monthly table, yearly table, KPIs, observations and the three charts.
 * All figures SAR excl. VAT, as the cost report.
 */
export { monthLabel };
export const CASH_CATEGORIES = ["Design & Consultancy", "Enabling Works", "Infrastructure", "Buildings", "MEP Works", "Procurement", "Testing & Commissioning", "Contingency", "Other"] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];
export type Payer = "contractor" | "consultant" | "other";

export interface CashMonth {
  key: string;
  label: string;
  year: number;
  /** before the report month: actual; the report month: current; after: forecast */
  kind: "actual" | "current" | "forecast";
  planned: number;
  actual: number;
  forecast: number;
  contractor: number;
  consultant: number;
  other: number;
  total: number;
  cumulative: number;
  cumulativePlanned: number;
}
export interface CashPackage {
  category: CashCategory;
  lines: number;
  budget: number;
  committed: number;
  actual: number;
  forecastRemaining: number;
  forecastFinal: number;
  variance: number;
  firstMonth: string | null;
  lastMonth: string | null;
  peakMonth: string | null;
  peakAmount: number;
  byMonth: Record<string, number>;
}
export interface CashYear {
  year: number;
  budget: number;
  forecast: number;
  actual: number;
  variance: number;
}
export interface CashLine {
  code: string;
  name: string;
  contractor: string;
  category: CashCategory;
  payer: Payer;
  budget: number;
  committed: number;
  actual: number;
  forecastFinal: number;
  start: string;
  end: string;
}
export interface CashflowForecast {
  programme: { name: string; code: string };
  period: { label: string; reportNo: number; end: string; month: string };
  currency: "SAR";
  summary: {
    budget: number;
    actual: number;
    committed: number;
    forecastRemaining: number;
    forecastFinal: number;
    /** the cost report's anticipated final account (column N) */
    afa: number;
    variance: number;
    start: string;
    end: string;
    durationMonths: number;
    previousForecastFinal: number | null;
    forecastChange: number | null;
  };
  kpis: { budgetUtilisation: number | null; committedPct: number | null; spentPct: number | null; completionPct: number | null; remainingBudget: number; peakMonth: { key: string; label: string; amount: number } | null };
  months: CashMonth[];
  packages: CashPackage[];
  years: CashYear[];
  lines: CashLine[];
  observations: string[];
  assumptions: string[];
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const monthsBetween = (a: string, b: string) => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};
/** cumulative share of an S-curve at t in [0, 1] */
const sCurve = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** The cash flow package a cost report line belongs to, from its Level 1 category, package and name. */
export function cashCategory(line: Pick<CostLineRow, "category" | "package" | "name" | "is_budget_hold" | "section">): CashCategory {
  const text = `${line.package} ${line.name}`.toLowerCase();
  const cat = (line.category ?? "").toLowerCase();
  if (line.is_budget_hold || /remaining budget|contingency|budget hold|inter project transfer/.test(text)) return "Contingency";
  if (/testing|commissioning|labs and all testing|preloading test/.test(text)) return "Testing & Commissioning";
  if (/\bmep\b|mechanical|electrical|plumbing|hvac|ev charging|access control/.test(text)) return "MEP Works";
  if (/ff&e|os&e|ffe|ose|procurement|supply of|furniture|spares|dock carts|equipment|supply and delivery/.test(text) || /ff&e/.test(cat)) return "Procurement";
  if (/professional|supervision|commercial management|management/.test(cat) || /consult|design|study|survey|engineer|architect|feasib|insurance|takaful|ocip|\bcar\b/.test(text)) return "Design & Consultancy";
  if (/early works/.test(cat) || /early works|enabling|demolition|site clearance|prelim|site logistics|temporary/.test(text)) return "Enabling Works";
  if (/marine|quay|jetty|jetties|boardwalk|pontoon|breakwater|dredg|infrastructure|utilit|road|berth|mooring|coral|ecology|seaplane|navigation|basin|shoring|block wall|porous|bridge|public realm|edge/.test(text)) return "Infrastructure";
  if (/construction/.test(cat) || /building|villa|hotel|condo|structure|main works|construction|fit[- ]?out|landscap|facade|roof/.test(text)) return "Buildings";
  return "Other";
}
const payerOf = (c: CashCategory): Payer => (c === "Design & Consultancy" ? "consultant" : c === "Contingency" || c === "Other" ? "other" : "contractor");

export function buildCashflowForecast(data: ReportData): CashflowForecast {
  const report = data.costReport;
  const reportMonth = monthKey(String(data.period.period_end ?? data.generatedAt).slice(0, 10));
  const contracts = (data.registers.contracts?.rows ?? []) as RecordRow[];
  const apps = (data.registers.payment_applications?.rows ?? []) as RecordRow[];
  const assumptions: string[] = [];

  // the project's own span: first payment application to the last revised completion date
  const appDates = apps.map((a) => String(a.ipc_date ?? a.application_date ?? "")).filter((d) => /^\d{4}-\d{2}/.test(d)).sort();
  const completions = contracts.map((c) => String(c.revised_completion_date ?? c.original_completion_date ?? "")).filter((d) => /^\d{4}-\d{2}/.test(d)).sort();
  const programmeStart = appDates.length ? monthKey(appDates[0]) : addMonths(reportMonth, -24);
  let programmeEnd = completions.length ? monthKey(completions[completions.length - 1]) : addMonths(reportMonth, 12);
  if (monthsBetween(reportMonth, programmeEnd) < 1) programmeEnd = addMonths(reportMonth, 3);
  if (!appDates.length) assumptions.push("No payment applications are recorded yet: the plan starts two years before the report month.");
  if (!completions.length) assumptions.push("No contract carries a completion date: the forecast runs twelve months beyond the report month.");

  const months: CashMonth[] = [];
  const firstKey = programmeStart;
  const lastKey = programmeEnd;
  for (let k = firstKey; monthsBetween(k, lastKey) >= 0; k = addMonths(k, 1)) {
    months.push({ key: k, label: monthLabel(k), year: Number(k.slice(0, 4)), kind: k < reportMonth ? "actual" : k === reportMonth ? "current" : "forecast", planned: 0, actual: 0, forecast: 0, contractor: 0, consultant: 0, other: 0, total: 0, cumulative: 0, cumulativePlanned: 0 });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  const add = (key: string, field: "planned" | "actual" | "forecast", v: number, payer?: Payer) => {
    if (!v) return;
    const k = key < firstKey ? firstKey : key > lastKey ? lastKey : key;
    const m = byKey.get(k)!;
    m[field] = r2(m[field] + v);
    if (payer && field !== "planned") m[payer] = r2(m[payer] + v);
  };

  const packages = new Map<CashCategory, CashPackage>();
  const pkg = (c: CashCategory) => {
    let p = packages.get(c);
    if (!p) {
      p = { category: c, lines: 0, budget: 0, committed: 0, actual: 0, forecastRemaining: 0, forecastFinal: 0, variance: 0, firstMonth: null, lastMonth: null, peakMonth: null, peakAmount: 0, byMonth: {} };
      packages.set(c, p);
    }
    return p;
  };
  const lines: CashLine[] = [];
  let residualNote = 0;
  let overCertified = 0;
  // the lines of one contract (CN.031C02, CN.031C02-2 … share the contract code) are forecast together:
  // the certificates land on the line the contract is linked to, the budget sits across the group
  interface Group { key: string; lines: CostLineRow[]; budget: number; committed: number; afa: number; actual: number }
  const groups = new Map<string, Group>();
  for (const line of report.lines) {
    const acc = line.code.match(/\b(\d{3}[A-Z]\d{2})\b/)?.[1];
    const key = acc ? `acc:${line.asset_id}:${acc}` : `line:${line.id}`;
    const g = groups.get(key) ?? { key, lines: [], budget: 0, committed: 0, afa: 0, actual: 0 };
    g.lines.push(line);
    g.budget = r2(g.budget + num(line.G));
    g.committed = r2(g.committed + num(line.I));
    g.afa = r2(g.afa + num(line.N));
    g.actual = r2(g.actual + num(line.P));
    groups.set(key, g);
  }
  for (const grp of groups.values()) {
    const lead = [...grp.lines].sort((x, y) => Math.abs(num(y.G)) - Math.abs(num(x.G)))[0];
    const category = cashCategory(lead);
    const payer = payerOf(category);
    const ids = new Set(contracts.filter((c) => grp.lines.some((l) => Number(c.cost_line_id) === l.id)).map((c) => Number(c.id)));
    const mine = contracts.filter((c) => ids.has(Number(c.id)));
    const lineApps = apps.filter((a) => ids.has(Number(a.contract_id)));
    const dates = lineApps.map((a) => String(a.application_date ?? a.ipc_date ?? "")).filter((d) => /^\d{4}-\d{2}/.test(d)).sort();
    const ends = mine.map((c) => String(c.revised_completion_date ?? c.original_completion_date ?? "")).filter((d) => /^\d{4}-\d{2}/.test(d)).sort();
    const start = dates.length ? monthKey(dates[0]) : programmeStart;
    let end = ends.length ? monthKey(ends[ends.length - 1]) : programmeEnd;
    if (end < start) end = start;

    const budget = grp.budget;
    const afa = grp.afa;
    let actual = grp.actual;
    // actual month by month from the IPC log (certified, net excl. VAT); the cost report's certified-to-date is the authority
    const monthly = new Map<string, number>();
    for (const a of lineApps) {
      const d = String(a.ipc_date ?? "");
      const v = num(a.net_certified);
      if (!/^\d{4}-\d{2}/.test(d) || !v) continue;
      const k = monthKey(d);
      monthly.set(k, r2((monthly.get(k) ?? 0) + v));
    }
    const logged = r2([...monthly.values()].reduce((sum, v) => sum + v, 0));
    if (!actual && logged) actual = logged;
    for (const [k, v] of monthly) add(k > reportMonth ? reportMonth : k, "actual", v, payer);
    const residual = r2(actual - logged);
    if (Math.abs(residual) >= 0.5) {
      add(reportMonth, "actual", residual, payer);
      residualNote += Math.abs(residual);
    }

    // planned: the budget on an S-curve across the span
    const span = Math.max(1, monthsBetween(start, end) + 1);
    const planned: number[] = [];
    for (let i = 0; i < span; i++) planned.push(r2(budget * (sCurve((i + 1) / span) - sCurve(i / span))));
    planned.forEach((v, i) => add(addMonths(start, i), "planned", v));

    // forecast: what is left to the anticipated final account, over the months still to run
    let remaining = r2(afa - actual);
    if (remaining < 0) {
      overCertified = r2(overCertified - remaining);
      remaining = 0;
    }
    const from = addMonths(reportMonth, 1);
    let to = end > reportMonth ? end : addMonths(reportMonth, remaining > 0 ? 3 : 1);
    if (to < from) to = from;
    const n = monthsBetween(from, to) + 1;
    const weights: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = addMonths(from, i);
      const idx = monthsBetween(start, k);
      weights.push(idx >= 0 && idx < span ? Math.max(planned[idx], 0) : 0);
    }
    const wsum = weights.reduce((sum, v) => sum + v, 0);
    const slices: [string, number][] = [];
    let spread = 0;
    for (let i = 0; i < n; i++) {
      const share = wsum > 0 ? weights[i] / wsum : 1 / n;
      const v = i === n - 1 ? r2(remaining - spread) : r2(remaining * share);
      spread = r2(spread + v);
      slices.push([addMonths(from, i), v]);
    }
    for (const [k, v] of slices) add(k, "forecast", v, payer);

    const p = pkg(category);
    p.lines += grp.lines.length;
    p.budget = r2(p.budget + budget);
    p.committed = r2(p.committed + grp.committed);
    p.actual = r2(p.actual + actual);
    p.forecastRemaining = r2(p.forecastRemaining + remaining);
    p.forecastFinal = r2(p.forecastFinal + afa);
    for (const [k, v] of monthly) p.byMonth[k] = r2((p.byMonth[k] ?? 0) + v);
    if (Math.abs(residual) >= 0.5) p.byMonth[reportMonth] = r2((p.byMonth[reportMonth] ?? 0) + residual);
    for (const [k, v] of slices) if (v) p.byMonth[k] = r2((p.byMonth[k] ?? 0) + v);
    for (const line of grp.lines) lines.push({ code: line.code, name: line.name, contractor: line.contractor, category, payer, budget: num(line.G), committed: num(line.I), actual: num(line.P), forecastFinal: num(line.N), start, end });
  }
  if (overCertified) assumptions.push(`Contracts certified beyond their anticipated final account (SAR ${formatMoney(overCertified)} in all) carry no further forecast; the final account will settle them.`);
  if (residualNote) assumptions.push(`Where the IPC log does not carry the full certified-to-date of a line, the difference (SAR ${formatMoney(residualNote)} in all) is placed in the report month.`);

  let cum = 0;
  let cumPlanned = 0;
  for (const m of months) {
    m.total = r2(m.actual + m.forecast);
    cum = r2(cum + m.total);
    cumPlanned = r2(cumPlanned + m.planned);
    m.cumulative = cum;
    m.cumulativePlanned = cumPlanned;
  }
  for (const p of packages.values()) {
    p.variance = r2(p.forecastFinal - p.budget);
    const keys = Object.keys(p.byMonth).filter((k) => Math.abs(p.byMonth[k]) >= 0.5).sort();
    p.firstMonth = keys[0] ?? null;
    p.lastMonth = keys[keys.length - 1] ?? null;
    for (const k of keys) if (p.byMonth[k] > p.peakAmount) {
      p.peakAmount = p.byMonth[k];
      p.peakMonth = k;
    }
  }
  const packageRows = CASH_CATEGORIES.map((c) => packages.get(c)).filter((p): p is CashPackage => !!p);

  const years = new Map<number, CashYear>();
  for (const m of months) {
    const y = years.get(m.year) ?? { year: m.year, budget: 0, forecast: 0, actual: 0, variance: 0 };
    y.budget = r2(y.budget + m.planned);
    y.forecast = r2(y.forecast + m.total);
    y.actual = r2(y.actual + m.actual);
    y.variance = r2(y.forecast - y.budget);
    years.set(m.year, y);
  }

  const g = report.grandTotal;
  const budget = num(g.G);
  const actual = r2(lines.reduce((sum, l) => sum + l.actual, 0));
  const committed = num(g.I);
  const afa = num(g.N);
  // the cash still to go out: every contract's works to complete (a contract certified beyond its anticipated
  // final account adds nothing back), so the forecast final cost is what will actually be paid
  const cashToComplete = r2(months.reduce((sum, m) => sum + m.forecast, 0));
  const forecastFinal = r2(actual + cashToComplete);
  if (Math.abs(forecastFinal - afa) >= 0.5) assumptions.push(`The cost report's anticipated final account is SAR ${formatMoney(afa)}; the cash forecast final cost is SAR ${formatMoney(forecastFinal)} because certified amounts above the anticipated final account on some contracts are not netted off other contracts' works to complete.`);
  const prevAvailable = !!data.previousCostReport;
  const previousForecastFinal = prevAvailable ? r2(num(g.R) + (forecastFinal - afa)) : null;
  const peak = months.reduce<CashMonth | null>((best, m) => (m.total > (best?.total ?? 0) ? m : best), null);
  const pct = (a: number, b: number) => (b > 0 ? r2((a / b) * 100) : null);

  const observations: string[] = [];
  const top = [...months].filter((m) => m.total > 0).sort((a, b) => b.total - a.total).slice(0, 3);
  if (top.length) observations.push(`Highest cash requirement: ${top.map((m) => `${m.label} (SAR ${formatMoney(m.total)})`).join(", ")}${top[0].kind === "forecast" ? " – forecast months, to be funded." : "."}`);
  const future = months.filter((m) => m.kind === "forecast");
  const next12 = r2(future.slice(0, 12).reduce((s, m) => s + m.total, 0));
  if (future.length) observations.push(`Funding needed over the next 12 months: SAR ${formatMoney(next12)}; cash to completion SAR ${formatMoney(cashToComplete)} by ${monthLabel(programmeEnd)}.`);
  const spendy = packageRows.filter((p) => p.peakMonth).sort((a, b) => b.forecastRemaining - a.forecastRemaining).slice(0, 3);
  if (spendy.length) observations.push(`Major package spending: ${spendy.map((p) => `${p.category} ${p.firstMonth ? monthLabel(p.firstMonth) : "–"} to ${p.lastMonth ? monthLabel(p.lastMonth) : "–"}, peak ${p.peakMonth ? monthLabel(p.peakMonth) : "–"} (SAR ${formatMoney(p.peakAmount)})`).join("; ")}.`);
  const risks = lines.filter((l) => l.forecastFinal - l.budget > 0.5).sort((a, b) => b.forecastFinal - b.budget - (a.forecastFinal - a.budget)).slice(0, 3);
  if (risks.length) observations.push(`Budget risks – forecast above budget: ${risks.map((l) => `${l.code} ${l.name} (+SAR ${formatMoney(r2(l.forecastFinal - l.budget))})`).join("; ")}.`);
  else observations.push("No cost report line forecasts above its latest budget.");
  const savings = lines.filter((l) => l.budget - l.forecastFinal > 0.5 && !/remaining budget|budget hold/i.test(l.name)).sort((a, b) => b.budget - b.forecastFinal - (a.budget - a.forecastFinal)).slice(0, 3);
  if (savings.length) observations.push(`Potential savings – forecast below budget: ${savings.map((l) => `${l.code} ${l.name} (SAR ${formatMoney(r2(l.budget - l.forecastFinal))})`).join("; ")}.`);
  if (previousForecastFinal !== null) {
    const change = r2(forecastFinal - previousForecastFinal);
    observations.push(Math.abs(change) < 0.5 ? "The forecast final cost is unchanged from the previous report." : `The forecast final cost ${change > 0 ? "rose" : "fell"} by SAR ${formatMoney(Math.abs(change))} since the previous report (${data.previousPeriod?.label ?? "previous"}).`);
  } else observations.push("No previous issued report to compare the forecast with.");

  assumptions.unshift(
    "Planned spend: each line's latest approved budget (column G) on an S-curve from its first payment application to its contracts' revised completion date.",
    "Actual spend: certified amounts (net, excl. VAT) by Interim Payment Certificate month from the IPC log, totalling the cost report's certified to date (column P).",
    "Forecast spend: works to complete (anticipated final account N less certified P) spread over the months to completion, following the planned curve; a line already past completion is cleared over the next three months.",
    "Committed cost: column I (awarded contracts plus determined VOs); forecast final cost: column N (anticipated final account); approved budget: column G.",
  );

  return {
    programme: { name: data.programme.name, code: data.programme.code },
    period: { label: String(data.period.label ?? ""), reportNo: Number(data.period.report_no ?? 0), end: String(data.period.period_end ?? ""), month: reportMonth },
    currency: "SAR",
    summary: { budget, actual, committed, afa, forecastRemaining: cashToComplete, forecastFinal, variance: r2(forecastFinal - budget), start: programmeStart, end: programmeEnd, durationMonths: months.length, previousForecastFinal, forecastChange: previousForecastFinal === null ? null : r2(forecastFinal - previousForecastFinal) },
    kpis: { budgetUtilisation: pct(forecastFinal, budget), committedPct: pct(committed, budget), spentPct: pct(actual, budget), completionPct: pct(actual, forecastFinal), remainingBudget: r2(budget - actual), peakMonth: peak ? { key: peak.key, label: peak.label, amount: peak.total } : null },
    months,
    packages: packageRows,
    years: [...years.values()].sort((a, b) => a.year - b.year),
    lines,
    observations,
    assumptions,
  };
}
