/**
 * The Claims Tracker's Remarks column (BR) is a running log typed by hand over months:
 *
 *   "22 Apr 24: WF currently with Fahad for approval 25 Apr 24: Assessment report issued …"
 *   "22 Dec 24: Ditto 13 Dec 24: Sasho had a discussion with the contractor …"
 *
 * The first is oldest-first, the second newest-first – there is no consistent order – so the start
 * of the cell is not "the latest position". This splits the log into dated entries and sorts them,
 * so the dashboard can show where a claim actually stands today and how long ago that was written.
 *
 * Kept free of imports: the browser uses it too.
 */

export interface RemarkEntry {
  /** ISO date of the entry, or null for text written before the first date in the cell. */
  date: string | null;
  text: string;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * A date as the trackers write it: "22 Apr 24", "2-June-24", "7-Jul-24", "14th Nov 2024",
 * "12 August 2024", "09 Sept 24", "22Mar25". Day, month name, 2- or 4-digit year.
 */
const DATE = /(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s\-\/,]*('?\d{4}|'?\d{2})(?!\d)/gi;

function toIso(d: string, mon: string, y: string): string | null {
  const day = Number(d);
  const month = MONTHS[mon.slice(0, 3).toLowerCase()];
  let year = Number(y.replace("'", ""));
  if (year < 100) year += 2000;
  if (!month || day < 1 || day > 31 || year < 2015 || year > 2040) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // reject 31 Feb and friends
  const check = new Date(`${iso}T00:00:00Z`);
  return check.getUTCDate() === day ? iso : null;
}

/**
 * A date well after the report date is a typing slip, not a plan: the real tracker has
 * "28 Jun 28" between "15 Jun 26" and later 2026 entries. The year is pulled back to the report's
 * year (or the one before) when that puts the date in the past; a date that still makes no sense
 * is not treated as an entry heading at all, so it can never pose as "the latest update".
 */
function plausible(iso: string | null, asOf: string): string | null {
  if (!iso) return null;
  const limit = new Date(`${asOf}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 45);
  const cap = limit.toISOString().slice(0, 10);
  if (iso <= cap) return iso;
  const y = Number(asOf.slice(0, 4));
  for (const year of [y, y - 1]) {
    const fixed = `${year}${iso.slice(4)}`;
    if (fixed <= cap) return fixed;
  }
  return null;
}

/**
 * Splits a remark log into entries. A date starts a new entry when it opens the cell or is followed
 * by a colon or a dash ("22 Apr 24:", "2-June-24 -"). A date inside a sentence ("a meeting was held
 * on 21 Apr 24, …") is part of the entry around it, not the start of another.
 */
export function parseRemarks(raw: unknown, asOf: string = new Date().toISOString().slice(0, 10)): RemarkEntry[] {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const heads: { at: number; end: number; date: string }[] = [];
  for (const m of text.matchAll(DATE)) {
    const iso = plausible(toIso(m[1], m[2], m[3]), asOf);
    if (!iso || m.index === undefined) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 3);
    const opensCell = text.slice(0, m.index).trim() === "";
    if (!opensCell && !/^\s*[:\-–—]/.test(after)) continue;
    heads.push({ at: m.index, end: m.index + m[0].length, date: iso });
  }
  if (!heads.length) return [{ date: null, text }];
  const out: RemarkEntry[] = [];
  const lead = text.slice(0, heads[0].at).trim();
  if (lead) out.push({ date: null, text: lead });
  heads.forEach((h, i) => {
    const body = text
      .slice(h.end, i + 1 < heads.length ? heads[i + 1].at : text.length)
      .replace(/^\s*[:\-–—]\s*/, "")
      .trim();
    if (body) out.push({ date: h.date, text: body });
  });
  return out;
}

/** The newest dated entry – where the claim stands – or the undated text when nothing is dated. */
export function latestRemark(raw: unknown, asOf?: string): RemarkEntry | null {
  const entries = parseRemarks(raw, asOf);
  if (!entries.length) return null;
  const dated = entries.filter((e) => e.date);
  if (!dated.length) return entries[entries.length - 1];
  // the last one written wins a tie ("22 Dec 24: Ditto" after "22 Dec 24: …")
  return dated.reduce((best, e) => (e.date! >= best.date! ? e : best));
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${iso.slice(8, 10)}-${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;

/**
 * The whole log re-ordered newest first, each entry stamped with a uniform date, so the first line
 * of the cell is always the latest position however the tracker was typed.
 */
export function remarksNewestFirst(raw: unknown, asOf?: string): string {
  const entries = parseRemarks(raw, asOf);
  if (entries.length <= 1) return entries[0] ? (entries[0].date ? `${short(entries[0].date)}: ${entries[0].text}` : entries[0].text) : "";
  const dated = entries.map((e, i) => ({ ...e, i })).filter((e) => e.date);
  const undated = entries.filter((e) => !e.date);
  dated.sort((a, b) => (a.date === b.date ? b.i - a.i : a.date! < b.date! ? 1 : -1));
  return [...dated.map((e) => `${short(e.date!)}: ${e.text}`), ...undated.map((e) => e.text)].join("  ·  ");
}
