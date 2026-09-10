import ExcelJS from "exceljs";
import { MONEY_COLUMNS, type CostReport, type CostLineRow } from "./compute";
import { formatDate, todayIso } from "../format";
import { XL, MONEY_FMT, titleBlock, headerRow, totalRow, sectionRow, colLetter, sumFormula, formula, finishWorkbook, setWorkbookLink, solid } from "../xlsx-style";

/**
 * Cost report workbook: Level 2 with live formulas (G = E + F, I = G + H, N = I + J + K + L + M,
 * O = N − G, Q = N − P, S = N − R, SUM subtotals) and Level 1 linked to Level 2 with SUMIFS by
 * asset and cost category, so the file can be edited in Excel and still adds up.
 */
export async function exportCostReport(report: CostReport, link?: { url: string; label: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  setWorkbookLink(wb, link);
  const l1 = wb.addWorksheet("Level 1");
  const l2 = wb.addWorksheet("Level 2");
  const sub = `${report.programme?.code ?? ""} ${report.programme?.name ?? ""} · ${report.period?.label ?? ""} · exported ${formatDate(todayIso())} · all amounts SAR`;
  const ref = writeLevel2(l2, report, `Cost Report – Level 2 (Detailed)`, sub);
  writeLevel1(l1, report, `Cost Report – Level 1 (Executive)`, sub, ref);
  finishWorkbook(wb, { freeze: { "Level 1": 3, "Level 2": 3 } });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface Level2Ref {
  sheet: string;
  first: number;
  last: number;
  /** column numbers */
  assetCol: number;
  categoryCol: number;
  holdCol: number;
  money: Record<string, number>;
  grandTotalRow: number;
}

const L2_TEXT = ["Code", "Package", "Name / description", "Contractor / Sub-contractor", "Asset", "Cost category", "Budget hold"];

/** Writes the Level 2 table and returns where its data lives (for Level 1 formulas). */
export function writeLevel2(ws: ExcelJS.Worksheet, report: CostReport, title: string, subtitle: string): Level2Ref {
  const textCols = L2_TEXT.length;
  const money: Record<string, number> = {};
  MONEY_COLUMNS.forEach((c, i) => (money[c.key] = textCols + i + 1));
  const L = (k: string) => colLetter(money[k]);
  titleBlock(ws, title, subtitle, textCols + MONEY_COLUMNS.length);
  const letters = ws.addRow([...Array(textCols).fill(""), ...MONEY_COLUMNS.map((c) => c.key)]);
  letters.font = { bold: true, color: { argb: XL.white } };
  letters.alignment = { horizontal: "center" };
  letters.eachCell({ includeEmpty: true }, (c, i) => {
    if (i > textCols) c.fill = solid(XL.navyLight);
  });
  const hdr = headerRow(ws.addRow([...L2_TEXT, ...MONEY_COLUMNS.map((c) => c.label)]), { height: 44 });
  const first = hdr.number + 1;
  const subtotalRows: number[] = [];
  const lineRow = (l: CostLineRow) => {
    const r = ws.addRow([l.code, l.package, l.name, l.contractor, l.asset_code, l.category, l.is_budget_hold ? "Yes" : "No"]);
    const n = r.number;
    const set = (k: string, v: ExcelJS.CellValue) => (r.getCell(money[k]).value = v);
    set("E", l.E);
    set("F", l.F);
    set("G", formula(`${L("E")}${n}+${L("F")}${n}`, l.G));
    set("H", l.H);
    set("I", formula(`${L("G")}${n}+${L("H")}${n}`, l.I));
    set("J", l.J);
    set("K", l.K);
    set("L", l.L);
    set("M", l.M);
    set("N", formula(`${L("I")}${n}+${L("J")}${n}+${L("K")}${n}+${L("L")}${n}+${L("M")}${n}`, l.N));
    set("O", formula(`${L("N")}${n}-${L("G")}${n}`, l.O));
    set("P", l.P);
    set("Q", formula(`${L("N")}${n}-${L("P")}${n}`, l.Q));
    set("R", l.R);
    set("S", formula(`${L("N")}${n}-${L("R")}${n}`, l.S));
    if (l.is_budget_hold) r.font = { italic: true, color: { argb: XL.muted } };
    return r;
  };
  for (const section of report.sections) {
    sectionRow(ws, section.name, textCols + MONEY_COLUMNS.length, XL.navyLight);
    const from = ws.rowCount + 1;
    for (const l of section.lines) lineRow(l);
    const to = ws.rowCount;
    const t = ws.addRow([`${section.name} subtotal`]);
    for (const c of MONEY_COLUMNS) t.getCell(money[c.key]).value = to >= from ? sumFormula(money[c.key], from, to, section.subtotal[c.key]) : 0;
    totalRow(t, XL.subtotalFill);
    subtotalRows.push(t.number);
  }
  const last = ws.rowCount;
  const g = ws.addRow(["Grand total"]);
  for (const c of MONEY_COLUMNS) g.getCell(money[c.key]).value = formula(subtotalRows.map((r) => `${L(c.key)}${r}`).join("+"), report.grandTotal[c.key]);
  totalRow(g, XL.totalFill);
  const x = ws.addRow(["Total excluding budget hold"]);
  for (const c of MONEY_COLUMNS) x.getCell(money[c.key]).value = formula(`SUMIFS(${L(c.key)}${first}:${L(c.key)}${last},$G$${first}:$G$${last},"No")`, report.totalsExclHold[c.key]);
  totalRow(x, XL.sectionFill, XL.muted);
  [14, 24, 32, 26, 14, 20, 10].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const c of MONEY_COLUMNS) {
    ws.getColumn(money[c.key]).width = 18;
    ws.getColumn(money[c.key]).numFmt = MONEY_FMT;
  }
  ws.addRow([]);
  const note = ws.addRow(["Formulas: G = E + F · I = G + H · N = I + J + K + L + M · O = N − G · Q = N − P · S = N − R. Subtotals and totals are SUM formulas; edit the input columns (E, F, H, J, K, L, M, P, R) and the rest recalculates."]);
  note.font = { italic: true, color: { argb: XL.muted }, size: 9 };
  return { sheet: ws.name, first, last, assetCol: 5, categoryCol: 6, holdCol: 7, money, grandTotalRow: g.number };
}

/** Writes Level 1 (asset × category). With `l2` the cells are SUMIFS formulas over the Level 2 sheet. */
export function writeLevel1(ws: ExcelJS.Worksheet, report: CostReport, title: string, subtitle: string, l2?: Level2Ref) {
  const text = ["Asset code", "Asset", "Cost category", "Lines"];
  const textCols = text.length;
  const money: Record<string, number> = {};
  MONEY_COLUMNS.forEach((c, i) => (money[c.key] = textCols + i + 1));
  titleBlock(ws, title, subtitle, textCols + MONEY_COLUMNS.length);
  const letters = ws.addRow([...Array(textCols).fill(""), ...MONEY_COLUMNS.map((c) => c.key)]);
  letters.font = { bold: true, color: { argb: XL.white } };
  letters.alignment = { horizontal: "center" };
  letters.eachCell({ includeEmpty: true }, (c, i) => {
    if (i > textCols) c.fill = solid(XL.navyLight);
  });
  headerRow(ws.addRow([...text, ...MONEY_COLUMNS.map((c) => c.label)]), { height: 44 });
  const first = ws.rowCount + 1;
  const l2ref = (col: number) => (l2 ? `'${l2.sheet}'!$${colLetter(col)}$${l2.first}:$${colLetter(col)}$${l2.last}` : "");
  for (const r of report.level1) {
    const row = ws.addRow([r.asset_code, r.asset_name, r.category]);
    const n = row.number;
    const crit = l2 ? `,${l2ref(l2.assetCol)},$A${n},${l2ref(l2.categoryCol)},$C${n}` : "";
    row.getCell(4).value = l2 ? formula(`COUNTIFS(${l2ref(l2.assetCol)},$A${n},${l2ref(l2.categoryCol)},$C${n})`, r.lines) : r.lines;
    for (const c of MONEY_COLUMNS) row.getCell(money[c.key]).value = l2 ? formula(`SUMIFS(${l2ref(l2.money[c.key])}${crit})`, r[c.key]) : r[c.key];
  }
  const last = ws.rowCount;
  const t = ws.addRow(["Total"]);
  t.getCell(4).value = last >= first ? sumFormula(4, first, last, report.lines.length) : 0;
  for (const c of MONEY_COLUMNS) t.getCell(money[c.key]).value = last >= first ? sumFormula(money[c.key], first, last, report.level1Total[c.key]) : 0;
  totalRow(t, XL.totalFill);
  const x = ws.addRow(["Total excluding budget hold"]);
  x.getCell(4).value = report.lines.filter((l) => !l.is_budget_hold).length;
  for (const c of MONEY_COLUMNS) {
    x.getCell(money[c.key]).value = l2 ? formula(`SUMIFS(${l2ref(l2.money[c.key])},${l2ref(l2.holdCol)},"No")`, report.totalsExclHold[c.key]) : report.totalsExclHold[c.key];
  }
  totalRow(x, XL.sectionFill, XL.muted);
  ws.addRow([]);
  const chk = ws.addRow(["Check: Level 1 total − Level 2 grand total (must be zero)"]);
  for (const c of MONEY_COLUMNS) {
    chk.getCell(money[c.key]).value = l2 ? formula(`${colLetter(money[c.key])}${t.number}-'${l2.sheet}'!${colLetter(l2.money[c.key])}${l2.grandTotalRow}`, report.check[c.key]) : report.check[c.key];
  }
  chk.font = { bold: true, color: { argb: report.checkOk ? XL.greenInk : XL.redInk } };
  [14, 28, 24, 8].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const c of MONEY_COLUMNS) {
    ws.getColumn(money[c.key]).width = 18;
    ws.getColumn(money[c.key]).numFmt = MONEY_FMT;
  }
  if (l2) {
    const note = ws.addRow([`Every figure on this sheet is a SUMIFS formula over the '${l2.sheet}' sheet (asset + cost category). Change a line on ${l2.sheet} and this sheet follows.`]);
    note.font = { italic: true, color: { argb: XL.muted }, size: 9 };
  }
}
