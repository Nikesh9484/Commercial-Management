import ExcelJS from "exceljs";
import { APP_NAME } from "../brand";
import type { ReportData } from "./data";
import { buildBudgetEac, EAC_COLUMNS, type BudgetEac, type EacColumn } from "./budget-eac";

/**
 * Writes the head office "Programme XX Budget EAC" workbook exactly as the template is laid out
 * (Peter Ayliffe, September 2026): the same six tabs, headings, column letters, formulas, number
 * formats, fills and hidden columns, so a programme's file can be consolidated like every other
 * one. Every figure Level 01 and Level 02 derive stays a live formula, so the sheet recalculates
 * when a row is edited.
 */
const ACC_FMT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)';
const ARIAL = { name: "Arial", size: 10 };
const PURPLE = "FF7030A0";
const SUBTOTAL_FILL = "FFFFEB9C";
const SUBTOTAL_INK = "FF9C5700";
const HEAD_FILL = "FFD9D9D9";
const HEAD_SITE_FILL = "FFDDEBF7";
const HEAD_USE_FILL = "FFE2EFDA";
const NOTE_FILL = "FFFFFF00";
const CODE_FILL = "FFADD8E6";
const LEVEL02 = "Level 02  level 5 data ";
const BREAKDOWN = "Early Warning Breakdown";

const thin: ExcelJS.Border = { style: "thin", color: { argb: "FF808080" } };
const BOX: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const f = (formula: string, result?: number | string): ExcelJS.CellFormulaValue => ({ formula, result });

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
const colIndex = (letter: string) => letter.split("").reduce((t, ch) => t * 26 + (ch.charCodeAt(0) - 64), 0);

function titleRows(ws: ExcelJS.Worksheet, e: BudgetEac, first: boolean, font = ARIAL) {
  const a1 = ws.getCell("A1");
  const a2 = ws.getCell("A2");
  const a3 = ws.getCell("A3");
  if (first) {
    a1.value = e.portfolio;
    a2.value = `${e.programme.name} (${e.programme.code})`;
    a3.value = `${e.month} – ${e.periodLabel}`;
  } else {
    a1.value = f("'Level 01'!A1", e.portfolio);
    a2.value = f("'Level 01'!A2", `${e.programme.name} (${e.programme.code})`);
    a3.value = f("'Level 01'!A3", `${e.month} – ${e.periodLabel}`);
  }
  for (const c of [a1, a2, a3]) c.font = { ...font, bold: true };
}

function headCell(c: ExcelJS.Cell, fill = HEAD_FILL, font = ARIAL, align: "left" | "center" = "center") {
  c.font = { ...font, bold: true };
  c.fill = solid(fill);
  c.border = BOX;
  c.alignment = { wrapText: true, vertical: "middle", horizontal: align };
}

function subtotalCell(c: ExcelJS.Cell, font = ARIAL, money = false) {
  c.font = { ...font, bold: true, color: { argb: SUBTOTAL_INK } };
  c.fill = solid(SUBTOTAL_FILL);
  c.border = BOX;
  if (money) {
    c.numFmt = ACC_FMT;
    c.alignment = { horizontal: "right", vertical: "middle" };
  } else c.alignment = { wrapText: true, vertical: "middle", horizontal: "left" };
}

function bodyCell(c: ExcelJS.Cell, font = ARIAL, money = false, align?: "left" | "right" | "center") {
  c.font = font;
  c.border = BOX;
  if (money) {
    c.numFmt = ACC_FMT;
    c.alignment = { horizontal: align ?? "right", vertical: "middle" };
  } else c.alignment = { wrapText: true, vertical: "middle", horizontal: align ?? "left" };
}

/* ------------------------------------------------------------------ */
/* Level 02                                                            */

interface Level02Ref {
  /** the sub-total row of each asset, in order */
  subtotalRows: number[];
  firstRow: number;
  lastRow: number;
}

const USE_LETTERS: Record<EacColumn, string> = { voUnderProcess: "S", eotClaims: "T", otherClaims: "U", finalAccount: "V", uncommittedScope: "W", plantSupply: "X", ffe: "Y", btOtherAsset: "Z", notRequired: "AA" };
const BREAKDOWN_LETTERS: Record<EacColumn, string> = { voUnderProcess: "I", eotClaims: "J", otherClaims: "K", finalAccount: "L", uncommittedScope: "M", plantSupply: "N", ffe: "O", btOtherAsset: "P", notRequired: "Q" };

/**
 * The Level 02 sheet. Linked, its DVO, PVO and utilisation cells are the template's SUMIFs over the
 * schedule tabs; on its own (the "Level 02 (R1)" sheet of a report download) the same figures go in
 * as values, so the sheet stands without the other tabs.
 */
function level02(wb: ExcelJS.Workbook, e: BudgetEac, opts: { linked: boolean; name?: string } = { linked: true }): Level02Ref {
  const ws = wb.addWorksheet(opts.name ?? LEVEL02, { properties: { tabColor: { argb: PURPLE } }, views: [{ showGridLines: false, state: "frozen", xSplit: 5, ySplit: 6 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const widths: Record<string, number> = { A: 14.5, B: 21.5, C: 20, D: 23.2, E: 41.3, F: 23.5, G: 13.5, H: 16.5, I: 15.3, J: 14.5, K: 15.5, L: 14.5, M: 13, N: 13, O: 13, P: 14.7, Q: 14.5, R: 2.5, S: 14.5, T: 13, U: 13, V: 13, W: 13, X: 13, Y: 13, Z: 13, AA: 13, AB: 2.5, AC: 14.5 };
  for (const [l, w] of Object.entries(widths)) ws.getColumn(colIndex(l)).width = w;
  for (let i = colIndex("AD"); i <= colIndex("AS"); i++) ws.getColumn(i).width = 13;
  if (opts.linked) for (const l of ["A", "F", "G"]) ws.getColumn(colIndex(l)).hidden = true;
  titleRows(ws, e, false);
  ws.getCell("J3").value = "Approved Contract Changes";
  ws.getCell("J3").font = { ...ARIAL, bold: true };
  // row 4: the two halves of the sheet
  ws.mergeCells("F4:M4");
  ws.getCell("F4").value = "As Per Head Office Cost Report";
  headCell(ws.getCell("F4"), NOTE_FILL);
  ws.getCell("F4").border = { top: { style: "medium" }, left: { style: "medium" }, bottom: { style: "medium" }, right: { style: "medium" } };
  ws.mergeCells("N4:P5");
  ws.getCell("N4").value = "SITE FORECAST";
  headCell(ws.getCell("N4"), HEAD_SITE_FILL);
  ws.getCell("N4").border = { top: { style: "medium" }, left: { style: "medium" }, bottom: { style: "medium" }, right: { style: "medium" } };
  ws.mergeCells("S4:AS4");
  // row 5: the column letters of the head office report and the group headings
  ws.getCell("A5").value = "Level 02 Summary";
  ws.getCell("A5").font = { ...ARIAL, bold: true };
  const letters: [string, string][] = [["H", "Column G"], ["I", "Column H"], ["J", "Column I"], ["K", "Column J"], ["L", "Column K"], ["M", "Column L"]];
  for (const [col, label] of letters) {
    ws.getCell(`${col}5`).value = label;
    ws.getCell(`${col}5`).font = { ...ARIAL, italic: true, color: { argb: "FF595959" } };
    ws.getCell(`${col}5`).alignment = { horizontal: "center" };
  }
  ws.mergeCells("S5:Z5");
  ws.getCell("S5").value = "EARLY WARNINGS (KNOWN BUT NOT COMMITTED)";
  headCell(ws.getCell("S5"), HEAD_USE_FILL);
  ws.mergeCells("AD5:AS5");
  ws.getCell("AD5").value = "Uncommitted utilisation by month (site to complete)";
  headCell(ws.getCell("AD5"), HEAD_USE_FILL);
  ws.getRow(4).height = 18;
  ws.getRow(5).height = 28;
  // row 6: the headings
  const heads: [string, string][] = [
    ["A", "Program"], ["B", "Asset"], ["C", "Sub-category"], ["D", "Contract Code"], ["E", "Name"],
    ["F", "Previous Approved Budget"], ["G", "Approved Budget Transfers"], ["H", "Currently Approved Budget"], ["I", "Contracts"], ["J", "DVO's"], ["K", "Committed"], ["L", "Uncommitted"], ["M", "PVO's "],
    ["N", "Early Warnings"], ["O", "Budget to Release [Not Required]"], ["P", "Final Account"], ["Q", "Variance"],
    ["S", "VO Under Process"], ["T", "EOT Claims"], ["U", "Other Claims"], ["V", "Final Account Adjustment"], ["W", "Identified Uncommited Scope"], ["X", "Plant Supply"], ["Y", "FF&E"], ["Z", "BT to other Asset"], ["AA", "UNCOMMITED/ NOT REQUIRED"],
    ["AC", "Total Uncommitted Utilisation"],
  ];
  const siteCols = ["N", "O", "P", "Q"];
  const useCols = ["S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AC"];
  for (const [col, label] of heads) {
    const c = ws.getCell(`${col}6`);
    c.value = label;
    headCell(c, siteCols.includes(col) ? HEAD_SITE_FILL : useCols.includes(col) ? HEAD_USE_FILL : HEAD_FILL, ARIAL, ["A", "B", "C", "D", "E", "F"].includes(col) ? "left" : "center");
  }
  // the months across AD:AS, from the report month
  const [mon, yy] = e.month.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let mi = Math.max(0, months.indexOf(mon));
  let year = 2000 + Number(yy);
  for (let i = colIndex("AD"); i <= colIndex("AS"); i++) {
    const c = ws.getCell(6, i);
    c.value = new Date(Date.UTC(year, mi, 1));
    c.numFmt = "[$-409]mmm\\-yy;@";
    headCell(c, HEAD_USE_FILL);
    mi++;
    if (mi === 12) {
      mi = 0;
      year++;
    }
  }
  ws.getRow(6).height = 43.5;

  let row = 7;
  const subtotalRows: number[] = [];
  const firstRow = row;
  for (const a of e.assets) {
    const start = row;
    for (const l of a.lines) {
      const r = ws.getRow(row);
      r.height = 32;
      const put = (col: string, v: ExcelJS.CellValue, money = false, align?: "left" | "right" | "center") => {
        const c = ws.getCell(`${col}${row}`);
        c.value = v;
        bodyCell(c, ARIAL, money, align);
        return c;
      };
      put("A", l.program);
      put("B", l.asset);
      put("C", l.subCategory);
      const code = put("D", l.contractCode);
      code.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF000000" } };
      code.fill = solid(CODE_FILL);
      put("E", l.name);
      put("F", l.previousBudget, true);
      put("G", f(`H${row}-F${row}`, l.currentBudget - l.previousBudget), true);
      put("H", l.currentBudget, true);
      put("I", l.contracts, true);
      put("J", opts.linked ? f(`SUMIF(DVOs!C:C,E${row},DVOs!E:E)`, l.dvos) : l.dvos, true);
      put("K", f(`SUM(I${row}:J${row})`, l.contracts + l.dvos), true);
      put("L", f(`H${row}-K${row}`, l.currentBudget - l.contracts - l.dvos), true);
      put("M", opts.linked ? f(`SUMIF(PVOs!C:C,E${row},PVOs!E:E)`, l.pvos) : l.pvos, true);
      const use: Record<EacColumn, number> = { voUnderProcess: 0, eotClaims: 0, otherClaims: 0, finalAccount: 0, uncommittedScope: 0, plantSupply: 0, ffe: 0, btOtherAsset: 0, notRequired: 0 };
      for (const w of e.ews) if (w.vendor === l.name) use[w.column] += w.value;
      const used = EAC_COLUMNS.reduce((t, c) => t + (c.key === "notRequired" ? 0 : use[c.key]), 0);
      put("N", f(`(AC${row}-AA${row})*-1`, -used), true);
      put("O", f(`AA${row}*-1`, 0), true);
      put("P", f(`SUM(K${row}:O${row})`, l.currentBudget + l.pvos - used), true);
      put("Q", f(`P${row}-H${row}`, l.pvos - used), true);
      for (const c of EAC_COLUMNS) {
        const col = USE_LETTERS[c.key];
        if (c.key === "notRequired") put(col, 0, true);
        else if (!opts.linked) put(col, use[c.key], true);
        else put(col, f(`SUMIF(${q(BREAKDOWN)}!$C:$C,$E${row},${q(BREAKDOWN)}!${BREAKDOWN_LETTERS[c.key]}:${BREAKDOWN_LETTERS[c.key]})`, use[c.key]), true);
      }
      put("AC", f(`SUM(S${row}:AA${row})`, used), true);
      for (let i = colIndex("AD"); i <= colIndex("AS"); i++) bodyCell(ws.getCell(row, i), ARIAL, true);
      row++;
    }
    const end = row - 1;
    // the asset's sub-total
    const r = ws.getRow(row);
    r.height = 32;
    for (let i = 1; i <= colIndex("AS"); i++) subtotalCell(ws.getCell(row, i), ARIAL, i >= 6);
    ws.getCell(`A${row}`).value = "Sub-Total ";
    ws.getCell(`B${row}`).value = a.name;
    ws.getCell(`E${row}`).value = "Sub-Total Development Cost";
    const sumCols = ["F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AC"];
    for (const col of sumCols) ws.getCell(`${col}${row}`).value = f(`SUM(${col}${start}:${col}${end})`, 0);
    for (let i = colIndex("AD"); i <= colIndex("AS"); i++) ws.getCell(row, i).value = f(`SUM(${colLetter(i)}${start}:${colLetter(i)}${end})`, 0);
    ws.getCell(`Q${row}`).value = f(`P${row}-H${row}`, 0);
    subtotalRows.push(row);
    row++;
  }
  return { subtotalRows, firstRow, lastRow: row - 1 };
}

/* ------------------------------------------------------------------ */
/* Level 01                                                            */

function level01(ws: ExcelJS.Worksheet, e: BudgetEac, ref: Level02Ref) {
  const font = { name: "Arial Narrow", size: 10 };
  const widths = [37.5, ...e.assets.map(() => 17.5), 21.5, 6.5];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  titleRows(ws, e, true, font);
  const nA = e.assets.length;
  const totalCol = colLetter(nA + 2);
  const lastAssetCol = colLetter(nA + 1);
  ws.getCell("A5").value = "Level 01 Summary";
  ws.getCell("A5").font = { ...font, bold: true };
  ws.getCell("A6").value = e.programme.code;
  headCell(ws.getCell("A6"), HEAD_FILL, font, "left");
  e.assets.forEach((a, i) => {
    const c = ws.getCell(6, i + 2);
    c.value = a.name;
    headCell(c, HEAD_FILL, font);
  });
  ws.getCell(`${totalCol}6`).value = `Total \n${e.programme.code}`;
  headCell(ws.getCell(`${totalCol}6`), HEAD_FILL, font);
  for (let i = 2; i <= nA + 2; i++) {
    const c = ws.getCell(7, i);
    c.value = "SAR";
    c.font = { ...font, italic: true };
    c.alignment = { horizontal: "center" };
  }
  ws.getRow(6).height = 30;
  const L2 = q(LEVEL02);
  const line = (r: number, label: string, col: string | null, opts: { bold?: boolean; head?: boolean; sumRows?: [number, number]; diff?: [number, number]; values?: (number | null)[]; red?: boolean } = {}) => {
    const a = ws.getCell(`A${r}`);
    a.value = label;
    a.font = { ...font, bold: !!opts.bold || !!opts.head };
    a.border = BOX;
    if (opts.head) a.fill = solid(HEAD_FILL);
    if (opts.head) return;
    e.assets.forEach((_, i) => {
      const c = ws.getCell(r, i + 2);
      const letter = colLetter(i + 2);
      if (col) c.value = f(`${L2}!${col}${ref.subtotalRows[i]}`, 0);
      else if (opts.sumRows) c.value = f(`SUM(${letter}${opts.sumRows[0]}:${letter}${opts.sumRows[1]})`, 0);
      else if (opts.diff) c.value = f(`${letter}${opts.diff[0]}-${letter}${opts.diff[1]}`, 0);
      else if (opts.values) c.value = opts.values[i];
      c.numFmt = ACC_FMT;
      c.font = { ...font, bold: !!opts.bold, color: opts.red ? { argb: "FFFF0000" } : undefined };
      c.alignment = { horizontal: "center" };
    });
    const t = ws.getCell(`${totalCol}${r}`);
    if (opts.sumRows) t.value = f(`SUM(${totalCol}${opts.sumRows[0]}:${totalCol}${opts.sumRows[1]})`, 0);
    else if (opts.diff) t.value = f(`${totalCol}${opts.diff[0]}-${totalCol}${opts.diff[1]}`, 0);
    else if (opts.values && opts.values.every((v) => v === null)) t.value = null;
    else t.value = f(`SUM(B${r}:${lastAssetCol}${r})`, 0);
    t.numFmt = ACC_FMT;
    t.font = { ...font, bold: !!opts.bold, color: opts.red ? { argb: "FFFF0000" } : undefined };
    t.alignment = { horizontal: "center" };
  };
  line(9, "Currently Approved Development Budget", "H");
  line(11, "Commitments", null, { head: true });
  line(12, "Contract Awards", "I");
  line(13, "DVOs", "J");
  line(15, "Potential Out-Turn Costs", null, { head: true });
  line(16, "PVOs", "M");
  line(17, "Early Warnings", "N");
  line(19, "CTC", null, { head: true });
  line(20, "Uncommitted Future Costs", "L");
  line(21, "Budget to Release", "O");
  line(24, "Site EAC", null, { bold: true, sumRows: [11, 23] });
  line(26, "Variance to Approved Budget", null, { bold: true, diff: [24, 9], red: true });
  line(28, "Last Month Anticipated EAC", null, { bold: true, values: e.assets.map((a) => a.lastMonthEac) });
  line(30, "Variance to Last Month ", null, { bold: true, diff: [24, 28] });
  ws.getCell("A32").value = "Reasons for Variance";
  ws.getCell("A32").font = { ...font, bold: true };
  ws.getCell("A32").border = BOX;
  ws.mergeCells(33, 1, 38, nA + 2);
  ws.getCell("A33").alignment = { wrapText: true, vertical: "top" };
  ws.getCell("A33").border = BOX;
  ws.getCell("A33").font = font;
  // the line the dashboard itself carries, for the reader's check
  const r = 41;
  ws.getCell(`A${r}`).value = "Dashboard anticipated final account (column N), for comparison";
  ws.getCell(`A${r}`).font = { ...font, italic: true, color: { argb: "FF595959" } };
  e.assets.forEach((a, i) => {
    const c = ws.getCell(r, i + 2);
    c.value = Math.round(a.lines.reduce((t, l) => t + l.dashboardEac, 0) * 100) / 100;
    c.numFmt = ACC_FMT;
    c.font = { ...font, italic: true, color: { argb: "FF595959" } };
    c.alignment = { horizontal: "center" };
  });
  const t = ws.getCell(`${totalCol}${r}`);
  t.value = f(`SUM(B${r}:${lastAssetCol}${r})`, 0);
  t.numFmt = ACC_FMT;
  t.font = { ...font, italic: true, color: { argb: "FF595959" } };
  t.alignment = { horizontal: "center" };
}

/* ------------------------------------------------------------------ */
/* the schedules                                                       */

function schedule(wb: ExcelJS.Workbook, e: BudgetEac, name: "DVOs" | "PVOs" | "UC", rows: BudgetEac["dvos"]) {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: PURPLE } }, views: [{ showGridLines: false }] });
  const font = { name: "Arial", size: 10 };
  [26.5, 21.5, 44.5, 28, 18.5, 50.5, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  titleRows(ws, e, false, font);
  const title = name === "DVOs" ? "DVOs (Approved) Schedule" : name === "PVOs" ? "PVOs (Approved) Schedule" : "Pending Contracts (Contracts under approval) Schedule";
  const titleRow = name === "UC" ? 6 : 5;
  ws.getCell(`A${titleRow}`).value = title;
  ws.getCell(`A${titleRow}`).font = { ...font, bold: true };
  const headRow = titleRow + 1;
  const refLabel = name === "DVOs" ? "DVO Reference" : name === "PVOs" ? "PVO Reference" : "UC Reference";
  const valLabel = name === "DVOs" ? "DVO Value" : name === "PVOs" ? "PVO Value" : "UC Value";
  const descLabel = name === "DVOs" ? "DVO Description" : name === "PVOs" ? "PVO Description" : "Description";
  const heads = ["Asset", "Sub-category", "Vendor [Same names as in Column D Level 02 Tab]", refLabel, valLabel, descLabel, "Notes"];
  heads.forEach((h, i) => {
    const c = ws.getCell(headRow, i + 1);
    c.value = h;
    headCell(c, HEAD_FILL, font, i < 3 ? "left" : "center");
  });
  ws.getRow(headRow).height = 30;
  let row = headRow + 1;
  const byAsset = new Map<string, typeof rows>();
  for (const r of rows) byAsset.set(r.asset, [...(byAsset.get(r.asset) ?? []), r]);
  for (const [asset, list] of byAsset) {
    const start = row;
    for (const r of list) {
      const vals: ExcelJS.CellValue[] = [r.asset, r.subCategory, r.vendor, r.ref, r.value, r.description, r.notes];
      vals.forEach((v, i) => {
        const c = ws.getCell(row, i + 1);
        c.value = v;
        bodyCell(c, font, i === 4);
      });
      row++;
    }
    for (let i = 1; i <= 7; i++) subtotalCell(ws.getCell(row, i), font, i === 5);
    ws.getCell(`A${row}`).value = `${asset} Total`;
    ws.getCell(`D${row}`).value = f(`SUBTOTAL(3,D${start}:D${row - 1})`, list.length);
    ws.getCell(`E${row}`).value = f(`SUBTOTAL(9,E${start}:E${row - 1})`, list.reduce((t, r) => t + r.value, 0));
    row++;
  }
  if (!rows.length) {
    const c = ws.getCell(row, 1);
    c.value = name === "UC" ? "No pending contracts are kept on the dashboard – add any contract under approval here (asset, sub-category, vendor as on Level 02, reference, value, description)." : `No ${name === "DVOs" ? "approved DVOs" : "PVOs or VOs under process"} are carried in this report's cost report.`;
    c.font = { ...font, italic: true, color: { argb: "FF595959" } };
  }
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: headRow }];
}

function breakdown(wb: ExcelJS.Workbook, e: BudgetEac) {
  const ws = wb.addWorksheet(BREAKDOWN, { properties: { tabColor: { argb: PURPLE } }, views: [{ showGridLines: false, state: "frozen", ySplit: 6 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const font = { name: "Calibri Light", size: 9 };
  [35, 20, 44, 14, 14, 46, 30, 44, 13, 13, 13, 13, 13, 13, 13, 13, 13].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  titleRows(ws, e, false, font);
  ws.getCell("A5").value = "Early Warnings";
  ws.getCell("A5").font = { ...font, bold: true };
  const heads = ["Asset", "Sub category", "Vendor [Same names as in Column D Level 02 Tab]", "EW Reference", "EW Value", "Description of Early Warning", "Notes", "Related contract", ...EAC_COLUMNS.map((c) => c.label)];
  heads.forEach((h, i) => {
    const c = ws.getCell(6, i + 1);
    c.value = h;
    headCell(c, i >= 8 ? HEAD_USE_FILL : HEAD_FILL, i >= 8 ? ARIAL : font, i < 3 || i === 5 || i === 6 || i === 7 ? "left" : "center");
  });
  ws.getRow(6).height = 36;
  let row = 7;
  const byAsset = new Map<string, BudgetEac["ews"]>();
  for (const r of e.ews) byAsset.set(r.asset, [...(byAsset.get(r.asset) ?? []), r]);
  for (const [asset, list] of byAsset) {
    for (let i = 1; i <= 17; i++) subtotalCell(ws.getCell(row, i), font, i >= 9);
    ws.getCell(`A${row}`).value = asset;
    row++;
    for (const r of list) {
      const vals: ExcelJS.CellValue[] = [r.asset, r.subCategory, r.vendor, r.ref, r.value, r.description, [r.source, r.notes].filter(Boolean).join(" · "), r.relatedContract];
      vals.forEach((v, i) => {
        const c = ws.getCell(row, i + 1);
        c.value = v;
        bodyCell(c, font, i === 4);
      });
      for (const c of EAC_COLUMNS) {
        const cell = ws.getCell(`${BREAKDOWN_LETTERS[c.key]}${row}`);
        cell.value = c.key === r.column ? f(`E${row}`, r.value) : null;
        bodyCell(cell, font, true);
      }
      row++;
    }
  }
  if (!e.ews.length) {
    const c = ws.getCell(row, 1);
    c.value = "No open early warnings, claims or requests for change are carried in this report's cost report.";
    c.font = { ...font, italic: true, color: { argb: "FF595959" } };
  }
}

function notesSheet(wb: ExcelJS.Workbook, e: BudgetEac, d: ReportData) {
  const ws = wb.addWorksheet("Read me", { properties: { tabColor: { argb: "FF808080" } }, views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 150;
  const put = (text: string, bold = false) => {
    const r = ws.addRow([text]);
    r.getCell(1).font = { ...ARIAL, bold };
    r.getCell(1).alignment = { wrapText: true, vertical: "top" };
    return r;
  };
  put(`${e.programme.name} (${e.programme.code}) – Budget EAC workbook – ${e.periodLabel}`, true);
  put(`Produced by ${APP_NAME} on ${new Date().toISOString().slice(0, 10)} from the report's own registers${d.locked ? " (issued report)" : " (draft report)"}. The layout, formulas and hidden columns follow the head office template "Programme XX Budget EAC - NEW".`);
  ws.addRow([]);
  put("How the figures are filled", true);
  for (const n of e.notes) put(`• ${n}`);
  ws.addRow([]);
  put("What to check before sending", true);
  put("• Level 02 column AA (UNCOMMITED / NOT REQUIRED): enter what you intend to release on each line; Budget to Release and the Final Account follow.");
  put("• Early Warning Breakdown: move any amount to another column if its wording was sorted wrongly, and add the final account adjustments and transfers to other assets.");
  put("• UC tab: list any contract under approval.");
  put("• Level 01 'Reasons for Variance': write the narrative.");
}

/** The Level 02 sheet on its own, in a report download: the template's layout, the figures as values. */
export function level02R1Sheet(wb: ExcelJS.Workbook, d: ReportData) {
  const e = buildBudgetEac(d);
  level02(wb, e, { linked: false, name: "Level 02 (R1)" });
  const ws = wb.getWorksheet("Level 02 (R1)")!;
  const r = ws.rowCount + 2;
  const put = (text: string, bold = false) => {
    const c = ws.getCell(r + (bold ? 0 : 1), 2);
    c.value = text;
    c.font = { ...ARIAL, bold, italic: !bold, color: { argb: "FF595959" } };
  };
  put(`Level 02 (R1) – ${e.programme.name} – ${e.periodLabel}: the head office "Budget EAC" layout, filled from the dashboard. DVOs, PVOs and the uncommitted utilisation are written as values here; the full workbook with the schedule tabs is on the Reports page.`, true);
  put(e.notes.slice(0, 3).join(" "));
  ws.mergeCells(r, 2, r, 17);
  ws.mergeCells(r + 1, 2, r + 1, 17);
  ws.getRow(r).height = 30;
  ws.getRow(r + 1).height = 60;
  ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
  ws.getCell(r + 1, 2).alignment = { wrapText: true, vertical: "top" };
}

export async function renderBudgetEacWorkbook(d: ReportData): Promise<{ buffer: Buffer; fileName: string }> {
  const e = buildBudgetEac(d);
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const l1 = wb.addWorksheet("Level 01", { properties: { tabColor: { argb: PURPLE } }, views: [{ showGridLines: false }] });
  const ref = level02(wb, e);
  level01(l1, e, ref);
  schedule(wb, e, "DVOs", e.dvos);
  schedule(wb, e, "PVOs", e.pvos);
  schedule(wb, e, "UC", []);
  breakdown(wb, e);
  notesSheet(wb, e, d);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const fileName = `${e.yyyymm} Programme ${e.programme.code} Budget EAC${d.locked ? "" : " DRAFT"}.xlsx`;
  return { buffer, fileName };
}
