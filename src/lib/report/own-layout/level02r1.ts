import type { ReportData } from "../data";
import { buildBudgetEac, level02Table, EAC_COLUMNS, type EacColumn } from "../budget-eac";
import { colLetters, type XWorkbook } from "./xlsx";

/**
 * The "Level 02 (R1)" tab written into the project's own report workbook: the Level 02 of the head
 * office "Programme XX Budget EAC" workbook, in its layout, filled from the dashboard – the figures
 * the dashboard holds as values, the sheet's own arithmetic (transfers, committed, uncommitted, early
 * warnings, budget to release, final account, variance, sub-totals, grand total) as formulas.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ACC_FMT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)';

const USE_LETTERS: Record<EacColumn, string> = { voUnderProcess: "S", eotClaims: "T", otherClaims: "U", finalAccount: "V", uncommittedScope: "W", plantSupply: "X", ffe: "Y", btOtherAsset: "Z", notRequired: "AA" };

export async function addLevel02R1Sheet(wb: XWorkbook, data: ReportData): Promise<{ lines: number; assets: number }> {
  const e = buildBudgetEac(data);
  const t = level02Table(e);
  const font = (extra = "") => `<font><sz val="10"/>${extra}<name val="Arial"/><family val="2"/></font>`;
  const [TEXT, HEAD, HEAD_SITE, HEAD_USE, MONEY, SUB_TEXT, SUB_MONEY, CODE, TITLE, NOTE, HEAD_NOTE, TOTAL_TEXT, TOTAL_MONEY] = await wb.addStyles({
    fonts: [font(), font("<b/>"), font('<b/><color rgb="FF9C5700"/>'), '<font><i/><sz val="9"/><color rgb="FF595959"/><name val="Arial"/><family val="2"/></font>'],
    fills: ["FFD9D9D9", "FFFFEB9C", "FFDDEBF7", "FFE2EFDA", "FFADD8E6", "FFFFFF00", "FFDCE6F2"].map((c) => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`),
    borders: ['<border><left style="thin"><color rgb="FF808080"/></left><right style="thin"><color rgb="FF808080"/></right><top style="thin"><color rgb="FF808080"/></top><bottom style="thin"><color rgb="FF808080"/></bottom><diagonal/></border>'],
    numFmts: [ACC_FMT],
    xfs: [
      (i) => `<xf numFmtId="0" fontId="${i.font[0]}" fillId="0" borderId="${i.border[0]}" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`,
      (i) => `<xf numFmtId="0" fontId="${i.font[1]}" fillId="${i.fill[0]}" borderId="${i.border[0]}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
      (i) => `<xf numFmtId="0" fontId="${i.font[1]}" fillId="${i.fill[2]}" borderId="${i.border[0]}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
      (i) => `<xf numFmtId="0" fontId="${i.font[1]}" fillId="${i.fill[3]}" borderId="${i.border[0]}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
      (i) => `<xf numFmtId="${i.numFmt[0]}" fontId="${i.font[0]}" fillId="0" borderId="${i.border[0]}" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
      (i) => `<xf numFmtId="0" fontId="${i.font[2]}" fillId="${i.fill[1]}" borderId="${i.border[0]}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`,
      (i) => `<xf numFmtId="${i.numFmt[0]}" fontId="${i.font[2]}" fillId="${i.fill[1]}" borderId="${i.border[0]}" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
      (i) => `<xf numFmtId="0" fontId="${i.font[1]}" fillId="${i.fill[4]}" borderId="${i.border[0]}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`,
      (i) => `<xf numFmtId="0" fontId="${i.font[1]}" fillId="0" borderId="0" applyFont="1"/>`,
      (i) => `<xf numFmtId="0" fontId="${i.font[3]}" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>`,
      (i) => `<xf numFmtId="0" fontId="${i.font[1]}" fillId="${i.fill[5]}" borderId="${i.border[0]}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
      (i) => `<xf numFmtId="0" fontId="${i.font[1]}" fillId="${i.fill[6]}" borderId="${i.border[0]}" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`,
      (i) => `<xf numFmtId="${i.numFmt[0]}" fontId="${i.font[1]}" fillId="${i.fill[6]}" borderId="${i.border[0]}" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    ],
  });

  type Cell = { c: number; s: number; v?: number; t?: string; f?: string };
  const rows = new Map<number, Cell[]>();
  const cell = (r: number, col: string | number, x: Omit<Cell, "c">) => {
    const c = typeof col === "number" ? col : colNo(col);
    const list = rows.get(r) ?? [];
    list.push({ c, ...x });
    rows.set(r, list);
  };
  const text = (r: number, col: string | number, v: string, s = TEXT) => cell(r, col, { s, t: v });
  const num = (r: number, col: string | number, v: number, s = MONEY) => cell(r, col, { s, v });
  const formula = (r: number, col: string | number, f: string, v: number, s = MONEY) => cell(r, col, { s, f, v });

  text(1, "A", e.portfolio, TITLE);
  text(2, "A", `${e.programme.name} (${e.programme.code})`, TITLE);
  text(3, "A", `${e.month} – ${e.periodLabel}`, TITLE);
  text(4, "F", "As Per Head Office Cost Report", HEAD_NOTE);
  text(4, "N", "SITE FORECAST", HEAD_SITE);
  text(5, "A", "Level 02 Summary", TITLE);
  for (const [col, label] of [["H", "Column G"], ["I", "Column H"], ["J", "Column I"], ["K", "Column J"], ["L", "Column K"], ["M", "Column L"]]) text(5, col, label, NOTE);
  text(5, "S", "EARLY WARNINGS (KNOWN BUT NOT COMMITTED)", HEAD_USE);
  const heads: [string, string, number][] = [
    ["A", "Program", HEAD], ["B", "Asset", HEAD], ["C", "Sub-category", HEAD], ["D", "Contract Code", HEAD], ["E", "Name", HEAD],
    ["F", "Previous Approved Budget", HEAD], ["G", "Approved Budget Transfers", HEAD], ["H", "Currently Approved Budget", HEAD], ["I", "Contracts", HEAD], ["J", "DVO's", HEAD], ["K", "Committed", HEAD], ["L", "Uncommitted", HEAD], ["M", "PVO's ", HEAD],
    ["N", "Early Warnings", HEAD_SITE], ["O", "Budget to Release [Not Required]", HEAD_SITE], ["P", "Final Account", HEAD_SITE], ["Q", "Variance", HEAD_SITE],
    ...EAC_COLUMNS.map((c): [string, string, number] => [USE_LETTERS[c.key], c.label, HEAD_USE]),
    ["AC", "Total Uncommitted Utilisation", HEAD_USE],
  ];
  for (const [col, label, s] of heads) text(6, col, label, s);

  let r = 7;
  const subtotalRows: number[] = [];
  let start = r;
  for (const row of t.rows) {
    if (row.kind === "line") {
      text(r, "A", row.program);
      text(r, "B", row.asset);
      text(r, "C", row.subCategory);
      text(r, "D", row.contractCode, CODE);
      text(r, "E", row.name);
      num(r, "F", row.previousBudget);
      formula(r, "G", `H${r}-F${r}`, row.transfers);
      num(r, "H", row.currentBudget);
      num(r, "I", row.contracts);
      num(r, "J", row.dvos);
      formula(r, "K", `SUM(I${r}:J${r})`, row.committed);
      formula(r, "L", `H${r}-K${r}`, row.uncommitted);
      num(r, "M", row.pvos);
      formula(r, "N", `(AC${r}-AA${r})*-1`, row.earlyWarnings);
      formula(r, "O", `AA${r}*-1`, row.budgetToRelease);
      formula(r, "P", `SUM(K${r}:O${r})`, row.finalAccount);
      formula(r, "Q", `P${r}-H${r}`, row.variance);
      for (const c of EAC_COLUMNS) num(r, USE_LETTERS[c.key], row.use[c.key]);
      formula(r, "AC", `SUM(S${r}:AA${r})`, row.totalUse);
      r++;
    } else if (row.kind === "subtotal") {
      const end = r - 1;
      text(r, "A", "Sub-Total ", SUB_TEXT);
      text(r, "B", row.asset, SUB_TEXT);
      text(r, "C", "", SUB_TEXT);
      text(r, "D", "", SUB_TEXT);
      text(r, "E", "Sub-Total Development Cost", SUB_TEXT);
      for (const col of ["F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AC"]) {
        const key = ({ F: "previousBudget", G: "transfers", H: "currentBudget", I: "contracts", J: "dvos", K: "committed", L: "uncommitted", M: "pvos", N: "earlyWarnings", O: "budgetToRelease", P: "finalAccount", AC: "totalUse" } as Record<string, keyof typeof row>)[col];
        const useKey = EAC_COLUMNS.find((c) => USE_LETTERS[c.key] === col)?.key;
        const v = useKey ? row.use[useKey] : key ? Number(row[key]) : 0;
        formula(r, col, `SUM(${col}${start}:${col}${end})`, v, SUB_MONEY);
      }
      formula(r, "Q", `P${r}-H${r}`, row.variance, SUB_MONEY);
      text(r, "R", "", SUB_TEXT);
      text(r, "AB", "", SUB_TEXT);
      subtotalRows.push(r);
      r++;
      start = r;
    }
  }
  // the grand total, which the head office template leaves to Level 01
  const g = r + 1;
  text(g, "A", "", TOTAL_TEXT);
  text(g, "B", "", TOTAL_TEXT);
  text(g, "C", "", TOTAL_TEXT);
  text(g, "D", "", TOTAL_TEXT);
  text(g, "E", "GRAND TOTAL", TOTAL_TEXT);
  for (const col of ["F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AC"]) {
    const key = ({ F: "previousBudget", G: "transfers", H: "currentBudget", I: "contracts", J: "dvos", K: "committed", L: "uncommitted", M: "pvos", N: "earlyWarnings", O: "budgetToRelease", P: "finalAccount", AC: "totalUse" } as Record<string, keyof typeof t.total>)[col];
    const useKey = EAC_COLUMNS.find((c) => USE_LETTERS[c.key] === col)?.key;
    const v = useKey ? t.total.use[useKey] : key ? Number(t.total[key]) : 0;
    formula(g, col, subtotalRows.length ? subtotalRows.map((x) => `${col}${x}`).join("+") : "0", v, TOTAL_MONEY);
  }
  formula(g, "Q", `P${g}-H${g}`, t.total.variance, TOTAL_MONEY);
  text(g, "R", "", TOTAL_TEXT);
  text(g, "AB", "", TOTAL_TEXT);
  const noteRow = g + 2;
  text(noteRow, "B", `Written by the dashboard from the registers of ${e.periodLabel}: the Level 02 tab of the head office "Programme XX Budget EAC" workbook. ${e.notes.slice(0, 3).join(" ")}`, NOTE);

  // the sheet XML
  const widths: Record<string, number> = { A: 14.5, B: 21.5, C: 20, D: 23.2, E: 41.3, F: 16.5, G: 13.5, H: 16.5, I: 15.3, J: 14.5, K: 15.5, L: 14.5, M: 13, N: 13, O: 13, P: 14.7, Q: 14.5, R: 2.5, S: 14.5, T: 13, U: 13, V: 13, W: 13, X: 13, Y: 13, Z: 13, AA: 13, AB: 2.5, AC: 14.5 };
  const cols = Object.entries(widths).map(([l, w]) => `<col min="${colNo(l)}" max="${colNo(l)}" width="${w}" customWidth="1"/>`).join("");
  const heights: Record<number, number> = { 4: 18, 5: 20, 6: 43.5, [noteRow]: 60 };
  const out: string[] = [];
  for (const rowNo of [...rows.keys()].sort((a, b) => a - b)) {
    const cells = rows.get(rowNo)!.sort((a, b) => a.c - b.c);
    const ht = heights[rowNo] ?? (rowNo >= 7 && rowNo < g ? 24 : undefined);
    out.push(`<row r="${rowNo}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>`);
    for (const x of cells) {
      const ref = `${colLetters(x.c)}${rowNo}`;
      if (x.f !== undefined) out.push(`<c r="${ref}" s="${x.s}"><f>${esc(x.f)}</f><v>${Number.isFinite(x.v ?? 0) ? x.v ?? 0 : 0}</v></c>`);
      else if (x.t !== undefined) out.push(x.t === "" ? `<c r="${ref}" s="${x.s}"/>` : `<c r="${ref}" s="${x.s}" t="inlineStr"><is><t xml:space="preserve">${esc(x.t)}</t></is></c>`);
      else out.push(`<c r="${ref}" s="${x.s}"><v>${Number.isFinite(x.v ?? 0) ? x.v ?? 0 : 0}</v></c>`);
    }
    out.push("</row>");
  }
  const merges = ["F4:M4", "N4:P5", "S5:Z5", `B${noteRow}:Q${noteRow}`];
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><tabColor rgb="FF7030A0"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:AC${noteRow}"/>` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane xSplit="5" ySplit="6" topLeftCell="F7" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="F7" sqref="F7"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${out.join("")}</sheetData>` +
    `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  await wb.addSheet("Level 02 (R1)", xml);
  return { lines: t.rows.filter((x) => x.kind === "line").length, assets: e.assets.length };
}

function colNo(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
