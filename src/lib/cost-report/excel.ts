import ExcelJS from "exceljs";
import { MONEY_COLUMNS, type CostReport, type CostLineRow } from "./compute";
import type { Level1Matrix, L1Row } from "./level1";
import { formatDate, todayIso } from "../format";
import { XL, MONEY_FMT, titleBlock, headerRow, totalRow, sectionRow, colLetter, sumFormula, formula, finishWorkbook, setWorkbookLink, solid } from "../xlsx-style";

/**
 * Cost report workbook: Level 2 with live formulas (G = E + F, I = G + H, N = I + J + K + L + M,
 * O = N − G, Q = N − P, S = N − R, SUM subtotals) and Level 1 linked to Level 2 with SUMIFS by
 * asset and cost category, so the file can be edited in Excel and still adds up.
 */
export async function exportCostReport(report: CostReport, matrix: Level1Matrix, link?: { url: string; label: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  setWorkbookLink(wb, link);
  const l1 = wb.addWorksheet("Level 1");
  const l2 = wb.addWorksheet("Level 2");
  const sub = `${report.programme?.code ?? ""} ${report.programme?.name ?? ""} · ${report.period?.label ?? ""} · exported ${formatDate(todayIso())} · all amounts SAR`;
  const ref = writeLevel2(l2, report, `Cost Report – Level 2 (Detailed)`, sub);
  writeLevel1(l1, report, matrix, `Cost Report – Level 1 (Executive)`, sub, ref);
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
  sectionCol: number;
  money: Record<string, number>;
  grandTotalRow: number;
  exclHoldRow: number;
}

const L2_TEXT = ["Code", "Package", "Name / description", "Contractor / Sub-contractor", "Asset", "Cost category", "Budget hold", "Section"];

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
    const r = ws.addRow([l.code, l.package, l.name, l.contractor, l.asset_code, l.category, l.is_budget_hold ? "Yes" : "No", l.section]);
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
  // one block per cost category with its sub-total, as on the Excel "Level 02" sheet
  for (const block of report.categories) {
    sectionRow(ws, block.label, textCols + MONEY_COLUMNS.length, XL.navyLight);
    const from = ws.rowCount + 1;
    for (const l of block.lines) lineRow(l);
    const to = ws.rowCount;
    const t = ws.addRow([`Sub-Total ${block.category || block.label}`]);
    for (const c of MONEY_COLUMNS) t.getCell(money[c.key]).value = to >= from ? sumFormula(money[c.key], from, to, block.subtotal[c.key]) : 0;
    totalRow(t, XL.subtotalFill);
    subtotalRows.push(t.number);
  }
  const last = ws.rowCount;
  const g = ws.addRow(["GRAND TOTAL"]);
  for (const c of MONEY_COLUMNS) g.getCell(money[c.key]).value = formula(subtotalRows.map((r) => `${L(c.key)}${r}`).join("+"), report.grandTotal[c.key]);
  totalRow(g, XL.totalFill);
  const x = ws.addRow(["Total excluding budget hold (executive view)"]);
  for (const c of MONEY_COLUMNS) x.getCell(money[c.key]).value = formula(`SUMIFS(${L(c.key)}${first}:${L(c.key)}${last},$G$${first}:$G$${last},"No")`, report.totalsExclHold[c.key]);
  totalRow(x, XL.sectionFill, XL.muted);
  [14, 24, 32, 26, 14, 20, 10, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const c of MONEY_COLUMNS) {
    ws.getColumn(money[c.key]).width = 18;
    ws.getColumn(money[c.key]).numFmt = MONEY_FMT;
  }
  ws.addRow([]);
  const note = ws.addRow(["Formulas: G = E + F · I = G + H · N = I + J + K + L + M · O = N − G · Q = N − P · S = N − R. Subtotals and totals are SUM formulas; edit the input columns (E, F, H, J, K, L, M, P, R) and the rest recalculates."]);
  note.font = { italic: true, color: { argb: XL.muted }, size: 9 };
  return { sheet: ws.name, first, last, assetCol: 5, categoryCol: 6, holdCol: 7, sectionCol: 8, money, grandTotalRow: g.number, exclHoldRow: x.number };
}

/**
 * Writes Level 1 as the Excel "Level 01" sheet: cost categories across, the report lines down, a Total
 * column, the previous report and the movement. With `l2` every category figure is a SUMIFS formula over
 * the Level 2 sheet (category, budget hold, section) and the derived lines (Development Budget,
 * Committed, Anticipated Final Account, Variance …) are formulas of the rows above, so the sheet keeps
 * adding up when Level 2 is edited.
 */
export interface Level1Ref {
  sheet: string;
  /** row number of each report line by key (E, F, G, awards, H, committed, J, K, L, M, uncommitted, N, O, P, Q …) */
  rows: Map<string, number>;
  /** column number of the Total column */
  totalCol: number;
  /** header row (category labels run from column 2 to 1 + columns) */
  headerRow: number;
  columns: number;
}

export function writeLevel1(ws: ExcelJS.Worksheet, report: CostReport, m: Level1Matrix, title: string, subtitle: string, l2?: Level2Ref): Level1Ref {
  const nCols = m.columns.length;
  const TOTAL = 2 + nCols; // column number of the Total column
  const PREV = TOTAL + 1;
  const MOVE = TOTAL + 2;
  titleBlock(ws, title, subtitle, MOVE);
  const hdr = headerRow(ws.addRow(["SAR", ...m.columns.map((c) => c.label), "Total", `Previous${m.previousLabel ? ` – ${m.previousLabel.replace("Monthly Report ", "")}` : ""}`, "Movement"]), { height: 40 });
  hdr.getCell(TOTAL).fill = solid(XL.navy);
  const rowNo = new Map<string, number>();
  const ref = (col: number) => (l2 ? `'${l2.sheet}'!$${colLetter(col)}$${l2.first}:$${colLetter(col)}$${l2.last}` : "");
  const catRef = (c: { asset_code: string; category: string }) => `${ref(l2!.categoryCol)},"${c.category.replace(/"/g, '""')}",${ref(l2!.assetCol)},"${c.asset_code}"`;
  const sourceFormula = (row: L1Row, ci: number) => {
    if (!l2 || !row.source) return null;
    const col = l2.money[row.source.col];
    if (!col) return null;
    const c = m.columns[ci];
    let f = `SUMIFS(${ref(col)},${catRef(c)}`;
    if (row.source.hold) f += `,${ref(l2.holdCol)},"No"`;
    if (row.source.section) f += `,${ref(l2.sectionCol)},"${row.source.section}"`;
    return `${f})`;
  };
  for (const row of m.rows) {
    if (row.kind === "group") {
      sectionRow(ws, row.label, MOVE, XL.navyLight);
      continue;
    }
    const r = ws.addRow([row.label]);
    const n = r.number;
    rowNo.set(row.key, n);
    m.columns.forEach((_, ci) => {
      const cellCol = 2 + ci;
      const L = colLetter(cellCol);
      let value: ExcelJS.CellValue = row.values[ci];
      if (row.formula) {
        const plus = row.formula.plus.map((k) => rowNo.get(k)).filter((x): x is number => x !== undefined);
        const minus = row.formula.minus.map((k) => rowNo.get(k)).filter((x): x is number => x !== undefined);
        if (plus.length + minus.length === row.formula.plus.length + row.formula.minus.length) value = formula(`${plus.map((x) => `${L}${x}`).join("+") || "0"}${minus.map((x) => `-${L}${x}`).join("")}`, row.values[ci]);
      } else {
        const f = sourceFormula(row, ci);
        if (f) value = formula(f, row.values[ci]);
      }
      r.getCell(cellCol).value = value;
    });
    r.getCell(TOTAL).value = nCols ? sumFormula(2, n, n, row.total) && formula(`SUM(${colLetter(2)}${n}:${colLetter(1 + nCols)}${n})`, row.total) : row.total;
    r.getCell(PREV).value = row.previous;
    r.getCell(MOVE).value = row.previous === null ? null : formula(`${colLetter(TOTAL)}${n}-${colLetter(PREV)}${n}`, row.movement ?? 0);
    if (row.kind === "strong") totalRow(r, XL.subtotalFill);
    if (row.kind === "muted") r.font = { italic: true, color: { argb: XL.muted } };
    r.getCell(TOTAL).font = { bold: true, color: { argb: XL.navy } };
  }
  // reasons for variance
  ws.addRow([]);
  sectionRow(ws, "Reasons for variance – this month", MOVE, XL.navy);
  headerRow(ws.addRow(["Item", "Column", "Amount (SAR)", "Remarks"]));
  const from = ws.rowCount + 1;
  for (const x of m.reasons) ws.addRow([x.title, x.col, x.amount, x.remark]);
  if (!m.reasons.length) ws.addRow([m.previousAvailable ? "Nothing moved the anticipated final account this period." : "No issued previous report to compare with."]);
  const to = ws.rowCount;
  const net = ws.addRow(["NET Movement (variance to last month)"]);
  net.getCell(3).value = m.reasons.length ? sumFormula(3, from, to, m.netMovement) : m.netMovement;
  totalRow(net, XL.totalFill);
  ws.getCell(`C${from}`);
  for (let i = from; i <= net.number; i++) ws.getCell(i, 3).numFmt = MONEY_FMT;
  // checks against Level 2
  ws.addRow([]);
  const gRow = rowNo.get("G");
  const nRow = rowNo.get("N");
  if (l2 && gRow && nRow) {
    const c1 = ws.addRow(["Check: Development Budget total − Level 2 grand total G (must be zero)"]);
    c1.getCell(TOTAL).value = formula(`${colLetter(TOTAL)}${gRow}-'${l2.sheet}'!${colLetter(l2.money.G)}${l2.grandTotalRow}`, 0);
    const c2 = ws.addRow(["Check: Anticipated Final Account total − Level 2 total excluding budget hold N (must be zero)"]);
    c2.getCell(TOTAL).value = formula(`${colLetter(TOTAL)}${nRow}-'${l2.sheet}'!${colLetter(l2.money.N)}${l2.exclHoldRow}`, 0);
    for (const c of [c1, c2]) c.font = { bold: true, color: { argb: report.checkOk ? XL.greenInk : XL.redInk } };
  }
  ws.getColumn(1).width = 46;
  for (let c = 2; c <= MOVE; c++) {
    ws.getColumn(c).width = 20;
    ws.getColumn(c).numFmt = MONEY_FMT;
  }
  ws.getColumn(4).width = Math.max(ws.getColumn(4).width ?? 20, 20);
  const note = ws.addRow([l2 ? `Category figures are SUMIFS formulas over the '${l2.sheet}' sheet (cost category, asset, budget hold, section); Development Budget, Committed, Anticipated Final Account and the variances are formulas of the rows above. Previous-report figures are values from the issued report.` : "Values as computed by the dashboard; the Previous and Movement columns compare with the previous issued report."]);
  note.font = { italic: true, color: { argb: XL.muted }, size: 9 };
  return { sheet: ws.name, rows: rowNo, totalCol: TOTAL, headerRow: hdr.number, columns: nCols };
}
