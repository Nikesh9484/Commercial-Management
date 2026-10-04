import { getDb } from "../../db";
import { formatDate } from "../../format";
import { ValidationError } from "../../registers/engine";
import { getPeriod, latestPeriod, type PeriodRow } from "../../snapshots";
import { snapshotRows } from "../../view-mode";
import { XWorkbook, type XSheet } from "./xlsx";
import { readReportTemplate } from "./templates";
import { getReportData } from "../data";
import { addLevel02R1Sheet } from "./level02r1";
import { extractSheets } from "./extract";

/**
 * The month's report written back into the project's own report workbook: the same tabs, the same
 * formulas and formatting, with the registers' rows in the cells the importer reads them from. A row
 * the workbook does not have yet (a new change, bond, application, transfer) is inserted inside its
 * table, below the last one, in the same style; a figure the workbook works out itself (a formula)
 * is left to the workbook. Excel recalculates every total when the file opens.
 */

type Row = Record<string, unknown>;
export interface OwnLayoutResult {
  bytes: Buffer;
  fileName: string;
  notes: string[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const lastNo = (s: unknown) => {
  const m = String(s ?? "").match(/(\d+)(?!.*\d)/);
  return m ? Number(m[1]) : null;
};
const upper = (s: unknown) => String(s ?? "").toUpperCase();
const n0 = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const yesNo = (v: unknown) => (v === 1 || v === true || v === "1" ? "Yes" : "No");

class Source {
  db = getDb();
  names = new Map<string, Map<number, string>>();
  constructor(
    public programmeId: number,
    public period: PeriodRow,
  ) {}
  rows(register: string, table = register): Row[] {
    // an issued month is its stored copy; bonds are standalone and always live
    if (this.period.status === "Locked" && register !== "bonds") {
      const stored = snapshotRows<Row>(this.db, this.period.id, register);
      if (stored) return stored.filter((r) => Number(r.programme_id) === this.programmeId);
    }
    const cols = (this.db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
    return cols.includes("programme_id") ? (this.db.prepare(`SELECT * FROM "${table}" WHERE programme_id = ? ORDER BY id`).all(this.programmeId) as Row[]) : (this.db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all() as Row[]);
  }
  name(table: string, id: unknown, field = "name"): string {
    if (id === null || id === undefined || id === "") return "";
    let m = this.names.get(`${table}.${field}`);
    if (!m) {
      m = new Map((this.db.prepare(`SELECT id, "${field}" AS v FROM "${table}"`).all() as { id: number; v: string }[]).map((r) => [r.id, String(r.v ?? "")]));
      this.names.set(`${table}.${field}`, m);
    }
    return m.get(Number(id)) ?? "";
  }
}

/** A table on a sheet: its header row, its key column and its data rows, with room made for new rows. */
class Table {
  rows = new Map<string, number[]>();
  first = 0;
  last = 0;
  constructor(
    public wb: XWorkbook,
    public s: XSheet,
    public hdr: number,
    public keyCol: number,
    public keyOf: (r: number) => string | null,
    public stop?: (r: number) => boolean,
  ) {
    this.scan();
  }
  scan() {
    this.rows = new Map();
    this.first = 0;
    this.last = 0;
    const max = Math.max(...this.s.rows.keys(), this.hdr);
    for (let r = this.hdr + 1; r <= max; r++) {
      if (this.stop?.(r)) break;
      const k = this.keyOf(r);
      if (k === null) continue;
      if (!this.first) this.first = r;
      this.last = r;
      this.rows.set(k, [...(this.rows.get(k) ?? []), r]);
    }
  }
  /** New rows for several keys at once: k rows after a group's last row (or above the table's last row), one insertion. */
  reserve(keys: string[], groupLast: number | null, inserted: { n: number }): void {
    const fresh = keys.filter((k) => !this.rows.get(k)?.length);
    if (!fresh.length || !this.last) return;
    const at = groupLast ? groupLast + 1 : this.last;
    const tpl = groupLast ?? this.last;
    this.wb.insertRows(this.s, at, fresh.length, tpl);
    inserted.n += fresh.length;
    this.scan();
    fresh.forEach((k, i) => this.rows.set(k, [at + i]));
  }
  /** The row for a key, else a new row right after a group's last row (same style and formulas as that row). */
  rowAfter(key: string, groupLast: number | null, inserted: { n: number }): number | null {
    const hit = this.rows.get(key);
    if (hit?.length) return hit[0];
    if (!groupLast) return this.rowFor(key, inserted);
    this.wb.insertRows(this.s, groupLast + 1, 1, groupLast);
    inserted.n++;
    this.scan();
    this.rows.set(key, [groupLast + 1]);
    return groupLast + 1;
  }
  /** The row for a key, else a new row inserted above the last data row (same style and formulas). */
  rowFor(key: string, inserted: { n: number }): number | null {
    const hit = this.rows.get(key);
    if (hit?.length) return hit[0];
    if (!this.last) return null;
    const at = this.last; // above the last row, so every range that ends on it grows
    this.wb.insertRows(this.s, at, 1, this.last);
    inserted.n++;
    this.scan();
    this.rows.set(key, [at]);
    return at;
  }
}

function numericKey(wb: XWorkbook, s: XSheet, col: number) {
  return (r: number) => {
    const v = wb.number(s, r, col);
    return v !== null && !wb.hasFormula(s, r, col) && Number.isInteger(v) ? String(v) : null;
  };
}

/** Data Input / Report Data: the report number and the month of the period. */
function writeReportHeader(wb: XWorkbook, period: PeriodRow, notes: string[]) {
  const end = new Date(`${String(period.period_end).slice(0, 10)}T00:00:00Z`);
  const monthName = MONTHS[end.getUTCMonth()];
  const year = end.getUTCFullYear();
  const reportNo = Number(period.report_no);
  // ---- Data Input / Report Data: the report number and the month
  for (const s of [wb.sheet("Data Input"), wb.sheet("Report Data")]) {
    if (!s) continue;
    for (const r of [...s.rows.keys()].sort((a, b) => a - b)) {
      const label = upper(wb.text(s, r, 1));
      const cur = wb.text(s, r, 2);
      if (label.startsWith("REPORT NO") && !label.includes("SHORT")) wb.set(s, r, 2, cur.replace(/\d+/, String(reportNo)) || `MONTHLY REPORT NO. ${reportNo}`, { force: true });
      else if (label.startsWith("REPORT NO SHORT")) wb.set(s, r, 2, cur.replace(/\d+/, String(reportNo)) || ` NO. ${reportNo}`, { force: true });
      else if (label.startsWith("REPORTING PERIOD")) {
        const m = cur.match(/([A-Za-z]{3,})(\s+)\d{4}/);
        const word = m ? (m[1] === m[1].toUpperCase() ? (m[1].length > 3 ? monthName.toUpperCase() : monthName.slice(0, 3).toUpperCase()) : m[1].length > 3 ? monthName : monthName.slice(0, 3)) : monthName.slice(0, 3);
        wb.set(s, r, 2, m ? cur.replace(/[A-Za-z]{3,}(\s+)\d{4}/, (_x, sp: string) => `${word}${sp}${year}`) : `${word}  ${year}`, { force: true });
      }
      else if (label.startsWith("PERIOD END") || label.startsWith("CUT-OFF") || label.startsWith("CUT OFF")) wb.set(s, r, 2, String(period.period_end).slice(0, 10), { force: true });
    }
    notes.push(`${s.name}: Report No ${reportNo}, ${monthName} ${year}.`);
  }

}

/** The Bonds & insurance tab (Schedule G / SCHD G): every bond and policy of the register in its row, new ones inserted in the table. */
function writeBondsSheet(wb: XWorkbook, src: Source, marina: boolean, notes: string[]): XSheet | null {
  // ---- Bonds & insurance
  const G = wb.sheet("Schedule G", "SCHD G");
  if (G) {
    const hdr = wb.headerRow(G, marina ? ["ref", "type of bond"] : ["pkg code", "type of bond"]) ?? 12;
    const keyCol = marina ? 2 : 1;
    const t = marina
      ? new Table(wb, G, hdr, keyCol, numericKey(wb, G, 2))
      : new Table(wb, G, hdr, keyCol, (r) => {
          const k = wb.text(G, r, 1).match(/^\s*(\d{3}[A-Z]\d{2})\s*$/i)?.[1]?.toUpperCase();
          const n = wb.number(G, r, 3);
          return k && n !== null && !wb.hasFormula(G, r, 3) ? `${k}:${Math.trunc(n)}` : null;
        });
    const inserted = { n: 0 };
    let written = 0;
    for (const b of src.rows("bonds")) {
      const typeName = src.name("bond_types", b.type_id);
      const vb = String(b.ref ?? "").match(/^G-(\d{3}[A-Z]\d{2})-(\d+)([a-z])?$/i);
      const key = marina ? String(lastNo(b.ref) ?? "") : vb && !vb[3] ? `${vb[1].toUpperCase()}:${Number(vb[2])}` : "";
      if (!key) continue;
      let r: number | null;
      if (marina) r = t.rowFor(key, inserted);
      else {
        r = t.rows.get(key)?.[0] ?? null;
        if (!r) {
          const frag = vb![1].toUpperCase();
          const groupLast = [...t.rows.entries()].filter(([k]) => k.startsWith(`${frag}:`)).flatMap(([, rows]) => rows).sort((x, y) => y - x)[0] ?? null;
          const keys = src.rows("bonds").map((x) => String(x.ref ?? "").match(/^G-(\d{3}[A-Z]\d{2})-(\d+)$/i)).filter((x): x is RegExpMatchArray => !!x && x[1].toUpperCase() === frag).map((x) => `${frag}:${Number(x[2])}`);
          t.reserve(keys, groupLast, inserted);
          for (const k of keys) {
            const nr = t.rows.get(k)?.[0];
            if (nr && !wb.text(G, nr, 1)) {
              wb.set(G, nr, 1, frag);
              wb.set(G, nr, 3, Number(k.split(":")[1]));
            }
          }
          r = t.rows.get(key)?.[0] ?? null;
        }
      }
      if (!r) continue;
      const set = (c: number, v: unknown, date = false) => {
        if (v === null || v === undefined || v === "") return;
        wb.set(G, r, c, typeof v === "number" ? v : String(v), { date });
      };
      if (marina) {
        set(2, lastNo(b.ref));
        set(3, src.name("contractors", b.contractor_id));
        set(4, src.name("packages", b.package_id));
        set(5, n0(b.original_contract_sum));
        set(7, typeName);
        set(8, b.policy_no);
        set(9, n0(b.requirement_value));
        set(10, n0(b.amount_provided));
        set(12, b.expiry_date, true);
        set(14, yesNo(b.approved));
        set(15, yesNo(b.bank_verification));
        set(16, b.comments);
      } else {
        if (!wb.text(G, r, 2)) set(2, src.name("packages", b.package_id));
        if (!wb.hasFormula(G, r, 4) && !wb.text(G, r, 4)) set(4, src.name("contractors", b.contractor_id));
        set(7, typeName);
        set(8, b.policy_no);
        set(9, n0(b.requirement_value));
        set(10, n0(b.amount_provided));
        set(11, b.expiry_date, true);
        set(13, b.comments);
      }
      written++;
    }
    notes.push(`${G.name}: ${written} bonds / policies written${inserted.n ? `, ${inserted.n} new row${inserted.n === 1 ? "" : "s"} added` : ""}.`);
  }

  return G ?? null;
}

export async function renderOwnLayout(programmeId: number, periodId: number | null): Promise<OwnLayoutResult> {
  const tpl = readReportTemplate(programmeId);
  if (!tpl) throw new ValidationError("No report workbook is kept for this project yet. Upload your last report workbook as the template (Reports & downloads → Your report workbook), or import a month: the workbook imported is kept automatically.");
  const period = (periodId ? getPeriod(periodId) : null) ?? latestPeriod(getDb(), programmeId);
  if (!period) throw new ValidationError("This project has no reporting period yet.");
  const src = new Source(programmeId, period);
  const wb = await XWorkbook.load(tpl.bytes);
  const notes: string[] = [];
  const end = new Date(`${String(period.period_end).slice(0, 10)}T00:00:00Z`);
  const monthName = MONTHS[end.getUTCMonth()];
  const year = end.getUTCFullYear();
  const reportNo = Number(period.report_no);

  writeReportHeader(wb, period, notes);

  const marina = !!wb.sheet("Schedule C");
  const C = wb.sheet("Schedule C", "SCHD C");
  // ---- Changes
  if (C) {
    const hdr = wb.headerRow(C, ["item", "description of change"]) ?? 16;
    // VBH numbers its changes per package: the key is the package code with the item number (or the
    // n-th row without a number), as the importer names them – CH-006C72-16, CH-006C58-x11
    const perFrag = new Map<string, number>();
    const vbhKey = (r: number) => {
      const frag = (wb.text(C, r, 9) || wb.text(C, r, 10)).match(/\d{3}[A-Z]\d{2}/i)?.[0]?.toUpperCase();
      const desc = wb.text(C, r, 2).trim();
      if (!frag || !desc) return null;
      const num = wb.number(C, r, 1);
      const hasRef = [18, 26, 35, 42].some((c) => wb.text(C, r, c).trim()) || [25, 34, 54].some((c) => wb.number(C, r, c) !== null);
      if (!hasRef && num === null) return null;
      const seq = (perFrag.get(frag) ?? 0) + 1;
      perFrag.set(frag, seq);
      return `${frag}:${num !== null && Number.isInteger(num) ? String(num) : `x${seq}`}`;
    };
    const t = marina ? new Table(wb, C, hdr + 2, 1, numericKey(wb, C, 1)) : new Table(wb, C, hdr + 3, 1, vbhKey);
    const inserted = { n: 0 };
    let written = 0;
    const changes = src.rows("changes").sort((a, b) => (lastNo(a.item_no) ?? 0) - (lastNo(b.item_no) ?? 0));
    const normDesc = (x: unknown) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
    const groupLastOf = (frag: string) => [...t.rows.entries()].filter(([k]) => k.startsWith(`${frag}:`)).flatMap(([, rows]) => rows).sort((x, y) => y - x)[0] ?? null;
    // VBH: an unnumbered row is found by its description inside its package; whatever is still unmatched gets rows reserved per package in one go
    const vbhRowOf = new Map<string, number>();
    if (!marina) {
      const byDesc = new Map<string, number>();
      for (const [k, rows] of t.rows) for (const r of rows) byDesc.set(`${k.split(":")[0]}:${normDesc(wb.text(C, r, 2))}`, r);
      const missing = new Map<string, string[]>();
      for (const ch of changes) {
        const item = String(ch.item_no ?? "");
        const m = item.match(/^CH-(\d{3}[A-Z]\d{2})-(x?\d+)([a-z])?$/i);
        if (!m || m[3]) continue;
        const frag = m[1].toUpperCase();
        const key = `${frag}:${m[2].toLowerCase()}`;
        const hit = t.rows.get(key)?.[0] ?? (/^x/i.test(m[2]) ? byDesc.get(`${frag}:${normDesc(ch.description)}`) : undefined);
        if (hit) vbhRowOf.set(item, hit);
        else missing.set(frag, [...(missing.get(frag) ?? []), item]);
      }
      for (const [frag, items] of missing) {
        t.reserve(items.map((i) => `new:${i}`), groupLastOf(frag), inserted);
        for (const i of items) {
          const r = t.rows.get(`new:${i}`)?.[0];
          if (r) {
            vbhRowOf.set(i, r);
            wb.set(C, r, 9, frag);
          }
        }
      }
    }
    const dvoStatusCol = marina ? 54 : 55;
    const dvoAmtCol = marina ? 53 : 54;
    const commentsCol = marina ? 62 : 58;
    for (const ch of changes) {
      const item = String(ch.item_no ?? "");
      let r: number | null;
      let no: number | null;
      if (marina) {
        no = lastNo(item);
        if (no === null || /[a-z]$/i.test(item)) continue; // a duplicated Excel number keeps its own row
        r = t.rowFor(String(no), inserted);
      } else {
        const m = item.match(/^CH-(\d{3}[A-Z]\d{2})-(x?\d+)([a-z])?$/i);
        if (!m || m[3]) continue;
        no = /^x/i.test(m[2]) ? null : Number(m[2]);
        r = vbhRowOf.get(item) ?? null;
      }
      if (!r) continue;
      const notesText = String(ch.notes ?? "");
      const excelStatus = notesText.match(/Excel status:\s*([^|\n]+)/)?.[1]?.trim();
      const pendingExcel = notesText.match(/Action pending by \(Excel\):\s*([^|\n]+)/)?.[1]?.trim();
      const status = (id: unknown) => upper(src.name("approval_statuses", id));
      const dvo = status(ch.dvo_status_id);
      const pvo = status(ch.pvo_status_id);
      const rfc = status(ch.rfc_status_id);
      const overall = src.name("approval_statuses", ch.overall_status_id);
      const derivedStatus = dvo === "APPROVED" ? "DVO - Accepted" : ch.dvo_ref ? `DVO - ${dvo || "Pending"}` : ch.vo_ref ? `VO - ${status(ch.vo_status_id) || "Issued"}` : ch.pvo_ref ? `PVO - ${pvo || "Pending"}` : ch.rfc_ref ? `RFC - ${rfc || "Pending"}` : overall;
      const time = (v: unknown) => (n0(v) ? Number(v) : "NO");
      const set = (c: number, v: unknown, date = false) => {
        if (v === null || v === undefined) return;
        wb.set(C, r, c, typeof v === "number" ? v : String(v), { date });
      };
      if (no !== null) set(1, no);
      set(2, ch.description);
      set(3, src.name("project_stages", ch.project_stage_id).replace("Post-Contract", "Post Contract").replace("Pre-Contract", "Pre Contract") || undefined);
      set(4, src.name("change_categories", ch.change_category_id) || undefined);
      set(5, ch.amaala_rep ? upper(ch.amaala_rep) : ["None"].includes(String(ch.action_pending_by)) ? "CLOSED" : "OTHER");
      set(6, pendingExcel ?? (String(ch.action_pending_by) === "None" ? "CLOSED" : String(ch.action_pending_by) === "Commercial Team" ? "OTHER" : upper(ch.action_pending_by)));
      set(7, excelStatus ?? derivedStatus);
      set(8, src.name("change_initiators", ch.initiated_by_id) || undefined);
      set(9, upper(src.name("assets", ch.asset_id)) || undefined);
      set(11, upper(src.name("assets", ch.asset_id)) || undefined);
      set(13, src.name("packages", ch.package_id) || undefined);
      set(14, src.name("contractors", ch.contractor_id) || undefined);
      set(15, ch.ew_ref);
      set(16, ch.ew_date, true);
      set(17, n0(ch.ew_cr_amount));
      set(18, ch.rfc_ref);
      set(19, ch.rfc_rev);
      set(20, ch.rfc_date, true);
      set(21, rfc || undefined);
      set(22, ch.rfc_aconex_ref);
      set(23, time(ch.rfc_time_impact));
      set(25, n0(ch.rfc_tracker_amount));
      set(26, ch.pvo_ref);
      set(27, ch.pvo_rev);
      set(28, ch.pvo_date, true);
      set(29, pvo || undefined);
      if (marina) {
        set(30, ch.vo_pr_status ? (String(ch.vo_pr_status) === "Approved" ? "PR APPROVED" : upper(ch.vo_pr_status)) : undefined);
        set(31, ch.pvo_aconex_ref);
        set(32, time(ch.pvo_time_impact));
      } else {
        set(30, ch.pvo_aconex_ref);
        set(31, time(ch.pvo_time_impact));
      }
      set(34, n0(ch.pvo_tracker_amount));
      set(35, ch.vo_ref);
      set(36, ch.vo_date, true);
      set(37, status(ch.vo_status_id) || undefined);
      set(38, ch.vo_aconex_ref);
      set(39, ch.ei_ref);
      set(40, ch.ei_date, true);
      set(41, ch.ei_aconex_ref);
      set(42, ch.dvo_ref);
      set(43, ch.dvo_rev);
      set(44, ch.vo_contractor_aconex_ref);
      set(45, ch.vo_contractor_date, true);
      set(46, n0(ch.vo_contractor_amount));
      set(47, ch.vo_engineer_aconex_ref);
      set(48, ch.vo_engineer_date, true);
      set(49, n0(ch.vo_engineer_amount));
      set(50, ch.vo_employer_aconex_ref);
      set(51, ch.dvo_date ?? ch.vo_employer_date, true);
      set(dvoAmtCol, n0(ch.dvo_tracker_amount));
      set(dvoStatusCol, dvo || undefined);
      if (marina) {
        set(55, n0(ch.funding_btr));
        set(56, n0(ch.funding_pvo));
        set(57, n0(ch.funding_dvo));
        set(58, n0(ch.funding_po));
        set(59, n0(ch.funding_pr));
        set(60, n0(ch.funding_contingency));
      } else {
        const funding = notesText.match(/Funding:\s*([^|\n]+)/)?.[1]?.trim();
        if (funding) set(56, funding.replace(/\s*\(.*\)$/, ""));
      }
      const comment = notesText.match(/Comments:\s*([^|\n]+)/)?.[1]?.trim() ?? (notesText.includes("Added from documents") ? notesText.split("\n").filter((l) => !/^(Scope|Reason):/.test(l)).join(" ").slice(0, 400) : "");
      if (comment) set(commentsCol, comment);
      written++;
    }
    notes.push(`${C.name}: ${written} changes written${inserted.n ? `, ${inserted.n} new row${inserted.n === 1 ? "" : "s"} added` : ""}.`);
  }

  writeBondsSheet(wb, src, marina, notes);

  // ---- Contracts (Schedule H) and the IPC logs behind them
  const contracts = src.rows("contracts");
  const H = wb.sheet("Schedule H");
  if (H && marina) {
    const hdr = wb.headerRow(H, ["sr nr", "name", "original contract"]) ?? 11;
    const t = new Table(wb, H, hdr, 1, numericKey(wb, H, 1), (r) => upper(wb.text(H, r, 1)).startsWith("TOTAL"));
    let written = 0;
    for (const c of contracts) {
      const r = t.rows.get(String(c.sr_no ?? ""))?.[0];
      if (!r) continue;
      wb.set(H, r, 7, String(c.current_status) === "Closed" ? "CLOSED" : upper(c.current_status));
      if (n0(c.eot_granted_days) !== null) wb.set(H, r, 9, Number(c.eot_granted_days));
      if (n0(c.original_contract) !== null) wb.set(H, r, 12, Number(c.original_contract));
      if (n0(c.final_account_adjustment) !== null) wb.set(H, r, 15, Number(c.final_account_adjustment));
      written++;
    }
    notes.push(`Schedule H: ${written} contracts updated (a contract without a row is listed on the dashboard only).`);
  }
  const apps = src.rows("payment_applications");
  // the visible IPC logs are the live ones; a hidden copy is left as it is
  const ipcSheets = wb.sheets.filter((s) => !s.hidden && /^schedule h\s*[-a-z0-9+]/i.test(s.name.trim()) && s.name.trim().toLowerCase() !== "schedule h");
  const usedContracts = new Set<number>();
  for (const s of ipcSheets) {
    const hdr = wb.headerRow(s, ["sr nr", "payment applicat"]) ?? 11;
    // the contract behind the sheet: the PO in its name, else the ACC code its Aconex references carry most
    const counts = new Map<string, number>();
    for (const r of [...s.rows.keys()].sort((x, y) => x - y).slice(0, 80))
      for (const c of [...(s.rows.get(r)?.cells.keys() ?? [])])
        for (const m of wb.text(s, r, c).matchAll(/1TB\d{5}-(\d{3}[A-Z]\d{2})-/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    const frag = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const po = s.name.match(/\b(\d{7})\b/)?.[1];
    // the contract behind the sheet, scored: its PO in the tab name, the ACC code its references carry,
    // the contractor's name in the tab name or typed above the table, a short tab name read as initials
    const headRow = [hdr - 2, hdr - 3].find((r) => r > 0 && !wb.hasFormula(s, r, 1) && wb.text(s, r, 1).trim().length > 1 && wb.text(s, r, 1).trim().length < 50 && !/stage/i.test(wb.text(s, r, 1)));
    const tab = s.name.replace(/^schedule h\s*-?\s*/i, "").trim();
    const title = `${tab} ${headRow ? wb.text(s, headRow, 1) : ""}`.trim().toLowerCase();
    const GENERIC = new Set(["general", "contracting", "company", "limited", "engineering", "marine", "services", "environmental", "trading", "industry", "industrial", "consultants", "consultant", "consultancy", "branch", "partners", "systems", "factory", "interiors", "construction", "development", "project", "building", "energy", "efficiency", "schedule", "install", "supply", "consult", "saudi", "arabia", "decoration", "equipment", "electronic", "supplies", "contracting"]);
    const words = (x: string) => x.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !GENERIC.has(w));
    const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 6 && (a.startsWith(b.slice(0, 6)) || b.startsWith(a.slice(0, 6))));
    const abbrevs = tab.split(/[^A-Za-z]+/).filter((t) => t.length >= 2 && t.length <= 5 && t === t.toUpperCase()).map((t) => t.toLowerCase());
    const subseq = (t: string, x: string) => {
      let i = 0;
      for (const ch of x) if (ch === t[i]) i++;
      return i === t.length;
    };
    const titleWords = words(title);
    const score = (c: Row) => {
      const name = src.name("contractors", c.contractor_id).toLowerCase();
      const cw = words(name);
      const letters = name.replace(/[^a-z]/g, "");
      const initials = name.split(/[^a-z]+/).filter(Boolean).map((w) => w[0]).join("");
      let n = 0;
      if (po && String(c.reef_po_no) === po) n += 10;
      if (frag && upper(c.acc_ref).includes(frag)) n += 5;
      n += 3 * titleWords.filter((w) => cw.some((x) => sameWord(w, x))).length;
      if (abbrevs.some((t) => initials.startsWith(t) || (t.length >= 3 && subseq(t, letters)))) n += 2;
      return n;
    };
    const ranked = contracts.map((c) => ({ c, n: score(c) })).filter((x) => x.n >= 3).sort((x, y) => y.n - x.n);
    const nameAgrees = (c: Row) => titleWords.length === 0 && abbrevs.length === 0 ? true : score(c) - (po && String(c.reef_po_no) === po ? 10 : 0) - (frag && upper(c.acc_ref).includes(frag) ? 5 : 0) > 0;
    let contract = ranked.length && (ranked.length === 1 || ranked[0].n > ranked[1].n) ? ranked[0].c : undefined;
    if (contract && !nameAgrees(contract) && (titleWords.length || abbrevs.length)) contract = undefined;
    if (contract && usedContracts.has(Number(contract.id))) {
      notes.push(`${s.name.trim()}: the same contract as an earlier sheet – left as it was.`);
      continue;
    }
    if (contract) usedContracts.add(Number(contract.id));
    if (!contract) {
      notes.push(`${s.name.trim()}: no contract matched – left as it was.`);
      continue;
    }
    const col = {
      appNo: wb.columnOf(s, hdr, "payment applicat"),
      month: wb.columnOf(s, hdr, "month"),
      ref: wb.columnOf(s, hdr, "aconex"),
      date: wb.columnOf(s, hdr, "date") || 5,
      cum: wb.columnOf(s, hdr, "cumulative claimed"),
      ipcNo: wb.columnOf(s, hdr, "ipc nr") || wb.columnOf(s, hdr, "ipc no"),
      cumCert: wb.columnOf(s, hdr, "cumulative certified"),
      paid: wb.columnOf(s, hdr, "payment date") || wb.columnOf(s, hdr, "paid"),
    };
    const row = s.rows.get(hdr);
    const cols = row ? [...row.cells.keys()].sort((a, b) => a - b) : [];
    const after = (from: number, ...words: string[]) => cols.find((c) => c > from && words.every((w) => wb.text(s, hdr, c).toLowerCase().replace(/\s+/g, " ").includes(w))) ?? 0;
    const ipcRef = col.ipcNo ? after(col.ipcNo, "aconex") : 0;
    const ipcDate = ipcRef ? after(ipcRef, "date") : 0;
    const invRef = col.cumCert ? after(col.cumCert, "aconex") || after(col.cumCert, "invoice") : 0;
    const invDate = invRef ? after(invRef, "date") : 0;
    const t = new Table(wb, s, hdr + 2, 1, numericKey(wb, s, 1), (r) => upper(wb.text(s, r, 1)).startsWith("TOTAL"));
    const inserted = { n: 0 };
    let written = 0;
    for (const a of apps.filter((x) => Number(x.contract_id) === Number(contract.id)).sort((x, y) => Number(x.sr_no ?? 0) - Number(y.sr_no ?? 0))) {
      const sr = n0(a.sr_no) ?? lastNo(a.application_no);
      if (sr === null) continue;
      const r = t.rowFor(String(sr), inserted);
      if (!r) continue;
      wb.set(s, r, 1, sr);
      if (col.appNo) wb.set(s, r, col.appNo, String(a.application_no ?? ""));
      if (col.month && a.month) {
        const m = String(a.month).match(/^([A-Za-z]{3})'(\d{2})$/);
        const mi = m ? MONTHS.findIndex((x) => x.slice(0, 3).toLowerCase() === m[1].toLowerCase()) : -1;
        if (mi >= 0 && m) wb.set(s, r, col.month, `20${m[2]}-${String(mi + 1).padStart(2, "0")}-01`, { date: true });
      }
      if (col.ref && a.application_aconex_ref) wb.set(s, r, col.ref, String(a.application_aconex_ref));
      if (col.date && a.application_date) wb.set(s, r, col.date, String(a.application_date), { date: true });
      if (col.cum && n0(a.cumulative_claimed) !== null) wb.set(s, r, col.cum, Number(a.cumulative_claimed));
      if (col.ipcNo && a.ipc_no) wb.set(s, r, col.ipcNo, String(a.ipc_no));
      if (ipcRef && a.ipc_aconex_ref) wb.set(s, r, ipcRef, String(a.ipc_aconex_ref));
      if (ipcDate && a.ipc_date) wb.set(s, r, ipcDate, String(a.ipc_date), { date: true });
      if (col.cumCert && n0(a.cumulative_certified) !== null) wb.set(s, r, col.cumCert, Number(a.cumulative_certified));
      if (invRef && a.invoice_aconex_ref) wb.set(s, r, invRef, String(a.invoice_aconex_ref));
      if (invDate && a.invoice_date) wb.set(s, r, invDate, String(a.invoice_date), { date: true });
      if (col.paid && a.paid_date) wb.set(s, r, col.paid, String(a.paid_date), { date: true });
      written++;
    }
    notes.push(`${s.name.trim()}: ${written} applications written for ${src.name("contractors", contract.contractor_id) || contract.title}${inserted.n ? `, ${inserted.n} new row${inserted.n === 1 ? "" : "s"} added` : ""}.`);
  }

  // ---- Provisional sums, budget transfers, early warnings, final accounts, risks, cost lines (Marina layout)
  if (marina) {
    const F = wb.sheet("Schedule F");
    if (F) {
      const hdr = wb.headerRow(F, ["item", "description", "budget"]) ?? 11;
      const t = new Table(wb, F, hdr, 1, numericKey(wb, F, 1), (r) => upper(wb.text(F, r, 2)).startsWith("TOTAL"));
      const inserted = { n: 0 };
      let written = 0;
      for (const p of src.rows("provisional_sums")) {
        const no = lastNo(p.item);
        if (no === null) continue;
        const r = t.rowFor(String(no), inserted);
        if (!r) continue;
        wb.set(F, r, 1, no);
        wb.set(F, r, 2, String(p.description ?? ""));
        wb.set(F, r, 3, upper(src.name("ps_statuses", p.status_id) || p.status || "PENDING"));
        wb.set(F, r, 4, upper(src.name("contractors", p.contractor_id)));
        if (n0(p.budget) !== null) wb.set(F, r, 5, Number(p.budget));
        if (n0(p.contract_value) !== null) wb.set(F, r, 6, Number(p.contract_value));
        if (p.comments) wb.set(F, r, 8, String(p.comments));
        written++;
      }
      notes.push(`Schedule F: ${written} provisional sums written${inserted.n ? `, ${inserted.n} new row${inserted.n === 1 ? "" : "s"} added` : ""}.`);
    }
    const J = wb.sheet("Schedule J");
    if (J) {
      const hdr = wb.headerRow(J, ["item", "from package"]) ?? 11;
      const t = new Table(wb, J, hdr, 1, numericKey(wb, J, 1), (r) => upper(wb.text(J, r, 2)).startsWith("TOTAL"));
      const inserted = { n: 0 };
      let written = 0;
      for (const b of src.rows("budget_transfers")) {
        const no = lastNo(b.item);
        if (no === null) continue;
        const r = t.rowFor(String(no), inserted);
        if (!r) continue;
        wb.set(J, r, 1, no);
        wb.set(J, r, 2, String(b.description ?? ""));
        wb.set(J, r, 3, src.name("packages", b.from_package_id) || "Budget Hold");
        wb.set(J, r, 4, src.name("packages", b.to_package_id) || "Budget Hold");
        if (n0(b.amount) !== null) wb.set(J, r, 5, -Math.abs(Number(b.amount)));
        if (n0(b.amount) !== null) wb.set(J, r, 6, Math.abs(Number(b.amount)));
        if (b.date) wb.set(J, r, 7, String(b.date), { date: true });
        wb.set(J, r, 8, `Monthly Report No ${reportNo} - ${monthName.slice(0, 3)}'${String(year).slice(-2)}`);
        if (b.approval_ref) wb.set(J, r, 9, String(b.approval_ref));
        written++;
      }
      notes.push(`Schedule J: ${written} budget transfers written${inserted.n ? `, ${inserted.n} new row${inserted.n === 1 ? "" : "s"} added` : ""}.`);
    }
    const EW = wb.sheet("Early Warning", "Early Warnings");
    if (EW) {
      let written = 0;
      const byNo = new Map<string, number>();
      for (const r of [...EW.rows.keys()].sort((a, b) => a - b)) {
        const no = wb.number(EW, r, 1);
        const p = wb.text(EW, r, 2);
        if (no !== null && p && p !== upper(p)) byNo.set(String(no), r);
      }
      for (const e of src.rows("early_warnings")) {
        const no = lastNo(e.ew_no);
        const r = no !== null ? byNo.get(String(no)) : undefined;
        if (!r) continue;
        wb.set(EW, r, 3, String(e.description ?? ""));
        if (n0(e.cost_impact ?? e.estimated_cost ?? e.amount) !== null) wb.set(EW, r, 4, Number(e.cost_impact ?? e.estimated_cost ?? e.amount));
        written++;
      }
      notes.push(`Early Warning: ${written} rows updated (the sheet keeps its sections; a new early warning is added by hand).`);
    }
    const FA = wb.sheet("FA Status", "Final Account Status");
    if (FA) {
      const hdr = wb.headerRow(FA, ["acc code", "status"]) ?? 12;
      const byAcc = new Map<string, number>();
      for (let r = hdr + 1; r <= Math.max(...FA.rows.keys()); r++) {
        const acc = wb.text(FA, r, 2).replace(/\s+/g, "");
        if (acc && wb.number(FA, r, 1) !== null && !byAcc.has(acc)) byAcc.set(acc, r);
      }
      let written = 0;
      for (const f of src.rows("final_accounts")) {
        const r = byAcc.get(String(f.acc_ref ?? "").replace(/\s+/g, ""));
        if (!r) continue;
        if (f.responsible) wb.set(FA, r, 9, String(f.responsible));
        if (f.forecast_date) wb.set(FA, r, 10, String(f.forecast_date), { date: true });
        if (f.status) wb.set(FA, r, 12, String(f.status));
        if (f.comments) wb.set(FA, r, 13, String(f.comments));
        written++;
      }
      notes.push(`FA Status: ${written} rows updated.`);
    }
    const D = wb.sheet("Schedule D");
    if (D) {
      const byNo = new Map<string, number>();
      for (const r of [...D.rows.keys()]) {
        const no = wb.number(D, r, 1);
        if (no !== null && !Number.isInteger(no) && wb.text(D, r, 2)) byNo.set(no.toFixed(2), r);
      }
      let written = 0;
      for (const k of src.rows("risks")) {
        const no = String(k.ro_no ?? "").match(/(\d+\.\d+)/)?.[1];
        const r = no ? byNo.get(Number(no).toFixed(2)) : undefined;
        if (!r) continue;
        wb.set(D, r, 2, String(k.description ?? ""));
        const v = n0(k.cost_impact);
        if (v !== null) {
          if (String(k.type) === "Opportunity") wb.set(D, r, 4, Math.abs(v));
          else wb.set(D, r, 3, v);
        }
        written++;
      }
      notes.push(`Schedule D: ${written} risks / opportunities updated.`);
    }
    const B = wb.sheet("Schedule B");
    if (B) {
      const hdr = wb.headerRow(B, ["code", "package", "approved baseline budget"]) ?? 12;
      const byCode = new Map<string, number>();
      for (let r = hdr + 1; r <= Math.max(...B.rows.keys()); r++) {
        const code = wb.text(B, r, 1).trim();
        if (code && !byCode.has(code)) byCode.set(code, r);
      }
      let written = 0;
      let formulas = 0;
      for (const l of src.rows("cost_lines")) {
        const code = String(l.code ?? "").replace(/-\d+$/, "");
        const r = byCode.get(code);
        if (!r) continue;
        if (n0(l.approved_baseline_budget) !== null) {
          if (wb.set(B, r, 5, Number(l.approved_baseline_budget))) written++;
          else formulas++;
        }
      }
      notes.push(`Schedule B: ${written} baseline budgets written${formulas ? `, ${formulas} left to the sheet's own formulas` : ""}; the awarded, change and forecast columns are the sheet's formulas.`);
    }
  }

  if (!marina) {
    const B = wb.sheet("SCHD B", "Schedule B");
    if (B) {
      const hdr = wb.headerRow(B, ["code", "name", "approved basel"]) ?? 10;
      const byCode = new Map<string, number>();
      for (let r = hdr + 1; r <= Math.max(...B.rows.keys()); r++) {
        const code = wb.text(B, r, 1).trim();
        if (code && !byCode.has(code)) byCode.set(code, r);
      }
      let written = 0;
      for (const l of src.rows("cost_lines")) {
        const r = byCode.get(String(l.code ?? "").replace(/-\d+$/, ""));
        if (!r) continue;
        let any = false;
        if (n0(l.approved_baseline_budget) !== null && wb.set(B, r, 3, Number(l.approved_baseline_budget))) any = true;
        if (n0(l.opening_transfers) !== null && wb.set(B, r, 4, Number(l.opening_transfers))) any = true;
        if (any) written++;
      }
      notes.push(`SCHD B: ${written} lines' baseline budgets and transfers written; the committed, change and forecast columns are the sheet's formulas.`);
    }
    const FA = wb.sheet("FA Status R1", "FA Status", "Final Account Status");
    if (FA) {
      const hdr = wb.headerRow(FA, ["acc code", "status"]) ?? 12;
      const byAcc = new Map<string, number>();
      for (let r = hdr + 1; r <= Math.max(...FA.rows.keys()); r++) {
        const acc = wb.text(FA, r, 2).replace(/\s+/g, "");
        if (acc && wb.number(FA, r, 1) !== null && !byAcc.has(acc)) byAcc.set(acc, r);
      }
      let written = 0;
      for (const f of src.rows("final_accounts")) {
        const r = byAcc.get(String(f.acc_ref ?? "").replace(/\s+/g, ""));
        if (!r) continue;
        if (f.responsible) wb.set(FA, r, 9, String(f.responsible));
        if (f.forecast_date) wb.set(FA, r, 10, String(f.forecast_date), { date: true });
        if (f.status) wb.set(FA, r, 12, String(f.status));
        if (f.comments) wb.set(FA, r, 13, String(f.comments));
        written++;
      }
      notes.push(`${FA.name}: ${written} rows updated.`);
    }
    const EW = wb.sheet("Early Warning", "Early Warnings");
    if (EW) {
      const hdr = wb.headerRow(EW, ["ew no", "description"]) ?? 8;
      const byNo = new Map<string, number>();
      for (let r = hdr + 1; r <= Math.max(...EW.rows.keys()); r++) {
        const no = wb.text(EW, r, 2).trim().replace(/\s+/g, " ");
        if (no && wb.text(EW, r, 4).trim() && !byNo.has(no)) byNo.set(no, r);
      }
      let written = 0;
      for (const e of src.rows("early_warnings")) {
        const r = byNo.get(String(e.ew_no ?? "").trim().replace(/\s+/g, "").replace(/-\d+$/, "")) ?? byNo.get(String(e.ew_no ?? "").trim().replace(/\s+/g, " "));
        if (!r) continue;
        wb.set(EW, r, 4, String(e.description ?? ""));
        const v = n0(e.cost_impact ?? e.estimated_cost ?? e.amount);
        if (v !== null) wb.set(EW, r, 5, v);
        if (e.notes) wb.set(EW, r, 7, String(e.notes));
        written++;
      }
      notes.push(`Early Warning: ${written} rows updated (the sheet keeps its package sections; a new early warning is added by hand).`);
    }
  }

  // ---- Level 02 (R1): the head office Budget EAC layout of Level 02, as a tab of its own
  try {
    const { lines, assets } = await addLevel02R1Sheet(wb, getReportData(programmeId, period.id));
    notes.push(`Level 02 (R1): ${lines} lines in ${assets} asset(s) written in the head office Budget EAC layout (the tab is added at the end, or replaced when the workbook already has one).`);
  } catch (e) {
    notes.push(`Level 02 (R1): not written – ${e instanceof Error ? e.message : String(e)}.`);
  }

  const bytes = await wb.save();
  const base = tpl.name.replace(/\.(xlsx|xlsm)$/i, "");
  const stem = base.replace(/Report[\s_]*No[\s_.]*\d+/i, `Report No ${reportNo}`).replace(/[A-Za-z]{3}-\d{2}/, `${monthName.slice(0, 3)}-${String(year).slice(-2)}`);
  const ext = tpl.name.match(/\.(xlsm)$/i) ? "xlsm" : "xlsx";
  const fileName = `${stem === base ? `${base} - Report No ${reportNo} ${monthName.slice(0, 3)}-${String(year).slice(-2)}` : stem}.${ext}`;
  notes.push(`Written into ${tpl.name} (${formatDate(String(period.period_end).slice(0, 10))}); every total recalculates when the workbook opens.`);
  return { bytes, fileName, notes };
}

/**
 * The Insurance tracker: the Bonds & insurance tab of the project's own report workbook, filled from the
 * register, as a workbook of its own – the tab's formulas, colours, fonts and layout exactly as in the
 * template, with the sheets its formulas look at kept hidden beside it.
 */
export async function renderBondsTracker(programmeId: number, periodId: number | null): Promise<OwnLayoutResult> {
  const tpl = readReportTemplate(programmeId);
  if (!tpl) throw new ValidationError("No report workbook is kept for this project yet. Upload your last report workbook as the template (Reports & downloads → Your report workbook), or import a month: the workbook imported is kept automatically.");
  const period = (periodId ? getPeriod(periodId) : null) ?? latestPeriod(getDb(), programmeId);
  if (!period) throw new ValidationError("This project has no reporting period yet.");
  const src = new Source(programmeId, period);
  const wb = await XWorkbook.load(tpl.bytes);
  const notes: string[] = [];
  writeReportHeader(wb, period, notes);
  const marina = !!wb.sheet("Schedule C");
  const G = writeBondsSheet(wb, src, marina, notes);
  if (!G) throw new ValidationError(`The report workbook kept for this project has no Bonds & insurance tab (Schedule G / SCHD G) – the tracker follows that tab.`);
  const bytes = await extractSheets(wb, [G.name]);
  const programme = getDb().prepare("SELECT name, code FROM programmes WHERE id = ?").get(programmeId) as { name: string; code: string } | undefined;
  const end = new Date(`${String(period.period_end).slice(0, 10)}T00:00:00Z`);
  const fileName = `Insurance Tracker - ${programme?.name ?? programme?.code ?? "project"} - Report No ${Number(period.report_no)} ${MONTHS[end.getUTCMonth()].slice(0, 3)}-${String(end.getUTCFullYear()).slice(-2)} - ${formatDate(new Date().toISOString().slice(0, 10))}.xlsx`;
  return { bytes, fileName, notes };
}
