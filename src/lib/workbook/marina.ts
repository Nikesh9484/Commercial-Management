/**
 * Converter for "The Marina CM Report" monthly workbook (Schedule A–J layout).
 *
 * When an uploaded workbook looks like that report, the importer runs this converter first.
 * It reads Schedule B (cost lines), Schedule C (change tracker), Schedule E New (claims),
 * the Early Warning sheet, Schedule D (risks), Schedule F (provisional sums), Schedule G
 * (bonds & insurance), Schedule H + the per-contract "Schedule H - …" sheets (contracts and
 * IPC logs), Schedule J (budget transfers) and Data Input (project team), and produces
 * clean sheets with tagged headings ("Label [field_key]") that the normal importer maps 1:1.
 *
 * Every rule here mirrors the Excel report: DVO / PVO amounts feed columns H / J exactly as
 * Schedule B does, early warnings feed L, RFC amounts are kept as tracker amounts (K = 0 in
 * the Excel), claims are not linked to cost lines (M = 0 in the Excel), and each cost category
 * gets a budget-hold line so Schedule A's totals stay at the approved budget.
 */
import type { SheetValues } from "./read";
import { DEAD_STATUSES as DEAD_STAGE, impliedOverallStatus } from "../registers/defs/changes";
import { cellText } from "./read";
import { readLevel1Check, type Level1Check } from "./level1-check";
import { faStatusFromExcel } from "../bonds/contract-status";

export type Row = unknown[];
export type Sheet = SheetValues;
/** Schedule E of the monthly workbook is read but not imported; the Claims Tracker is the source of claims. */
const INCLUDE_WORKBOOK_CLAIMS = false;

export interface ConvertedSheet {
  name: string;
  register: string;
  columns: { label: string; key: string }[];
  rows: unknown[][];
}

/** Report-level values a workbook carries besides its registers: written to the reporting period on import. */
export interface ReportControl {
  aconex_ref?: string | null;
  /** narrative for the Executive Summary ("Key issues this period") */
  key_issues?: string | null;
  /** report checklist ticks by module number */
  checklist?: Record<number, boolean> | null;
}

export interface ConversionResult {
  sheets: ConvertedSheet[];
  notes: string[];
  periodEnd: string | null;
  reportNo: number | null;
  /** the workbook's own Level 1 figures, for the reconciliation shown on the dashboard */
  level1?: Level1Check | null;
  control?: ReportControl | null;
}

/* ------------------------------------------------------------------ helpers */

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const cell = (v: Row | undefined, i: number): unknown => (v && v.length > i ? v[i] : undefined);
export const txt = (v: Row | undefined, i: number): string => {
  const x = cell(v, i);
  return x === null || x === undefined ? "" : String(x).trim();
};
export const money = (v: Row | undefined, i: number): number | null => {
  const x = cell(v, i);
  if (isNum(x)) return Math.round(x * 100) / 100;
  if (typeof x === "string") {
    const t = x.replace(/,/g, "").replace(/SAR/i, "").trim();
    const n = Number(t);
    return t && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  return null;
};
const inRange = (y: number) => y >= 2015 && y <= 2035;
function serialToIso(n: number): string | null {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return inRange(d.getUTCFullYear()) ? d.toISOString().slice(0, 10) : null;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function date(v: Row | undefined, i: number): string | null {
  const x = cell(v, i);
  if (x === null || x === undefined || x === "") return null;
  if (isNum(x)) return serialToIso(x);
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return inRange(Number(m[1])) ? s.slice(0, 10) : null;
  const m2 = /^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ](\d{2,4})$/.exec(s);
  if (m2) {
    const mo = MONTHS.indexOf(m2[2].toLowerCase());
    const y = Number(m2[3].length === 2 ? "20" + m2[3] : m2[3]);
    if (mo >= 0 && inRange(y)) return `${y}-${String(mo + 1).padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  }
  const m3 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m3 && inRange(Number(m3[3]))) return `${m3[3]}-${m3[2].padStart(2, "0")}-${m3[1].padStart(2, "0")}`;
  return null;
}
export function monthText(v: Row | undefined, i: number): string {
  const x = cell(v, i);
  if (x === null || x === undefined || x === "") return "";
  const iso = isNum(x) ? serialToIso(x) : /^\d{4}-\d{2}/.test(String(x)) ? String(x).slice(0, 10) : null;
  if (iso) {
    const [y, m] = iso.split("-");
    return `${MONTHS[Number(m) - 1][0].toUpperCase()}${MONTHS[Number(m) - 1].slice(1)}'${y.slice(2)}`;
  }
  return String(x).trim();
}
export const yes = (v: Row | undefined, i: number) => ["yes", "y", "true", "1", "x", "11", "ü"].includes(txt(v, i).toLowerCase());
export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function rows(sheet: Sheet | undefined): [number, Row][] {
  return sheet ? [...sheet.rows.entries()].sort((a, b) => a[0] - b[0]) : [];
}
export function findSheet(sheets: Sheet[], ...names: string[]): Sheet | undefined {
  for (const n of names) {
    const hit = sheets.find((s) => norm(s.name) === norm(n));
    if (hit) return hit;
  }
  return undefined;
}
/** First row whose cells include all the given words (case-insensitive). */
export function findHeaderRow(sheet: Sheet, ...words: string[]): number | null {
  for (const [r, v] of rows(sheet)) {
    const joined = v.map((x) => cellText(x).toLowerCase()).join(" | ");
    if (words.every((w) => joined.includes(w.toLowerCase()))) return r;
  }
  return null;
}

/* ------------------------------------------------------------------ canonical names */

const CONTRACTORS: [string, string, string[]][] = [
  ["Al Saad General Contracting Co. Ltd.", "Contractor", ["al saad", "alsaad", "als -", "als-"]],
  ["MME – Majestic Marine Engineering LLC", "Contractor", ["mme", "majestic marine", "ps-mmemarine"]],
  ["WSP Middle East", "Consultant", ["wsp"]],
  ["Elmar Marinas Khaleej LLC", "Contractor", ["elmar"]],
  ["Five Oceans Environmental Services LLC", "Consultant", ["five ocean", "5 ocean"]],
  ["Beacon Development Company", "Consultant", ["beacon", "becon"]],
  ["Dredging International Saudi Arabia (JVD)", "Contractor", ["jvd", "dredging int"]],
  ["Haskoning DHV Saudia", "Consultant", ["haskoning"]],
  ["KAUST – King Abdullah University of Science & Technology", "Consultant", ["kaust", "king abdullah"]],
  ["Sydney Seaplanes Asia Limited", "Consultant", ["sydney sea", "sys-sydney"]],
  ["Supreme Rubber LLC", "Supplier", ["supreme rubber"]],
  ["Al Rajhi Takaful (insurance)", "Insurer", ["al rajhi"]],
  ["Foster + Partners", "Consultant", ["foster"]],
];
function contractor(name: string): string {
  const n = name.trim().toLowerCase();
  if (!n) return "";
  for (const [canon, , keys] of CONTRACTORS) if (keys.some((k) => n.includes(k))) return canon;
  return name.trim();
}

const PKG_ALIAS: Record<string, string> = {
  "marina basin": "Al Saad Main Works",
  "fixed decks": "ALS - Construction of Jetty Works",
  "professional services": "WSP Consultants",
  "design and construction of floating pontoons": "MME-MME Marine Engg",
  "constructing boardwalks & jetties for hijaz island": "Elmar-Hijaz Boardwalk and Jetties",
  "water aerodrome feasibility study for a water aerodrome": "Sydney SeaPlane",
  "call-off agreement for group level environmental consultancy services": "Kaust-King Abdullah University of Science",
  "ps - ground improvement to enhance shoring system": "PS - enhance shoring system",
  "supreme rubber - marine furniture": "Supreme Rubber - Marine Furniture",
};
function pkg(name: string): string {
  const n = name.replace(/\s+/g, " ").trim();
  return n ? (PKG_ALIAS[n.toLowerCase()] ?? n) : "";
}

export const BOND_TYPES: Record<string, string> = {
  "trade license": "Trade License",
  "professional indemnity": "Professional Indemnity",
  "public liability": "Public/Third Party Liability",
  "third party liability": "Public/Third Party Liability",
  "contractors all risk": "Contractors All Risks",
  "advance payment bond": "Advance Payment Bond",
  "performance bond": "Performance Bond",
  "workmens compensation": "Workmen's Compensation",
  "workmen’s compensation": "Workmen's Compensation",
  "workmen's compensation": "Workmen's Compensation",
  "motor vehicle": "Motor Vehicle Liability",
  "motor vehicle insurance": "Motor Vehicle Liability",
  "contractor's plant & machinery policy": "Plant & Equipment",
  "marine hull": "Marine & Hull",
  "protection and indemnity": "Protection & Indemnity",
};

/* ------------------------------------------------------------------ detection */

export function looksLikeMarinaReport(sheets: Sheet[]): boolean {
  const names = sheets.map((s) => norm(s.name));
  const has = (n: string) => names.includes(norm(n));
  return has("Schedule B") && has("Schedule C") && (has("Schedule H") || has("Schedule G"));
}

/* ------------------------------------------------------------------ conversion */

interface Line {
  code: string;
  orig: string;
  pkg: string;
  name: string;
  contractor: string;
  section: string;
  category: string;
  hold: boolean;
  baseline: number;
  transfers: number;
  note: string;
}

export function convertMarinaReport(sheets: Sheet[]): ConversionResult {
  const notes: string[] = [];
  const out: ConvertedSheet[] = [];

  // ---- Data Input: period, asset
  let asset = "";
  let reportNo: number | null = null;
  let periodEnd: string | null = null;
  const dataInput = findSheet(sheets, "Data Input");
  for (const [, v] of rows(dataInput)) {
    const label = txt(v, 1).toUpperCase();
    if (label.startsWith("ASSET CODE")) asset = txt(v, 2);
    if (label.startsWith("REPORT NO")) {
      const m = /(\d+)/.exec(txt(v, 2));
      if (m) reportNo = Number(m[1]);
    }
    if (label.startsWith("REPORTING PERIOD")) {
      // "September 2026", "SEPTEMBER 2026", "Sep-26"
      const m = /([A-Za-z]{3})[A-Za-z]*[\s-]+(\d{4}|\d{2})\b/.exec(txt(v, 2));
      if (m) {
        const mo = MONTHS.indexOf(m[1].toLowerCase());
        if (mo >= 0) {
          const last = new Date(Date.UTC(m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]), mo + 1, 0));
          periodEnd = last.toISOString().slice(0, 10);
        }
      }
    }
  }
  const PERIOD_END = periodEnd ?? new Date().toISOString().slice(0, 10);
  if (!asset) notes.push("Asset code not found on the Data Input sheet – the current asset in the top bar is used.");

  // ---- 1. Cost lines (Schedule B)
  const B = findSheet(sheets, "Schedule B");
  const lines: Line[] = [];
  const firstLineByFrag = new Map<string, string>();
  const mainLineByPkg = new Map<string, string>();
  if (B) {
    const hdr = findHeaderRow(B, "code", "package", "approved baseline budget") ?? 12;
    const seen = new Map<string, number>();
    const SKIP = new Set(["PS", "CN - EW", "CN - MW", "CC", "FF&E & OS&E", "98", "MS.98 + CM.98", "CN.98", "PS.98", asset]);
    let inEarlyWorks = false;
    for (const [r, v] of rows(B)) {
      if (r <= hdr) continue;
      const code = txt(v, 1);
      const pk = txt(v, 2);
      const name = txt(v, 3);
      const contr = txt(v, 4);
      const up = name.toUpperCase();
      if (up.includes("EARLY WORKS") && (code === "CN - EW" || up.startsWith("SUB-TOTAL"))) inEarlyWorks = false;
      if (!code && up.includes("EARLY WORKS")) inEarlyWorks = true;
      if (up.startsWith("GRAND TOTAL") && code === asset && lines.length) break; // end of the asset block (the hold block follows)
      if (!code && !name) continue;
      if (up.startsWith("SUB-TOTAL") || up.startsWith("SUB TOTAL") || up.startsWith("TOTAL") || up.startsWith("GRAND TOTAL")) continue;
      if (SKIP.has(code) && !up.startsWith("REMAINING")) continue;
      if (!code) continue;
      const hold = code.endsWith(".98") || up.startsWith("REMAINING BUDGET");
      if (!pk && !contr && !hold) continue; // group total rows such as "Al Saad-Marina Basin"
      if (!name.trim() && !hold && !(money(v, 5) || money(v, 6) || money(v, 8))) continue; // a row left over from the template: no name, no figures
      const baseline = money(v, 5) ?? 0;
      const transfers = money(v, 6) ?? 0;
      const awarded = money(v, 8) ?? 0;
      const n = (seen.get(code) ?? 0) + 1;
      seen.set(code, n);
      const ucode = n === 1 ? code : `${code}-${n}`;
      const category = code.startsWith("PS") ? "Professional Services" : code.startsWith("MS") ? "Management Supervision" : code.startsWith("CM") ? "Commercial Management" : inEarlyWorks || code === "CN.031C01" || code === "CN.031C03" ? "Early Works" : "Construction Works";
      const line: Line = {
        code: ucode,
        orig: code,
        pkg: pkg(hold ? "Budget Hold" : pk || name.slice(0, 40)),
        name: name || pk,
        contractor: contr ? contractor(contr) : "",
        section: hold || awarded === 0 ? "Uncommitted" : "Committed",
        category,
        hold,
        baseline,
        transfers,
        note: hold ? "Budget hold – remaining budget not yet allocated to a contract" : ucode !== code ? `Excel code ${code} (shared with other lines)` : "",
      };
      lines.push(line);
      // the contract code in the line code, whatever the prefix: CN.031C10.00, PS.003D01, FFEOSE.003F06, CN.003C328
      const frag = /\b(\d{3}[A-Z]\d{2,3})\b/.exec(code)?.[1] ?? code.replace(/^(PS|CN|MS|CM)\./, "").split(".")[0];
      if (!firstLineByFrag.has(frag)) firstLineByFrag.set(frag, ucode);
      if (!mainLineByPkg.has(line.pkg)) mainLineByPkg.set(line.pkg, ucode);
    }
    // the budget-hold block sits below the asset grand total
    let afterTotal = false;
    for (const [r, v] of rows(B)) {
      if (r <= hdr) continue;
      const code = txt(v, 1);
      const name = txt(v, 3).toUpperCase();
      if (name.startsWith("GRAND TOTAL") && code === asset) {
        afterTotal = !afterTotal;
        continue;
      }
      if (!afterTotal) continue;
      if (!code.endsWith(".98") || !name.startsWith("REMAINING")) continue;
      if (lines.some((l) => l.orig === code && l.hold)) continue;
      const category = code.startsWith("PS") ? "Professional Services" : code.startsWith("MS") ? "Management Supervision" : code.startsWith("CM") ? "Commercial Management" : "Construction Works";
      lines.push({ code, orig: code, pkg: "Budget Hold", name: txt(v, 3), contractor: "", section: "Uncommitted", category, hold: true, baseline: money(v, 5) ?? 0, transfers: money(v, 6) ?? 0, note: "Budget hold – remaining budget not yet allocated to a contract" });
    }
    notes.push(`Cost lines: ${lines.length} (approved budget ${lines.reduce((t, l) => t + l.baseline, 0).toLocaleString("en", { minimumFractionDigits: 2 })}, transfers ${lines.reduce((t, l) => t + l.transfers, 0).toLocaleString("en", { minimumFractionDigits: 2 })}).`);
  } else notes.push("Schedule B not found – no cost lines converted.");
  const lineForFrag = (frag: string) => firstLineByFrag.get(frag) ?? "";
  const lineForPkg = (p: string) => mainLineByPkg.get(pkg(p)) ?? "";

  out.push({
    name: "Cost Report Lines",
    register: "cost_lines",
    columns: cols([["Asset", "asset_id"], ["Code", "code"], ["Package", "package_id"], ["Name / description", "name"], ["Contractor / Sub-contractor", "contractor_id"], ["Section", "section"], ["Cost category", "category_id"], ["Budget hold line", "is_budget_hold"], ["Approved Baseline Budget", "approved_baseline_budget"], ["Budget transfers brought forward", "opening_transfers"], ["Order", "sort_order"], ["Notes", "notes"]]),
    rows: lines.map((l, i) => [asset, l.code, l.pkg, l.name, l.contractor, l.section, l.category, l.hold, l.baseline, l.transfers, i + 1, l.note]),
  });

  // ---- 2. Contracts (Schedule H) and IPC logs (Schedule H - …)
  interface Params { layout: "A" | "B"; hdr: number; adv: number; ret: number; vat: number; ipcDays: number; payDays: number }
  const ipcSheets = sheets.filter((s) => /^schedule h\s*-|^schedule h [a-z]/i.test(s.name.trim()) && norm(s.name) !== "schedule h");
  const paramsBySheet = new Map<string, Params>();
  const wordsOf = (t: string) => new Set(t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !["limited", "company", "saudi", "arabia", "contracting", "trading", "schedule", "services", "works"].includes(w)));
  /**
   * The code a sheet's title gives ("CN.003F13 - Infor Saudi Arabia Limited") – unless the line with that code is
   * another contractor's and one other line is this contractor's (a title copied from the sheet before it):
   * then that line's code.
   */
  const checkedTitleFrag = (frag: string, title: string): string => {
    if (!frag) return frag;
    const who = wordsOf(title.replace(/^[A-Z&]+\.\d{3}[A-Z]\d{2,3}\s*[-–]\s*/i, ""));
    if (!who.size) return frag;
    const shares = (l: Line) => [...wordsOf(`${l.name} ${l.contractor}`)].some((w) => who.has(w));
    const own = lines.find((l) => l.code === lineForFrag(frag));
    if (!own || shares(own)) return frag;
    const others = lines.filter((l) => !l.hold && shares(l));
    const hit = others.length === 1 ? (/\b(\d{3}[A-Z]\d{2,3})\b/.exec(others[0].code)?.[1] ?? "") : "";
    return hit && lineForFrag(hit) === others[0].code ? hit : frag;
  };
  const fragBySheet = new Map<string, string>();
  const engFragBySheet = new Map<string, string>();
  /** the sheet's own title rows: "PS.003D01 - Dewan Architects & Engineers 2200445", "ZFP (ZUHAIR FAYEZ … - PO 2230041)" */
  const titleBySheet = new Map<string, string>();
  const poBySheet = new Map<string, string>();
  for (const s of ipcSheets) {
    const hdr = findHeaderRow(s, "sr nr", "payment applicat") ?? 11;
    const h = s.rows.get(hdr) ?? [];
    const layout: "A" | "B" = txt(h, 12).toUpperCase().startsWith("IPC NR") ? "A" : "B";
    const r12 = s.rows.get(hdr + 1) ?? [];
    const r13 = s.rows.get(hdr + 2) ?? [];
    const pct = (x: unknown) => (isNum(x) ? Math.round(x * 100) : 0);
    const days = (rule: unknown, d: number) => {
      const m = /\+\s*(\d+)/.exec(String(rule ?? ""));
      return m ? Number(m[1]) : d;
    };
    const vatCell = cell(r12, layout === "A" ? 29 : 26);
    paramsBySheet.set(s.name, { layout, hdr, adv: layout === "A" ? pct(cell(r12, 8)) : 0, ret: layout === "A" ? pct(cell(r12, 9)) : 0, vat: isNum(vatCell) ? Math.round(vatCell * 100) : 15, ipcDays: days(cell(r13, layout === "A" ? 15 : 12), 28), payDays: days(cell(r13, layout === "A" ? 26 : 23), 30) });
    // which contract: the contractor's own application refs and the invoice refs carry the ACC code,
    // e.g. "1TB01031-031C10-MME-…". The certification refs come from the Engineer, so they are only a last resort.
    const findFrag = (cols: number[]) => {
      for (const [r, v] of rows(s)) {
        if (r <= hdr + 2) continue;
        for (const i of cols) {
          const m = /-(\d{3}[A-Z]\d{2})-/.exec(txt(v, i));
          if (m) return m[1];
        }
      }
      return "";
    };
    // the sheet's own title ("PS.003D01 - Dewan Architects & Engineers") names the contract outright
    const titleFrag = (() => {
      for (const [r, v] of rows(s)) {
        if (r >= hdr) break;
        const t = txt(v, 1).trim();
        if (!t || /PROGRAMME|ASSET|REPORT|STAGE 1/i.test(t)) continue;
        if (!titleBySheet.has(s.name) && t.length > 2) titleBySheet.set(s.name, t);
        const po = /\b(2\d{6})\b/.exec(t);
        if (po && !poBySheet.has(s.name)) poBySheet.set(s.name, po[1]);
        const m = /\b(\d{3}[A-Z]\d{2})\b/.exec(t);
        if (m) return m[1];
      }
      return "";
    })();
    fragBySheet.set(s.name, checkedTitleFrag(titleFrag, titleBySheet.get(s.name) ?? "") || findFrag(layout === "A" ? [4, 23] : [4, 20]));
    engFragBySheet.set(s.name, findFrag(layout === "A" ? [13] : [10]));
  }
  interface Contract { sr: number; pr: string; po: string; acc: string; contractor: string; scope: string; status: string; completion: string | null; eot: number; original: number; faAdj: number; line: string; p: Params | null; note: string; certified?: number | null }
  /**
   * The cost line of a contract whose code has no line of its own: Schedule B can carry it under another
   * contract's code ("CN.003C13-3 NSCC - Triple Bay Piling (AYC only) 2220032", "CN.003C34-2 ARMETAL -
   * Reflective ceiling") – found by its PO number in the line name, else by the contractor's name.
   */
  const lineForContract = (acc: string, po: string, who: string): string => {
    const own = lineForFrag(acc);
    if (own) return own;
    const free = lines.filter((l) => !l.hold);
    const pos = po.split(/\s*&\s*/).filter((x) => /^\d{7}$/.test(x));
    const byPo = free.filter((l) => pos.some((x) => l.name.includes(x) || l.orig.includes(x)));
    if (byPo.length === 1) return byPo[0].code;
    const names = wordsOf(who);
    if (!names.size) return "";
    const byName = free.filter((l) => [...wordsOf(`${l.name} ${l.contractor}`)].some((w) => names.has(w)));
    return byName.length === 1 ? byName[0].code : "";
  };
  const contracts: Contract[] = [];
  const H = findSheet(sheets, "Schedule H");
  // the project's own contract-code prefix (003 for 003D01, 003C13 …), to read a code typed with another project's prefix
  const prefixCounts = new Map<string, number>();
  for (const l of lines) {
    const m = /\b(\d{3})[A-Z]\d{2}\b/.exec(l.orig);
    if (m) prefixCounts.set(m[1], (prefixCounts.get(m[1]) ?? 0) + 1);
  }
  const ownPrefix = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const ownFrag = (raw: string) => {
    const first = /\d{3}[A-Z]\d{2}/.exec(raw)?.[0] ?? raw;
    if (lineForFrag(first) || !ownPrefix) return first;
    const alt = first.replace(/^\d{3}/, ownPrefix);
    return lineForFrag(alt) ? alt : first;
  };
  if (H) {
    const hdr = findHeaderRow(H, "sr nr", "name", "original contract") ?? 11;
    for (const [r, v] of rows(H)) {
      if (r <= hdr || !isNum(cell(v, 1))) continue;
      const acc = ownFrag(txt(v, 4).replace(/\s+/g, ""));
      const sheetName = [...fragBySheet.entries()].find(([, f]) => f === acc)?.[0];
      let scope = txt(v, 6).replace(/\s+/g, " ");
      const line = lineForContract(acc, txt(v, 3), txt(v, 5));
      if (scope.length < 12) scope = lines.find((l) => l.code === line)?.name ?? (scope || "Contract");
      contracts.push({
        sr: cell(v, 1) as number, pr: txt(v, 2), po: txt(v, 3) || `TBC-${acc}`, acc, contractor: contractor(txt(v, 5)), scope,
        status: txt(v, 7).toUpperCase() === "CLOSED" ? "Closed" : "Active", completion: date(v, 8), eot: isNum(cell(v, 9)) ? (cell(v, 9) as number) : 0,
        original: money(v, 12) ?? 0, faAdj: money(v, 15) ?? 0, line, p: sheetName ? paramsBySheet.get(sheetName)! : null,
        note: money(v, 18) !== null ? `Excel Schedule H: applied ${money(v, 18)?.toLocaleString("en")}, certified ${money(v, 19)?.toLocaleString("en")}, paid ${money(v, 20)?.toLocaleString("en")}` : "",
        certified: money(v, 19),
      });
    }
  }
  // contracts that only appear in Schedule B (awarded lines with a contractor but no Schedule H row)
  let nextSr = contracts.reduce((m, c) => Math.max(m, c.sr), 0);
  for (const l of lines) {
    if (l.hold || l.section !== "Committed" || !l.contractor) continue;
    const frag = l.orig.replace(/^(PS|CN|MS|CM)\./, "").split(".")[0];
    if (contracts.some((c) => c.acc === frag) || l.code !== lineForFrag(frag)) continue;
    if (l.contractor.includes("Al Rajhi")) continue;
    nextSr++;
    contracts.push({ sr: nextSr, pr: "", po: `TBC-${frag}`, acc: frag, contractor: l.contractor, scope: l.name, status: "Active", completion: null, eot: 0, original: l.baseline + l.transfers, faAdj: 0, line: l.code, p: null, note: "Added from Schedule B (no Schedule H row)" });
  }
  // contracts an IPC log names in its own title ("FFEOSE.003D07 - Birch Street") that neither Schedule H nor
  // Schedule B (with a contractor) carries: added from the title and the cost report line
  for (const s of ipcSheets) {
    const frag = fragBySheet.get(s.name) ?? "";
    const line = frag ? lineForFrag(frag) : "";
    if (!frag || !line || contracts.some((c) => c.acc === frag)) continue;
    const title = titleBySheet.get(s.name) ?? s.name;
    const who = title.replace(/^[A-Z&]+\.\d{3}[A-Z]\d{2}\s*[-–]\s*/i, "").replace(/\s*\(?\bPO\s*\d{7}\)?/i, "").replace(/\s+\d{7}\s*$/, "").trim();
    const l = lines.find((x) => x.code === line);
    nextSr++;
    contracts.push({ sr: nextSr, pr: "", po: poBySheet.get(s.name) ?? (/\b(2\d{6})\b/.exec(l?.name ?? "")?.[1] ?? `TBC-${frag}`), acc: frag, contractor: contractor(who) || who, scope: l?.name ?? who, status: "Active", completion: null, eot: 0, original: (l?.baseline ?? 0) + (l?.transfers ?? 0), faAdj: 0, line, p: paramsBySheet.get(s.name) ?? null, note: `Added from the IPC log "${s.name.trim()}" (no Schedule H row)` });
  }
  const contractByFrag = new Map(contracts.map((c) => [c.acc, c]));
  out.push({
    name: "Contracts",
    register: "contracts",
    columns: cols([["SR No", "sr_no"], ["Contract title", "title"], ["REEF PR No", "reef_pr_no"], ["REEF PO No", "reef_po_no"], ["ACC ref", "acc_ref"], ["Contractor / Consultant", "contractor_id"], ["Package", "package_id"], ["Cost report line", "cost_line_id"], ["Scope of work", "scope_of_work"], ["Current status", "current_status"], ["Original completion date", "original_completion_date"], ["EOT granted (days)", "eot_granted_days"], ["Original contract", "original_contract"], ["Final account adjustment", "final_account_adjustment"], ["Advance recovery %", "advance_recovery_pct"], ["Retention %", "retention_pct"], ["Days to issue IPC", "ipc_days"], ["Days to pay", "payment_days"], ["VAT %", "vat_pct"], ["Notes", "notes"]]),
    rows: contracts.map((c) => [c.sr, c.scope.slice(0, 120) || c.contractor, c.pr, c.po, c.acc, c.contractor, lines.find((l) => l.code === c.line)?.pkg ?? "", c.line, c.scope, c.status, c.completion, c.eot, c.original, c.faAdj, c.p?.adv ?? 0, c.p?.ret ?? 0, c.p?.ipcDays ?? 28, c.p?.payDays ?? 30, c.p?.vat ?? 15, c.note]),
  });

  /** Finds the contract an IPC sheet belongs to: by ACC code in its Aconex refs, else by PO number or contractor in the sheet name. */
  const contractForSheet = (s: Sheet): Contract | undefined => {
    const title = s.name.replace(/^schedule h\s*-?\s*/i, "").trim();
    // the code the sheet's own title gives ("PS.003D03 - HKS Architects Ltd - Design Architect Fees 2200375")
    const titled = /\b\d{3}[A-Z]\d{2,3}\b/.test(titleBySheet.get(s.name) ?? "") ? contractByFrag.get(fragBySheet.get(s.name) ?? "") : undefined;
    if (titled) return titled;
    const po = /\b(\d{7})\b/.exec(title)?.[1] ?? poBySheet.get(s.name);
    if (po) {
      const hit = contracts.find((c) => c.po === po) ?? contracts.find((c) => c.pr === po) ?? contracts.find((c) => c.po.split(/\s*&\s*/).includes(po));
      if (hit) return hit;
    }
    const byFrag = contractByFrag.get(fragBySheet.get(s.name) ?? "");
    if (byFrag) return byFrag;
    // the Engineer's certification refs name the contract too, but only trust them when the sheet title agrees
    const eng = contractByFrag.get(engFragBySheet.get(s.name) ?? "");
    if (eng && CONTRACTORS.find(([canon]) => canon === eng.contractor)?.[2].some((k) => title.toLowerCase().includes(k))) return eng;
    const canon = contractor(/\bals\b/i.test(title) ? "Al Saad " + title : title);
    const mine = contracts.filter((c) => c.contractor === canon);
    if (mine.length === 1) return mine[0];
    if (mine.length > 1) {
      const words = title.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !["schedule", "the", "and"].includes(w));
      const early = /\bEW\b|early/i.test(title);
      const scored = mine.map((c) => ({ c, score: words.filter((w) => c.scope.toLowerCase().includes(w)).length + (early && /early/i.test(c.scope) ? 5 : 0) - (!early && /early/i.test(c.scope) ? 5 : 0) }));
      scored.sort((a, b) => b.score - a.score || b.c.original - a.c.original);
      return scored[0].c;
    }
    return contractByFrag.get(engFragBySheet.get(s.name) ?? "");
  };
  const ipcRows: unknown[][] = [];
  for (const s of ipcSheets) {
    const p = paramsBySheet.get(s.name)!;
    const c = contractForSheet(s);
    if (!c) {
      notes.push(`IPC sheet "${s.name}" skipped – could not tell which contract it belongs to.`);
      continue;
    }
    notes.push(`IPC sheet "${s.name.trim()}" → contract ${c.po} (${c.contractor}).`);
    const A = p.layout === "A";
    const col = { ipcNo: A ? 12 : 9, ipcRef: A ? 13 : 10, ipcDate: A ? 14 : 11, cumCert: A ? 17 : 14, grossCert: A ? 18 : 15, invRef: A ? 23 : 20, invDate: A ? 24 : 21, paid: A ? 25 : 22 };
    // The sheet's blocks, each closed by a TOTAL row. The first is normally the whole contract; a sheet that
    // splits one contract across several projects ("NSCC (BEACH + RSMLI + AYC + B&M)" with a block per plot)
    // carries this project's part in the block whose certified total is the one Schedule H gives the contract.
    // The certified figure is read the way that reproduces Schedule H's: the sheet's cumulative column, else its
    // monthly gross certified added up, else that without the advance payment (not certified work in Aconex).
    interface IpcEntry { sr: unknown; appNo: string; month: unknown; aconex: string; appDate: string | null; claimed: number | null; ipcNo: string; ipcRef: string; ipcDate: string | null; cumCert: number | null; gross: number | null; advance: boolean; invRef: string; invDate: string | null; paid: string | null; note?: string }
    const blocks: { title: string; entries: IpcEntry[] }[] = [{ title: "", entries: [] }];
    let prevCum = 0;
    let n = 0;
    for (const [r, v] of rows(s)) {
      if (r <= p.hdr + 2) continue;
      const b = blocks[blocks.length - 1];
      if (txt(v, 1).toUpperCase().startsWith("TOTAL")) {
        blocks.push({ title: "", entries: [] });
        prevCum = 0;
        n = 0;
        continue;
      }
      const serial = isNum(cell(v, 1)) ? (cell(v, 1) as number) : /^\s*\d+\s*$/.test(txt(v, 1)) ? Number(txt(v, 1)) : null;
      if (serial === null || !isNum(cell(v, 6))) {
        if (txt(v, 1) && !txt(v, 2) && !b.entries.length && !/^(stage\b|sr\b)/i.test(txt(v, 1))) b.title = txt(v, 1);
        continue;
      }
      n++;
      let cumCert = money(v, col.cumCert);
      const gross = money(v, col.grossCert);
      if (cumCert !== null && gross !== null && n > 1 && Math.abs(cumCert - gross) < 0.5 && prevCum > 0 && cumCert < prevCum) cumCert = Math.round((prevCum + gross) * 100) / 100;
      if (cumCert !== null) prevCum = cumCert;
      const appNo = txt(v, 2) || `IPA ${serial}`;
      b.entries.push({ sr: serial, appNo, month: monthText(v, 3), aconex: txt(v, 4), appDate: date(v, 5) ?? date(v, col.ipcDate) ?? date(v, 3), claimed: money(v, 6), ipcNo: txt(v, col.ipcNo), ipcRef: txt(v, col.ipcRef), ipcDate: date(v, col.ipcDate), cumCert, gross, advance: /\badv(ance)?\b|\badv\.?\s*pay/i.test(appNo), invRef: txt(v, col.invRef), invDate: date(v, col.invDate), paid: date(v, col.paid) });
    }
    const live = blocks.filter((b) => b.entries.length);
    if (!live.length) continue;
    const cert = c.certified ?? null;
    const near = (x: number | null) => cert !== null && x !== null && Math.abs(x - cert) < 1;
    type Reading = "cumulative" | "gross" | "gross without advance";
    /** the block's certified to date read one way: the running figure on each application, and the last */
    const read = (b: { entries: IpcEntry[] }, how: Reading): { values: (number | null)[]; last: number | null } => {
      if (how === "cumulative") {
        const values = b.entries.map((e) => e.cumCert);
        return { values, last: [...values].reverse().find((x) => x !== null) ?? null };
      }
      let run = 0;
      let any = false;
      const values = b.entries.map((e) => {
        if (how === "gross without advance" && e.advance) return null;
        if (e.gross === null && e.cumCert === null) return null;
        if (e.gross !== null) run = Math.round((run + e.gross) * 100) / 100;
        any = true;
        return run;
      });
      return { values, last: any ? run : null };
    };
    let chosen = live[0];
    let how: Reading = "cumulative";
    if (cert !== null && !near(read(chosen, "cumulative").last)) {
      const ways: Reading[] = ["cumulative", "gross", "gross without advance"];
      const pick = (bs: typeof live) => {
        for (const w of ways) {
          const hits = bs.filter((b) => near(read(b, w).last));
          if (hits.length === 1) return { b: hits[0], w };
        }
        return null;
      };
      const found = pick([live[0]]) ?? (live.length > 1 ? pick(live) : null);
      if (found) {
        chosen = found.b;
        how = found.w;
        if (chosen !== live[0]) notes.push(`IPC sheet "${s.name.trim()}": the block "${chosen.title || "untitled"}" is this project's – its certified total is Schedule H's ${cert.toLocaleString("en", { minimumFractionDigits: 2 })}; the sheet's other ${live.length - 1} block(s) are not imported.`);
        if (how !== "cumulative") notes.push(`IPC sheet "${s.name.trim()}": certified to date read from the monthly gross certified${how === "gross without advance" ? " without the advance payment" : ""} – that adds up to Schedule H's ${cert.toLocaleString("en", { minimumFractionDigits: 2 })}, the sheet's cumulative column does not.`);
      }
    }
    if (how !== "cumulative") {
      const values = read(chosen, how).values;
      chosen.entries.forEach((e, i) => {
        e.cumCert = values[i];
        if (how === "gross without advance" && e.advance) e.note = "Advance payment – not certified work: left out of certified to date as in Schedule H and Aconex, recovered on later certificates";
      });
    }
    // an application without a date keeps its place in the log: it takes the date of the one before it (the first,
    // the one after it), so an undated first certificate is not read as the latest
    const entries = chosen.entries;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].appDate) continue;
      const before = entries.slice(0, i).reverse().find((e) => e.appDate)?.appDate;
      const after = entries.slice(i + 1).find((e) => e.appDate)?.appDate;
      if (before ?? after) (entries[i] as IpcEntry & { undated?: boolean }).undated = true;
      entries[i].appDate = before ?? after ?? null;
    }
    const seenApp = new Map<string, number>();
    for (const e of entries) {
      let appNo = e.appNo;
      const k = appNo.toLowerCase();
      const dup = (seenApp.get(k) ?? 0) + 1;
      seenApp.set(k, dup);
      if (dup > 1) appNo = `${appNo} (${dup})`;
      const undated = (e as IpcEntry & { undated?: boolean }).undated;
      ipcRows.push([c.po, e.sr, appNo, e.month, e.aconex, e.appDate ?? PERIOD_END, e.claimed, e.ipcNo, e.ipcRef, e.ipcDate, e.cumCert, e.invRef, e.invDate, e.paid, [undated ? "Application date missing in Excel – placed with the application beside it" : e.appDate ? "" : "Application date missing in Excel", e.note ?? ""].filter(Boolean).join(" | ")]);
    }
  }
  out.push({
    name: "IPC Log",
    register: "payment_applications",
    columns: cols([["Contract", "contract_id"], ["SR", "sr_no"], ["Payment application no", "application_no"], ["Month", "month"], ["Application Aconex ref", "application_aconex_ref"], ["Application date", "application_date"], ["Cumulative claimed (excl. VAT)", "cumulative_claimed"], ["IPC No", "ipc_no"], ["IPC Aconex ref", "ipc_aconex_ref"], ["IPC date", "ipc_date"], ["Cumulative certified (excl. VAT)", "cumulative_certified"], ["Invoice approval Aconex ref", "invoice_aconex_ref"], ["Invoice approval date", "invoice_date"], ["Paid by Finance", "paid_date"], ["Comments", "comments"]]),
    rows: ipcRows,
  });

  // ---- 3. Changes (Schedule C)
  const C = findSheet(sheets, "Schedule C");
  const changeRows: unknown[][] = [];
  if (C) {
    const hdr = findHeaderRow(C, "item", "description of change") ?? 16;
    // the stage columns by their headers: the blocks (EARLY WARNINGS, RFC, PVO, VO, EI, DVO, FUNDING, Comments)
    // on the header row, their fields on the row below, the representatives' sub-fields on the row after –
    // The Marina's sheet carries a "PR Status" column and an ACC / REEF block that the Yacht Club's does not
    const cc = (() => {
      const h0 = C.rows.get(hdr) ?? [];
      const h1 = C.rows.get(hdr + 1) ?? [];
      const h2 = C.rows.get(hdr + 2) ?? [];
      const label = (row: Row, i: number) => txt(row, i).replace(/\s+/g, " ").trim().toUpperCase();
      const last = Math.max(h0.length, h1.length, h2.length);
      const starts = (names: string[]) => {
        for (let i = 1; i < last; i++) for (const n of names) if (label(h0, i).startsWith(n)) return i;
        return -1;
      };
      const order = [
        ["ew", ["EARLY WARNING"]],
        ["rfc", ["RFC"]],
        ["pvo", ["PVO"]],
        ["vo", ["VO"]],
        ["ei", ["EI"]],
        ["dvo", ["DVO"]],
        ["acc", ["ACC AND REEF", "ACC"]],
        ["fund", ["FUNDING"]],
        ["comments", ["COMMENTS"]],
      ] as const;
      const start: Record<string, number> = {};
      for (const [k, names] of order) start[k] = starts([...names]);
      const end = (k: string) => {
        const mine = start[k];
        const nexts = Object.values(start).filter((x) => x > mine);
        return nexts.length ? Math.min(...nexts) - 1 : last;
      };
      const within = (k: string, row: Row, ...names: string[]) => {
        if (start[k] < 0) return -1;
        for (let i = start[k]; i <= end(k); i++) for (const n of names) if (label(row, i).startsWith(n)) return i;
        return -1;
      };
      const after = (from: number, row: Row, name: string, to: number) => {
        for (let i = from; i <= to; i++) if (label(row, i).startsWith(name)) return i;
        return -1;
      };
      const rep = (k: string, name: string) => {
        const c = within(k, h1, name);
        if (c < 0) return { ref: -1, date: -1, amount: -1 };
        const to = end(k);
        const ref = after(c, h2, "ACONEX", to);
        const date = after(Math.max(c, ref), h2, "DATE", to);
        const amount = after(Math.max(c, date), h2, "SUBMISSION AMOUNT", to);
        return { ref, date, amount };
      };
      const con = rep("dvo", "CONTRACTOR");
      const eng = rep("dvo", "ENGINEER");
      const emp = rep("dvo", "EMPLOYER");
      const found = start.rfc > 0 && start.pvo > 0 && start.dvo > 0;
      const or = (v: number, d: number) => (found && v >= 0 ? v : d);
      return {
        found,
        ewNr: or(within("ew", h1, "NR"), 15), ewDate: or(within("ew", h1, "DATE"), 16), ewCr: or(within("ew", h1, "COST REPORT AMOUNT"), 17),
        rfcNr: or(within("rfc", h1, "NR"), 18), rfcRev: or(within("rfc", h1, "REVISION"), 19), rfcDate: or(within("rfc", h1, "DATE"), 20), rfcStatus: or(within("rfc", h1, "STATUS"), 21), rfcAconex: or(within("rfc", h1, "ACONEX"), 22), rfcTime: or(within("rfc", h1, "TIME IMPACT"), 23), rfcTracker: or(within("rfc", h1, "TRACKER AMOUNT"), 24), rfcCr: or(within("rfc", h1, "COST REPORT AMOUNT"), 25),
        pvoNr: or(within("pvo", h1, "NR"), 26), pvoRev: or(within("pvo", h1, "REVISION"), 27), pvoDate: or(within("pvo", h1, "DATE"), 28), pvoStatus: or(within("pvo", h1, "STATUS"), 29), pvoPr: found ? within("pvo", h1, "PR STATUS") : 30, pvoAconex: or(within("pvo", h1, "ACONEX"), 31), pvoTime: or(within("pvo", h1, "TIME IMPACT"), 32), pvoTracker: or(within("pvo", h1, "TRACKER AMOUNT"), 33), pvoAmount: or(within("pvo", h1, "AMOUNT", "COST REPORT AMOUNT"), 34),
        voNr: or(within("vo", h1, "NR"), 35), voDate: or(within("vo", h1, "DATE"), 36), voStatus: or(within("vo", h1, "STATUS"), 37), voAconex: or(within("vo", h1, "ACONEX"), 38),
        eiNr: or(within("ei", h1, "NR"), 39), eiDate: or(within("ei", h1, "DATE"), 40), eiAconex: or(within("ei", h1, "ACONEX"), 41),
        dvoNr: or(within("dvo", h1, "NR"), 42), dvoRev: or(within("dvo", h1, "REVISION"), 43), dvoTracker: or(within("dvo", h1, "TRACKER AMOUNT"), 52), dvoStatus: or(within("dvo", h1, "STATUS"), 54),
        conRef: or(con.ref, 44), conDate: or(con.date, 45), conAmount: or(con.amount, 46),
        engRef: or(eng.ref, 47), engDate: or(eng.date, 48), engAmount: or(eng.amount, 49),
        empRef: or(emp.ref, 50), empDate: or(emp.date, 51), empAmount: or(emp.amount, 53),
        fundBtr: found ? within("fund", h1, "BTR") : 55, fundPvo: found ? within("fund", h1, "PVO") : 56, fundDvo: found ? within("fund", h1, "DVO") : 57, fundPo: found ? within("fund", h1, "PO") : 58, fundPr: found ? within("fund", h1, "PR") : 59, fundCont: found ? within("fund", h1, "CONTINGENCY") : 60,
        comments: or(start.comments, 62),
      };
    })();
    if (!cc.found) notes.push("Schedule C: the stage columns were not found by their headers – The Marina's column positions are assumed.");
    const DEAD = ["CANCELLED", "REJECTED", "SUPERSEDED", "TRANSFERRED"];
    const stageStatus = (s: string) => {
      const u = s.toUpperCase().trim();
      const m: Record<string, string> = { APPROVED: "Approved", CANCELLED: "Cancelled", SUPERSEDED: "Superseded", "REVIEW COMPLETE": "Review Complete", REJECTED: "Rejected", PENDING: "Pending" };
      return m[u] ?? (u ? u[0] + u.slice(1).toLowerCase() : "");
    };
    const timeImpact = (v: Row, i: number): number | null => {
      const x = cell(v, i);
      if (isNum(x)) return x;
      return String(x ?? "").trim().toUpperCase() === "NO" ? 0 : null;
    };
    const prStatus = (s: string) => {
      const u = s.toUpperCase();
      if (!u) return "";
      if (u === "PENDING") return "Raised";
      if (u === "CANCELLED") return "Rejected";
      if (u.startsWith("PR ")) return "Approved";
      return "Raised";
    };
    const itemSeen = new Map<string, number>();
    for (const [r, v] of rows(C)) {
      if (r <= hdr + 2 || !isNum(cell(v, 1))) continue;
      if (!txt(v, 2).trim()) continue; // a numbered row with nothing on it
      const item = String(Math.trunc(cell(v, 1) as number));
      const dup = (itemSeen.get(item) ?? 0) + 1;
      itemSeen.set(item, dup);
      const itemNo = `CH-${item.padStart(3, "0")}${dup === 1 ? "" : String.fromCharCode(96 + dup)}`;
      // a line struck through in the workbook is cancelled: the whole change when its description is, a stage when its reference is
      const struckCols = C.strikes?.get(r) ?? [];
      const struck = struckCols.includes(2);
      const struckStage = (refCol: number, status: string) => (struckCols.includes(refCol) && !DEAD_STAGE.includes(status) ? "Cancelled" : status);
      const dvoStatus = struckStage(cc.dvoNr, stageStatus(txt(v, cc.dvoStatus)));
      const rfcStatus = struckStage(cc.rfcNr, stageStatus(txt(v, cc.rfcStatus)));
      const pvoStatus = struckStage(cc.pvoNr, stageStatus(txt(v, cc.pvoStatus)));
      const voStatus = struckStage(cc.voNr, stageStatus(txt(v, cc.voStatus)));
      const excelStatus = txt(v, 7);
      const u = excelStatus.toUpperCase();
      const excelOverall = u.includes("ACCEPT") || u.includes("APPROV") ? "Approved" : u.includes("REJECT") || u.includes("SUPERSED") || u.includes("CANCEL") ? "Rejected" : u.includes("FINAL ACCOUNT") ? (dvoStatus === "Approved" ? "Approved" : "Pending") : "Pending";
      // the stages decide: a DVO approved closes the change, a struck-through line or a dead last stage cancels it
      const overall = impliedOverallStatus({ rfc: rfcStatus, pvo: pvoStatus, vo: voStatus, dvo: dvoStatus }, excelOverall, { struck });
      const pvoAmt = money(v, cc.pvoAmount);
      const rfcAmt = money(v, cc.rfcCr);
      const dvoAmt = money(v, cc.empAmount);
      const stageDates = [date(v, cc.empDate), date(v, cc.engDate), date(v, cc.conDate), date(v, cc.eiDate), date(v, cc.voDate), date(v, cc.pvoDate), date(v, cc.rfcDate)].filter((x): x is string => !!x);
      let closed: string | null = null;
      if (overall === "Approved" && ["Approved", "Review Complete"].includes(dvoStatus)) closed = date(v, cc.empDate) ?? (stageDates.length ? stageDates.sort().at(-1)! : null);
      else if (DEAD_STAGE.includes(overall) || overall === "Rejected") closed = stageDates.length ? stageDates.sort().at(-1)! : null;
      const pendingBy = txt(v, 6);
      const pending = ({ CLOSED: "None", "N/A": "None", OTHER: "Commercial Team" } as Record<string, string>)[pendingBy.toUpperCase()] ?? "Commercial Team";
      const rep = ["CLOSED", "OTHER", "N/A"].includes(txt(v, 5).toUpperCase()) ? "" : txt(v, 5).replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w/g, (c) => c.toLowerCase());
      const stage = txt(v, 3).replace("Post Contract", "Post-Contract").replace("Pre Contract", "Pre-Contract");
      const note = [excelStatus ? `Excel status: ${excelStatus}` : "", txt(v, cc.comments) ? `Comments: ${txt(v, cc.comments)}` : "", pendingBy ? `Action pending by (Excel): ${pendingBy}` : ""].filter(Boolean).join(" | ");
      void DEAD;
      changeRows.push([
        itemNo, txt(v, 2), overall, date(v, cc.rfcDate) ?? date(v, cc.ewDate) ?? date(v, cc.pvoDate), asset, pkg(txt(v, 13)), contractor(txt(v, 14)), lineForPkg(txt(v, 13)), stage, txt(v, 4), txt(v, 8), rep, pending, closed,
        txt(v, cc.ewNr), date(v, cc.ewDate), money(v, cc.ewCr),
        txt(v, cc.rfcNr), txt(v, cc.rfcRev), date(v, cc.rfcDate), rfcStatus, txt(v, cc.rfcAconex), timeImpact(v, cc.rfcTime), rfcAmt, rfcAmt === null ? null : 0,
        txt(v, cc.pvoNr), txt(v, cc.pvoRev), date(v, cc.pvoDate), pvoStatus, txt(v, cc.pvoAconex), timeImpact(v, cc.pvoTime), pvoAmt, pvoAmt, prStatus(txt(v, cc.pvoPr)),
        txt(v, cc.voNr), date(v, cc.voDate), voStatus, txt(v, cc.voAconex), txt(v, cc.voNr) ? pvoAmt : null,
        txt(v, cc.eiNr), date(v, cc.eiDate), txt(v, cc.eiAconex),
        txt(v, cc.dvoNr), txt(v, cc.dvoRev), date(v, cc.empDate), dvoStatus, money(v, cc.conAmount), dvoAmt,
        txt(v, cc.conRef), date(v, cc.conDate), money(v, cc.conAmount), txt(v, cc.engRef), date(v, cc.engDate), money(v, cc.engAmount), txt(v, cc.empRef), date(v, cc.empDate), dvoAmt,
        money(v, cc.fundBtr), money(v, cc.fundPvo), money(v, cc.fundDvo), money(v, cc.fundPo), money(v, cc.fundPr), money(v, cc.fundCont), note,
      ]);
    }
    notes.push(`Changes: ${changeRows.length}.`);
  }
  out.push({
    name: "Change Tracker",
    register: "changes",
    columns: cols([
      ["Item No", "item_no"], ["Description", "description"], ["Overall status", "overall_status_id"], ["Date raised", "date_raised"], ["Project / Asset", "asset_id"], ["Package", "package_id"], ["Contractor / Consultant", "contractor_id"], ["Cost report line", "cost_line_id"], ["Project stage", "project_stage_id"], ["Change category", "change_category_id"], ["Initiated by", "initiated_by_id"], ["Amaala rep", "amaala_rep"], ["Action pending by", "action_pending_by"], ["Closed date", "closed_date"],
      ["EW reference no", "ew_ref"], ["EW date", "ew_date"], ["EW cost-report amount", "ew_cr_amount"],
      ["RFC reference no", "rfc_ref"], ["RFC revision", "rfc_rev"], ["RFC date", "rfc_date"], ["RFC status", "rfc_status_id"], ["RFC Aconex ref", "rfc_aconex_ref"], ["RFC time impact (days)", "rfc_time_impact"], ["RFC tracker amount", "rfc_tracker_amount"], ["RFC cost-report amount", "rfc_cr_amount"],
      ["PVO reference no", "pvo_ref"], ["PVO revision", "pvo_rev"], ["PVO date", "pvo_date"], ["PVO status", "pvo_status_id"], ["PVO Aconex ref", "pvo_aconex_ref"], ["PVO time impact (days)", "pvo_time_impact"], ["PVO tracker amount", "pvo_tracker_amount"], ["PVO cost-report amount", "pvo_cr_amount"], ["PR status", "vo_pr_status"],
      ["VO reference no", "vo_ref"], ["VO date", "vo_date"], ["VO status", "vo_status_id"], ["VO Aconex ref", "vo_aconex_ref"], ["VO cost-report amount", "vo_cr_amount"],
      ["EI reference no", "ei_ref"], ["EI date", "ei_date"], ["EI Aconex ref", "ei_aconex_ref"],
      ["DVO reference no", "dvo_ref"], ["DVO revision", "dvo_rev"], ["DVO date", "dvo_date"], ["DVO status", "dvo_status_id"], ["DVO tracker amount", "dvo_tracker_amount"], ["DVO cost-report amount", "dvo_cr_amount"],
      ["Contractor's submission – Aconex ref", "vo_contractor_aconex_ref"], ["Contractor's submission – date", "vo_contractor_date"], ["Contractor's submission – amount", "vo_contractor_amount"],
      ["Engineer's submission – Aconex ref", "vo_engineer_aconex_ref"], ["Engineer's submission – date", "vo_engineer_date"], ["Engineer's submission – amount", "vo_engineer_amount"],
      ["Employer's submission – Aconex ref", "vo_employer_aconex_ref"], ["Employer's submission – date", "vo_employer_date"], ["Employer's submission – amount", "vo_employer_amount"],
      ["BTR", "funding_btr"], ["Funding PVO", "funding_pvo"], ["Funding DVO", "funding_dvo"], ["PO", "funding_po"], ["PR", "funding_pr"], ["Contingency / Additional budget", "funding_contingency"], ["Notes", "notes"],
    ]),
    rows: changeRows,
  });

  // ---- 4. Claims (Schedule E New, else Schedule E)
  const E = findSheet(sheets, "Schedule E New", "Schedule E");
  const claimRows: unknown[][] = [];
  if (E) {
    const hdr = findHeaderRow(E, "claim no", "description of claim") ?? 11;
    for (const [r, v] of rows(E)) {
      if (r <= hdr + 1 || !isNum(cell(v, 1))) continue;
      const det = money(v, 49) !== null || txt(v, 40) || date(v, 41);
      const n = (x: number) => (isNum(cell(v, x)) ? (cell(v, x) as number) : null);
      const bigDays = isNum(cell(v, 39)) && (cell(v, 39) as number) >= 10000; // the Excel sometimes puts SAR in the "days" cell
      claimRows.push([
        `CL-${String(Math.trunc(cell(v, 1) as number)).padStart(3, "0")}`, txt(v, 2), det ? "Approved" : "Pending", asset, contractor(txt(v, 7)), txt(v, 3), txt(v, 5), txt(v, 6),
        !!txt(v, 8), !!txt(v, 9), !!txt(v, 10), !!txt(v, 11), !!txt(v, 12),
        date(v, 13), txt(v, 14), date(v, 15), txt(v, 18), date(v, 19), txt(v, 20), date(v, 21), txt(v, 24), date(v, 25), txt(v, 26), date(v, 27),
        n(28), n(29), money(v, 42), txt(v, 44).toLowerCase().startsWith("awaiting") ? "" : txt(v, 44), date(v, 45),
        n(30), n(31), money(v, 43), txt(v, 32), date(v, 33),
        n(34), n(35), money(v, 46), txt(v, 36) || txt(v, 47), date(v, 37) ?? date(v, 48),
        n(38), bigDays ? null : n(39), money(v, 49) ?? (bigDays ? money(v, 39) : null), txt(v, 40) || txt(v, 50), date(v, 41) ?? date(v, 51),
        [txt(v, 52) ? `Last action: ${txt(v, 52)}` : "", txt(v, 56) ? `Action with: ${txt(v, 56)}` : "", txt(v, 57) ? `Remark: ${txt(v, 57)}` : "", txt(v, 59) ? `Rejected on: ${txt(v, 59)}` : ""].filter(Boolean).join(" | "),
      ]);
    }
  }
  // Claims & Disputes are maintained from the AMAALA Claims Tracker (Stand-alone imports -> Claims Tracker),
  // not from Schedule E of the monthly workbook, so the schedule is read but not imported.
  if (claimRows.length) notes.push(`Claims (Schedule E, ${claimRows.length} rows) were not imported: Claims & Disputes come from the Claims Tracker import.`);
  if (INCLUDE_WORKBOOK_CLAIMS) out.push({
    name: "Claims",
    register: "claims",
    columns: cols([
      ["Claim No", "claim_no"], ["Description", "description"], ["Status", "status"], ["Asset code", "asset_id"], ["Contractor / Consultant", "contractor_id"], ["Contract No", "contract_no"], ["Project", "project"], ["Scope", "scope"],
      ["EOT", "type_eot"], ["Prolongation", "type_prolongation"], ["Disruption", "type_disruption"], ["Acceleration", "type_acceleration"], ["Other", "type_other"],
      ["(A) Date contractor became aware", "notice_aware_date"], ["Notice letter ref", "notice_letter_ref"], ["(B) Date received by RSG", "notice_received_date"], ["Engineer / Employer response ref", "notice_response_ref"], ["Response date", "notice_response_date"],
      ["Detailed claim letter ref", "detail_letter_ref"], ["(C) Date detailed claim received", "detail_received_date"], ["Engineer / Employer detailed response ref", "detail_response_ref"], ["Detailed response date", "detail_response_date"], ["Resubmission ref", "resubmission_ref"], ["Resubmission date", "resubmission_date"],
      ["Contractor's claim – EOT days", "contractor_eot_days"], ["Contractor's claim – compensable days", "contractor_compensable_days"], ["Contractor's claim – cost (SAR)", "contractor_cost"], ["Contractor's claim – letter ref", "contractor_ref"], ["Contractor's claim – date", "contractor_date"],
      ["Engineer's recommendation – EOT days", "engineer_eot_days"], ["Engineer's recommendation – compensable days", "engineer_compensable_days"], ["Engineer's recommendation – cost (SAR)", "engineer_cost"], ["Engineer's recommendation – letter ref", "engineer_ref"], ["Engineer's recommendation – date", "engineer_date"],
      ["Employer's assessment – EOT days", "employer_eot_days"], ["Employer's assessment – compensable days", "employer_compensable_days"], ["Employer's assessment – cost (SAR)", "employer_cost"], ["Employer's assessment – letter ref", "employer_ref"], ["Employer's assessment – date", "employer_date"],
      ["Determination – EOT days", "determination_eot_days"], ["Determination – compensable days", "determination_compensable_days"], ["Determination – cost (SAR)", "determination_cost"], ["Determination – letter / VO ref", "determination_ref"], ["Determination – date", "determination_date"], ["Notes", "notes"],
    ]),
    rows: claimRows,
  });

  // ---- 5. Early warnings (Early Warning sheet)
  const EW = findSheet(sheets, "Early Warning", "Early Warnings");
  const ewRows: unknown[][] = [];
  if (EW) {
    const seen = new Map<string, number>();
    for (const [, v] of rows(EW)) {
      const desc = txt(v, 3);
      const p = txt(v, 2);
      if (!desc || !p || txt(v, 1).toUpperCase().startsWith("SUB") || p.toUpperCase() === p) continue; // section titles are upper case
      const base = txt(v, 1) ? `EW-${txt(v, 1)}` : "EW";
      const dup = (seen.get(base) ?? 0) + 1;
      seen.set(base, dup);
      const cost = money(v, 4) ?? 0;
      ewRows.push([`${base}${dup === 1 ? "" : "-" + dup}`, PERIOD_END, "Contractor", asset, pkg(p), contractor(p), desc, null, cost, cost ? "High" : "Med", "Open", lineForPkg(p), [txt(v, 5) ? `Excel stage: ${txt(v, 5)}` : "", txt(v, 6), "Date raised not in Excel – set to the period end"].filter(Boolean).join(" | ")]);
    }
  }
  out.push({
    name: "Early Warnings",
    register: "early_warnings",
    columns: cols([["EW No", "ew_no"], ["Date raised", "date_raised"], ["Raised by", "raised_by"], ["Asset", "asset_id"], ["Package", "package_id"], ["Contractor / Consultant", "contractor_id"], ["Description", "description"], ["Potential time impact (days)", "time_impact_days"], ["Potential cost impact", "cost_impact"], ["Likelihood", "likelihood"], ["Status", "status"], ["Cost report line", "cost_line_id"], ["Notes", "notes"]]),
    rows: ewRows,
  });

  // ---- 6. Risks (Schedule D)
  const D = findSheet(sheets, "Schedule D");
  const riskRows: unknown[][] = [];
  if (D) {
    for (const [, v] of rows(D)) {
      const no = cell(v, 1);
      if (!isNum(no) || Number.isInteger(no) || !txt(v, 2)) continue;
      const risk = money(v, 3);
      const opp = money(v, 4);
      riskRows.push([`RO-${no.toFixed(2)}`, opp ? "Opportunity" : "Risk", txt(v, 2), asset, risk ?? -(opp ?? 0), "Open", PERIOD_END, "From Schedule D; date set to the period end"]);
    }
  }
  out.push({
    name: "Risks & Opportunities",
    register: "risks",
    columns: cols([["No", "ro_no"], ["Type", "type"], ["Description", "description"], ["Asset", "asset_id"], ["Cost impact", "cost_impact"], ["Status", "status"], ["Date", "date"], ["Notes", "notes"]]),
    rows: riskRows,
  });

  // ---- 7. Provisional sums (Schedule F)
  const F = findSheet(sheets, "Schedule F");
  const psRows: unknown[][] = [];
  if (F) {
    const hdr = findHeaderRow(F, "item", "description", "budget") ?? 11;
    for (const [r, v] of rows(F)) {
      if (r <= hdr || !isNum(cell(v, 1)) || !txt(v, 2)) continue;
      const st = txt(v, 3);
      psRows.push([`PS-${String(Math.trunc(cell(v, 1) as number)).padStart(2, "0")}`, txt(v, 2), st ? st[0].toUpperCase() + st.slice(1).toLowerCase() : "Pending", contractor(txt(v, 4)), asset, money(v, 5) ?? 0, money(v, 6), txt(v, 8), psRows.length + 1]);
    }
  }
  out.push({
    name: "Provisional Sums",
    register: "provisional_sums",
    columns: cols([["Item", "item"], ["Description", "description"], ["Status", "status_id"], ["Contractor", "contractor_id"], ["Asset", "asset_id"], ["Budget", "budget"], ["Contract value", "contract_value"], ["Comments", "comments"], ["Order", "sort_order"]]),
    rows: psRows,
  });

  // ---- 8. Bonds & insurance (Schedule G)
  // A bond whose contract is closed (FA Status sheet "Closed" / "Not required", or Schedule H "CLOSED") is
  // imported as released so its expiry is not flagged.
  const closedLines = new Set<string>();
  for (const c of contracts) if (c.status === "Closed" && c.line) closedLines.add(c.line);
  {
    const FA0 = findSheet(sheets, "FA Status", "Final Account Status", "FA");
    if (FA0) {
      const hdr = findHeaderRow(FA0, "acc code", "status") ?? 12;
      for (const [r, v] of rows(FA0)) {
        if (r <= hdr || !isNum(cell(v, 1)) || !txt(v, 2)) continue;
        if (faStatusFromExcel(txt(v, 12)) === "Open") continue;
        const frag = txt(v, 2).replace(/\s+/g, "").replace(/^(PS|CN|MS|CM)\./, "").split(".")[0];
        const line = lineForFrag(frag);
        if (line) closedLines.add(line);
      }
    }
  }
  const G = findSheet(sheets, "Schedule G");
  const bondRows: unknown[][] = [];
  let releasedBonds = 0;
  if (G) {
    const hdr = findHeaderRow(G, "ref", "type of bond") ?? 12;
    const seen = new Map<string, number>();
    const noExpiry: string[] = [];
    for (const [r, v] of rows(G)) {
      if (r <= hdr || !isNum(cell(v, 2)) || !txt(v, 7)) continue;
      // the ref is the number printed on Schedule G; a number the report uses twice gets a letter (10, 10a)
      const base = String(Math.trunc(cell(v, 2) as number));
      const dup = (seen.get(base) ?? 0) + 1;
      seen.set(base, dup);
      const req = money(v, 9);
      const reqTxt = txt(v, 9);
      const t = BOND_TYPES[txt(v, 7).toLowerCase().trim()] ?? txt(v, 7).trim();
      let comments = txt(v, 16);
      if (req === null && reqTxt) comments = `Contract requirement: ${reqTxt}. ${comments}`.trim();
      const line = lineForPkg(txt(v, 4));
      const released = !!line && closedLines.has(line);
      const bondRef = `${base}${dup === 1 ? "" : String.fromCharCode(96 + dup)}`;
      const expiry = date(v, 12);
      if (!expiry) {
        // no expiry: a bond returned or never required ("Fully recovered", "N/A") – not a live bond
        noExpiry.push(`${bondRef} ${t} – ${contractor(txt(v, 3))}${reqTxt && req === null ? ` (${reqTxt})` : ""}`);
        continue;
      }
      if (released) releasedBonds++;
      bondRows.push([bondRef, contractor(txt(v, 3)), pkg(txt(v, 4)), line, t, txt(v, 8), money(v, 5), req !== null ? "Fixed SAR amount" : "% of contract value", req, money(v, 10), expiry, yes(v, 14), yes(v, 15), released, comments]);
    }
    if (releasedBonds) notes.push(`Bonds & insurance: ${releasedBonds} marked as released because the contract is closed in FA Status / Schedule H.`);
    if (noExpiry.length) notes.push(`Bonds & insurance: ${noExpiry.length} row(s) without an expiry date left out (returned or not required): ${noExpiry.join("; ")}.`);
  }
  out.push({
    name: "Bonds & Insurance",
    register: "bonds",
    columns: cols([["Ref", "ref"], ["Contractor / Consultant", "contractor_id"], ["Package", "package_id"], ["Cost report line (contract)", "cost_line_id"], ["Type of bond / insurance", "type_id"], ["Policy / bond no", "policy_no"], ["Original contract sum", "original_contract_sum"], ["Contract requirement – type", "requirement_type"], ["Contract requirement – value", "requirement_value"], ["Amount provided", "amount_provided"], ["Expiry date", "expiry_date"], ["Approved", "approved"], ["Bank verification", "bank_verification"], ["Contract closed – bond released", "contract_closed"], ["Comments", "comments"]]),
    rows: bondRows,
  });

  // ---- 9. Budget transfers (Schedule J)
  const J = findSheet(sheets, "Schedule J");
  const btRows: unknown[][] = [];
  if (J) {
    const hdr = findHeaderRow(J, "item", "from package") ?? 11;
    const seen = new Map<string, number>();
    for (const [r, v] of rows(J)) {
      if (r <= hdr || !isNum(cell(v, 1)) || !txt(v, 2)) continue;
      const from = money(v, 5);
      const to = money(v, 6);
      const amount = to ? Math.abs(to) : Math.abs(from ?? 0);
      if (!amount) continue;
      const base = `BT-${String(Math.trunc(cell(v, 1) as number)).padStart(2, "0")}`;
      const dup = (seen.get(base) ?? 0) + 1;
      seen.set(base, dup);
      const dt = date(v, 7);
      btRows.push([`${base}${dup === 1 ? "" : String.fromCharCode(96 + dup)}`, txt(v, 2), "Approved", pkg(txt(v, 3)) || "Budget Hold", pkg(txt(v, 4)) || "Budget Hold", Math.round(amount * 100) / 100, dt ?? PERIOD_END, txt(v, 9), [txt(v, 8) ? `Excel reporting period: ${txt(v, 8)}` : "", dt ? "" : "Date not given in Excel", 'Historic transfer – already included in "Budget transfers brought forward" on the cost lines, so not linked to cost lines.'].filter(Boolean).join(". ")]);
    }
  }
  out.push({
    name: "Budget Transfers",
    register: "budget_transfers",
    columns: cols([["Item", "item"], ["Description", "description"], ["Status", "status"], ["From package", "from_package_id"], ["To package", "to_package_id"], ["Amount", "amount"], ["Date", "date"], ["Approval ref", "approval_ref"], ["Notes", "notes"]]),
    rows: btRows,
  });

  // ---- 9b. Final account status (FA Status sheet)
  const FA = findSheet(sheets, "FA Status", "Final Account Status", "FA");
  const faRows: unknown[][] = [];
  if (FA) {
    const hdr = findHeaderRow(FA, "acc code", "status") ?? 12;
    const seenAcc = new Set<string>();
    const faNoLine: string[] = [];
    for (const [r, v] of rows(FA)) {
      if (r <= hdr || !isNum(cell(v, 1)) || !txt(v, 2)) continue;
      const acc = txt(v, 2).replace(/\s+/g, "");
      if (seenAcc.has(acc)) continue;
      seenAcc.add(acc);
      const frag = acc.replace(/^(PS|CN|MS|CM)\./, "").split(".")[0];
      // only "Open" is open: "FAS Signed", "Closed" and the workbook's other wordings all close the contract
      const status = faStatusFromExcel(txt(v, 12));
      const typ = txt(v, 5);
      const faContractor = contractor(txt(v, 4) || txt(v, 3));
      const po = String(contractByFrag.get(frag)?.po ?? "");
      const byPo = po && !/^TBC/.test(po) ? lines.find((l) => !l.hold && l.name.includes(po))?.code ?? "" : "";
      const byContractor = (() => {
        const hits = lines.filter((l) => !l.hold && l.contractor && l.contractor === faContractor);
        return hits.length === 1 ? hits[0].code : "";
      })();
      const faLine = lineForFrag(frag) || byPo || byContractor;
      if (!faLine) {
        faNoLine.push(`${acc} ${faContractor}`);
        continue;
      }
      faRows.push([acc, txt(v, 3).replace(/\s+/g, " "), faContractor, ["Contractor", "Consultant", "Supplier", "Insurer"].includes(typ) ? typ : "", faLine, contractByFrag.get(frag)?.po ?? "", txt(v, 9) === "TBC" ? "" : txt(v, 9), date(v, 10), status, "", status === "Closed" ? null : null, txt(v, 13)]);
    }
    notes.push(`Final accounts: ${faRows.length}.${faNoLine.length ? ` ${faNoLine.length} row(s) left out – no cost report line for the ACC code, the contract's PO or the contractor: ${faNoLine.join("; ")}.` : ""}`);
  }
  out.push({
    name: "Final Account Status",
    register: "final_accounts",
    columns: cols([["ACC code", "acc_ref"], ["Package / description", "description"], ["Contractor / Consultant", "contractor_id"], ["Type", "type"], ["Cost report line", "cost_line_id"], ["Contract", "contract_id"], ["Responsible", "responsible"], ["Forecast FA closure", "forecast_closure_date"], ["Status", "status"], ["FA statement ref", "fa_statement_ref"], ["Closed / signed date", "closed_date"], ["Comments", "comments"]]),
    rows: faRows,
  });

  // ---- 10. Project team (Data Input sign-off block + Index "Prepared by")
  const teamRows: unknown[][] = [];
  if (dataInput) {
    let n = 0;
    for (const [, v] of rows(dataInput)) {
      const rawRole = txt(v, 1);
      const role = rawRole.replace(/:$/, "").trim();
      const name = txt(v, 3);
      if (!rawRole.endsWith(":") || !name || name.length < 4 || !/^[A-Za-z .'-]+$/.test(name) || !/director|manager|engineer|surveyor|lead|head|controller/i.test(role)) continue;
      n++;
      teamRows.push([n, role, name, "Red Sea Global", true]);
    }
  }
  out.push({ name: "Project Team", register: "project_team", columns: cols([["#", "sort_order"], ["Role / position", "role"], ["Name", "name"], ["Organisation", "organisation"], ["On distribution", "in_distribution"]]), rows: teamRows });

  notes.push(`Converted from the Marina CM Report layout${reportNo ? ` (Report No ${reportNo}` + (periodEnd ? `, period ending ${periodEnd})` : ")") : ""}.`);
  const level1 = readLevel1Check(sheets);
  if (level1) notes.push(`Excel Level 1: budget ${fmt(level1.budget)}, anticipated final account ${fmt(level1.afa)}, variance ${fmt(level1.variance)}, last month ${fmt(level1.lastMonthAfa)}, variance to last month ${fmt(level1.varianceToLastMonth)} – kept with the report for the dashboard's Excel check.`);
  return { sheets: out.filter((s) => s.rows.length > 0), notes, periodEnd, reportNo, level1 };
}

export const fmt = (n: number | null) => (n === null ? "–" : n.toLocaleString("en", { maximumFractionDigits: 0 }));

export function cols(pairs: [string, string][]) {
  return pairs.map(([label, key]) => ({ label, key }));
}

/** Turns converted sheets into the value-sheets the analyser and importer read (headings tagged with [key]). */
export function toSheetValues(conv: Pick<ConversionResult, "sheets">): Sheet[] {
  return conv.sheets.map((s) => {
    const rowsMap = new Map<number, unknown[]>();
    rowsMap.set(1, [null, ...s.columns.map((c) => `${c.label} [${c.key}]`)]);
    s.rows.forEach((r, i) => rowsMap.set(i + 2, [null, ...r.map((v) => (v === undefined ? null : v))]));
    return { name: s.name, rows: rowsMap, rowCount: s.rows.length + 1, truncated: false };
  });
}
