import { APP_NAME } from "../brand";
import ExcelJS from "exceljs";
import { MONEY_COLUMNS, type CostReport, type Money } from "./compute";
import { formatDate, todayIso } from "../format";

const NAVY = "FF0F2B4C";

export async function exportCostReport(report: CostReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  level1Sheet(wb, report);
  level2Sheet(wb, report);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function title(ws: ExcelJS.Worksheet, report: CostReport, name: string, textCols: number) {
  ws.addRow([`${name} – ${report.programme?.code ?? ""} ${report.programme?.name ?? ""}`]).font = { bold: true, size: 14 };
  ws.addRow([`${report.period?.label ?? ""} · exported ${formatDate(todayIso())} · all amounts SAR`]).font = { color: { argb: "FF5B6577" } };
  ws.addRow([]);
  const letters = ws.addRow([...Array(textCols).fill(""), ...MONEY_COLUMNS.map((c) => c.key)]);
  letters.font = { bold: true, color: { argb: "FFFFFFFF" } };
  letters.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  return letters.number;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  row.alignment = { wrapText: true, vertical: "middle" };
  row.height = 42;
}

function moneyCells(m: Money) {
  return MONEY_COLUMNS.map((c) => m[c.key]);
}

function totalRow(ws: ExcelJS.Worksheet, values: unknown[], strong = false) {
  const r = ws.addRow(values);
  r.font = { bold: true };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: strong ? "FFDCE6F2" : "FFF3F5F9" } };
  return r;
}

function finish(ws: ExcelJS.Worksheet, textCols: number, headerRowNo: number) {
  ws.views = [{ state: "frozen", xSplit: textCols, ySplit: headerRowNo }];
  for (let i = 0; i < MONEY_COLUMNS.length; i++) {
    const col = ws.getColumn(textCols + i + 1);
    col.numFmt = "#,##0.00;[Red]-#,##0.00";
    col.width = 18;
  }
}

function level2Sheet(wb: ExcelJS.Workbook, report: CostReport) {
  const ws = wb.addWorksheet("Level 2 – Detailed");
  const text = ["Code", "Package", "Name", "Contractor / Sub-contractor", "Asset"];
  title(ws, report, "Cost Report – Level 2", text.length);
  const header = ws.addRow([...text, ...MONEY_COLUMNS.map((c) => c.label)]);
  styleHeader(header);
  [14, 26, 30, 26, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const section of report.sections) {
    const sr = ws.addRow([section.name]);
    sr.font = { bold: true, color: { argb: NAVY } };
    for (const l of section.lines) ws.addRow([l.code, l.package, l.name, l.contractor, l.asset_code, ...moneyCells(l)]);
    totalRow(ws, [`${section.name} subtotal`, "", "", "", "", ...moneyCells(section.subtotal)]);
  }
  totalRow(ws, ["Grand total", "", "", "", "", ...moneyCells(report.grandTotal)], true);
  finish(ws, text.length, header.number);
}

function level1Sheet(wb: ExcelJS.Workbook, report: CostReport) {
  const ws = wb.addWorksheet("Level 1 – Executive");
  const text = ["Asset code", "Asset", "Lines"];
  title(ws, report, "Cost Report – Level 1", text.length);
  const header = ws.addRow([...text, ...MONEY_COLUMNS.map((c) => c.label)]);
  styleHeader(header);
  [14, 30, 8].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const r of report.level1) ws.addRow([r.asset_code, r.asset_name, r.lines, ...moneyCells(r)]);
  totalRow(ws, ["Total", "", report.lines.length, ...moneyCells(report.level1Total)], true);
  ws.addRow([]);
  const check = ws.addRow(["Check: Level 1 total minus Level 2 total (must be zero)", "", "", ...moneyCells(report.check)]);
  check.font = { bold: true, color: { argb: report.checkOk ? "FF047857" : "FFB91C1C" } };
  finish(ws, text.length, header.number);
}
