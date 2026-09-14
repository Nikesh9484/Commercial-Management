import type { FieldType } from "../registers/types";

/**
 * "Customise my reports": the shape of a report the user has put together themselves – which set of
 * records, filtered how, with which columns, grouped and sorted how, and which parts of the summary
 * to write. The same spec drives the on-screen preview, the PDF, the Excel and the Word summary, so
 * a download is always exactly what was on screen.
 *
 * This file stays free of server-only imports: the builder page uses it in the browser.
 */

export type FilterOp =
  | "contains"
  | "not_contains"
  | "eq"
  | "neq"
  | "starts"
  | "num_eq"
  | "num_gte"
  | "num_lte"
  | "num_between"
  | "date_on"
  | "date_before"
  | "date_after"
  | "date_between"
  | "last_days"
  | "next_days"
  | "overdue"
  | "in"
  | "not_in"
  | "is_true"
  | "is_false"
  | "blank"
  | "not_blank";

export interface Condition {
  field: string;
  op: FilterOp;
  /** Single value (text, number, ISO date, or day count). */
  value?: string | number | null;
  /** Upper bound for the "between" operators. */
  value2?: string | number | null;
  /** Chosen values for "is any of" / "is none of". */
  values?: (string | number)[];
}

export interface SummaryBlocks {
  /** Headline figures across the top. */
  kpis: boolean;
  /** Count and value per group / per category. */
  breakdown: boolean;
  /** Count and value per age band, where the report has a date to age against. */
  ageing: boolean;
  /** The written commercial narrative. */
  narrative: boolean;
  /** The "needs attention" bullets. */
  attention: boolean;
  /** The records themselves. */
  table: boolean;
}

export const DEFAULT_BLOCKS: SummaryBlocks = { kpis: true, breakdown: true, ageing: true, narrative: true, attention: true, table: true };

/**
 * The shape of the report – how much of it is wanted. Each style is only a set of the blocks above,
 * so it is a starting point the "What to include" ticks can still change; the style shown as chosen
 * is worked back out from the blocks, which means a report saved before styles existed still opens
 * on the right one.
 */
export type ReportLayout = "one_pager" | "summary" | "detailed" | "data" | "custom";

export interface LayoutDef {
  id: Exclude<ReportLayout, "custom">;
  label: string;
  description: string;
  /** The file this shape is meant for, said plainly on the page. */
  suits: string;
  blocks: SummaryBlocks;
}

export const LAYOUTS: LayoutDef[] = [
  {
    id: "one_pager",
    label: "One-pager",
    description: "The answer on a single page: the headline figures, the written position and what needs attention. No tables.",
    suits: "PDF or Word",
    blocks: { kpis: true, narrative: true, attention: true, breakdown: false, ageing: false, table: false },
  },
  {
    id: "summary",
    label: "Detailed summary",
    description: "The figures and the commentary with the breakdown and ageing behind them, but not the full list of records.",
    suits: "Word or PDF",
    blocks: { kpis: true, narrative: true, attention: true, breakdown: true, ageing: true, table: false },
  },
  {
    id: "detailed",
    label: "Full report",
    description: "Everything: the figures, the commentary, the breakdown, the ageing and every record.",
    suits: "PDF or Excel",
    blocks: { kpis: true, narrative: true, attention: true, breakdown: true, ageing: true, table: true },
  },
  {
    id: "data",
    label: "Records only",
    description: "Just the records with their totals and nothing written, for working on the figures yourself.",
    suits: "Excel",
    blocks: { kpis: false, narrative: false, attention: false, breakdown: false, ageing: false, table: true },
  },
];

/** Which style the ticks currently add up to, or "custom" when they match none of them. */
export function layoutOf(blocks: SummaryBlocks): ReportLayout {
  const hit = LAYOUTS.find((l) => (Object.keys(l.blocks) as (keyof SummaryBlocks)[]).every((k) => l.blocks[k] === blocks[k]));
  return hit?.id ?? "custom";
}

export interface ReportSpec {
  /** A source id from the catalogue, e.g. "bonds" or "payments_due". */
  source: string;
  /** Do the conditions all have to match, or any one of them? */
  match: "all" | "any";
  conditions: Condition[];
  /** Field keys in the order they should be printed. Empty = the source's own default set. */
  columns: string[];
  /** Field key to group the records under, with a subtotal per group. */
  groupBy?: string | null;
  sort: { field: string; dir: "asc" | "desc" }[];
  blocks: SummaryBlocks;
  /** Overrides the report's printed title. */
  title?: string;
  /** The user's own note, printed under the title. */
  notes?: string;
  /** Keep only the first N records (after sorting). */
  limit?: number | null;
}

export function emptySpec(source: string): ReportSpec {
  return { source, match: "all", conditions: [], columns: [], groupBy: null, sort: [], blocks: { ...DEFAULT_BLOCKS }, title: "", notes: "", limit: null };
}

/** One filterable / printable field of a source, as the builder page needs to render it. */
export interface SourceField {
  key: string;
  label: string;
  type: FieldType | "text";
  /** Fixed choices (select), or the labels of a lookup – what the "is any of" list offers. */
  options?: string[];
  /** True for money / number / percent: right-aligned and totalled. */
  numeric?: boolean;
  /** Shown in the default column set. */
  inDefault?: boolean;
  /** The part of the record this field belongs to, used to group the long field lists. */
  section?: string;
  help?: string;
}

export interface SourceInfo {
  id: string;
  title: string;
  description: string;
  group: string;
  /** Which field the ageing block counts days against, when the source has one. */
  ageField?: string;
  /** "due" = the field is a date the item falls due (overdue is bad); "since" = a date something last happened. */
  ageMode?: "due" | "since";
  /** Sensible field to group by when the user has not chosen one. */
  suggestGroupBy?: string;
  fields: SourceField[];
  /** One-click starting points, e.g. "Overdue payments". */
  presets: { id: string; label: string; description: string }[];
}

/* ------------------------------------------------------------------ operators */

export interface OpDef {
  op: FilterOp;
  label: string;
  /** How many value inputs the operator needs. */
  inputs: 0 | 1 | 2;
  /** Renders a multi-select of the field's options instead of a text box. */
  set?: boolean;
  /** The input is a number of days. */
  days?: boolean;
}

const TEXT_OPS: OpDef[] = [
  { op: "contains", label: "contains the words", inputs: 1 },
  { op: "eq", label: "is exactly", inputs: 1 },
  { op: "starts", label: "starts with", inputs: 1 },
  { op: "not_contains", label: "does not contain", inputs: 1 },
  { op: "neq", label: "is not", inputs: 1 },
  { op: "not_blank", label: "is not empty", inputs: 0 },
  { op: "blank", label: "is empty", inputs: 0 },
];

const NUM_OPS: OpDef[] = [
  { op: "num_gte", label: "is at least", inputs: 1 },
  { op: "num_lte", label: "is at most", inputs: 1 },
  { op: "num_between", label: "is between", inputs: 2 },
  { op: "num_eq", label: "is exactly", inputs: 1 },
  { op: "not_blank", label: "is not empty", inputs: 0 },
  { op: "blank", label: "is empty", inputs: 0 },
];

const DATE_OPS: OpDef[] = [
  { op: "overdue", label: "is already past", inputs: 0 },
  { op: "next_days", label: "is in the next … days", inputs: 1, days: true },
  { op: "last_days", label: "was in the last … days", inputs: 1, days: true },
  { op: "date_before", label: "is before", inputs: 1 },
  { op: "date_after", label: "is after", inputs: 1 },
  { op: "date_between", label: "is between", inputs: 2 },
  { op: "date_on", label: "is on", inputs: 1 },
  { op: "not_blank", label: "is not empty", inputs: 0 },
  { op: "blank", label: "is empty", inputs: 0 },
];

const SET_OPS: OpDef[] = [
  { op: "in", label: "is one of", inputs: 1, set: true },
  { op: "not_in", label: "is not one of", inputs: 1, set: true },
  { op: "not_blank", label: "is not empty", inputs: 0 },
  { op: "blank", label: "is empty", inputs: 0 },
];

const BOOL_OPS: OpDef[] = [
  { op: "is_true", label: "is Yes", inputs: 0 },
  { op: "is_false", label: "is No", inputs: 0 },
];

/** The operators offered for a field, decided by its type. */
export function opsFor(field: SourceField): OpDef[] {
  switch (field.type) {
    case "money":
    case "number":
    case "percent":
      return NUM_OPS;
    case "date":
      return DATE_OPS;
    case "boolean":
      return BOOL_OPS;
    case "select":
    case "lookup":
      return field.options && field.options.length ? SET_OPS : TEXT_OPS;
    default:
      return TEXT_OPS;
  }
}

/** How many values an operator needs filled in; 0 for the ones that stand on their own. */
export function opInputs(op: FilterOp): 0 | 1 | 2 {
  for (const list of [TEXT_OPS, NUM_OPS, DATE_OPS, SET_OPS, BOOL_OPS]) {
    const hit = list.find((o) => o.op === op);
    if (hit) return hit.inputs;
  }
  return 1;
}

/**
 * True when a condition has been filled in far enough to mean something. A condition that has been
 * added but not yet given a value is ignored rather than matching nothing, so a half-typed filter
 * never silently empties the report.
 */
export function isConditionReady(c: Condition): boolean {
  if (!c.field || !c.op) return false;
  const n = opInputs(c.op);
  if (n === 0) return true;
  const given = (v: unknown) => v !== undefined && v !== null && v !== "";
  if (Array.isArray(c.values)) return c.values.length > 0;
  if (!given(c.value)) return false;
  return n === 1 || given(c.value2);
}

export function opLabel(op: FilterOp): string {
  for (const list of [TEXT_OPS, NUM_OPS, DATE_OPS, SET_OPS, BOOL_OPS]) {
    const hit = list.find((o) => o.op === op);
    if (hit) return hit.label;
  }
  return op;
}
