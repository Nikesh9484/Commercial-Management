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

/* ------------------------------------------------------------------ shared report shapes */

/**
 * One party's rows inside a report – the contractor a chase is made to, or whoever else the report
 * is organised around – with that party's own subtotals. A status report is read one party at a
 * time, because that is how the work is done: one conversation per contractor, not one per row.
 */
export interface PartyGroup<T> {
  party: string;
  count: number;
  /** Named subtotals, e.g. { claimed: 1200, granted: 300 }. */
  totals: Record<string, number>;
  items: T[];
}

/** One company however it is spelled, so "… Ltd." and "… Ltd" are one heading and one subtotal. */
export const partyKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Groups rows by party, adds up whatever `totals` returns per row, and puts the largest group first.
 * The fullest spelling seen is the one printed.
 */
export function groupByParty<T>(
  items: T[],
  party: (t: T) => string,
  totals: (t: T) => Record<string, number> = () => ({}),
  sortItems?: (a: T, b: T) => number,
): PartyGroup<T>[] {
  const map = new Map<string, PartyGroup<T>>();
  for (const it of items) {
    const name = String(party(it) ?? "").trim();
    const k = partyKey(name) || "__none__";
    const g = map.get(k) ?? { party: name || "(not recorded)", count: 0, totals: {}, items: [] };
    if (name.length > g.party.length) g.party = name;
    g.count += 1;
    for (const [key, v] of Object.entries(totals(it))) g.totals[key] = (g.totals[key] ?? 0) + (Number.isFinite(v) ? v : 0);
    g.items.push(it);
    map.set(k, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, totals: Object.fromEntries(Object.entries(g.totals).map(([k, v]) => [k, Math.round(v * 100) / 100])), items: sortItems ? [...g.items].sort(sortItems) : g.items }))
    .sort((a, b) => b.count - a.count || a.party.localeCompare(b.party));
}

/** How many movement bullets are worth printing before they stop being a summary and become a list. */
export const MAX_MOVEMENT_LINES = 8;

/**
 * Keeps a movement list to a readable length. A register with thirty new rows since last month
 * printed thirty bullets, which filled the first page and pushed the tables the report is actually
 * for onto the second – the detail is in those tables, so the bullets only have to give the shape.
 */
export function capMovement(movement: { label: string; items: string[] } | null, max = MAX_MOVEMENT_LINES): { label: string; items: string[] } | null {
  if (!movement || movement.items.length <= max) return movement;
  const hidden = movement.items.length - max;
  return { label: movement.label, items: [...movement.items.slice(0, max), `… and ${hidden} more – see the tables below.`] };
}
