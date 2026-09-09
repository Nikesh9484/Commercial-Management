/**
 * Formatting helpers used everywhere in the app.
 * Money: SAR with thousands separators and 2 decimals -> "1,234,567.00"
 * Dates: DD-MMM-YY -> "09-Sep-26"
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const moneyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | string | null | undefined, withCurrency = false): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "";
  const text = moneyFormatter.format(n);
  return withCurrency ? `SAR ${text}` : text;
}

export function formatNumber(value: number | string | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "";
  return `${formatNumber(n, 2)}%`;
}

/** Accepts "YYYY-MM-DD", ISO date-time, or a Date. Returns "DD-MMM-YY". */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = toDate(value);
  if (!d) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mmm = MONTHS[d.getUTCMonth()];
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}-${mmm}-${yy}`;
}

/** "DD-MMM-YY HH:MM" for change history timestamps (shown in local time). */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = toDate(value);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mmm = MONTHS[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mmm}-${yy} ${hh}:${mi}`;
}

/** "Sep'26" style month label used in reporting period names. */
export function formatMonthYear(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = toDate(value);
  if (!d) return "";
  return `${MONTHS[d.getUTCMonth()]}'${String(d.getUTCFullYear()).slice(-2)}`;
}

export function toDate(value: string | Date | number): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return new Date(value);
  const s = value.trim();
  if (!s) return null;
  // Plain date "YYYY-MM-DD" -> treat as UTC midnight so the day never shifts.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse many human date formats into "YYYY-MM-DD" (used for Excel import and forms).
 * Supports: YYYY-MM-DD, DD-MMM-YY, DD-MMM-YYYY, DD/MM/YYYY, DD/MM/YY, Excel Date objects.
 */
export function parseDateInput(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    // Excel serial date number
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + value * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[-\/ ](\d{2}|\d{4})$/);
  if (m) {
    const month = MONTHS.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    if (month < 0) return null;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoFromParts(year, month, Number(m[1]));
  }
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoFromParts(year, Number(m[2]) - 1, Number(m[1]));
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function isoFromParts(year: number, monthIndex: number, day: number): string | null {
  const d = new Date(Date.UTC(year, monthIndex, day));
  if (d.getUTCMonth() !== monthIndex || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
