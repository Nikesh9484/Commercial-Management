import { formatMoney } from "../format";

/** Shared little helpers used across the executive narrative reports (claims, final account, payments,
 * changes, early warnings & risks, provisional sums, bonds & insurance, budget transfers), so the
 * wording and number formatting reads the same everywhere. */

export const num = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v));
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
export const txt = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
export const money = (n: number): string => `SAR ${formatMoney(n)}`;
export const pct = (a: number, b: number): number => (b ? Math.round((a / b) * 100) : 0);
export const plural = (n: number, s: string, p = `${s}s`): string => `${n} ${n === 1 ? s : p}`;
export const list = (items: string[], max = 4): string => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);
export const avg = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((t, x) => t + x, 0) / xs.length) : null);
