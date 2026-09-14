/**
 * Converter for the "VBH Commercial Report" monthly workbook (Village Boutique Hotel, programme
 * code 1TB01006): the SCHD A–G layout with a "Report Data" sheet and a "DATA" sheet that maps every
 * ACC reference to its asset, PO number, contractor and package.
 *
 * Like the Marina converter it produces clean sheets with tagged headings ("Label [field_key]") that
 * the normal importer maps 1:1: cost lines (SCHD B), contracts and IPC logs (the "Schedule H …"
 * sheets), changes (SCHD C), early warnings (Early Warning), bonds & insurance (SCHD G) and the final
 * account status (FA Status). Every rule mirrors the Excel: DVO / PVO / RFC amounts feed the cost
 * report exactly as SCHD B does, and each cost category keeps its budget-hold line.
 */
import { BOND_TYPES, cell, cols, date, findHeaderRow, findSheet, fmt, isNum, money, monthText, norm, rows, txt, type ConversionResult, type ConvertedSheet, type ReportControl, type Row, type Sheet } from "./marina";
import { readLevel1Check } from "./level1-check";

/* ------------------------------------------------------------------ detection */

export function looksLikeVbhReport(sheets: Sheet[]): boolean {
  const names = sheets.map((s) => norm(s.name));
  const has = (n: string) => names.includes(norm(n));
  return has("SCHD B") && has("SCHD C") && (has("Report Data") || has("DATA"));
}

/* ------------------------------------------------------------------ helpers */

/** "1.TB.01.006.03" -> "1TB01006.03"; "1TB01006.03" stays; anything else -> "". */
function assetCodeOf(raw: string): string {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  const m = /^1\.?TB\.?(\d{2})\.?(\d{3})(?:\.(\d{2}))?$/.exec(s);
  if (!m) return "";
  return `1TB${m[1]}${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** "PS.006D04" -> "006D04"; "FFEOSE.006D#1" -> "006D#1"; "006C05" -> "006C05". */
export function fragOf(code: string): string {
  const s = code.replace(/\s+/g, "").toUpperCase();
  const m = /(\d{3}[A-Z]#?\d{1,3})/.exec(s);
  return m ? m[1] : "";
}

const CATEGORY: Record<string, string> = {
  PS: "Professional Services",
  MS: "Management Supervision",
  CM: "Commercial Management",
  CN: "Construction Works",
  CC: "Client Costs",
  FF: "FF&E & OS&E",
  FFEOSE: "FF&E & OS&E",
};
function categoryOf(prefix: string): string {
  const p = prefix.toUpperCase().replace(/[^A-Z]/g, "");
  return CATEGORY[p] ?? (p.startsWith("FF") ? CATEGORY.FF : "Construction Works");
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

interface DataRow {
  frag: string;
  asset: string;
  po: string;
  contractor: string;
  type: string;
  package: string;
  code: string;
}

interface Line {
  code: string;
  frag: string;
  asset: string;
  pkg: string;
  name: string;
  contractor: string;
  section: string;
  category: string;
  hold: boolean;
  baseline: number;
  transfers: number;
  awarded: number;
  ew: number;
  note: string;
}

interface Contract {
  sr: number;
  po: string;
  acc: string;
  contractor: string;
  scope: string;
  status: string;
  original: number;
  line: string;
  pkg: string;
  frags: string[];
  p: Params | null;
  note: string;
  /** Stage 2 remeasure less stage 1 value (Executive Summary "Stage 2 contract conversion" tracker) */
  faAdj?: number;
}
interface Params {
  hdr: number;
  adv: number;
  ret: number;
  vat: number;
  ipcDays: number;
  payDays: number;
}

/* ------------------------------------------------------------------ conversion */

export function convertVbhReport(sheets: Sheet[]): ConversionResult {
  const notes: string[] = [];
  const out: ConvertedSheet[] = [];

  // ---- Report Data: programme code, report no, period
  let progCode = "";
  let assetName = "";
  let reportNo: number | null = null;
  let periodEnd: string | null = null;
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const rd = findSheet(sheets, "Report Data");
  for (const [, v] of rows(rd)) {
    const label = txt(v, 1).toUpperCase();
    const value = txt(v, 2);
    if (label.startsWith("PROGRAMME CODE")) progCode = value.replace(/\s+/g, "");
    if (label.startsWith("ASSET NAME")) assetName = title(value);
    if (label.startsWith("REPORT NO")) {
      const m = /(\d+)/.exec(value);
      if (m) reportNo = Number(m[1]);
    }
    if (label.startsWith("REPORTING PERIOD")) {
      const m = /([A-Za-z]{3})[a-z]*\s+(\d{4})/i.exec(value);
      if (m) {
        const mo = MONTHS.indexOf(m[1].toLowerCase());
        if (mo >= 0) periodEnd = new Date(Date.UTC(Number(m[2]), mo + 1, 0)).toISOString().slice(0, 10);
      }
    }
  }
  // fall back to the header block every schedule carries ("PROGRAMME CODE: - 1TB01006")
  const B = findSheet(sheets, "SCHD B", "Schedule B");
  if (!progCode || !reportNo) {
    for (const [r, v] of rows(B)) {
      if (r > 8) break;
      const t = txt(v, 1).toUpperCase();
      const m = /:\s*-\s*(.+)$/.exec(t);
      if (!m) continue;
      if (t.startsWith("PROGRAMME CODE") && !progCode) progCode = m[1].replace(/\s+/g, "");
      if (t.startsWith("REPORT NO") && !reportNo) reportNo = Number(/(\d+)/.exec(m[1])?.[1] ?? 0) || null;
      if (t.startsWith("ASSET NAME") && !assetName) assetName = title(m[1]);
      if (t.startsWith("REPORTING PERIOD") && !periodEnd) {
        const mm = /([A-Za-z]{3})[a-z]*\s+(\d{4})/i.exec(m[1]);
        if (mm) {
          const mo = MONTHS.indexOf(mm[1].toLowerCase());
          if (mo >= 0) periodEnd = new Date(Date.UTC(Number(mm[2]), mo + 1, 0)).toISOString().slice(0, 10);
        }
      }
    }
  }
  if (!progCode) progCode = "1TB01006";
  const PERIOD_END = periodEnd ?? new Date().toISOString().slice(0, 10);
  const assetFor = (idx: string) => `${progCode}.${idx}`;
  const DEFAULT_ASSET = assetFor("99");

  // ---- DATA: ACC ref -> asset, PO, contractor, package
  const data = new Map<string, DataRow>();
  const D = findSheet(sheets, "DATA");
  if (D) {
    const hdr = findHeaderRow(D, "acc ref", "po number") ?? 2;
    const h = D.rows.get(hdr) ?? [];
    const col = (...words: string[]) => {
      const i = h.findIndex((x) => words.every((w) => String(x ?? "").toLowerCase().includes(w)));
      return i;
    };
    const cAsset = col("asset ref");
    const cPo = col("po number");
    const cAcc = col("acc ref");
    const cName = col("contractor", "consultants");
    const cType = col("direct actual");
    const cPkg = col("package");
    const cCode3 = col("code 3");
    for (const [r, v] of rows(D)) {
      if (r <= hdr) continue;
      const frag = fragOf(txt(v, cAcc));
      if (!frag || data.has(frag)) continue;
      const contractor = tidy(txt(v, cName));
      if (!contractor) continue;
      data.set(frag, {
        frag,
        asset: assetCodeOf(txt(v, cAsset)),
        po: txt(v, cPo).replace(/\s+/g, ""),
        contractor,
        type: /direct/i.test(txt(v, cType)) ? "Supplier" : /contractor/i.test(txt(v, cType)) ? "Contractor" : "Consultant",
        package: tidy(txt(v, cPkg)),
        code: txt(v, cCode3).replace(/\s+/g, ""),
      });
    }
    notes.push(`DATA sheet: ${data.size} ACC references mapped to contractor / PO / asset.`);
  } else notes.push("DATA sheet not found – contractors and PO numbers are read from the schedule names only.");

  const contractorFor = (frag: string, fallback: string): string => data.get(frag)?.contractor ?? tidy(fallback);
  /** Short label for a contractor ("Foster + Partners Limited" -> "Foster + Partners"). */
  const shortName = (name: string) =>
    tidy(name)
      .replace(/\s*\(.*?\)\s*/g, " ")
      .replace(/\b(limited|ltd\.?|llc|l\.l\.c\.?|co\.?|company|est\.?|inc\.?|s\.l\.?|for|and partners)\b.*$/i, "")
      .replace(/[\s,.-]+$/, "")
      .trim() || tidy(name);
  const pkgFor = (frag: string, fallback = ""): string => {
    if (!frag) return fallback ? tidy(fallback) : "General";
    const d = data.get(frag);
    const label = d?.package || shortName(d?.contractor ?? fallback) || frag;
    return `${frag} – ${label}`.slice(0, 80);
  };

  // ---- 1. Cost lines (SCHD B)
  const lines: Line[] = [];
  const lineByFrag = new Map<string, Line>();
  if (B) {
    const hdr = findHeaderRow(B, "code", "name", "approved baseline budget") ?? 10;
    let idx = "";
    const seen = new Map<string, number>();
    for (const [r, v] of rows(B)) {
      if (r <= hdr) continue;
      const code = txt(v, 1);
      const name = tidy(txt(v, 2));
      if (!code && !name) continue;
      const up = name.toUpperCase();
      const section = /^(\d{2})\.?\s*(PS|MS|CM|CN|CC|FF)/i.exec(code);
      if (section && !/\.98\b/.test(code)) {
        idx = section[1];
        continue; // category heading or sub-total
      }
      if (/^(SUB-?\s?TOTAL|TOTAL|GRAND TOTAL|BUDGET HOLD)/.test(up)) continue;
      if (/^\d{3}\.\d{2}/.test(code) || /^1TB/i.test(code) || code.includes("+")) continue;
      const hold = /\.98$/.test(code.replace(/\s+/g, "")) && /^REMAINING/.test(up);
      if (!hold && !/^(PS|MS|CM|CN|CC|FF)/i.test(code)) continue;
      if (hold) {
        const m = /^(\d{2})\.(.+)\.98$/.exec(code.replace(/\s+/g, ""));
        if (m) idx = m[1];
      }
      const prefix = hold ? (/^\d{2}\.(.+)\.98$/.exec(code.replace(/\s+/g, ""))?.[1] ?? "CN") : code.split(".")[0];
      const frag = hold ? "" : fragOf(code);
      const d = frag ? data.get(frag) : undefined;
      const asset = idx ? assetFor(idx) : d?.asset && d.asset.startsWith(progCode) ? d.asset : DEFAULT_ASSET;
      const n = (seen.get(code) ?? 0) + 1;
      seen.set(code, n);
      const ucode = n === 1 ? code : `${code}-${n}`;
      const awarded = money(v, 6) ?? 0;
      const contractor = hold ? "" : contractorFor(frag, name.split(" - ")[0]);
      const line: Line = {
        code: ucode,
        frag,
        asset,
        pkg: hold ? "Budget Hold" : pkgFor(frag, name.split(" - ")[0]),
        name: hold ? name : name || d?.package || contractor,
        contractor,
        section: hold || awarded === 0 ? "Uncommitted" : "Committed",
        category: categoryOf(prefix),
        hold,
        baseline: money(v, 3) ?? 0,
        transfers: money(v, 4) ?? 0,
        awarded,
        ew: money(v, 13) ?? 0,
        note: hold ? "Budget hold – remaining budget not yet allocated to a contract" : [d?.po && /^\d{6,}$/.test(d.po) ? `PO ${d.po}` : "", ucode !== code ? `Excel code ${code} (shared with other lines)` : ""].filter(Boolean).join(" | "),
      };
      lines.push(line);
      if (frag && !lineByFrag.has(frag)) lineByFrag.set(frag, line);
    }
    notes.push(`Cost lines: ${lines.length} across ${new Set(lines.map((l) => l.asset)).size} sub-asset(s) (approved budget ${lines.reduce((t, l) => t + l.baseline, 0).toLocaleString("en", { minimumFractionDigits: 2 })}, transfers ${lines.reduce((t, l) => t + l.transfers, 0).toLocaleString("en", { minimumFractionDigits: 2 })}).`);
  } else notes.push("SCHD B not found – no cost lines converted.");
  const lineForFrag = (frag: string) => lineByFrag.get(frag)?.code ?? "";
  if (B) {
    // SCHD B totals (excluding the budget-hold lines) so the dashboard can be checked against the Excel
    const A = findSheet(sheets, "SCHD A Summary", "Schedule A Summary", "SCHD A") ?? B;
    const hdr = findHeaderRow(A, "code", "name", "approved baseline budget") ?? 10;
    const tot = rows(A).find(([r, v]) => r > hdr && /^GRAND TOTAL ASSET COSTS \(EXCL/i.test(txt(v, 2)) && txt(v, 1).replace(/\s+/g, "") === progCode)?.[1];
    if (tot) {
      const f = (i: number) => (money(tot, i) ?? 0).toLocaleString("en", { maximumFractionDigits: 0 });
      notes.push(`SCHD B grand total excl. budget hold – budget ${f(6)}, DVO ${f(7)}, committed PVO ${f(8)}, PVO ${f(11)}, RFC ${f(12)}, early warnings ${f(13)}, claims ${f(14)}, anticipated final account ${f(15)}, certified ${f(19)}. Compare with the Level 2 totals after the import.`);
    }
  }

  out.push({
    name: "Cost Report Lines",
    register: "cost_lines",
    columns: cols([["Asset", "asset_id"], ["Code", "code"], ["Package", "package_id"], ["Name / description", "name"], ["Contractor / Sub-contractor", "contractor_id"], ["Section", "section"], ["Cost category", "category_id"], ["Budget hold line", "is_budget_hold"], ["Approved Baseline Budget", "approved_baseline_budget"], ["Budget transfers brought forward", "opening_transfers"], ["Order", "sort_order"], ["Notes", "notes"]]),
    rows: lines.map((l, i) => [l.asset, l.code, l.pkg, l.name, l.contractor, l.section, l.category, l.hold, l.baseline, l.transfers, i + 1, l.note]),
  });

  // ---- 2. Final account status (needed early: closed contracts)
  const FA = findSheet(sheets, "FA Status R1", "FA Status", "Final Account Status", "FA");
  const faStatus = new Map<string, { status: string; responsible: string; forecast: string | null; comments: string; type: string; contractor: string; desc: string; acc: string }>();
  if (FA) {
    const hdr = findHeaderRow(FA, "acc code", "status") ?? 12;
    for (const [r, v] of rows(FA)) {
      if (r <= hdr || !txt(v, 2)) continue;
      const acc = txt(v, 2).replace(/\s+/g, "");
      const frag = fragOf(acc);
      if (!frag || faStatus.has(frag)) continue;
      const st = txt(v, 12).toLowerCase();
      const status = st.startsWith("closed") ? "Closed" : st.startsWith("not req") ? "Not Required" : st.startsWith("no fa") ? "Direct Payment – No FA" : "Open";
      const typ = txt(v, 5);
      faStatus.set(frag, { acc, status, responsible: txt(v, 9), forecast: date(v, 10), comments: txt(v, 13), type: /direct/i.test(typ) ? "Supplier" : ["Contractor", "Consultant", "Supplier", "Insurer"].includes(typ) ? typ : "", contractor: tidy(txt(v, 4) || txt(v, 3)), desc: tidy(txt(v, 3)) });
    }
  }

  // ---- 3. Contracts: one per PO (a PO can cover several cost lines, e.g. one architect across the sub-assets)
  const contracts: Contract[] = [];
  const byPo = new Map<string, Contract>();
  let sr = 0;
  for (const l of lines) {
    if (l.hold || !l.frag || !l.contractor) continue;
    if (l.awarded === 0 && l.baseline + l.transfers === 0) continue;
    const d = data.get(l.frag);
    let po = d?.po && /^\d{6,}$/.test(d.po) ? d.po : `TBC-${l.frag}`;
    const closed = faStatus.get(l.frag)?.status === "Closed";
    let existing = byPo.get(po);
    if (existing && existing.contractor !== l.contractor) {
      // the same PO number typed against two different contractors in DATA: keep them apart
      po = `${po}/${l.frag}`;
      existing = byPo.get(po);
    }
    if (existing) {
      existing.original += l.awarded;
      existing.frags.push(l.frag);
      if (l.awarded > (lineByFrag.get(existing.acc)?.awarded ?? 0)) {
        existing.acc = l.frag;
        existing.line = l.code;
        existing.pkg = l.pkg;
      }
      if (!closed) existing.status = "Active";
      continue;
    }
    sr++;
    const c: Contract = { sr, po, acc: l.frag, contractor: l.contractor, scope: d?.package || l.name, status: closed ? "Closed" : "Active", original: l.awarded, line: l.code, pkg: l.pkg, frags: [l.frag], p: null, note: "" };
    contracts.push(c);
    byPo.set(po, c);
  }
  const contractByFrag = new Map<string, Contract>();
  for (const c of contracts) for (const f of c.frags) contractByFrag.set(f, c);

  // ---- 4. IPC logs (the "Schedule H …" sheets, one per contract)
  const ipcSheets = sheets.filter((s) => /^schedule h\s*[-a-z0-9+]/i.test(s.name.trim()) && norm(s.name) !== "schedule h");
  const contractForSheet = (s: Sheet, hdr: number): Contract | undefined => {
    const heads: string[] = [];
    for (const [r, v] of rows(s)) {
      if (r >= hdr) break;
      if (r >= hdr - 4) heads.push(txt(v, 1), txt(v, 2));
    }
    const head = heads.join(" ");
    const frag = fragOf(head);
    if (frag && contractByFrag.get(frag)) return contractByFrag.get(frag);
    const po = /\b(\d{7,12})\b/.exec(head)?.[1];
    if (po) {
      const hit = contracts.find((c) => c.po === po || po.includes(c.po) || c.po.includes(po));
      if (hit) return hit;
    }
    // by contractor name words in the sheet title / heading
    const words = `${s.name.replace(/^schedule h\s*-?\s*/i, "")} ${head}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !["schedule", "install", "supply", "consult"].includes(w));
    const scored = contracts.map((c) => ({ c, score: words.filter((w) => c.contractor.toLowerCase().includes(w)).length })).filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score || b.c.original - a.c.original);
    return scored[0]?.c;
  };
  const ipcRows: unknown[][] = [];
  for (const s of ipcSheets) {
    const hdr = findHeaderRow(s, "sr nr", "payment applicat");
    if (!hdr) continue;
    const c = contractForSheet(s, hdr);
    if (!c) {
      notes.push(`IPC sheet "${s.name.trim()}" skipped – could not tell which contract it belongs to.`);
      continue;
    }
    const h = s.rows.get(hdr) ?? [];
    const A = txt(h, 12).toUpperCase().startsWith("IPC");
    const r12 = s.rows.get(hdr + 1) ?? [];
    const r13 = s.rows.get(hdr + 2) ?? [];
    const pct = (x: unknown) => (isNum(x) ? Math.round(x * 100) : 0);
    const days = (rule: unknown, d: number) => {
      const m = /\+\s*(\d+)/.exec(String(rule ?? ""));
      return m ? Number(m[1]) : d;
    };
    const vatCell = cell(r12, A ? 29 : 26);
    const p: Params = { hdr, adv: A ? pct(cell(r12, 8)) : 0, ret: A ? pct(cell(r12, 9)) : 0, vat: isNum(vatCell) ? Math.round(vatCell * 100) : 15, ipcDays: days(cell(r13, A ? 15 : 12), 28), payDays: days(cell(r13, A ? 26 : 23), 30) };
    if (!c.p) c.p = p;
    const col = { ipcNo: A ? 12 : 9, ipcRef: A ? 13 : 10, ipcDate: A ? 14 : 11, cumCert: A ? 17 : 14, grossCert: A ? 18 : 15, invRef: A ? 23 : 20, invDate: A ? 24 : 21, paid: A ? 25 : 22 };
    // A sheet may hold several blocks (one per service / call-off order under the same PO), each
    // ending in a TOTAL row. The blocks do not necessarily run one after another – their application
    // dates can interleave – so the contract's cumulative claimed / certified at any date is the SUM
    // of every block's own cumulative-to-date value, worked out chronologically across all blocks,
    // rather than the current block's figure stacked on the previous block's final total (which goes
    // negative whenever a later block in the sheet actually falls earlier in time).
    let prevCum = 0;
    let n = 0;
    let block = 0;
    let blockTitle = "";
    const seenApp = new Map<string, number>();
    // "1", "IPC No 3", "IPA 12" – the serial in the first column, however it is written
    const serial = (v: Row): number | null => {
      const x = cell(v, 1);
      if (isNum(x)) return x;
      const m = /(\d+)/.exec(txt(v, 1));
      return m ? Number(m[1]) : null;
    };
    interface RawEntry {
      order: number;
      block: number;
      sr: number;
      appNo: string;
      month: unknown;
      aconex: string;
      appDate: string | null;
      localClaimed: number | null;
      localCert: number | null;
      ipcNo: string;
      ipcRef: string;
      ipcDate: string | null;
      invRef: string;
      invDate: string | null;
      paidDate: string | null;
    }
    const entries: RawEntry[] = [];
    let order = 0;
    for (const [r, v] of rows(s)) {
      if (r <= hdr + 2) continue;
      if (txt(v, 1).toUpperCase().startsWith("TOTAL")) {
        prevCum = 0;
        n = 0;
        block++;
        continue;
      }
      const sr = serial(v);
      if (sr === null || !isNum(cell(v, 6))) {
        // a heading row between blocks names the next service / call-off order
        if (block > 0 && txt(v, 1) && !txt(v, 2) && !isNum(cell(v, 6))) blockTitle = txt(v, 1).slice(0, 40);
        continue;
      }
      n++;
      let cumCert = money(v, col.cumCert);
      const gross = money(v, col.grossCert);
      if (cumCert !== null && gross !== null && n > 1 && Math.abs(cumCert - gross) < 0.5 && prevCum > 0 && cumCert < prevCum) cumCert = Math.round((prevCum + gross) * 100) / 100;
      if (cumCert !== null) prevCum = cumCert;
      const claimed = money(v, 6);
      let appNo = txt(v, 2) || txt(v, 1) || `IPA ${sr}`;
      if (block > 0 && blockTitle && !appNo.toLowerCase().includes(blockTitle.toLowerCase().slice(0, 8))) appNo = `${appNo} – ${blockTitle}`;
      const k = appNo.toLowerCase();
      const dup = (seenApp.get(k) ?? 0) + 1;
      seenApp.set(k, dup);
      if (dup > 1) appNo = `${appNo} (${dup})`;
      const appDate = date(v, 5) ?? date(v, col.ipcDate) ?? date(v, 3);
      entries.push({ order: order++, block, sr, appNo, month: monthText(v, 3), aconex: txt(v, 4), appDate, localClaimed: claimed, localCert: cumCert, ipcNo: txt(v, col.ipcNo), ipcRef: txt(v, col.ipcRef), ipcDate: date(v, col.ipcDate), invRef: txt(v, col.invRef), invDate: date(v, col.invDate), paidDate: date(v, col.paid) });
    }
    // Merge blocks chronologically: at each application date, add up the latest known cumulative
    // figure of every block that has started by then. Every block's own submission normally lands
    // on the same handful of real-world dates (the whole contract applies together each period), so
    // all entries sharing a date are applied to the block totals as one group before the combined
    // total is read back – otherwise whichever block happens to appear first in the sheet would show
    // a partial total while its sibling blocks for that same date are still waiting to be counted.
    const chronological = [...entries].sort((a, b) => (a.appDate ?? PERIOD_END).localeCompare(b.appDate ?? PERIOD_END) || a.order - b.order);
    const blockClaimed = new Map<number, number>();
    const blockCert = new Map<number, number>();
    const cumClaimedOf = new Map<number, number | null>();
    const cumCertOf = new Map<number, number | null>();
    let i = 0;
    while (i < chronological.length) {
      let j = i;
      while (j < chronological.length && (chronological[j].appDate ?? PERIOD_END) === (chronological[i].appDate ?? PERIOD_END)) j++;
      const group = chronological.slice(i, j);
      for (const e of group) {
        // never let a block's tracked value regress – a block's own cumulative figure is monotonic
        // in its natural (serial) order, but an occasional application date entered out of sequence
        // (a real anomaly in the source data, not a parsing error) must not read back as a fall in
        // "certified to date".
        if (e.localClaimed !== null) blockClaimed.set(e.block, Math.max(blockClaimed.get(e.block) ?? 0, e.localClaimed));
        if (e.localCert !== null) blockCert.set(e.block, Math.max(blockCert.get(e.block) ?? 0, e.localCert));
      }
      const sumClaimed = Math.round([...blockClaimed.values()].reduce((t, x) => t + x, 0) * 100) / 100;
      const sumCert = Math.round([...blockCert.values()].reduce((t, x) => t + x, 0) * 100) / 100;
      for (const e of group) {
        cumClaimedOf.set(e.order, e.localClaimed === null ? null : sumClaimed);
        cumCertOf.set(e.order, e.localCert === null ? null : sumCert);
      }
      i = j;
    }
    for (const e of entries) {
      ipcRows.push([c.po, e.sr, e.appNo, e.month, e.aconex, e.appDate ?? PERIOD_END, cumClaimedOf.get(e.order) ?? null, e.ipcNo, e.ipcRef, e.ipcDate, cumCertOf.get(e.order) ?? null, e.invRef, e.invDate, e.paidDate, e.appDate ? "" : "Application date missing in Excel"]);
    }
    notes.push(`IPC sheet "${s.name.trim()}" → contract ${c.po} (${c.contractor})${block > 1 ? `, ${block} blocks (service / call-off orders) merged chronologically` : ""}.`);
  }

  // ---- Stage 2 contract conversion tracker (Executive Summary): remeasured value against the stage 1 contract
  const ES = findSheet(sheets, "Executive Summary");
  let stage2 = 0;
  if (ES) {
    for (const [, v] of rows(ES)) {
      const m = /^(\d{3}[A-Z]\d{2})\s*-\s*/i.exec(txt(v, 13));
      if (!m || !isNum(cell(v, 14))) continue;
      const c = contractByFrag.get(m[1].toUpperCase());
      if (!c) continue;
      const s1 = money(v, 14) ?? 0;
      const s2 = money(v, 15);
      const variance = money(v, 16) ?? (s2 === null ? null : Math.round((s2 - s1) * 100) / 100);
      if (variance !== null) c.faAdj = variance;
      const when = date(v, 18) ?? txt(v, 18);
      c.note = `Stage 2 conversion: stage 1 ${fmt(s1)}, stage 2 remeasure ${s2 === null ? "–" : fmt(s2)}, variance ${variance === null ? "–" : fmt(variance)}${txt(v, 17) ? `; ${txt(v, 17)}` : ""}${when ? `; forecast completion ${when}` : ""}.`;
      stage2++;
    }
    if (stage2) notes.push(`Stage 2 contract conversion tracker: ${stage2} contract(s) – the remeasure variance is carried as the contract's final account adjustment.`);
  }

  out.push({
    name: "Contracts",
    register: "contracts",
    columns: cols([["SR No", "sr_no"], ["Contract title", "title"], ["REEF PR No", "reef_pr_no"], ["REEF PO No", "reef_po_no"], ["ACC ref", "acc_ref"], ["Contractor / Consultant", "contractor_id"], ["Package", "package_id"], ["Cost report line", "cost_line_id"], ["Scope of work", "scope_of_work"], ["Current status", "current_status"], ["Original completion date", "original_completion_date"], ["EOT granted (days)", "eot_granted_days"], ["Original contract", "original_contract"], ["Final account adjustment", "final_account_adjustment"], ["Advance recovery %", "advance_recovery_pct"], ["Retention %", "retention_pct"], ["Days to issue IPC", "ipc_days"], ["Days to pay", "payment_days"], ["VAT %", "vat_pct"], ["Notes", "notes"]]),
    rows: contracts.map((c) => [c.sr, `${c.scope.slice(0, 100)}${c.frags.length > 1 ? ` (${c.frags.length} lines)` : ""}`, "", c.po, c.acc, c.contractor, c.pkg, c.line, c.scope, c.status, null, 0, Math.round(c.original * 100) / 100, c.faAdj ?? 0, c.p?.adv ?? 0, c.p?.ret ?? 0, c.p?.ipcDays ?? 28, c.p?.payDays ?? 30, c.p?.vat ?? 15, `${c.frags.length > 1 ? `One PO across ${c.frags.length} cost lines: ${c.frags.join(", ")}; value = awarded contracts / budget of those lines (SCHD B column C).` : "Value = awarded contract / budget (SCHD B column C)."}${c.note ? ` ${c.note}` : ""}`]),
  });
  if (ipcRows.length) notes.push(`IPC log: ${ipcRows.length} payment application(s) across ${new Set(ipcRows.map((r) => r[0])).size} contract(s). The dashboard's "Certified to date" is the gross cumulative certified amount from the IPC sheets; SCHD B column K shows it net of advance recovery and retention, so the two differ by those deductions.`);
  out.push({
    name: "IPC Log",
    register: "payment_applications",
    columns: cols([["Contract", "contract_id"], ["SR", "sr_no"], ["Payment application no", "application_no"], ["Month", "month"], ["Application Aconex ref", "application_aconex_ref"], ["Application date", "application_date"], ["Cumulative claimed (excl. VAT)", "cumulative_claimed"], ["IPC No", "ipc_no"], ["IPC Aconex ref", "ipc_aconex_ref"], ["IPC date", "ipc_date"], ["Cumulative certified (excl. VAT)", "cumulative_certified"], ["Invoice approval Aconex ref", "invoice_aconex_ref"], ["Invoice approval date", "invoice_date"], ["Paid by Finance", "paid_date"], ["Comments", "comments"]]),
    rows: ipcRows,
  });

  // ---- 5. Changes (SCHD C)
  const C = findSheet(sheets, "SCHD C", "Schedule C");
  const changeRows: unknown[][] = [];
  if (C) {
    const hdr = findHeaderRow(C, "item no", "description of change") ?? 16;
    const stageStatus = (s: string) => {
      const u = s.toUpperCase().trim();
      const m: Record<string, string> = { APPROVED: "Approved", CANCELLED: "Cancelled", SUPERSEDED: "Superseded", "REVIEW COMPLETE": "Review Complete", REJECTED: "Rejected", PENDING: "Pending", TRANSFERRED: "Transferred" };
      return m[u] ?? (u ? u[0] + u.slice(1).toLowerCase() : "");
    };
    const timeImpact = (v: Row, i: number): number | null => {
      const x = cell(v, i);
      if (isNum(x)) return x;
      return String(x ?? "").trim().toUpperCase() === "NO" ? 0 : null;
    };
    const perFrag = new Map<string, number>();
    const seenItem = new Set<string>();
    for (const [r, v] of rows(C)) {
      if (r <= hdr + 3) continue;
      const desc = tidy(txt(v, 2));
      const frag = fragOf(txt(v, 9) || txt(v, 10));
      if (!desc || !frag) continue;
      const hasRef = txt(v, 18) || txt(v, 26) || txt(v, 35) || txt(v, 42) || money(v, 25) !== null || money(v, 34) !== null || money(v, 54) !== null;
      if (!hasRef && !isNum(cell(v, 1))) continue;
      const seq = (perFrag.get(frag) ?? 0) + 1;
      perFrag.set(frag, seq);
      const rawItem = isNum(cell(v, 1)) ? String(Math.trunc(cell(v, 1) as number)) : `x${seq}`;
      let itemNo = `CH-${frag}-${rawItem}`;
      let dup = 1;
      while (seenItem.has(itemNo)) itemNo = `CH-${frag}-${rawItem}${String.fromCharCode(96 + ++dup)}`;
      seenItem.add(itemNo);
      const rfcStatus = stageStatus(txt(v, 21));
      const pvoStatus = stageStatus(txt(v, 29));
      const voStatus = stageStatus(txt(v, 37));
      const dvoStatus = stageStatus(txt(v, 55));
      const excelStatus = txt(v, 7);
      const u = excelStatus.toUpperCase();
      const anyRejected = [rfcStatus, pvoStatus, voStatus, dvoStatus].some((s) => ["Rejected", "Cancelled", "Superseded"].includes(s));
      const overall = u.includes("ACCEPT") || u.includes("APPROV") ? "Approved" : u.includes("REJECT") || u.includes("SUPERSED") || u.includes("CANCEL") ? "Rejected" : dvoStatus === "Approved" || voStatus === "Approved" ? "Approved" : anyRejected && !["Approved", "Pending"].includes(dvoStatus) && !["Approved", "Pending"].includes(pvoStatus) ? "Rejected" : "Pending";
      const rfcAmt = money(v, 25);
      const pvoAmt = money(v, 34);
      const dvoAmt = money(v, 54);
      const stageDates = [date(v, 51), date(v, 48), date(v, 45), date(v, 40), date(v, 36), date(v, 28), date(v, 20)].filter((x): x is string => !!x);
      let closed: string | null = null;
      if (overall === "Approved" && ["Approved", "Review Complete"].includes(dvoStatus)) closed = date(v, 51) ?? (stageDates.length ? stageDates.sort().at(-1)! : null);
      else if (overall === "Rejected") closed = stageDates.length ? stageDates.sort().at(-1)! : null;
      const pendingBy = txt(v, 6);
      const pending = ({ CLOSED: "None", "N/A": "None", OTHER: "Commercial Team" } as Record<string, string>)[pendingBy.toUpperCase()] ?? "Commercial Team";
      const rep = ["CLOSED", "OTHER", "N/A"].includes(txt(v, 5).toUpperCase()) ? "" : title(txt(v, 5));
      const stage = txt(v, 3).replace("Post Contract", "Post-Contract").replace("Pre Contract", "Pre-Contract");
      const asset = assetCodeOf(txt(v, 12)) || lineByFrag.get(frag)?.asset || DEFAULT_ASSET;
      const note = [excelStatus ? `Excel status: ${excelStatus}` : "", txt(v, 58) ? `Comments: ${txt(v, 58)}` : "", pendingBy ? `Action pending by (Excel): ${pendingBy}` : "", txt(v, 56) ? `Funding: ${txt(v, 56)}${txt(v, 57) ? ` (${txt(v, 57)})` : ""}` : "", txt(v, 24).toUpperCase() === "NOT ACTIVE" && rfcAmt ? "RFC not active in Excel" : ""].filter(Boolean).join(" | ");
      // The Excel's own decision per change (the ACTIVE flags feed SCHD B): DVO counted when its flag is
      // active; else the PVO amount when the PVO flag is active (committed PVO when the ACC flag is active
      // too); else the RFC amount when the RFC flag is active and no PVO / ACC flag is. Verified against
      // every SCHD B line of Report No 47.
      const on = (i: number) => txt(v, i).toUpperCase() === "ACTIVE";
      const dvoActive = on(52);
      const pvoActive = !dvoActive && on(32);
      const rfcActive = !dvoActive && !on(32) && !on(33) && on(24);
      changeRows.push([
        itemNo, desc, overall, date(v, 20) ?? date(v, 16) ?? date(v, 28) ?? PERIOD_END, asset.startsWith(progCode) ? asset : DEFAULT_ASSET, pkgFor(frag, txt(v, 13) || txt(v, 14)), contractorFor(frag, txt(v, 14)), lineForFrag(frag), stage, txt(v, 4), txt(v, 8), rep, pending, closed,
        txt(v, 15), date(v, 16), money(v, 17),
        txt(v, 18), txt(v, 19), date(v, 20), rfcStatus, txt(v, 22), timeImpact(v, 23), rfcAmt, rfcAmt === null ? null : rfcActive ? rfcAmt : 0,
        txt(v, 26), txt(v, 27), date(v, 28), pvoStatus, txt(v, 30), timeImpact(v, 31), pvoAmt, pvoAmt === null ? null : pvoActive ? pvoAmt : 0, "",
        txt(v, 35), date(v, 36), voStatus, txt(v, 38), txt(v, 35) ? (pvoActive ? pvoAmt : 0) : null,
        txt(v, 39), date(v, 40), txt(v, 41),
        txt(v, 42), txt(v, 43), date(v, 51) ?? date(v, 48) ?? date(v, 45), dvoStatus, dvoAmt, dvoAmt === null ? null : dvoActive ? dvoAmt : 0,
        txt(v, 44), date(v, 45), money(v, 46), txt(v, 47), date(v, 48), money(v, 49), txt(v, 50), date(v, 51), dvoAmt,
        null, null, null, null, null, null, note,
      ]);
    }
    notes.push(`Changes: ${changeRows.length}.`);
  } else notes.push("SCHD C not found – no changes converted.");
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

  // ---- 6. Early warnings (Early Warning sheet), plus the allowances SCHD B carries as early warnings
  const EW = findSheet(sheets, "Early Warning", "Early Warnings");
  const ewRows: unknown[][] = [];
  const ewFrags = new Set<string>();
  if (EW) {
    const seen = new Map<string, number>();
    for (const [, v] of rows(EW)) {
      const frag = fragOf(txt(v, 1));
      const desc = tidy(txt(v, 4));
      if (!frag || !desc) continue;
      const base = txt(v, 2) ? tidy(txt(v, 2)).replace(/\s+/g, " ") : `EW ${frag}`;
      const dup = (seen.get(base.toLowerCase()) ?? 0) + 1;
      seen.set(base.toLowerCase(), dup);
      const cost = money(v, 5) ?? 0;
      ewFrags.add(frag);
      ewRows.push([`${base}${dup === 1 ? "" : "-" + dup}`, PERIOD_END, "Contractor", lineByFrag.get(frag)?.asset ?? DEFAULT_ASSET, pkgFor(frag, txt(v, 3)), contractorFor(frag, txt(v, 3)), desc, null, cost, cost ? "High" : "Med", "Open", lineForFrag(frag), [txt(v, 6) ? `Excel stage: ${txt(v, 6)}` : "", txt(v, 7), "Date raised not in Excel – set to the period end"].filter(Boolean).join(" | ")]);
    }
  }
  let allowances = 0;
  for (const l of lines) {
    if (l.hold || !l.frag || !l.ew || ewFrags.has(l.frag)) continue;
    allowances++;
    ewRows.push([`EW ${l.frag}`, PERIOD_END, "Employer", l.asset, l.pkg, l.contractor, `${l.name} – allowance carried in SCHD B column H (Early Warning)`, null, l.ew, "High", "Open", l.code, "Allowance from SCHD B (no row on the Early Warning sheet)"]);
  }
  notes.push(`Early warnings: ${ewRows.length}${allowances ? ` (${allowances} allowance(s) taken from SCHD B)` : ""}.`);
  out.push({
    name: "Early Warnings",
    register: "early_warnings",
    columns: cols([["EW No", "ew_no"], ["Date raised", "date_raised"], ["Raised by", "raised_by"], ["Asset", "asset_id"], ["Package", "package_id"], ["Contractor / Consultant", "contractor_id"], ["Description", "description"], ["Potential time impact (days)", "time_impact_days"], ["Potential cost impact", "cost_impact"], ["Likelihood", "likelihood"], ["Status", "status"], ["Cost report line", "cost_line_id"], ["Notes", "notes"]]),
    rows: ewRows,
  });

  // ---- 7. Bonds & insurance (SCHD G)
  const G = findSheet(sheets, "SCHD G", "Schedule G");
  const bondRows: unknown[][] = [];
  const EXTRA_BOND_TYPES: [RegExp, string][] = [
    [/plant|equipment/i, "Plant & Equipment"],
    [/third party|general liability|public liability/i, "Public/Third Party Liability"],
    [/workmen|employer'?s liability/i, "Workmen's Compensation"],
    [/professional indemnity/i, "Professional Indemnity"],
    [/motor/i, "Motor Vehicle Liability"],
    [/marine cargo|marine hull|marine/i, "Marine & Hull"],
    [/advance payment/i, "Advance Payment Bond"],
    [/performance/i, "Performance Bond"],
    [/retention/i, "Retention Bond"],
    [/all risk/i, "Contractors All Risks"],
    [/trade licen/i, "Trade License"],
  ];
  if (G) {
    const hdr = findHeaderRow(G, "pkg code", "type of bond") ?? 11;
    let released = 0;
    const noExpiry: string[] = [];
    const seen = new Map<string, number>();
    for (const [r, v] of rows(G)) {
      if (r <= hdr) continue;
      const frag = fragOf(txt(v, 1));
      const rawType = tidy(txt(v, 7));
      if (!frag || !rawType || txt(v, 1).toUpperCase().startsWith("PACKAGE")) continue;
      const policy = txt(v, 8);
      const provided = money(v, 10);
      const expiry = date(v, 11);
      if (!policy && provided === null && !expiry) continue; // "Not Applicable" rows
      if (!expiry) {
        noExpiry.push(`${frag} ${rawType}`);
        continue; // the dashboard tracks expiry; a policy without a date cannot be tracked
      }
      const base = `G-${frag}-${isNum(cell(v, 3)) ? Math.trunc(cell(v, 3) as number) : seen.size + 1}`;
      const dup = (seen.get(base) ?? 0) + 1;
      seen.set(base, dup);
      const t = BOND_TYPES[rawType.toLowerCase()] ?? EXTRA_BOND_TYPES.find(([re]) => re.test(rawType))?.[1] ?? rawType.replace(/\s*\(.*?\)\s*/g, "").trim();
      const req = money(v, 9);
      const reqTxt = txt(v, 9);
      let comments = txt(v, 13);
      if (req === null && reqTxt) comments = `Contract requirement: ${reqTxt}. ${comments}`.trim();
      const line = lineForFrag(frag);
      const closed = faStatus.get(frag)?.status === "Closed";
      if (closed) released++;
      bondRows.push([`${base}${dup === 1 ? "" : String.fromCharCode(96 + dup)}`, contractorFor(frag, txt(v, 4)), pkgFor(frag, txt(v, 2)), line, t, policy, money(v, 5), req !== null ? "Fixed SAR amount" : "% of contract value", req, provided, expiry, !!policy, false, closed, comments]);
    }
    notes.push(`Bonds & insurance: ${bondRows.length}${released ? ` (${released} marked released – contract closed in FA Status)` : ""}.`);
    if (noExpiry.length) notes.push(`${noExpiry.length} bond / insurance row(s) have no expiry date in SCHD G and were not imported: ${noExpiry.slice(0, 8).join("; ")}${noExpiry.length > 8 ? " …" : ""}.`);
  }
  out.push({
    name: "Bonds & Insurance",
    register: "bonds",
    columns: cols([["Ref", "ref"], ["Contractor / Consultant", "contractor_id"], ["Package", "package_id"], ["Cost report line (contract)", "cost_line_id"], ["Type of bond / insurance", "type_id"], ["Policy / bond no", "policy_no"], ["Original contract sum", "original_contract_sum"], ["Contract requirement – type", "requirement_type"], ["Contract requirement – value", "requirement_value"], ["Amount provided", "amount_provided"], ["Expiry date", "expiry_date"], ["Approved", "approved"], ["Bank verification", "bank_verification"], ["Contract closed – bond released", "contract_closed"], ["Comments", "comments"]]),
    rows: bondRows,
  });

  // ---- 8. Final account status
  const faRows: unknown[][] = [];
  let faSkipped = 0;
  for (const [frag, f] of faStatus) {
    if (!lineForFrag(frag)) {
      faSkipped++; // another project's contract listed on the FA sheet (no SCHD B line here)
      continue;
    }
    faRows.push([f.acc, f.desc, contractorFor(frag, f.contractor), f.type, lineForFrag(frag), contractByFrag.get(frag)?.po ?? "", f.responsible === "TBC" ? "" : f.responsible, f.forecast, f.status, "", null, f.comments]);
  }
  if (faRows.length) notes.push(`Final accounts: ${faRows.length}${faSkipped ? ` (${faSkipped} row(s) without a cost line here skipped)` : ""}.`);
  out.push({
    name: "Final Account Status",
    register: "final_accounts",
    columns: cols([["ACC code", "acc_ref"], ["Package / description", "description"], ["Contractor / Consultant", "contractor_id"], ["Type", "type"], ["Cost report line", "cost_line_id"], ["Contract", "contract_id"], ["Responsible", "responsible"], ["Forecast FA closure", "forecast_closure_date"], ["Status", "status"], ["FA statement ref", "fa_statement_ref"], ["Closed / signed date", "closed_date"], ["Comments", "comments"]]),
    rows: faRows,
  });

  // ---- Project team and distribution (Report Data sheet)
  const teamRows: unknown[][] = [];
  const control: ReportControl = { aconex_ref: null, key_issues: null, checklist: null };
  if (rd) {
    let section: "" | "distribution" | "team" = "";
    let n = 0;
    const checklist: Record<number, boolean> = {};
    const moduleOf = (label: string): number[] => {
      const t = label.toUpperCase().trim();
      if (t === "MOM" || t.startsWith("EXECUTIVE SUMMARY")) return [11];
      const m = /^SCHEDULE\s+([A-K])$/.exec(t);
      const map: Record<string, number> = { A: 2, B: 2, C: 3, D: 5, E: 4, F: 6, G: 7, H: 8, I: 9, J: 10 };
      return m && map[m[1]] ? [map[m[1]]] : [];
    };
    for (const [, v] of rows(rd)) {
      // label in the first filled cell, value in the next filled cell (the sheet's columns vary)
      const filled = v.map((x, i) => [i, x] as const).filter(([i, x]) => i <= 4 && x !== null && x !== undefined && String(x).trim() !== "");
      const a = filled.length ? txt(v, filled[0][0]) : "";
      const b = filled.length > 1 ? txt(v, filled[1][0]) : "";
      if (/^amaala ref/i.test(a) && b && !control.aconex_ref) control.aconex_ref = b;
      if (/^distribution$/i.test(a)) {
        section = "distribution";
        continue;
      }
      if (/^project team$/i.test(a)) {
        section = "team";
        continue;
      }
      if ((section && a.endsWith(":")) || (section && /director|manager|lead|surveying|engineer|head/i.test(a) && b)) {
        const role = a.replace(/:$/, "").trim();
        if (role && b && /^[A-Za-z .'-]+$/.test(b)) teamRows.push([++n, role, b, "AMAALA", section === "distribution"]);
        continue;
      }
      // report checklist: "√" in the Done column
      for (const mod of moduleOf(a)) {
        const done = txt(v, 5) === "√" || txt(v, 5).toLowerCase() === "yes";
        checklist[mod] = mod in checklist ? checklist[mod] && done : done;
      }
    }
    if (Object.keys(checklist).length) control.checklist = checklist;
    // the same person is often listed under Distribution and under Project Team: one row, on distribution
    const merged = new Map<string, unknown[]>();
    for (const r of teamRows) {
      const k = `${String(r[1]).toLowerCase()}|${String(r[2]).toLowerCase()}`;
      const prev = merged.get(k);
      if (prev) prev[4] = prev[4] || r[4];
      else merged.set(k, r);
    }
    teamRows.splice(0, teamRows.length, ...[...merged.values()].map((r, i) => [i + 1, ...r.slice(1)]));
    if (teamRows.length) notes.push(`Project team: ${teamRows.length} (${teamRows.filter((r) => r[4]).length} on distribution).`);
  }
  out.push({ name: "Project Team", register: "project_team", columns: cols([["#", "sort_order"], ["Role / position", "role"], ["Name", "name"], ["Organisation", "organisation"], ["On distribution", "in_distribution"]]), rows: teamRows });

  // ---- Key period movements (Executive Summary): the narrative for the dashboard's Executive Summary
  if (ES) {
    // the sheet shows the headline movements first and the itemised list under a second
    // "KEY PERIOD MOVEMENTS" heading: the last heading starts the list that is carried over
    const all = rows(ES);
    let start = -1;
    all.forEach(([r, v]) => {
      if (/^key period movements/i.test(txt(v, 4))) start = r;
    });
    const lines: string[] = [];
    for (const [r, v] of all) {
      if (r <= start) continue;
      const a = txt(v, 4);
      if (!a || /^description$/i.test(a)) continue;
      const amt = money(v, 8);
      if (amt === null) continue;
      const item = /^(item\s*no|\s*-\s)/i.test(a);
      lines.push(item ? `  • ${a.replace(/^\s*-\s*/, "")}: ${amt >= 0 ? "+" : ""}${fmt(amt)}` : `${lines.length ? "\n" : ""}${a}: ${amt >= 0 ? "+" : ""}${fmt(amt)}`);
    }
    if (lines.length) {
      control.key_issues = `Key period movements (from ${reportNo ? `Report No ${reportNo}` : "the monthly report"}):\n${lines.join("\n")}`;
      notes.push(`Key period movements: ${lines.filter((l) => l.startsWith("  •")).length} item(s) carried to the Executive Summary narrative.`);
    }
  }
  if (control.aconex_ref) notes.push(`Report reference ${control.aconex_ref} kept as the period's Aconex ref.`);

  notes.push(`Converted from the VBH Commercial Report layout (${assetName || "Village Boutique Hotel"}, ${progCode}${reportNo ? `, Report No ${reportNo}` : ""}${periodEnd ? `, period ending ${periodEnd}` : ""}).`);
  const level1 = readLevel1Check(sheets);
  if (level1) notes.push(`Excel Level 1: budget ${fmt(level1.budget)}, anticipated final account ${fmt(level1.afa)}, variance ${fmt(level1.variance)}, last month ${fmt(level1.lastMonthAfa)}, variance to last month ${fmt(level1.varianceToLastMonth)} – kept with the report for the dashboard's Excel check.`);
  return { sheets: out.filter((s) => s.rows.length > 0), notes, periodEnd, reportNo, level1, control };
}
