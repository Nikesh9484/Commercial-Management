import ExcelJS from "exceljs";
import { APP_NAME } from "./brand";

/**
 * One look for every Excel download: navy title band, coloured table headers, zebra rows, thin
 * borders, number / date formats, frozen header, autofilter, status colouring, SUM formulas,
 * sheet tab colours, print setup and hyperlinks. Every file stays fully editable in Excel.
 */
export const XL = {
  navy: "FF0F2B4C",
  navyLight: "FF1F4F8F",
  accent: "FF2F80ED",
  white: "FFFFFFFF",
  ink: "FF172033",
  muted: "FF5B6577",
  zebra: "FFF3F6FB",
  line: "FFD9DEE8",
  totalFill: "FFDCE6F2",
  subtotalFill: "FFEEF3FA",
  sectionFill: "FFE8EEF7",
  green: "FFDCFCE7",
  greenInk: "FF047857",
  amber: "FFFEF3C7",
  amberInk: "FF92400E",
  red: "FFFEE2E2",
  redInk: "FFB91C1C",
  blue: "FFDBEAFE",
  grey: "FFE5E7EB",
};

export const MONEY_FMT = "#,##0.00;[Red]-#,##0.00";
export const INT_FMT = "#,##0;[Red]-#,##0";
export const PCT_FMT = "0.0%";
export const DATE_FMT = "DD-MMM-YY";

const TAB_COLOURS = ["FF2F80ED", "FF0F9D58", "FFF4B400", "FFDB4437", "FF7B61FF", "FF00A3A3", "FFE8710A", "FF8E24AA"];

export const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin: ExcelJS.Border = { style: "thin", color: { argb: XL.line } };
export const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };

interface TableMark {
  headerRow: number;
  /** Last data row (set later); when missing the table runs until the first blank row. */
  lastRow?: number;
  zebra: boolean;
  filter: boolean;
}
const marks = new WeakMap<ExcelJS.Worksheet, TableMark[]>();
const links = new WeakMap<ExcelJS.Workbook, { url: string; label: string } | undefined>();

/** Remember the dashboard URL the file was downloaded from, so every sheet can link back. */
export function setWorkbookLink(wb: ExcelJS.Workbook, link?: { url: string; label: string }) {
  links.set(wb, link);
}

/** Title band: big white title on navy, subtitle line, optional "Open in dashboard" link. Returns the next free row. */
export function titleBlock(ws: ExcelJS.Worksheet, title: string, subtitle?: string, span = 8): number {
  const wb = ws.workbook;
  const link = links.get(wb);
  const t = ws.addRow([title]);
  t.height = 30;
  t.font = { bold: true, size: 16, color: { argb: XL.white } };
  t.alignment = { vertical: "middle" };
  for (let c = 1; c <= span; c++) t.getCell(c).fill = solid(XL.navy);
  try {
    ws.mergeCells(t.number, 1, t.number, Math.max(1, span - (link ? 2 : 0)));
  } catch {
    /* already merged */
  }
  if (link) {
    const cell = t.getCell(span - 1);
    cell.value = { text: link.label, hyperlink: link.url, tooltip: `Open ${link.label} in ${APP_NAME}` };
    cell.font = { color: { argb: "FFBFDBFE" }, underline: true, size: 10 };
    cell.alignment = { horizontal: "right", vertical: "middle" };
    try {
      ws.mergeCells(t.number, span - 1, t.number, span);
    } catch {
      /* ignore */
    }
  }
  if (subtitle) {
    const s = ws.addRow([subtitle]);
    s.font = { italic: true, color: { argb: XL.muted }, size: 10 };
    for (let c = 1; c <= span; c++) s.getCell(c).fill = solid(XL.sectionFill);
    try {
      ws.mergeCells(s.number, 1, s.number, span);
    } catch {
      /* ignore */
    }
  }
  ws.addRow([]);
  return ws.rowCount + 1;
}

/** A coloured section heading inside a sheet. */
export function sectionRow(ws: ExcelJS.Worksheet, text: string, span = 6, argb = XL.navy): ExcelJS.Row {
  const r = ws.addRow([text]);
  r.font = { bold: true, size: 12, color: { argb: XL.white } };
  r.height = 20;
  r.alignment = { vertical: "middle" };
  for (let c = 1; c <= span; c++) r.getCell(c).fill = solid(argb);
  try {
    ws.mergeCells(r.number, 1, r.number, span);
  } catch {
    /* ignore */
  }
  return r;
}

/** Styles a header row and registers the table that starts below it (zebra rows, borders, filter applied in finish()). */
export function headerRow(row: ExcelJS.Row, opts: { zebra?: boolean; filter?: boolean; height?: number } = {}): ExcelJS.Row {
  row.font = { bold: true, color: { argb: XL.white }, size: 10 };
  row.alignment = { wrapText: true, vertical: "middle" };
  row.height = opts.height ?? 32;
  row.eachCell({ includeEmpty: false }, (c) => {
    c.fill = solid(XL.navy);
    c.border = { ...BORDER, bottom: { style: "medium", color: { argb: XL.accent } } };
  });
  const ws = row.worksheet;
  const list = marks.get(ws) ?? [];
  list.push({ headerRow: row.number, zebra: opts.zebra ?? true, filter: opts.filter ?? true });
  marks.set(ws, list);
  return row;
}

/** Bold total row with a coloured fill. */
export function totalRow(row: ExcelJS.Row, fill = XL.totalFill, ink = XL.navy): ExcelJS.Row {
  row.font = { bold: true, color: { argb: ink } };
  row.eachCell({ includeEmpty: true }, (c) => {
    c.fill = solid(fill);
    c.border = { ...BORDER, top: { style: "medium", color: { argb: XL.navy } } };
  });
  return row;
}

/** Excel column letter for a 1-based index. */
export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** =SUM(col from..to) formula with a pre-computed result so viewers without recalculation still see the value. */
export function sumFormula(col: number, from: number, to: number, result?: number): ExcelJS.CellFormulaValue {
  const L = colLetter(col);
  return { formula: `SUM(${L}${from}:${L}${to})`, result: result ?? 0 };
}

export function formula(text: string, result?: number | string | null): ExcelJS.CellFormulaValue {
  return { formula: text, result: result === null ? undefined : result };
}

const STATUS_TONES: [RegExp, string, string][] = [
  [/^(approved|closed|done|paid|active|yes|ok|determined|released|complete|completed|signed|review complete|green)\b/i, XL.green, XL.greenInk],
  [/^(pending|open|expiring|in progress|revised|awaiting|mitigating|superseded|amber|draft|not done)\b/i, XL.amber, XL.amberInk],
  [/^(rejected|expired|overdue|late|cancelled|canceled|terminated|no|red|failed|disputed|suspended)\b/i, XL.red, XL.redInk],
];

/** Colours a cell by its status-like text (Approved green, Pending amber, Rejected red …). */
export function statusFill(cell: ExcelJS.Cell) {
  const v = String(cell.value ?? "").trim();
  if (!v) return;
  for (const [re, fill, ink] of STATUS_TONES) {
    if (re.test(v)) {
      cell.fill = solid(fill);
      cell.font = { ...(cell.font ?? {}), color: { argb: ink }, bold: true };
      cell.alignment = { ...(cell.alignment ?? {}), horizontal: "center" };
      return;
    }
  }
}

/** Colours a "days" cell: red when negative (overdue), amber up to `warn` days. */
export function daysFill(cell: ExcelJS.Cell, warn = 60) {
  const v = cell.value;
  if (typeof v !== "number") return;
  if (v < 0) {
    cell.fill = solid(XL.red);
    cell.font = { color: { argb: XL.redInk }, bold: true };
  } else if (v <= warn) {
    cell.fill = solid(XL.amber);
    cell.font = { color: { argb: XL.amberInk } };
  }
}

const STATUS_HEADERS = /^(status|overall status|current status|stage|current stage|approved|bank verification|applied|notice within|detail within|complies|paid|released|on distribution|done)/i;
const DAYS_HEADERS = /^(days to expiry|days remaining|days open|days|dvo days remaining|days to due)/i;

/**
 * Final pass for a sheet: zebra rows, thin borders and status colours on every registered table,
 * autofilter on the first table, frozen header, tab colour, print setup and a link back to the Index.
 */
export function finishSheet(ws: ExcelJS.Worksheet, opts: { freezeCols?: number; tabIndex?: number; indexSheet?: string } = {}) {
  const list = marks.get(ws) ?? [];
  list.sort((a, b) => a.headerRow - b.headerRow);
  list.forEach((m, i) => {
    const next = list[i + 1]?.headerRow ?? ws.rowCount + 1;
    let last = m.headerRow;
    for (let r = m.headerRow + 1; r < next; r++) {
      const row = ws.getRow(r);
      if (!row.hasValues) break;
      last = r;
    }
    m.lastRow = last;
    const hdr = ws.getRow(m.headerRow);
    const colCount = hdr.cellCount;
    const statusCols: number[] = [];
    const dayCols: number[] = [];
    hdr.eachCell({ includeEmpty: false }, (c, i2) => {
      const label = String(c.value ?? "");
      if (STATUS_HEADERS.test(label)) statusCols.push(i2);
      if (DAYS_HEADERS.test(label)) dayCols.push(i2);
    });
    for (let r = m.headerRow + 1; r <= last; r++) {
      const row = ws.getRow(r);
      const isTotal = row.font?.bold && row.getCell(1).fill && (row.getCell(1).fill as ExcelJS.FillPattern).fgColor;
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        cell.border = { ...(cell.border ?? {}), ...BORDER };
        if (!isTotal && m.zebra && (r - m.headerRow) % 2 === 0 && !cell.fill) cell.fill = solid(XL.zebra);
        if (cell.alignment === undefined || cell.alignment === null) cell.alignment = { vertical: "top", wrapText: typeof cell.value === "string" && String(cell.value).length > 60 };
      }
      if (!isTotal) {
        for (const c of statusCols) statusFill(row.getCell(c));
        for (const c of dayCols) daysFill(row.getCell(c));
      }
    }
  });
  const first = list[0];
  if (first && first.filter && first.lastRow && first.lastRow > first.headerRow) {
    ws.autoFilter = { from: { row: first.headerRow, column: 1 }, to: { row: first.lastRow, column: ws.getRow(first.headerRow).cellCount } };
    ws.views = [{ state: "frozen", xSplit: opts.freezeCols ?? 0, ySplit: first.headerRow, showGridLines: true }];
    ws.pageSetup = { ...(ws.pageSetup ?? {}), printTitlesRow: `${first.headerRow}:${first.headerRow}` };
  }
  ws.pageSetup = { ...(ws.pageSetup ?? {}), orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  ws.headerFooter = { oddFooter: `&L${APP_NAME}&C${ws.name}&RPage &P of &N` };
  ws.properties.tabColor = { argb: TAB_COLOURS[(opts.tabIndex ?? 0) % TAB_COLOURS.length] };
  if (opts.indexSheet && ws.name !== opts.indexSheet) {
    const cell = ws.getCell(1, Math.max(ws.columnCount, 2));
    if (!cell.value) {
      cell.value = { text: "◀ Index", hyperlink: `#'${opts.indexSheet}'!A1` };
      cell.font = { color: { argb: "FFBFDBFE" }, underline: true, size: 10 };
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
  }
}

/** Runs finishSheet on every worksheet of the workbook. */
export function finishWorkbook(wb: ExcelJS.Workbook, opts: { indexSheet?: string; freeze?: Record<string, number> } = {}) {
  wb.worksheets.forEach((ws, i) => finishSheet(ws, { tabIndex: i, indexSheet: opts.indexSheet, freezeCols: opts.freeze?.[ws.name] }));
  wb.creator = APP_NAME;
  wb.lastModifiedBy = APP_NAME;
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
}

/** Column number formats by field type. */
export function applyColumnFormat(col: ExcelJS.Column, type: string) {
  if (type === "money") col.numFmt = MONEY_FMT;
  else if (type === "number") col.numFmt = "#,##0.##;[Red]-#,##0.##";
  else if (type === "percent") col.numFmt = "0.00";
  else if (type === "date") col.numFmt = DATE_FMT;
}
