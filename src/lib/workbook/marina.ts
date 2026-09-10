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
import { cellText } from "./read";

type Row = unknown[];
type Sheet = SheetValues;

export interface ConvertedSheet {
  name: string;
  register: string;
  columns: { label: string; key: string }[];
  rows: unknown[][];
}

export interface ConversionResult {
  sheets: ConvertedSheet[];
  notes: string[];
  periodEnd: string | null;
  reportNo: number | null;
}

/* ------------------------------------------------------------------ helpers */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const cell = (v: Row | undefined, i: number): unknown => (v && v.length > i ? v[i] : undefined);
const txt = (v: Row | undefined, i: number): string => {
  const x = cell(v, i);
  return x === null || x === undefined ? "" : String(x).trim();
};
const money = (v: Row | undefined, i: number): number | null => {
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
function date(v: Row | undefined, i: number): string | null {
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
function monthText(v: Row | undefined, i: number): string {
  const x = cell(v, i);
  if (x === null || x === undefined || x === "") return "";
  const iso = isNum(x) ? serialToIso(x) : /^\d{4}-\d{2}/.test(String(x)) ? String(x).slice(0, 10) : null;
  if (iso) {
    const [y, m] = iso.split("-");
    return `${MONTHS[Number(m) - 1][0].toUpperCase()}${MONTHS[Number(m) - 1].slice(1)}'${y.slice(2)}`;
  }
  return String(x).trim();
}
const yes = (v: Row | undefined, i: number) => ["yes", "y", "true", "1", "x", "11", "ü"].includes(txt(v, i).toLowerCase());
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function rows(sheet: Sheet | undefined): [number, Row][] {
  return sheet ? [...sheet.rows.entries()].sort((a, b) => a[0] - b[0]) : [];
}
function findSheet(sheets: Sheet[], ...names: string[]): Sheet | undefined {
  for (const n of names) {
    const hit = sheets.find((s) => norm(s.name) === norm(n));
    if (hit) return hit;
  }
  return undefined;
}
/** First row whose cells include all the given words (case-insensitive). */
function findHeaderRow(sheet: Sheet, ...words: string[]): number | null {
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

const BOND_TYPES: Record<string, string> = {
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
      const m = /([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(txt(v, 2));
      if (m) {
        const mo = MONTHS.indexOf(m[1].toLowerCase());
        if (mo >= 0) {
          const last = new Date(Date.UTC(Number(m[2]), mo + 1, 0));
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
      const frag = code.replace(/^(PS|CN|MS|CM)\./, "").split(".")[0];
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
  const fragBySheet = new Map<string, string>();
  const engFragBySheet = new Map<string, string>();
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
    fragBySheet.set(s.name, findFrag(layout === "A" ? [4, 23] : [4, 20]));
    engFragBySheet.set(s.name, findFrag(layout === "A" ? [13] : [10]));
  }
  interface Contract { sr: number; pr: string; po: string; acc: string; contractor: string; scope: string; status: string; completion: string | null; eot: number; original: number; faAdj: number; line: string; p: Params | null; note: string }
  const contracts: Contract[] = [];
  const H = findSheet(sheets, "Schedule H");
  if (H) {
    const hdr = findHeaderRow(H, "sr nr", "name", "original contract") ?? 11;
    for (const [r, v] of rows(H)) {
      if (r <= hdr || !isNum(cell(v, 1))) continue;
      const acc = txt(v, 4).replace(/\s+/g, "");
      const sheetName = [...fragBySheet.entries()].find(([, f]) => f === acc)?.[0];
      let scope = txt(v, 6).replace(/\s+/g, " ");
      const line = lineForFrag(acc);
      if (scope.length < 12) scope = lines.find((l) => l.code === line)?.name ?? (scope || "Contract");
      contracts.push({
        sr: cell(v, 1) as number, pr: txt(v, 2), po: txt(v, 3) || `TBC-${acc}`, acc, contractor: contractor(txt(v, 5)), scope,
        status: txt(v, 7).toUpperCase() === "CLOSED" ? "Closed" : "Active", completion: date(v, 8), eot: isNum(cell(v, 9)) ? (cell(v, 9) as number) : 0,
        original: money(v, 12) ?? 0, faAdj: money(v, 15) ?? 0, line, p: sheetName ? paramsBySheet.get(sheetName)! : null,
        note: money(v, 18) !== null ? `Excel Schedule H: applied ${money(v, 18)?.toLocaleString("en")}, certified ${money(v, 19)?.toLocaleString("en")}, paid ${money(v, 20)?.toLocaleString("en")}` : "",
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
    const po = /\b(\d{7})\b/.exec(title)?.[1];
    if (po) {
      const hit = contracts.find((c) => c.po === po || c.pr === po);
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
    let prevCum = 0;
    let n = 0;
    const seenApp = new Map<string, number>();
    for (const [r, v] of rows(s)) {
      if (r <= p.hdr + 2) continue;
      if (txt(v, 1).toUpperCase().startsWith("TOTAL")) break; // only the first block (whole contract)
      if (!isNum(cell(v, 1)) || !isNum(cell(v, 6))) continue;
      n++;
      let cumCert = money(v, col.cumCert);
      const gross = money(v, col.grossCert);
      if (cumCert !== null && gross !== null && n > 1 && Math.abs(cumCert - gross) < 0.5 && prevCum > 0 && cumCert < prevCum) cumCert = Math.round((prevCum + gross) * 100) / 100;
      if (cumCert !== null) prevCum = cumCert;
      let appNo = txt(v, 2) || `IPA ${cell(v, 1)}`;
      const k = appNo.toLowerCase();
      const dup = (seenApp.get(k) ?? 0) + 1;
      seenApp.set(k, dup);
      if (dup > 1) appNo = `${appNo} (${dup})`;
      const appDate = date(v, 5) ?? date(v, col.ipcDate) ?? date(v, 3);
      ipcRows.push([c.po, cell(v, 1), appNo, monthText(v, 3), txt(v, 4), appDate ?? PERIOD_END, money(v, 6), txt(v, col.ipcNo), txt(v, col.ipcRef), date(v, col.ipcDate), cumCert, txt(v, col.invRef), date(v, col.invDate), date(v, col.paid), appDate ? "" : "Application date missing in Excel"]);
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
      const item = String(Math.trunc(cell(v, 1) as number));
      const dup = (itemSeen.get(item) ?? 0) + 1;
      itemSeen.set(item, dup);
      const itemNo = `CH-${item.padStart(3, "0")}${dup === 1 ? "" : String.fromCharCode(96 + dup)}`;
      const dvoStatus = stageStatus(txt(v, 54));
      const rfcStatus = stageStatus(txt(v, 21));
      const pvoStatus = stageStatus(txt(v, 29));
      const voStatus = stageStatus(txt(v, 37));
      const excelStatus = txt(v, 7);
      const u = excelStatus.toUpperCase();
      const overall = u.includes("ACCEPT") || u.includes("APPROV") ? "Approved" : u.includes("REJECT") || u.includes("SUPERSED") || u.includes("CANCEL") ? "Rejected" : u.includes("FINAL ACCOUNT") ? (dvoStatus === "Approved" ? "Approved" : "Pending") : "Pending";
      const pvoAmt = money(v, 34);
      const rfcAmt = money(v, 25);
      const dvoAmt = money(v, 53);
      const stageDates = [date(v, 51), date(v, 48), date(v, 45), date(v, 40), date(v, 36), date(v, 28), date(v, 20)].filter((x): x is string => !!x);
      let closed: string | null = null;
      if (overall === "Approved" && ["Approved", "Review Complete"].includes(dvoStatus)) closed = date(v, 51) ?? (stageDates.length ? stageDates.sort().at(-1)! : null);
      else if (overall === "Rejected") closed = stageDates.length ? stageDates.sort().at(-1)! : null;
      const pendingBy = txt(v, 6);
      const pending = ({ CLOSED: "None", "N/A": "None", OTHER: "Commercial Team" } as Record<string, string>)[pendingBy.toUpperCase()] ?? "Commercial Team";
      const rep = ["CLOSED", "OTHER", "N/A"].includes(txt(v, 5).toUpperCase()) ? "" : txt(v, 5).replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w/g, (c) => c.toLowerCase());
      const stage = txt(v, 3).replace("Post Contract", "Post-Contract").replace("Pre Contract", "Pre-Contract");
      const note = [excelStatus ? `Excel status: ${excelStatus}` : "", txt(v, 62) ? `Comments: ${txt(v, 62)}` : "", pendingBy ? `Action pending by (Excel): ${pendingBy}` : ""].filter(Boolean).join(" | ");
      void DEAD;
      changeRows.push([
        itemNo, txt(v, 2), overall, date(v, 20) ?? date(v, 16) ?? date(v, 28), asset, pkg(txt(v, 13)), contractor(txt(v, 14)), lineForPkg(txt(v, 13)), stage, txt(v, 4), txt(v, 8), rep, pending, closed,
        txt(v, 15), date(v, 16), money(v, 17),
        txt(v, 18), txt(v, 19), date(v, 20), rfcStatus, txt(v, 22), timeImpact(v, 23), rfcAmt, rfcAmt === null ? null : 0,
        txt(v, 26), txt(v, 27), date(v, 28), pvoStatus, txt(v, 31), timeImpact(v, 32), pvoAmt, pvoAmt, prStatus(txt(v, 30)),
        txt(v, 35), date(v, 36), voStatus, txt(v, 38), txt(v, 35) ? pvoAmt : null,
        txt(v, 39), date(v, 40), txt(v, 41),
        txt(v, 42), txt(v, 43), date(v, 51), dvoStatus, money(v, 46), dvoAmt,
        txt(v, 44), date(v, 45), money(v, 46), txt(v, 47), date(v, 48), money(v, 49), txt(v, 50), date(v, 51), dvoAmt,
        money(v, 55), money(v, 56), money(v, 57), money(v, 58), money(v, 59), money(v, 60), note,
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
  out.push({
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
        const st = txt(v, 12).toLowerCase();
        if (!(st.startsWith("closed") || st.startsWith("not req") || st.startsWith("no fa"))) continue;
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
    for (const [r, v] of rows(G)) {
      if (r <= hdr || !isNum(cell(v, 2)) || !txt(v, 7)) continue;
      const base = `G-${String(Math.trunc(cell(v, 2) as number)).padStart(2, "0")}`;
      const dup = (seen.get(base) ?? 0) + 1;
      seen.set(base, dup);
      const req = money(v, 9);
      const reqTxt = txt(v, 9);
      const t = BOND_TYPES[txt(v, 7).toLowerCase().trim()] ?? txt(v, 7).trim();
      let comments = txt(v, 16);
      if (req === null && reqTxt) comments = `Contract requirement: ${reqTxt}. ${comments}`.trim();
      const line = lineForPkg(txt(v, 4));
      const released = !!line && closedLines.has(line);
      if (released) releasedBonds++;
      bondRows.push([`${base}${dup === 1 ? "" : String.fromCharCode(96 + dup)}`, contractor(txt(v, 3)), pkg(txt(v, 4)), line, t, txt(v, 8), money(v, 5), req !== null ? "Fixed SAR amount" : "% of contract value", req, money(v, 10), date(v, 12), yes(v, 14), yes(v, 15), released, comments]);
    }
    if (releasedBonds) notes.push(`Bonds & insurance: ${releasedBonds} marked as released because the contract is closed in FA Status / Schedule H.`);
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
    for (const [r, v] of rows(FA)) {
      if (r <= hdr || !isNum(cell(v, 1)) || !txt(v, 2)) continue;
      const acc = txt(v, 2).replace(/\s+/g, "");
      if (seenAcc.has(acc)) continue;
      seenAcc.add(acc);
      const frag = acc.replace(/^(PS|CN|MS|CM)\./, "").split(".")[0];
      const st = txt(v, 12).toLowerCase();
      const status = st.startsWith("closed") ? "Closed" : st.startsWith("not req") ? "Not Required" : st.startsWith("no fa") ? "Direct Payment – No FA" : "Open";
      const typ = txt(v, 5);
      faRows.push([acc, txt(v, 3).replace(/\s+/g, " "), contractor(txt(v, 4) || txt(v, 3)), ["Contractor", "Consultant", "Supplier", "Insurer"].includes(typ) ? typ : "", lineForFrag(frag), contractByFrag.get(frag)?.po ?? "", txt(v, 9) === "TBC" ? "" : txt(v, 9), date(v, 10), status, "", status === "Closed" ? null : null, txt(v, 13)]);
    }
    notes.push(`Final accounts: ${faRows.length}.`);
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
  return { sheets: out.filter((s) => s.rows.length > 0), notes, periodEnd, reportNo };
}

function cols(pairs: [string, string][]) {
  return pairs.map(([label, key]) => ({ label, key }));
}

/** Turns converted sheets into the value-sheets the analyser and importer read (headings tagged with [key]). */
export function toSheetValues(conv: ConversionResult): Sheet[] {
  return conv.sheets.map((s) => {
    const rowsMap = new Map<number, unknown[]>();
    rowsMap.set(1, [null, ...s.columns.map((c) => `${c.label} [${c.key}]`)]);
    s.rows.forEach((r, i) => rowsMap.set(i + 2, [null, ...r.map((v) => (v === undefined ? null : v))]));
    return { name: s.name, rows: rowsMap, rowCount: s.rows.length + 1, truncated: false };
  });
}
