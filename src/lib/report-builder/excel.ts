import ExcelJS from "exceljs";
import { APP_NAME } from "../brand";
import { formatDate, toDate } from "../format";
import type { RecordRow } from "../registers/types";
import type { BuiltReport, ResultColumn } from "./build";

/**
 * The Excel of a custom report. Two sheets on purpose: "Report" is the presented version with the
 * headline, the figures and the subtotals; "Data" is the same records flat – one header row, no
 * merged cells, no subtotals – so it can be filtered and pivoted without unpicking anything. Numbers
 * are written as numbers with real Excel formats (never as text), so totals and pivots work.
 */

const NAVY = "FF0F2B4C";
const MUTED = "FF5B6577";
const BAND = "FFEFF6FF";
const LINE = "FFD9DEE8";
/** Accounting style: thousands, negatives in brackets, nothing shown for zero. */
const MONEY = '#,##0;(#,##0);"–"';
const NUMBER = '#,##0;(#,##0);"–"';
const PERCENT = '0.0"%";(0.0)"%";"–"';
const DATE_FMT = "DD-MMM-YY";
/** Okabe-Ito, so the flags survive a colour-blind reader and a greyscale photocopier. */
const TONE_FILL: Record<string, string> = { red: "FFFDE7DC", amber: "FFFDF3DC", green: "FFDFF5EC" };
const TONE_FONT: Record<string, string> = { red: "FF8A3D00", amber: "FF7A5400", green: "FF00573F" };

export async function renderBuilderExcel(r: BuiltReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  wb.created = new Date();
  reportSheet(wb, r);
  dataSheet(wb, r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ------------------------------------------------------------------ the presented sheet */

function reportSheet(wb: ExcelJS.Workbook, r: BuiltReport) {
  const ws = wb.addWorksheet("Report", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } } });
  ws.getColumn(1).width = 34;
  for (let i = 2; i <= Math.max(6, r.columns.length + 1); i++) ws.getColumn(i).width = 18;

  const t = ws.addRow([r.title]);
  t.font = { bold: true, size: 15, color: { argb: NAVY } };
  for (const line of r.subtitle) ws.addRow([line]).font = { size: 9, color: { argb: MUTED } };
  ws.addRow([]);

  const h = ws.addRow([r.headline]);
  h.font = { bold: true, size: 11, color: { argb: NAVY } };
  h.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
  h.alignment = { wrapText: true, vertical: "top" };
  h.height = Math.min(60, 14 * Math.ceil(r.headline.length / 110));
  if (r.notes) ws.addRow([r.notes]).font = { italic: true, size: 10 };
  if (r.filterSummary.length) ws.addRow([`Filtered to: ${r.filterSummary.join(" · ")}`]).font = { size: 9, color: { argb: MUTED } };
  ws.addRow([]);

  if (r.kpis.length) {
    sectionTitle(ws, "Headline figures");
    headerRow(ws, ["Measure", "Value", "Note"]);
    for (const k of r.kpis) ws.addRow([k.label, k.value, k.note ?? ""]);
    ws.addRow([]);
  }

  for (const p of r.narrative) {
    sectionTitle(ws, p.heading);
    const row = ws.addRow([p.text]);
    row.alignment = { wrapText: true, vertical: "top" };
    row.height = Math.min(140, 13 * Math.ceil(p.text.length / 110));
    ws.addRow([]);
  }

  if (r.attention.length) {
    sectionTitle(ws, "Needs attention");
    for (const a of r.attention) {
      const row = ws.addRow([`• ${a}`]);
      row.alignment = { wrapText: true, vertical: "top" };
      row.height = Math.min(70, 13 * Math.ceil(a.length / 110));
    }
    ws.addRow([]);
  }

  if (r.breakdown?.bands.length) {
    sectionTitle(ws, `By ${r.breakdown.label.toLowerCase()}`);
    bandBlock(ws, r.breakdown.bands);
  }
  if (r.ageing?.bands.length) {
    sectionTitle(ws, `Ageing – ${r.ageing.label.toLowerCase()}`, r.ageMode === "since" ? `Counted back from ${r.ageing.label.toLowerCase()}.` : "Counted from the date each item falls due.");
    bandBlock(ws, r.ageing.bands);
  }

  if (r.columns.length) {
    sectionTitle(ws, r.groups ? `Detail by ${r.groupLabel?.toLowerCase() ?? "group"}` : "Detail", `${r.count.toLocaleString("en-US")} record(s)${r.limited ? " – trimmed to the limit set" : ""}.`);
    const head = headerRow(ws, r.columns.map((c) => c.label));
    alignNumeric(head, r.columns);
    const firstDataRow = ws.rowCount + 1;
    if (r.groups) {
      for (const g of r.groups) {
        const gr = ws.addRow([`${g.label} (${g.rows.length})`]);
        gr.font = { bold: true, color: { argb: NAVY } };
        for (const row of g.rows) writeRow(ws, row, r.columns);
        totalLine(ws, r.columns, g.totals, `${g.label} total`, false);
      }
      totalLine(ws, r.columns, r.totals, "Grand total", true);
    } else {
      for (const row of r.rows) writeRow(ws, row, r.columns);
      if (r.totalKeys.length) totalLine(ws, r.columns, r.totals, "Total", true);
    }
    // the header of the detail table repeats when printed
    ws.pageSetup.printTitlesRow = `${firstDataRow - 1}:${firstDataRow - 1}`;
  }

  ws.addRow([]);
  sectionTitle(ws, "Basis of preparation");
  for (const b of r.basis) {
    const row = ws.addRow([b]);
    row.alignment = { wrapText: true, vertical: "top" };
    row.font = { size: 9, color: { argb: MUTED } };
    row.height = Math.min(60, 12 * Math.ceil(b.length / 110));
  }
  ws.headerFooter = { oddFooter: `&L${r.title} · as at ${formatDate(r.asOf)}&R Page &P of &N` };
}

function sectionTitle(ws: ExcelJS.Worksheet, text: string, hint?: string) {
  const row = ws.addRow([text]);
  row.font = { bold: true, size: 12, color: { argb: NAVY } };
  if (hint) ws.addRow([hint]).font = { size: 8, color: { argb: MUTED } };
}

function headerRow(ws: ExcelJS.Worksheet, labels: string[]): ExcelJS.Row {
  const row = ws.addRow(labels);
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: LINE } } };
  });
  row.height = 26;
  return row;
}

/** Numeric headers sit over their numbers, right-aligned like the figures below. */
function alignNumeric(row: ExcelJS.Row, columns: ResultColumn[]) {
  columns.forEach((c, i) => {
    if (c.numeric) row.getCell(i + 1).alignment = { vertical: "middle", horizontal: "right", wrapText: true };
  });
}

function bandBlock(ws: ExcelJS.Worksheet, bands: { label: string; n: number; value: number; share: number }[]) {
  const hasValue = bands.some((b) => b.value !== 0);
  const head = headerRow(ws, hasValue ? ["Band", "Items", "Value (SAR)", "% of value"] : ["Band", "Items"]);
  head.getCell(2).alignment = { horizontal: "right", vertical: "middle" };
  if (hasValue) {
    head.getCell(3).alignment = { horizontal: "right", vertical: "middle" };
    head.getCell(4).alignment = { horizontal: "right", vertical: "middle" };
  }
  for (const b of bands) {
    const row = ws.addRow(hasValue ? [b.label, b.n, b.value, b.share] : [b.label, b.n]);
    row.getCell(2).numFmt = NUMBER;
    if (hasValue) {
      row.getCell(3).numFmt = MONEY;
      row.getCell(4).numFmt = PERCENT;
    }
  }
  const total = ws.addRow(hasValue ? ["Total", bands.reduce((t, b) => t + b.n, 0), bands.reduce((t, b) => t + b.value, 0), 100] : ["Total", bands.reduce((t, b) => t + b.n, 0)]);
  total.font = { bold: true, color: { argb: NAVY } };
  total.getCell(2).numFmt = NUMBER;
  if (hasValue) {
    total.getCell(3).numFmt = MONEY;
    total.getCell(4).numFmt = PERCENT;
  }
  total.eachCell((c) => (c.border = { top: { style: "thin", color: { argb: NAVY } }, bottom: { style: "double", color: { argb: NAVY } } }));
  ws.addRow([]);
}

function writeRow(ws: ExcelJS.Worksheet, row: RecordRow, columns: ResultColumn[]) {
  const values = columns.map((c) => cellValue(row[c.key], c));
  const r = ws.addRow(values);
  columns.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    if (c.type === "money") cell.numFmt = MONEY;
    else if (c.type === "number") cell.numFmt = NUMBER;
    else if (c.type === "percent") cell.numFmt = PERCENT;
    else if (c.type === "date") cell.numFmt = DATE_FMT;
    if (c.numeric) cell.alignment = { horizontal: "right" };
    const tone = row[`${c.key}__tone`] as string | undefined;
    if (tone && TONE_FILL[tone]) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILL[tone] } };
      cell.font = { color: { argb: TONE_FONT[tone] }, bold: true };
    }
  });
}

function cellValue(v: unknown, c: ResultColumn): string | number | Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (c.numeric) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (c.type === "date") return toDate(String(v)) ?? String(v);
  if (c.type === "boolean") return v === true ? "Yes" : "No";
  return String(v);
}

function totalLine(ws: ExcelJS.Worksheet, columns: ResultColumn[], totals: Record<string, number>, label: string, grand: boolean) {
  const values = columns.map((c, i) => (i === 0 ? label : c.numeric && c.type !== "percent" && totals[c.key] !== undefined ? totals[c.key] : null));
  const row = ws.addRow(values);
  row.font = { bold: true, color: { argb: NAVY } };
  columns.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    if (c.type === "money") cell.numFmt = MONEY;
    else if (c.type === "number") cell.numFmt = NUMBER;
    if (c.numeric) cell.alignment = { horizontal: "right" };
    cell.border = grand ? { top: { style: "thin", color: { argb: NAVY } }, bottom: { style: "double", color: { argb: NAVY } } } : { top: { style: "thin", color: { argb: NAVY } } };
  });
}

/* ------------------------------------------------------------------ the flat sheet */

/** Every record, one header row, no merges and no subtotals: the sheet to pivot from. */
function dataSheet(wb: ExcelJS.Workbook, r: BuiltReport) {
  const ws = wb.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const columns = r.columns;
  headerRow(ws, columns.map((c) => c.label));
  for (const row of r.rows) writeRow(ws, row, columns);
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.numeric ? 16 : c.type === "date" ? 13 : Math.min(46, Math.max(14, c.label.length + 6));
  });
  if (r.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  ws.pageSetup.printTitlesRow = "1:1";
  ws.headerFooter = { oddFooter: `&L${r.title} · data · as at ${formatDate(r.asOf)}&R Page &P of &N` };
}
