import type { RecordRow } from "../registers/types";
import type { Condition, ReportSpec, SourceField } from "./types";
import { opLabel } from "./types";

/**
 * Applies the builder's filter conditions to a set of rows. Pure and free of server imports so the
 * preview in the browser and the download on the server run exactly the same rules.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** The value a condition tests: the label for a lookup, the raw value otherwise. */
export function valueOf(row: RecordRow, field: SourceField): unknown {
  if (field.type === "lookup") {
    const label = row[`${field.key}__label`];
    return label === undefined ? row[field.key] : label;
  }
  return row[field.key];
}

const isBlank = (v: unknown) => v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
const text = (v: unknown) => String(v ?? "").trim().toLowerCase();
const num = (v: unknown) => {
  if (isBlank(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
/** ISO date (YYYY-MM-DD) from whatever the row holds; null when it is not a date. */
const iso = (v: unknown): string | null => {
  if (isBlank(v)) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
function shiftDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Does one row satisfy one condition? */
export function matchesCondition(row: RecordRow, c: Condition, field: SourceField): boolean {
  const raw = valueOf(row, field);
  switch (c.op) {
    case "blank":
      return isBlank(raw);
    case "not_blank":
      return !isBlank(raw);
    case "is_true":
      return raw === true || raw === 1 || text(raw) === "yes" || text(raw) === "true";
    case "is_false":
      return raw === false || raw === 0 || text(raw) === "no" || text(raw) === "false";
    case "contains":
      return text(raw).includes(text(c.value));
    case "not_contains":
      return !text(raw).includes(text(c.value));
    case "eq":
      return text(raw) === text(c.value);
    case "neq":
      return text(raw) !== text(c.value);
    case "starts":
      return text(raw).startsWith(text(c.value));
    case "in":
      return (c.values ?? []).map((x) => text(x)).includes(text(raw));
    case "not_in":
      return !(c.values ?? []).map((x) => text(x)).includes(text(raw));
    case "num_eq": {
      const n = num(raw);
      const a = num(c.value);
      return n !== null && a !== null && Math.abs(n - a) < 0.005;
    }
    case "num_gte": {
      const n = num(raw);
      const a = num(c.value);
      return n !== null && a !== null && n >= a;
    }
    case "num_lte": {
      const n = num(raw);
      const a = num(c.value);
      return n !== null && a !== null && n <= a;
    }
    case "num_between": {
      const n = num(raw);
      const a = num(c.value);
      const b = num(c.value2);
      if (n === null) return false;
      if (a !== null && n < a) return false;
      if (b !== null && n > b) return false;
      return a !== null || b !== null;
    }
    case "date_on": {
      const d = iso(raw);
      return d !== null && d === iso(c.value);
    }
    case "date_before": {
      const d = iso(raw);
      const a = iso(c.value);
      return d !== null && a !== null && d < a;
    }
    case "date_after": {
      const d = iso(raw);
      const a = iso(c.value);
      return d !== null && a !== null && d > a;
    }
    case "date_between": {
      const d = iso(raw);
      const a = iso(c.value);
      const b = iso(c.value2);
      if (d === null) return false;
      if (a !== null && d < a) return false;
      if (b !== null && d > b) return false;
      return a !== null || b !== null;
    }
    case "last_days": {
      const d = iso(raw);
      const n = num(c.value);
      if (d === null || n === null) return false;
      return d <= today() && d >= shiftDays(-Math.abs(n));
    }
    case "next_days": {
      const d = iso(raw);
      const n = num(c.value);
      if (d === null || n === null) return false;
      return d >= today() && d <= shiftDays(Math.abs(n));
    }
    case "overdue": {
      const d = iso(raw);
      return d !== null && d < today();
    }
    default:
      return true;
  }
}

/** Applies every condition of a spec. */
export function applyFilter(rows: RecordRow[], spec: ReportSpec, fields: SourceField[]): RecordRow[] {
  const live = spec.conditions.filter((c) => c.field && c.op);
  if (!live.length) return rows;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return rows.filter((r) => {
    const results = live.map((c) => {
      const f = byKey.get(c.field);
      return f ? matchesCondition(r, c, f) : true;
    });
    return spec.match === "any" ? results.some(Boolean) : results.every(Boolean);
  });
}

/** "Expiry date is in the next 30 days", for printing at the top of the report. */
export function describeCondition(c: Condition, fields: SourceField[]): string {
  const f = fields.find((x) => x.key === c.field);
  const name = f?.label ?? c.field;
  const op = opLabel(c.op);
  if (c.op === "in" || c.op === "not_in") return `${name} ${op} ${(c.values ?? []).join(", ") || "–"}`;
  if (c.op === "num_between" || c.op === "date_between") return `${name} ${op} ${c.value ?? "–"} and ${c.value2 ?? "–"}`;
  if (c.op === "last_days" || c.op === "next_days") return `${name} ${op.replace("…", String(c.value ?? "?"))}`;
  if (c.value === undefined || c.value === null || c.value === "") return `${name} ${op}`;
  return `${name} ${op} ${c.value}`;
}

export function describeFilter(spec: ReportSpec, fields: SourceField[]): string[] {
  return spec.conditions.filter((c) => c.field && c.op).map((c) => describeCondition(c, fields));
}

/** Sorts rows by the spec's sort list, falling back to the first column. */
export function applySort(rows: RecordRow[], spec: ReportSpec, fields: SourceField[]): RecordRow[] {
  const sorts = spec.sort.filter((s) => s.field);
  if (!sorts.length) return rows;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const f = byKey.get(s.field);
      if (!f) continue;
      const av = valueOf(a, f);
      const bv = valueOf(b, f);
      const dir = s.dir === "desc" ? -1 : 1;
      const blankA = isBlank(av);
      const blankB = isBlank(bv);
      if (blankA && blankB) continue;
      if (blankA) return 1; // empties last, whichever way the sort runs
      if (blankB) return -1;
      let cmp = 0;
      if (f.numeric) cmp = (num(av) ?? 0) - (num(bv) ?? 0);
      else if (f.type === "date") cmp = String(iso(av) ?? "").localeCompare(String(iso(bv) ?? ""));
      else if (f.type === "boolean") cmp = (av === true ? 1 : 0) - (bv === true ? 1 : 0);
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
}
