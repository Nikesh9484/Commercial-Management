import { formatMoney } from "../format";

/** Shared little helpers used across the executive narrative reports (claims, final account, payments,
 * changes, early warnings & risks, provisional sums, bonds & insurance, budget transfers), so the
 * wording and number formatting reads the same everywhere. */

export const num = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v));
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
export const txt = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
export const money = (n: number): string => `SAR ${formatMoney(n)}`;
export const pct = (a: number, b: number): number => (b ? Math.round((a / b) * 100) : 0);
/**
 * "1 policy" / "2 policies". A plain "s" gave "policys" and "2 companys": a word ending in a
 * consonant + y takes "ies", and the sibilant endings take "es". A phrase like "bond / policy" is
 * pluralised on its last word, which is the one that carries the number.
 */
function pluralise(word: string): string {
  const cut = word.lastIndexOf(" ");
  const head = cut === -1 ? "" : word.slice(0, cut + 1);
  const last = cut === -1 ? word : word.slice(cut + 1);
  if (/sis$/i.test(last)) return `${head}${last.slice(0, -2)}es`;
  if (/[^aeiou]y$/i.test(last)) return `${head}${last.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(last)) return `${head}${last}es`;
  return `${head}${last}s`;
}

export const plural = (n: number, s: string, p = pluralise(s)): string => `${n} ${n === 1 ? s : p}`;
export const list = (items: string[], max = 4): string => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);
export const avg = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((t, x) => t + x, 0) / xs.length) : null);
