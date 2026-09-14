import type { RecordRow } from "../registers/types";
import { formatDate, todayIso } from "../format";
import { daysBetween } from "../registers/enrich-utils";
import type { ReportSpec, SourceField, SourceInfo } from "./types";
import { applyFilter, applySort, describeFilter, valueOf } from "./filter";
import { defaultColumns, loadSource } from "./sources";
import { writeNarrative } from "./narrative";

/**
 * Turns a spec into everything the three renderers need. The figures are worked out once here, so
 * the preview on screen, the PDF, the Excel and the Word summary can never disagree with each other.
 */

export interface ResultColumn {
  key: string;
  label: string;
  type: SourceField["type"];
  numeric: boolean;
}

export interface ResultGroup {
  label: string;
  rows: RecordRow[];
  totals: Record<string, number>;
}

export interface Kpi {
  label: string;
  value: string;
  note?: string;
}

export interface Band {
  label: string;
  n: number;
  value: number;
  /** Share of the total value, 0–100. */
  share: number;
}

export interface BuiltReport {
  source: string;
  title: string;
  /** Contract / package line, measure and unit line, period line – the three-line title block. */
  subtitle: string[];
  asOf: string;
  generatedAt: string;
  notes: string;
  /** The one-sentence answer that goes above everything else. */
  headline: string;
  filterSummary: string[];
  /** As-at date, what is counted, how money is shown – printed under the tables. */
  basis: string[];
  columns: ResultColumn[];
  rows: RecordRow[];
  groups: ResultGroup[] | null;
  groupLabel: string | null;
  totals: Record<string, number>;
  /** Money / number columns that carry a total. */
  totalKeys: string[];
  kpis: Kpi[];
  breakdown: { label: string; bands: Band[] } | null;
  ageing: { label: string; bands: Band[] } | null;
  /** How the ageing dates read – a due date, or when something last happened. */
  ageMode: "due" | "since";
  narrative: { heading: string; text: string }[];
  attention: string[];
  count: number;
  countAll: number;
  limited: boolean;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const isNum = (v: unknown) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A count of the distinct values in the source's natural grouping – a useful headline when there is no money. */
function breakdownCount(rows: RecordRow[], byKey: Map<string, SourceField>, info: SourceInfo): Kpi | null {
  const f = info.suggestGroupBy ? byKey.get(info.suggestGroupBy) : undefined;
  if (!f || !rows.length) return null;
  const n = new Set(rows.map((r) => String(valueOf(r, f) ?? ""))).size;
  return { label: `Distinct ${f.label.toLowerCase()}`, value: String(n), note: "across the records shown" };
}

/** The money column a report is "about" – the one totalled in the headline. */
function primaryMoney(columns: ResultColumn[]): ResultColumn | null {
  const money = columns.filter((c) => c.type === "money");
  if (!money.length) return null;
  const preferred = ["total_due", "value", "net_certified", "revised_value", "movement", "amount_provided", "cost_impact", "budget", "amount", "contractor_cost_view", "original_contract"];
  for (const key of preferred) {
    const hit = money.find((c) => c.key === key);
    if (hit) return hit;
  }
  return money[0];
}

function groupLabelOf(row: RecordRow, field: SourceField): string {
  const v = valueOf(row, field);
  if (v === null || v === undefined || v === "") return "(not set)";
  if (field.type === "boolean") return v === true ? "Yes" : "No";
  return String(v);
}

/** Count, value and share for each distinct value of a field. */
function bands(rows: RecordRow[], field: SourceField, moneyKey: string | null, max = 12): Band[] {
  const m = new Map<string, { n: number; value: number }>();
  for (const r of rows) {
    const k = groupLabelOf(r, field);
    const b = m.get(k) ?? { n: 0, value: 0 };
    b.n++;
    b.value += moneyKey ? num(r[moneyKey]) : 0;
    m.set(k, b);
  }
  const total = [...m.values()].reduce((t, b) => t + b.value, 0);
  const out = [...m.entries()].map(([label, b]) => ({ label, n: b.n, value: r2(b.value), share: total ? r2((b.value / total) * 100) : 0 }));
  out.sort((a, b) => (moneyKey ? b.value - a.value || b.n - a.n : b.n - a.n));
  return out.slice(0, max);
}

/** Days-late / days-old bands, on the finance ladder, counted from the source's own date column. */
function ageingBands(rows: RecordRow[], field: SourceField, moneyKey: string | null, mode: "due" | "since" = "due"): Band[] {
  const today = todayIso();
  const future = mode === "since" ? "Dated ahead" : "Not yet due";
  const order = [future, "1–30 days", "31–60 days", "61–90 days", "Over 90 days", "No date"];
  const m = new Map<string, { n: number; value: number }>(order.map((o) => [o, { n: 0, value: 0 }]));
  for (const r of rows) {
    const raw = r[field.key];
    const d = raw ? /^(\d{4}-\d{2}-\d{2})/.exec(String(raw))?.[1] : null;
    const past = d ? -daysBetween(today, d) : null;
    const key = past === null ? "No date" : past <= 0 ? future : past <= 30 ? "1–30 days" : past <= 60 ? "31–60 days" : past <= 90 ? "61–90 days" : "Over 90 days";
    const b = m.get(key)!;
    b.n++;
    b.value += moneyKey ? num(r[moneyKey]) : 0;
  }
  const total = [...m.values()].reduce((t, b) => t + b.value, 0);
  return order
    .map((label) => ({ label, ...m.get(label)! }))
    .filter((b) => b.n > 0)
    .map((b) => ({ label: b.label, n: b.n, value: r2(b.value), share: total ? r2((b.value / total) * 100) : 0 }));
}

export interface BuildContext {
  programmeId: number;
  programmeName: string;
  programmeCode: string;
  assetName?: string | null;
  periodLabel: string;
  periodEnd: string;
  locked: boolean;
}

export function buildReport(spec: ReportSpec, ctx: BuildContext): BuiltReport {
  const { info, fields, rows: all, defaults } = loadSource(spec.source, ctx.programmeId);
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const filtered = applyFilter(all, spec, fields);
  const sorted = applySort(filtered, spec, fields);
  const limited = !!spec.limit && spec.limit > 0 && sorted.length > spec.limit;
  const rows = limited ? sorted.slice(0, spec.limit!) : sorted;

  const columnKeys = (spec.columns.length ? spec.columns : (defaults ?? defaultColumns(fields))).filter((k) => byKey.has(k));
  const columns: ResultColumn[] = columnKeys.map((k) => {
    const f = byKey.get(k)!;
    return { key: k, label: f.label, type: f.type, numeric: !!f.numeric };
  });

  const totalKeys = columns.filter((c) => c.numeric && c.type !== "percent").map((c) => c.key);
  const totalsOf = (set: RecordRow[]) => Object.fromEntries(totalKeys.map((k) => [k, r2(set.reduce((t, r) => t + num(r[k]), 0))]));
  const totals = totalsOf(rows);

  // Grouping
  let groups: ResultGroup[] | null = null;
  let groupLabel: string | null = null;
  const groupField = spec.groupBy ? byKey.get(spec.groupBy) : undefined;
  if (groupField) {
    groupLabel = groupField.label;
    const m = new Map<string, RecordRow[]>();
    for (const r of rows) {
      const k = groupLabelOf(r, groupField);
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    }
    groups = [...m.entries()].map(([label, set]) => ({ label, rows: set, totals: totalsOf(set) }));
    const money = primaryMoney(columns);
    groups.sort((a, b) => (money ? num(b.totals[money.key]) - num(a.totals[money.key]) : 0) || b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  }

  // Headline figures
  const money = primaryMoney(columns);
  const kpis: Kpi[] = [];
  kpis.push({ label: "Records", value: String(rows.length), note: rows.length === all.length ? "the whole register" : `of ${all.length} in the register` });
  if (money) kpis.push({ label: money.label, value: `SAR ${fmtMoney(totals[money.key] ?? 0)}`, note: "total across the records shown" });
  const overdueCol = columns.find((c) => c.key === "days" || c.key === "days_to_target");
  if (overdueCol) {
    const late = rows.filter((r) => isNum(r[overdueCol.key]) && Number(r[overdueCol.key]) < 0);
    if (late.length) kpis.push({ label: "Past their date", value: String(late.length), note: money ? `SAR ${fmtMoney(late.reduce((t, r) => t + num(r[money.key]), 0))} at stake` : undefined });
  }
  if (!money && breakdownCount(rows, byKey, info)) kpis.push(breakdownCount(rows, byKey, info)!);
  if (groups && groups.length) kpis.push({ label: `Largest ${groupLabel?.toLowerCase() ?? "group"}`, value: groups[0].label, note: money ? `SAR ${fmtMoney(groups[0].totals[money.key] ?? 0)} across ${groups[0].rows.length} record(s)` : `${groups[0].rows.length} record(s)` });

  // Breakdown and ageing
  const breakdownField = groupField ?? (info.suggestGroupBy ? byKey.get(info.suggestGroupBy) : undefined);
  const breakdown = spec.blocks.breakdown && breakdownField && rows.length ? { label: breakdownField.label, bands: bands(rows, breakdownField, money?.key ?? null) } : null;
  const ageField = info.ageField ? byKey.get(info.ageField) : undefined;
  const ageing = spec.blocks.ageing && ageField && rows.length ? { label: ageField.label, bands: ageingBands(rows, ageField, money?.key ?? null, info.ageMode ?? "due") } : null;

  const filterSummary = describeFilter(spec, fields);
  const written = writeNarrative({ spec, info, fields, rows, all, columns, totals, groups, groupLabel, breakdown, ageing, money, ctx });

  return {
    source: spec.source,
    title: spec.title?.trim() || info.title,
    subtitle: [
      `${ctx.programmeCode} · ${ctx.programmeName}${ctx.assetName ? ` · ${ctx.assetName}` : ""}`,
      `${info.title}${money ? ` · ${money.label} in SAR` : ""}`,
      `${ctx.periodLabel} · as at ${formatDate(ctx.periodEnd)}${ctx.locked ? "" : " · DRAFT (period not locked)"}`,
    ],
    asOf: ctx.periodEnd,
    generatedAt: new Date().toISOString(),
    notes: spec.notes?.trim() ?? "",
    headline: written.headline,
    filterSummary,
    basis: basisOf(info, filterSummary, ctx, all.length, rows.length),
    columns,
    rows,
    groups,
    groupLabel,
    totals,
    totalKeys,
    kpis,
    breakdown,
    ageing,
    ageMode: info.ageMode ?? "due",
    narrative: spec.blocks.narrative ? written.narrative : [],
    attention: spec.blocks.attention ? written.attention : [],
    count: rows.length,
    countAll: all.length,
    limited,
  };
}

/** The "basis of preparation" note – what was counted, as at when, and how the money is shown. */
function basisOf(info: SourceInfo, filterSummary: string[], ctx: BuildContext, countAll: number, count: number): string[] {
  const out: string[] = [];
  out.push(`Prepared from the ${info.title} of the commercial dashboard for ${ctx.programmeCode} ${ctx.programmeName}, as at ${formatDate(ctx.periodEnd)} (${ctx.periodLabel}${ctx.locked ? ", issued" : ", draft – the period is not locked"}).`);
  out.push(filterSummary.length ? `Filtered to: ${filterSummary.join("; ")}. ${count} of ${countAll} record(s) meet the filter.` : `No filter applied: all ${countAll} record(s) are included.`);
  out.push("All amounts are in SAR and exclude VAT unless the column says otherwise. Amounts are shown to the nearest SAR, negatives in brackets, and a dash means nothing is recorded.");
  if (info.ageField) out.push("Ageing is counted from the date each item falls due, not from when it was raised.");
  return out;
}

/** Whole SAR with thousands separators – the report convention, not the on-screen one. */
export function fmtMoney(v: unknown, dp = 0): string {
  if (v === null || v === undefined || v === "") return "–";
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  if (Math.abs(n) < 0.005) return "–";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return n < 0 ? `(${s})` : s;
}
