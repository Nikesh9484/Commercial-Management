import { formatMonthYear } from "../format";

/** Month helpers shared by the cash flow model and its pages (browser-safe: no database here). */
export const monthKey = (iso: string): string => iso.slice(0, 7);

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export const monthLabel = (key: string): string => formatMonthYear(`${key}-01`);
