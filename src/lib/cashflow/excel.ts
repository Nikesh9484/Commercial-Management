import ExcelJS from "exceljs";
import type { Cashflow } from "./compute";
import { formatDate, todayIso } from "../format";

const NAVY = "FF0F2B4C";

export async function exportCashflow(cf: Cashflow, programmeLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cash Flow");
  ws.addRow([`Cash Flow – ${programmeLabel}`]).font = { bold: true, size: 14 };
  ws.addRow([`Exported ${formatDate(todayIso())} · SAR excl. VAT · Actuals from Payment Tracking unless overridden`]).font = { color: { argb: "FF5B6577" } };
  ws.addRow([]);
  const text = ["Transaction No", "Supplier", "Line Description", "Coding", "CBS", "Programme"];
  const top = ws.addRow([...text, ...cf.months.flatMap((m) => [m.label, "", ""]), "Total", "", ""]);
  const head = ws.addRow([...text.map(() => ""), ...cf.months.flatMap(() => ["Forecast", "Actual", "Difference"]), "Forecast", "Actual", "Difference"]);
  for (const r of [top, head]) {
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  }
  cf.months.forEach((_, i) => ws.mergeCells(top.number, text.length + 1 + i * 3, top.number, text.length + 3 + i * 3));
  ws.mergeCells(top.number, text.length + 1 + cf.months.length * 3, top.number, text.length + 3 + cf.months.length * 3);
  for (const r of cf.rows) {
    ws.addRow([r.transaction_no, r.supplier, r.description, r.coding, r.cbs, r.programme, ...cf.months.flatMap((m) => [r.cells[m.key].forecast ?? 0, r.cells[m.key].actual, r.cells[m.key].difference ?? 0]), r.total_forecast, r.total_actual, r.total_difference]);
  }
  const total = ws.addRow(["Total", "", "", "", "", "", ...cf.months.flatMap((m) => [cf.monthTotals[m.key].forecast, cf.monthTotals[m.key].actual, cf.monthTotals[m.key].difference]), cf.grand.forecast, cf.grand.actual, cf.grand.difference]);
  total.font = { bold: true };
  total.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F2" } };
  [16, 22, 30, 12, 12, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (let i = text.length + 1; i <= text.length + (cf.months.length + 1) * 3; i++) {
    ws.getColumn(i).width = 15;
    ws.getColumn(i).numFmt = "#,##0.00;[Red]-#,##0.00";
  }
  ws.views = [{ state: "frozen", xSplit: text.length, ySplit: head.number }];

  const acc = wb.addWorksheet("Accruals");
  acc.addRow(["Certified but not paid (net, excl. VAT)"]).font = { bold: true, size: 14 };
  acc.addRow([]);
  const h = acc.addRow(["Contract", "Supplier", "Net certified", "Net paid", "Accrued"]);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  for (const c of cf.accruals.byContract) acc.addRow([c.contract, c.supplier, c.net_certified, c.net_paid, c.accrued]);
  acc.addRow(["Total", "", "", "", cf.accruals.totalAccrued]).font = { bold: true };
  [30, 22, 16, 16, 16].forEach((w, i) => (acc.getColumn(i + 1).width = w));
  [3, 4, 5].forEach((i) => (acc.getColumn(i).numFmt = "#,##0.00;[Red]-#,##0.00"));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
