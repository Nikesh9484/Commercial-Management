import ExcelJS from "exceljs";
import { APP_NAME } from "../brand";
import type { ReportData } from "./data";
import { executiveTotals } from "../cost-report/executive";
import { getClaimsSummary } from "../claims/summary";
import { CHANGE_STAGES } from "../registers/defs/changes";
import { formatDate, toDate } from "../format";
import type { RecordRow } from "../registers/types";
import { XL, titleBlock, headerRow, sectionRow, totalRow, finishWorkbook, setWorkbookLink, colLetter, formula, solid } from "../xlsx-style";
import { writeLevel1, writeLevel2, type Level1Ref } from "../cost-report/excel";
import { movementSheet, momSheet, cashflowSheet, paymentTrackerBlock, registerBlock, sub } from "./excel";
import { addChartsToXlsx, type XlsxChart } from "../xlsx-charts";

/**
 * The whole dashboard as one Excel workbook: a Dashboard sheet with the headline tiles, open-item
 * tiles and six native charts, then one sheet per module laid out like the dashboard page (summary
 * figures, a chart, the register). Level 1 is formulas over Level 2, the module summaries are
 * COUNTIF / SUMIF formulas over their registers, and the Dashboard tiles read the Level 1 sheet –
 * so the workbook keeps recalculating when the registers are edited in Excel.
 */
const SHEET = {
  dash: "Dashboard",
  l1: "Level 1",
  l2: "Level 2",
  move: "Movement",
  changes: "Change Management",
  claims: "Claims & Disputes",
  ew: "Early Warnings & Risks",
  ps: "Provisional Sums",
  bonds: "Bonds & Insurance",
  pay: "Invoices & Payments",
  fa: "Final Account Status",
  cf: "Cash Flow",
  bt: "Budget Transfers",
  mom: "Minutes & Actions",
};
const WHOLE = "#,##0;[Red](#,##0)";
const TILE = { navy: "FF1F3A5F", teal: "FF0E7C86", orange: "FFEB6834", green: "FF2E9E5B", red: "FFD64545", blue: "FF2A78D6", purple: "FF7C5CBF", gold: "FFC9A227", grey: "FF6B7280" };
const CHART_COLORS = { navy: "1F3A5F", teal: "0E7C86", orange: "EB6834", green: "2E9E5B", red: "D64545", blue: "2A78D6", purple: "7C5CBF", gold: "C9A227", amber: "E29A1A", grey: "6B7280" };

const q = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;
const cellRef = (sheet: string, col: number, row: number) => `${q(sheet)}!$${colLetter(col)}$${row}`;
const rangeRef = (sheet: string, col: number, r1: number, r2: number) => `${q(sheet)}!$${colLetter(col)}$${r1}:$${colLetter(col)}$${r2}`;
const rowRef = (sheet: string, row: number, c1: number, c2: number) => `${q(sheet)}!$${colLetter(c1)}$${row}:$${colLetter(c2)}$${row}`;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

type CellVal = ExcelJS.CellValue;

/** A coloured headline tile: label, big value, small note – three rows, `span` columns wide. */
function tile(ws: ExcelJS.Worksheet, row: number, col: number, span: number, t: { label: string; value: CellVal; sub?: string; fill: string; fmt?: string }) {
  const end = col + span - 1;
  for (let r = row; r <= row + 2; r++) for (let c = col; c <= end; c++) ws.getCell(r, c).fill = solid(t.fill);
  const label = ws.getCell(row, col);
  label.value = t.label.toUpperCase();
  label.font = { bold: true, size: 8, color: { argb: "FFE4ECF6" } };
  label.alignment = { vertical: "bottom", horizontal: "left", indent: 1 };
  const value = ws.getCell(row + 1, col);
  value.value = t.value;
  value.font = { bold: true, size: 16, color: { argb: XL.white } };
  value.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  if (t.fmt) value.numFmt = t.fmt;
  const note = ws.getCell(row + 2, col);
  note.value = t.sub ?? "";
  note.font = { size: 8, color: { argb: "FFE4ECF6" } };
  note.alignment = { vertical: "top", horizontal: "left", indent: 1 };
  ws.mergeCells(row, col, row, end);
  ws.mergeCells(row + 1, col, row + 1, end);
  ws.mergeCells(row + 2, col, row + 2, end);
  ws.getRow(row).height = Math.max(ws.getRow(row).height ?? 15, 16);
  ws.getRow(row + 1).height = 30;
  ws.getRow(row + 2).height = 15;
}

/** Fills rows until the sheet has `n` rows, so the next addRow lands on row n + 1. */
function padTo(ws: ExcelJS.Worksheet, n: number) {
  while (ws.rowCount < n) ws.addRow([]);
}

/** A small label / value table written at fixed cells (not appended). */
function kvTable(ws: ExcelJS.Worksheet, row: number, col: number, title: string, rows: { label: string; value: CellVal; fmt?: string; strong?: boolean }[], width = 2): number {
  const t = ws.getCell(row, col);
  t.value = title;
  t.font = { bold: true, size: 11, color: { argb: XL.navy } };
  rows.forEach((r, i) => {
    const y = row + 1 + i;
    const l = ws.getCell(y, col);
    l.value = r.label;
    l.font = { color: { argb: XL.ink }, bold: !!r.strong };
    l.border = { bottom: { style: "hair", color: { argb: XL.line } } };
    const v = ws.getCell(y, col + width - 1);
    v.value = r.value;
    v.numFmt = r.fmt ?? WHOLE;
    v.font = { bold: true, color: { argb: r.strong ? XL.navy : XL.ink } };
    v.alignment = { horizontal: "right" };
    v.border = { bottom: { style: "hair", color: { argb: XL.line } } };
    if (r.strong) for (let c = col; c < col + width; c++) ws.getCell(y, c).fill = solid(XL.subtotalFill);
  });
  return row + 1 + rows.length;
}

/** A small data table (header + rows) at fixed cells; returns the first and last data rows. */
function dataTable(ws: ExcelJS.Worksheet, row: number, col: number, title: string, headers: string[], rows: CellVal[][], fmts: (string | undefined)[] = []): { first: number; last: number; cols: number[] } {
  const t = ws.getCell(row, col);
  t.value = title;
  t.font = { bold: true, size: 11, color: { argb: XL.navy } };
  headers.forEach((h, i) => {
    const c = ws.getCell(row + 1, col + i);
    c.value = h;
    c.font = { bold: true, color: { argb: XL.white }, size: 9 };
    c.fill = solid(XL.navyLight);
    c.alignment = { horizontal: i === 0 ? "left" : "right", vertical: "middle", wrapText: true };
  });
  rows.forEach((r, ri) => {
    r.forEach((v, i) => {
      const c = ws.getCell(row + 2 + ri, col + i);
      c.value = v;
      if (fmts[i]) c.numFmt = fmts[i]!;
      c.alignment = { horizontal: i === 0 ? "left" : "right" };
      c.border = { bottom: { style: "hair", color: { argb: XL.line } } };
      if (ri % 2) c.fill = solid(XL.zebra);
    });
  });
  return { first: row + 2, last: row + 1 + rows.length, cols: headers.map((_, i) => col + i) };
}

const COUNT_IF = (range: string, what: string) => `COUNTIF(${range},"${what.replace(/"/g, '""')}")`;
const SUM_IFS = (sum: string, ...pairs: [string, string][]) => `SUMIFS(${sum},${pairs.map(([r, w]) => `${r},"${w.replace(/"/g, '""')}"`).join(",")})`;

export async function renderDashboardExcel(data: ReportData, link?: { url: string; label: string }): Promise<Buffer> {
  const d = data;
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  setWorkbookLink(wb, link);
  const charts: Record<string, XlsxChart[]> = {};
  const add = (sheet: string, c: XlsxChart) => (charts[sheet] = [...(charts[sheet] ?? []), c]);
  const g = executiveTotals(d.costReport);
  const dash = d.dashboard;
  const rows = (key: string) => d.registers[key]?.rows ?? [];
  const src = (key: string) => (d.sources[key] === "snapshot" ? "stored copy of this report" : "live register");

  /* ---------------- Dashboard sheet first (filled at the end, once the other sheets exist) ---- */
  const wsDash = wb.addWorksheet(SHEET.dash, { views: [{ showGridLines: false }] });

  /* ---------------- Level 1 / Level 2 ---------------------------------------------------------- */
  const wsL1 = wb.addWorksheet(SHEET.l1); // created first so it sits before Level 2 in the tab order
  const wsL2 = wb.addWorksheet(SHEET.l2);
  const l2 = writeLevel2(wsL2, d.costReport, `Cost Report – Level 2 (Detailed) · source: ${d.sources.cost_report}`, sub(d));
  const l1 = writeLevel1(wsL1, d.costReport, d.level1Matrix, `Cost Report – Level 1 (Executive) · source: ${d.sources.cost_report}`, sub(d), l2);
  const l1cell = (key: string, fallback: number): CellVal => {
    const r = l1.rows.get(key);
    return r ? formula(cellRef(l1.sheet, l1.totalCol, r), fallback) : fallback;
  };
  const l1has = (key: string) => l1.rows.has(key);

  /* ---------------- Movement ------------------------------------------------------------------ */
  movementSheet(wb, d);

  /* ---------------- Change Management --------------------------------------------------------- */
  {
    const ws = wb.addWorksheet(SHEET.changes);
    const ch = rows("changes");
    const def = d.registers.changes?.def;
    titleBlock(ws, "Change Management", sub(d), 12);
    padTo(ws, 21);
    const ref = def ? registerBlock(ws, def, ch, src("changes")) : null;
    const stages = CHANGE_STAGES.filter((s) => ["rfc", "pvo", "vo", "dvo"].includes(s.prefix));
    const statusCol = (prefix: string) => (ref ? ref.cols[`${prefix}_status_id`] : undefined);
    const rng = (col: number) => rangeRef(ws.name, col, ref!.first, ref!.last);
    const buckets: [string, string[]][] = [
      ["Approved", ["Approved", "Review Complete"]],
      ["Pending", ["Pending", "Revised & Re-submit"]],
      ["Cancelled", ["Cancelled", "Superseded"]],
    ];
    const countOf = (r: RecordRow, prefix: string, names: string[]) => (names.includes(String(r[`${prefix}_status_id__label`] ?? "")) ? 1 : 0);
    const table = dataTable(
      ws,
      4,
      1,
      "Status by stage (number of items)",
      ["Stage", ...buckets.map((b) => b[0]), "Other"],
      stages.map((s) => {
        const col = statusCol(s.prefix);
        const counts = buckets.map(([, names]) => ch.reduce((t, r) => t + countOf(r, s.prefix, names), 0));
        const other = ch.filter((r) => String(r[`${s.prefix}_status_id__label`] ?? "")).length - counts.reduce((a, b) => a + b, 0);
        return [
          s.short,
          ...buckets.map(([, names], i) => (col && ref && ref.last >= ref.first ? formula(names.map((n) => COUNT_IF(rng(col), n)).join("+"), counts[i]) : counts[i])),
          col && ref && ref.last >= ref.first ? formula(`COUNTA(${rng(col)})-${buckets.flatMap(([, names]) => names.map((n) => COUNT_IF(rng(col), n))).join("-")}`, other) : other,
        ];
      }),
    );
    kvTable(ws, 11, 1, "Cost report effect (SAR, from Level 1)", [
      { label: "Determined VOs (H)", value: l1cell("H", g.H) },
      { label: "Potential VOs (J)", value: l1cell("J", g.J) },
      { label: "Requests for change (K)", value: l1cell("K", g.K) },
      { label: "Change items", value: ch.length, fmt: "0" },
      { label: "Open change items", value: dash.openChanges, fmt: "0" },
    ], 3);
    add(ws.name, {
      type: "stackedBar",
      title: "Change status by stage",
      categories: rangeRef(ws.name, table.cols[0], table.first, table.last),
      catCache: stages.map((s) => s.short),
      series: [...buckets.map((b) => b[0]), "Other"].map((name, i) => ({
        name,
        values: rangeRef(ws.name, table.cols[i + 1], table.first, table.last),
        cache: stages.map((s) => {
          const counts = buckets.map(([, names]) => ch.reduce((t, r) => t + countOf(r, s.prefix, names), 0));
          return i < 3 ? counts[i] : ch.filter((r) => String(r[`${s.prefix}_status_id__label`] ?? "")).length - counts.reduce((a, b) => a + b, 0);
        }),
        color: [CHART_COLORS.green, CHART_COLORS.amber, CHART_COLORS.grey, CHART_COLORS.purple][i],
      })),
      from: { col: 6, row: 3 },
      to: { col: 12, row: 19 },
      showValues: true,
      numFmt: "0",
    });
  }

  /* ---------------- Claims & Disputes --------------------------------------------------------- */
  {
    const ws = wb.addWorksheet(SHEET.claims);
    const cl = rows("claims");
    const def = d.registers.claims?.def;
    const cs = getClaimsSummary(d.programme.id, cl);
    titleBlock(ws, "Claims & Disputes", sub(d), 12);
    padTo(ws, 21);
    const ref = def ? registerBlock(ws, def, cl, src("claims")) : null;
    const has = ref && ref.last >= ref.first;
    const rng = (key: string) => (has && ref!.cols[key] ? rangeRef(ws.name, ref!.cols[key], ref!.first, ref!.last) : null);
    const statuses = [...new Set(cl.map((c) => String(c.status ?? "")).filter(Boolean))];
    const table = dataTable(
      ws,
      4,
      1,
      "Claims by status",
      ["Status", "Claims", "SAR claimed", "SAR determined"],
      statuses.map((st) => {
        const mine = cl.filter((c) => String(c.status ?? "") === st);
        const claimed = mine.reduce((t, c) => t + num(c.contractor_cost_view), 0);
        const det = mine.reduce((t, c) => t + num(c.determination_cost_view), 0);
        return [
          st,
          rng("status") ? formula(COUNT_IF(rng("status")!, st), mine.length) : mine.length,
          rng("status") && rng("contractor_cost_view") ? formula(SUM_IFS(rng("contractor_cost_view")!, [rng("status")!, st]), claimed) : claimed,
          rng("status") && rng("determination_cost_view") ? formula(SUM_IFS(rng("determination_cost_view")!, [rng("status")!, st]), det) : det,
        ];
      }),
      [undefined, "0", WHOLE, WHOLE],
    );
    kvTable(ws, table.last + 2, 1, "Position", [
      { label: "Claims", value: rng("claim_no") ? formula(`COUNTA(${rng("claim_no")})`, cs.total) : cs.total, fmt: "0" },
      { label: "Pending", value: rng("status") ? formula(COUNT_IF(rng("status")!, "Pending"), cs.open) : cs.open, fmt: "0" },
      { label: "SAR claimed", value: rng("contractor_cost_view") ? formula(`SUM(${rng("contractor_cost_view")})`, cs.costClaimed) : cs.costClaimed },
      { label: "SAR determined", value: rng("determination_cost_view") ? formula(`SUM(${rng("determination_cost_view")})`, cs.costDetermined) : cs.costDetermined },
      { label: "EOT claimed (days)", value: rng("contractor_eot_days_view") ? formula(`SUM(${rng("contractor_eot_days_view")})`, cs.eotClaimed) : cs.eotClaimed, fmt: "0" },
      { label: "EOT granted (days)", value: rng("determination_eot_days_view") ? formula(`SUM(${rng("determination_eot_days_view")})`, cs.eotGranted) : cs.eotGranted, fmt: "0" },
      { label: "Carried in the cost report (M)", value: l1cell("M", g.M), strong: true },
    ], 4);
    if (statuses.length)
      add(ws.name, {
        type: "bar",
        title: "Claimed and determined by status (SAR)",
        categories: rangeRef(ws.name, table.cols[0], table.first, table.last),
        catCache: statuses,
        series: [
          { name: "SAR claimed", values: rangeRef(ws.name, table.cols[2], table.first, table.last), cache: statuses.map((st) => cl.filter((c) => String(c.status ?? "") === st).reduce((t, c) => t + num(c.contractor_cost_view), 0)), color: CHART_COLORS.gold },
          { name: "SAR determined", values: rangeRef(ws.name, table.cols[3], table.first, table.last), cache: statuses.map((st) => cl.filter((c) => String(c.status ?? "") === st).reduce((t, c) => t + num(c.determination_cost_view), 0)), color: CHART_COLORS.teal },
        ],
        from: { col: 6, row: 3 },
        to: { col: 12, row: 19 },
        numFmt: "#,##0",
      });
  }

  /* ---------------- Early Warnings & Risks ---------------------------------------------------- */
  {
    const ws = wb.addWorksheet(SHEET.ew);
    const ews = rows("early_warnings");
    const rs = rows("risks");
    titleBlock(ws, "Early Warnings & Risks / Opportunities", sub(d), 12);
    padTo(ws, 21);
    const ewRef = d.registers.early_warnings ? registerBlock(ws, d.registers.early_warnings.def, ews, src("early_warnings")) : null;
    const rRef = d.registers.risks ? registerBlock(ws, d.registers.risks.def, rs, src("risks")) : null;
    const ewR = (key: string) => (ewRef && ewRef.last >= ewRef.first && ewRef.cols[key] ? rangeRef(ws.name, ewRef.cols[key], ewRef.first, ewRef.last) : null);
    const rR = (key: string) => (rRef && rRef.last >= rRef.first && rRef.cols[key] ? rangeRef(ws.name, rRef.cols[key], rRef.first, rRef.last) : null);
    const lik = ["High", "Med", "Low"];
    const openCost = (l: string) => ews.filter((e) => e.status === "Open" && String(e.likelihood ?? "").startsWith(l)).reduce((t, e) => t + num(e.cost_impact), 0);
    const openN = (l: string) => ews.filter((e) => e.status === "Open" && String(e.likelihood ?? "").startsWith(l)).length;
    const table = dataTable(
      ws,
      4,
      1,
      "Open early warnings by likelihood",
      ["Likelihood", "Open", "Potential cost (SAR)"],
      lik.map((l) => [l, ewR("status") && ewR("likelihood") ? formula(`COUNTIFS(${ewR("status")},"Open",${ewR("likelihood")},"${l}*")`, openN(l)) : openN(l), ewR("status") && ewR("likelihood") && ewR("cost_impact") ? formula(`SUMIFS(${ewR("cost_impact")},${ewR("status")},"Open",${ewR("likelihood")},"${l}*")`, openCost(l)) : openCost(l)]),
      [undefined, "0", WHOLE],
    );
    const risk = rs.filter((r) => r.type === "Risk");
    const opp = rs.filter((r) => r.type === "Opportunity");
    const openRisk = risk.filter((r) => r.status === "Open" || r.status === "Mitigating");
    const openOpp = opp.filter((r) => r.status === "Open" || r.status === "Mitigating");
    const ev = (list: RecordRow[]) => list.reduce((t, r) => t + num(r.expected_value), 0);
    const openF = (type: string, sum?: string) => (rR("type") && rR("status") && (!sum || rR(sum)) ? formula(sum ? `SUMIFS(${rR(sum)},${rR("type")},"${type}",${rR("status")},"Open")+SUMIFS(${rR(sum)},${rR("type")},"${type}",${rR("status")},"Mitigating")` : `COUNTIFS(${rR("type")},"${type}",${rR("status")},"Open")+COUNTIFS(${rR("type")},"${type}",${rR("status")},"Mitigating")`, sum ? ev(type === "Risk" ? openRisk : openOpp) : (type === "Risk" ? openRisk : openOpp).length) : null);
    kvTable(ws, table.last + 2, 1, "Position", [
      { label: "Early warnings", value: ewR("ew_no") ? formula(`COUNTA(${ewR("ew_no")})`, ews.length) : ews.length, fmt: "0" },
      { label: "Open early warnings", value: ewR("status") ? formula(COUNT_IF(ewR("status")!, "Open"), dash.openEarlyWarnings) : dash.openEarlyWarnings, fmt: "0" },
      { label: "Open cost exposure (SAR)", value: ewR("status") && ewR("cost_impact") ? formula(SUM_IFS(ewR("cost_impact")!, [ewR("status")!, "Open"]), dash.ewOpenValue) : dash.ewOpenValue },
      { label: "Carried in the cost report (L)", value: l1cell("L", g.L), strong: true },
      { label: "Open risks", value: openF("Risk") ?? openRisk.length, fmt: "0" },
      { label: "Risk expected value (SAR)", value: openF("Risk", "expected_value") ?? ev(openRisk) },
      { label: "Open opportunities", value: openF("Opportunity") ?? openOpp.length, fmt: "0" },
      { label: "Opportunity expected value (SAR)", value: openF("Opportunity", "expected_value") ?? ev(openOpp) },
    ], 3);
    if (ews.length)
      add(ws.name, {
        type: "pie",
        title: "Open early warnings by likelihood (SAR)",
        categories: rangeRef(ws.name, table.cols[0], table.first, table.last),
        catCache: lik.map((l) => `${l} likelihood`),
        series: [{ name: "Potential cost", values: rangeRef(ws.name, table.cols[2], table.first, table.last), cache: lik.map(openCost) }],
        pointColors: [CHART_COLORS.red, CHART_COLORS.amber, CHART_COLORS.green],
        from: { col: 5, row: 3 },
        to: { col: 11, row: 19 },
      });
  }

  /* ---------------- Provisional Sums ---------------------------------------------------------- */
  {
    const ws = wb.addWorksheet(SHEET.ps);
    const ps = rows("provisional_sums");
    titleBlock(ws, "Provisional Sums", sub(d), 12);
    padTo(ws, 21);
    const ref = d.registers.provisional_sums ? registerBlock(ws, d.registers.provisional_sums.def, ps, src("provisional_sums")) : null;
    const rng = (key: string) => (ref && ref.last >= ref.first && ref.cols[key] ? rangeRef(ws.name, ref.cols[key], ref.first, ref.last) : null);
    const tot = (k: string) => ps.reduce((t, r) => t + num(r[k]), 0);
    kvTable(ws, 4, 1, "Position", [
      { label: "Provisional sums", value: rng("item") ? formula(`COUNTA(${rng("item")})`, ps.length) : ps.length, fmt: "0" },
      { label: "Budget (SAR)", value: rng("budget") ? formula(`SUM(${rng("budget")})`, tot("budget")) : tot("budget") },
      { label: "Contract value (SAR)", value: rng("contract_value") ? formula(`SUM(${rng("contract_value")})`, tot("contract_value")) : tot("contract_value") },
      { label: "(Saving) / extra (SAR)", value: rng("saving_extra") ? formula(`SUM(${rng("saving_extra")})`, tot("saving_extra")) : tot("saving_extra"), strong: true },
      { label: "Approved", value: rng("status_id") ? formula(COUNT_IF(rng("status_id")!, "Approved"), ps.filter((r) => r.status_id__label === "Approved").length) : ps.filter((r) => r.status_id__label === "Approved").length, fmt: "0" },
      { label: "Pending", value: rng("status_id") ? formula(COUNT_IF(rng("status_id")!, "Pending"), ps.filter((r) => r.status_id__label === "Pending").length) : ps.filter((r) => r.status_id__label === "Pending").length, fmt: "0" },
    ], 3);
    if (ref && ref.last >= ref.first && ref.cols.item && ref.cols.budget && ref.cols.contract_value)
      add(ws.name, {
        type: "bar",
        title: "Budget vs contract value by provisional sum (SAR)",
        categories: rangeRef(ws.name, ref.cols.item, ref.first, ref.last),
        catCache: ps.map((r) => String(r.item ?? "")),
        series: [
          { name: "Budget", values: rangeRef(ws.name, ref.cols.budget, ref.first, ref.last), cache: ps.map((r) => num(r.budget)), color: CHART_COLORS.blue },
          { name: "Contract value", values: rangeRef(ws.name, ref.cols.contract_value, ref.first, ref.last), cache: ps.map((r) => num(r.contract_value)), color: CHART_COLORS.orange },
        ],
        from: { col: 4, row: 3 },
        to: { col: 12, row: 19 },
        numFmt: "#,##0",
      });
  }

  /* ---------------- Bonds & Insurance --------------------------------------------------------- */
  {
    const ws = wb.addWorksheet(SHEET.bonds);
    const bd = rows("bonds");
    const b = dash.bonds;
    titleBlock(ws, "Bonds & Insurance", sub(d), 12);
    padTo(ws, 21);
    const ref = d.registers.bonds ? registerBlock(ws, d.registers.bonds.def, bd, src("bonds")) : null;
    const rng = (key: string) => (ref && ref.last >= ref.first && ref.cols[key] ? rangeRef(ws.name, ref.cols[key], ref.first, ref.last) : null);
    const active = Math.max(0, b.total - b.expired - b.red - b.amber - b.released - b.superseded);
    const statusRows: [string, string, number, string][] = [
      ["Active", "Active", active, CHART_COLORS.green],
      ["Expiring within 60 days", "Expiring*", b.red + b.amber, CHART_COLORS.amber],
      ["Expired (live contracts)", "Expired*", b.expired, CHART_COLORS.red],
      ["Released (contract closed)", "Released*", b.released, CHART_COLORS.grey],
      ["Superseded (newer policy held)", "Superseded*", b.superseded, "9CA3AF"],
    ];
    const table = dataTable(
      ws,
      4,
      1,
      "Portfolio status",
      ["Status", "Bonds / policies"],
      statusRows.map(([label, pat, n]) => [label, rng("status") ? formula(COUNT_IF(rng("status")!, pat), n) : n]),
      [undefined, "0"],
    );
    kvTable(ws, table.last + 2, 1, "Position", [
      { label: "Bonds & policies", value: rng("ref") ? formula(`COUNTA(${rng("ref")})`, b.total) : b.total, fmt: "0" },
      { label: "Provided (SAR)", value: rng("amount_provided") ? formula(`SUM(${rng("amount_provided")})`, b.provided) : b.provided },
      { label: "Required by contract (SAR)", value: rng("required_amount") ? formula(`SUM(${rng("required_amount")})`, b.required) : b.required },
      { label: "Below the contract requirement", value: b.shortfall, fmt: "0" },
      { label: "Shortfall (SAR)", value: b.shortfallValue },
      { label: "Not yet approved", value: rng("approved") ? formula(COUNT_IF(rng("approved")!, "No"), b.notApproved) : b.notApproved, fmt: "0" },
      { label: "Bank verification outstanding", value: rng("bank_verification") ? formula(COUNT_IF(rng("bank_verification")!, "No"), b.notVerified) : b.notVerified, fmt: "0" },
    ], 3);
    if (b.total)
      add(ws.name, {
        type: "doughnut",
        title: "Bonds & insurance by status",
        categories: rangeRef(ws.name, table.cols[0], table.first, table.last),
        catCache: statusRows.map((s) => s[0]),
        series: [{ name: "Bonds / policies", values: rangeRef(ws.name, table.cols[1], table.first, table.last), cache: statusRows.map((s) => s[2]) }],
        pointColors: statusRows.map((s) => s[3]),
        from: { col: 4, row: 3 },
        to: { col: 11, row: 19 },
      });
  }

  /* ---------------- Invoices & Payments ------------------------------------------------------- */
  {
    const ws = wb.addWorksheet(SHEET.pay);
    titleBlock(ws, "Invoices & Payments", sub(d), 12);
    const pts = dash.payments;
    const last = pts[pts.length - 1];
    kvTable(ws, 4, 1, "Position (SAR)", [
      { label: "Claimed to date", value: last?.claimed ?? 0 },
      { label: "Certified to date (P)", value: l1cell("P", g.P), strong: true },
      { label: "Paid to date", value: last?.paid ?? 0 },
      { label: "Certified, not yet paid", value: (last?.certified ?? 0) - (last?.paid ?? 0) },
      { label: "Works to complete (Q)", value: l1cell("Q", g.Q) },
    ], 3);
    const table = dataTable(ws, 11, 1, "Cumulative claimed, certified and paid", ["Month", "Claimed", "Certified", "Paid"], pts.map((p) => [formatDate(p.date), p.claimed, p.certified, p.paid]), [undefined, WHOLE, WHOLE, WHOLE]);
    if (pts.length)
      add(ws.name, {
        type: "line",
        title: "Cumulative claimed, certified and paid (SAR)",
        categories: rangeRef(ws.name, table.cols[0], table.first, table.last),
        catCache: pts.map((p) => formatDate(p.date)),
        series: [
          { name: "Claimed", values: rangeRef(ws.name, table.cols[1], table.first, table.last), cache: pts.map((p) => p.claimed), color: CHART_COLORS.gold },
          { name: "Certified", values: rangeRef(ws.name, table.cols[2], table.first, table.last), cache: pts.map((p) => p.certified), color: CHART_COLORS.blue },
          { name: "Paid", values: rangeRef(ws.name, table.cols[3], table.first, table.last), cache: pts.map((p) => p.paid), color: CHART_COLORS.green },
        ],
        from: { col: 5, row: 3 },
        to: { col: 12, row: 19 },
        numFmt: "#,##0",
      });
    padTo(ws, Math.max(table.last + 1, 21));
    paymentTrackerBlock(ws, d);
    ws.addRow([]);
    for (const key of ["contracts", "payment_applications"]) if (d.registers[key]) registerBlock(ws, d.registers[key].def, rows(key), src(key));
  }

  /* ---------------- Final Account Status ------------------------------------------------------ */
  {
    const ws = wb.addWorksheet(SHEET.fa);
    const fa = rows("final_accounts");
    titleBlock(ws, "Final Account Status", sub(d), 12);
    padTo(ws, 21);
    const ref = d.registers.final_accounts ? registerBlock(ws, d.registers.final_accounts.def, fa, src("final_accounts")) : null;
    const rng = (key: string) => (ref && ref.last >= ref.first && ref.cols[key] ? rangeRef(ws.name, ref.cols[key], ref.first, ref.last) : null);
    const statuses = [...new Set(fa.map((r) => String(r.status ?? "")).filter(Boolean))];
    const moneyKey = ["final_account_value", "agreed_final_account", "revised_contract_value", "contract_value"].find((k) => ref?.cols[k]);
    const table = dataTable(
      ws,
      4,
      1,
      "Contracts by final account status",
      ["Status", "Contracts", ...(moneyKey ? ["Value (SAR)"] : [])],
      statuses.map((st) => [
        st,
        rng("status") ? formula(COUNT_IF(rng("status")!, st), fa.filter((r) => r.status === st).length) : fa.filter((r) => r.status === st).length,
        ...(moneyKey ? [rng("status") && rng(moneyKey) ? formula(SUM_IFS(rng(moneyKey)!, [rng("status")!, st]), fa.filter((r) => r.status === st).reduce((t, r) => t + num(r[moneyKey]), 0)) : fa.filter((r) => r.status === st).reduce((t, r) => t + num(r[moneyKey]), 0)] : []),
      ]),
      [undefined, "0", WHOLE],
    );
    if (statuses.length)
      add(ws.name, {
        type: "doughnut",
        title: "Contracts by final account status",
        categories: rangeRef(ws.name, table.cols[0], table.first, table.last),
        catCache: statuses,
        series: [{ name: "Contracts", values: rangeRef(ws.name, table.cols[1], table.first, table.last), cache: statuses.map((st) => fa.filter((r) => r.status === st).length) }],
        pointColors: [CHART_COLORS.amber, CHART_COLORS.green, CHART_COLORS.grey, CHART_COLORS.blue, CHART_COLORS.purple],
        from: { col: 5, row: 3 },
        to: { col: 11, row: 19 },
      });
  }

  /* ---------------- Cash Flow ----------------------------------------------------------------- */
  {
    const ws = wb.addWorksheet(SHEET.cf);
    const cf = d.cashflow;
    const ref = cashflowSheet(ws, d);
    ws.addRow([]);
    const start = ws.rowCount + 1;
    const months = cf.months;
    const table = dataTable(
      ws,
      start,
      1,
      "Monthly summary (SAR)",
      ["Month", "Forecast", "Actual", "Difference", "Cumulative forecast", "Cumulative actual"],
      months.map((m, i) => {
        const fc = ref.firstMonthCol + i * 3;
        const mt = cf.monthTotals[m.key] ?? { forecast: 0, actual: 0, difference: 0 };
        const rowN = start + 2 + i;
        return [
          m.label,
          formula(`$${colLetter(fc)}$${ref.totalRow}`, mt.forecast),
          formula(`$${colLetter(fc + 1)}$${ref.totalRow}`, mt.actual),
          formula(`$${colLetter(fc + 2)}$${ref.totalRow}`, mt.difference),
          formula(i === 0 ? `B${rowN}` : `E${rowN - 1}+B${rowN}`, cf.chart[i]?.forecast ?? 0),
          formula(i === 0 ? `C${rowN}` : `F${rowN - 1}+C${rowN}`, cf.chart[i]?.actual ?? 0),
        ];
      }),
      [undefined, WHOLE, WHOLE, WHOLE, WHOLE, WHOLE],
    );
    padTo(ws, table.last);
    const hasF = months.some((m) => cf.monthTotals[m.key]?.forecast);
    const hasA = months.some((m) => cf.monthTotals[m.key]?.actual);
    if (months.length && (hasF || hasA)) {
      const top = table.last + 1;
      add(ws.name, {
        type: "bar",
        title: "Monthly forecast vs actual (SAR)",
        categories: rangeRef(ws.name, 1, table.first, table.last),
        catCache: months.map((m) => m.label),
        series: [...(hasF ? [{ name: "Forecast", values: rangeRef(ws.name, 2, table.first, table.last), cache: months.map((m) => cf.monthTotals[m.key]?.forecast ?? 0), color: CHART_COLORS.blue }] : []), ...(hasA ? [{ name: "Actual", values: rangeRef(ws.name, 3, table.first, table.last), cache: months.map((m) => cf.monthTotals[m.key]?.actual ?? 0), color: CHART_COLORS.green }] : [])],
        from: { col: 0, row: top },
        to: { col: 6, row: top + 17 },
        numFmt: "#,##0",
      });
      add(ws.name, {
        type: "line",
        title: "Cumulative forecast vs actual (SAR)",
        categories: rangeRef(ws.name, 1, table.first, table.last),
        catCache: months.map((m) => m.label),
        series: [...(hasF ? [{ name: "Cumulative forecast", values: rangeRef(ws.name, 5, table.first, table.last), cache: cf.chart.map((p) => p.forecast), color: CHART_COLORS.blue }] : []), ...(hasA ? [{ name: "Cumulative actual", values: rangeRef(ws.name, 6, table.first, table.last), cache: cf.chart.map((p) => p.actual), color: CHART_COLORS.green }] : [])],
        from: { col: 7, row: top },
        to: { col: 13, row: top + 17 },
        numFmt: "#,##0",
      });
      padTo(ws, top + 18);
    }
  }

  /* ---------------- Budget Transfers ---------------------------------------------------------- */
  {
    const ws = wb.addWorksheet(SHEET.bt);
    const bt = rows("budget_transfers");
    titleBlock(ws, "Budget Transfers", sub(d), 12);
    padTo(ws, 14);
    const ref = d.registers.budget_transfers ? registerBlock(ws, d.registers.budget_transfers.def, bt, src("budget_transfers")) : null;
    const rng = (key: string) => (ref && ref.last >= ref.first && ref.cols[key] ? rangeRef(ws.name, ref.cols[key], ref.first, ref.last) : null);
    const tot = (st?: string) => bt.filter((r) => !st || r.status === st).reduce((t, r) => t + num(r.amount), 0);
    kvTable(ws, 4, 1, "Position (SAR)", [
      { label: "Transfers", value: rng("item") ? formula(`COUNTA(${rng("item")})`, bt.length) : bt.length, fmt: "0" },
      { label: "Approved transfers", value: rng("status") && rng("amount") ? formula(SUM_IFS(rng("amount")!, [rng("status")!, "Approved"]), tot("Approved")) : tot("Approved") },
      { label: "Pending transfers", value: rng("status") && rng("amount") ? formula(SUM_IFS(rng("amount")!, [rng("status")!, "Pending"]), tot("Pending")) : tot("Pending") },
      { label: "Net transfers in the cost report (F)", value: l1cell("F", g.F), strong: true },
    ], 3);
  }

  /* ---------------- Minutes & Actions --------------------------------------------------------- */
  momSheet(wb, d);
  const momWs = wb.getWorksheet("MoM");
  if (momWs) momWs.name = SHEET.mom;

  /* ---------------- Dashboard ----------------------------------------------------------------- */
  dashboardSheet(wsDash, d, l1, l1cell, l1has, add);

  finishWorkbook(wb, { indexSheet: SHEET.dash, freeze: { [SHEET.l1]: 1, [SHEET.l2]: 3 }, noFreeze: [SHEET.dash, SHEET.changes, SHEET.claims, SHEET.ew, SHEET.ps, SHEET.bonds, SHEET.pay, SHEET.fa, SHEET.cf, SHEET.bt] });
  const base = Buffer.from(await wb.xlsx.writeBuffer());
  return addChartsToXlsx(base, charts);
}

function dashboardSheet(ws: ExcelJS.Worksheet, d: ReportData, l1: Level1Ref, l1cell: (key: string, fallback: number) => CellVal, l1has: (key: string) => boolean, add: (sheet: string, c: XlsxChart) => void) {
  const g = executiveTotals(d.costReport);
  const dash = d.dashboard;
  const COLS = 18;
  for (let c = 1; c <= COLS; c++) ws.getColumn(c).width = 10.5;
  titleBlock(ws, `Commercial Dashboard – The Marina · ${d.period.label}`, sub(d), COLS);
  const movementOk = !!d.costReport.previousPeriod?.snapshotAvailable && !!d.movement && !d.movement.warning;
  const prevLabel = (d.costReport.previousPeriod?.label ?? "").replace("Monthly Report ", "");

  /* headline tiles (formulas to the Level 1 sheet) */
  sectionRow(ws, "Cost position (SAR) – figures read from the Level 1 sheet, which is built by formula from Level 2", COLS, XL.navy);
  const t1 = ws.rowCount + 1;
  const tiles1: Parameters<typeof tile>[4][] = [
    { label: "Approved baseline budget", value: l1cell("E", g.E), fill: TILE.navy, fmt: WHOLE, sub: "column E" },
    { label: "Latest budget", value: l1cell("G", g.G), fill: TILE.teal, fmt: WHOLE, sub: `transfers ${g.F >= 0 ? "+" : ""}${Math.round(g.F).toLocaleString("en-US")}` },
    { label: "Anticipated final account", value: l1cell("N", g.N), fill: TILE.orange, fmt: WHOLE, sub: "column N" },
    { label: "Variance to budget", value: l1has("O") ? l1cell("O", g.O) : formula(`${colLetter(4)}${t1 + 1}-${colLetter(7)}${t1 + 1}`, g.O), fill: g.O > 0 ? TILE.red : TILE.green, fmt: WHOLE, sub: g.O > 0 ? "over budget" : g.O < 0 ? "under budget" : "on budget" },
    { label: "Certified to date", value: l1cell("P", g.P), fill: TILE.purple, fmt: WHOLE, sub: `${g.N ? Math.round((g.P / g.N) * 100) : 0}% of the anticipated final account` },
    movementOk ? { label: "Period movement", value: l1has("N") && l1.rows.get("N") ? formula(`${cellRef(l1.sheet, l1.totalCol + 2, l1.rows.get("N")!)}`, g.S) : g.S, fill: g.S > 0 ? TILE.red : g.S < 0 ? TILE.green : TILE.blue, fmt: WHOLE, sub: `vs ${prevLabel}` } : { label: "Works to complete", value: l1has("Q") ? l1cell("Q", g.Q) : formula(`${colLetter(7)}${t1 + 1}-${colLetter(13)}${t1 + 1}`, g.Q), fill: TILE.blue, fmt: WHOLE, sub: "anticipated final account less certified" },
  ];
  tiles1.forEach((t, i) => tile(ws, t1, 1 + i * 3, 3, t));
  padTo(ws, t1 + 3);
  ws.addRow([]);

  /* open items tiles */
  sectionRow(ws, "Open items – counted on the module sheets", COLS, XL.navyLight);
  const t2 = ws.rowCount + 1;
  const cnt = (sheet: string, formulaText: string | null, value: number) => (formulaText ? formula(formulaText, value) : value);
  const tiles2: Parameters<typeof tile>[4][] = [
    { label: "Open change items", value: dash.openChanges, fill: TILE.blue, fmt: "0", sub: `${dash.openStages.map((s) => `${s.stage} ${s.open}`).join(" · ")}` },
    { label: "Open early warnings", value: cnt(SHEET.ew, null, dash.openEarlyWarnings), fill: TILE.gold, fmt: "0", sub: `SAR ${Math.round(dash.ewOpenValue).toLocaleString("en-US")} potential cost` },
    { label: "Pending claims", value: dash.openClaims, fill: TILE.orange, fmt: "0", sub: `SAR ${Math.round(dash.claimsPendingValue).toLocaleString("en-US")} claimed` },
    { label: "Bonds expired (live contracts)", value: dash.bonds.expired, fill: dash.bonds.expired ? TILE.red : TILE.green, fmt: "0", sub: `${dash.bonds.red + dash.bonds.amber} expiring within 60 days · ${dash.bonds.shortfall} below requirement` },
    { label: "Open risks", value: dash.openRisks, fill: dash.openRisks ? TILE.purple : TILE.green, fmt: "0", sub: "risk register" },
    { label: "Open actions", value: dash.actions.length, fill: dash.actions.length ? TILE.teal : TILE.green, fmt: "0", sub: "from the commercial meetings" },
  ];
  tiles2.forEach((t, i) => tile(ws, t2, 1 + i * 3, 3, t));
  padTo(ws, t2 + 3);
  ws.addRow([]);

  /* module links */
  sectionRow(ws, "Modules – click to open the sheet", COLS, XL.navyLight);
  const linkRow = ws.rowCount + 1;
  const links: [string, string][] = [
    [SHEET.l1, "Cost Report – Level 1"],
    [SHEET.l2, "Cost Report – Level 2"],
    [SHEET.move, "Movement"],
    [SHEET.changes, "Change Management"],
    [SHEET.claims, "Claims & Disputes"],
    [SHEET.ew, "Early Warnings & Risks"],
    [SHEET.ps, "Provisional Sums"],
    [SHEET.bonds, "Bonds & Insurance"],
    [SHEET.pay, "Invoices & Payments"],
    [SHEET.fa, "Final Account Status"],
    [SHEET.cf, "Cash Flow"],
    [SHEET.bt, "Budget Transfers"],
    [SHEET.mom, "Minutes & Actions"],
  ];
  links.forEach(([sheet, label], i) => {
    const r = linkRow + Math.floor(i / 6);
    const c = 1 + (i % 6) * 3;
    const cell = ws.getCell(r, c);
    cell.value = { formula: `HYPERLINK("#${q(sheet)}!A1","▸ ${label}")`, result: `▸ ${label}` };
    cell.font = { color: { argb: XL.accent }, underline: true, bold: true, size: 10 };
    ws.mergeCells(r, c, r, c + 2);
  });
  padTo(ws, linkRow + Math.ceil(links.length / 6));
  ws.addRow([]);

  /* charts: two rows of three; the data tables sit below */
  sectionRow(ws, "Charts – native Excel charts, linked to the tables at the foot of this sheet and to the Level 1 sheet", COLS, XL.navy);
  const chartTop = ws.rowCount; // 0-based row index for the anchor = rowCount (next row) - 1 + 1
  const CH = 17;
  padTo(ws, chartTop + CH * 2 + 2);
  ws.addRow([]);

  /* headlines & key issues */
  sectionRow(ws, "Headlines", COLS, XL.navyLight);
  const money = (v: number) => Math.round(v).toLocaleString("en-US");
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  const headlines = [
    `Anticipated Final Account of SAR ${money(g.N)} against a latest budget of SAR ${money(g.G)}: ${g.O === 0 ? "on budget" : `SAR ${money(Math.abs(g.O))} (${pct(Math.abs(g.O), g.G)}) ${g.O > 0 ? "over" : "under"} budget`}.`,
    ...(movementOk ? [`Movement since ${d.costReport.previousPeriod?.label}: ${g.S === 0 ? "no change" : `${g.S > 0 ? "increase" : "decrease"} of SAR ${money(Math.abs(g.S))}`}.`] : []),
    `Certified to date SAR ${money(g.P)} (${pct(g.P, g.N)} of the anticipated final account); works to complete SAR ${money(g.Q)}.`,
    `${dash.openChanges} open change items carried at SAR ${money(g.H + g.J + g.K)} (DVO, PVO and RFC); ${dash.openEarlyWarnings} open early warnings at SAR ${money(dash.ewOpenValue)}.`,
    `${dash.openClaims} pending claims (SAR ${money(dash.claimsPendingValue)} claimed); ${dash.openRisks} open risks.`,
    `Bonds & insurance: ${dash.bonds.expired} expired on live contracts, ${dash.bonds.red + dash.bonds.amber} expiring within 60 days, ${dash.bonds.shortfall} below the contract requirement.`,
  ];
  for (const h of headlines) {
    const r = ws.addRow([`• ${h}`]);
    ws.mergeCells(r.number, 1, r.number, COLS);
    r.alignment = { wrapText: true, vertical: "top" };
    r.height = 18;
  }
  ws.addRow([]);
  const issues = String(dash.keyIssues ?? "").split(/\r?\n/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  sectionRow(ws, "Key issues this period", COLS, XL.navyLight);
  if (!issues.length) ws.addRow(["None recorded on the Executive Summary page."]).font = { italic: true, color: { argb: XL.muted } };
  for (const it of issues) {
    const r = ws.addRow([`• ${it}`]);
    ws.mergeCells(r.number, 1, r.number, COLS);
    r.alignment = { wrapText: true, vertical: "top" };
    r.height = 18;
  }
  ws.addRow([]);
  sectionRow(ws, "Open actions from the commercial meetings", COLS, XL.navyLight);
  headerRow(ws.addRow(["No", "Topic", "", "Action", "", "", "", "", "Owner", "", "Due", "Status"]), { filter: false, zebra: true });
  for (const a of dash.actions) {
    const r = ws.addRow([a.item_no, a.topic, "", a.action, "", "", "", "", a.owner, "", a.due_date ? toDate(String(a.due_date)) : "", a.status]);
    ws.mergeCells(r.number, 2, r.number, 3);
    ws.mergeCells(r.number, 4, r.number, 8);
    ws.mergeCells(r.number, 9, r.number, 10);
    r.getCell(11).numFmt = "DD-MMM-YY";
    r.alignment = { wrapText: true, vertical: "top" };
  }
  if (!dash.actions.length) ws.addRow(["", "No open actions."]).font = { italic: true, color: { argb: XL.muted } };
  ws.addRow([]);

  /* data behind the charts */
  sectionRow(ws, "Data behind the charts", COLS, XL.navy);
  ws.addRow([]);
  const dataTop = ws.rowCount + 1;
  // A. AFA build-up (formulas to Level 1)
  const build: [string, string, number][] = [
    ["Latest budget (G)", "G", g.G],
    ["Determined VOs (H)", "H", g.H],
    ["Potential VOs (J)", "J", g.J],
    ["Requests for change (K)", "K", g.K],
    ["Early warnings (L)", "L", g.L],
    ["Claims (M)", "M", g.M],
  ];
  const tA = dataTable(ws, dataTop, 1, "Anticipated final account build-up (SAR)", ["Element", "SAR"], build.map(([l, k, v]) => [l, l1cell(k, v)]), [undefined, WHOLE]);
  ws.mergeCells(tA.first - 1, 1, tA.first - 1, 3);
  for (let r = tA.first; r <= tA.last; r++) {
    ws.mergeCells(r, 1, r, 3);
    const v = ws.getCell(r, 2).value;
    ws.getCell(r, 4).value = v;
    ws.getCell(r, 4).numFmt = WHOLE;
    ws.getCell(r, 2).value = null;
  }
  ws.getCell(tA.first - 1, 4).value = "SAR";
  const nRow = ws.getRow(tA.last + 1);
  nRow.getCell(1).value = "Anticipated final account (N)";
  nRow.getCell(4).value = l1cell("N", g.N);
  nRow.getCell(4).numFmt = WHOLE;
  ws.mergeCells(tA.last + 1, 1, tA.last + 1, 3);
  totalRow(nRow);
  // B. Packages
  const pk = [...d.costReport.chart].filter((p) => p.baseline || p.afa).sort((a, b) => b.baseline - a.baseline).slice(0, 12);
  const tB = dataTable(ws, dataTop, 6, "Largest packages (SAR)", ["Package", "", "Approved baseline", "Anticipated FA"], pk.map((p) => [p.package, "", p.baseline, p.afa]), [undefined, undefined, WHOLE, WHOLE]);
  for (let r = tB.first - 1; r <= tB.last; r++) ws.mergeCells(r, 6, r, 7);
  // C. Payments
  const pts = dash.payments.slice(-18);
  const tC = dataTable(ws, dataTop, 11, "Cumulative payments (SAR)", ["Month", "Claimed", "Certified", "Paid"], pts.map((p) => [formatDate(p.date), p.claimed, p.certified, p.paid]), [undefined, WHOLE, WHOLE, WHOLE]);
  // D. Bonds
  const b = dash.bonds;
  const bondRows: [string, number, string][] = [
    ["Active", Math.max(0, b.total - b.expired - b.red - b.amber - b.released - b.superseded), CHART_COLORS.green],
    ["Expiring within 60 days", b.red + b.amber, CHART_COLORS.amber],
    ["Expired (live contracts)", b.expired, CHART_COLORS.red],
    ["Released / superseded", b.released + b.superseded, CHART_COLORS.grey],
  ];
  const tD = dataTable(ws, dataTop, 16, "Bonds & insurance", ["Status", "", "Count"], bondRows.map(([l, n]) => [l, "", n]), [undefined, undefined, "0"]);
  for (let r = tD.first - 1; r <= tD.last; r++) ws.mergeCells(r, 16, r, 17);
  padTo(ws, Math.max(tA.last + 1, tB.last, tC.last, tD.last) + 1);
  const note = ws.addRow(["Amounts in SAR. The build-up, tiles and Level 1 figures are formulas; package, payment and bond figures are values as on the dashboard for this report."]);
  note.font = { italic: true, color: { argb: XL.muted }, size: 9 };
  ws.mergeCells(note.number, 1, note.number, COLS);

  /* the charts */
  const catCols = { c1: 2, c2: 1 + l1.columns };
  const gRow = l1.rows.get("G");
  const nRowL1 = l1.rows.get("N");
  const catLabels = d.level1Matrix.columns.map((c) => c.label);
  const gVals = d.level1Matrix.rows.find((r) => r.key === "G")?.values ?? [];
  const nVals = d.level1Matrix.rows.find((r) => r.key === "N")?.values ?? [];
  const row1 = chartTop;
  const row2 = chartTop + CH + 1;
  add(ws.name, {
    type: "doughnut",
    title: "Anticipated final account build-up",
    categories: rangeRef(ws.name, 1, tA.first, tA.last),
    catCache: build.map((x) => x[0]),
    series: [{ name: "SAR", values: rangeRef(ws.name, 4, tA.first, tA.last), cache: build.map((x) => x[2]) }],
    pointColors: [CHART_COLORS.navy, CHART_COLORS.blue, CHART_COLORS.teal, CHART_COLORS.gold, CHART_COLORS.amber, CHART_COLORS.red],
    from: { col: 0, row: row1 },
    to: { col: 6, row: row1 + CH },
  });
  if (gRow && nRowL1 && l1.columns)
    add(ws.name, {
      type: "bar",
      title: "Development budget vs anticipated final account by category",
      categories: rowRef(l1.sheet, l1.headerRow, catCols.c1, catCols.c2),
      catCache: catLabels,
      series: [
        { name: "Development budget", values: rowRef(l1.sheet, gRow, catCols.c1, catCols.c2), cache: gVals, color: CHART_COLORS.blue },
        { name: "Anticipated final account", values: rowRef(l1.sheet, nRowL1, catCols.c1, catCols.c2), cache: nVals, color: CHART_COLORS.orange },
      ],
      from: { col: 6, row: row1 },
      to: { col: 12, row: row1 + CH },
      numFmt: "#,##0",
    });
  if (b.total)
    add(ws.name, {
      type: "doughnut",
      title: "Bonds & insurance by status",
      categories: rangeRef(ws.name, 16, tD.first, tD.last),
      catCache: bondRows.map((x) => x[0]),
      series: [{ name: "Bonds / policies", values: rangeRef(ws.name, 18, tD.first, tD.last), cache: bondRows.map((x) => x[1]) }],
      pointColors: bondRows.map((x) => x[2]),
      from: { col: 12, row: row1 },
      to: { col: 18, row: row1 + CH },
    });
  if (pk.length)
    add(ws.name, {
      type: "bar",
      title: "Largest packages – baseline vs anticipated final account",
      categories: rangeRef(ws.name, 6, tB.first, tB.last),
      catCache: pk.map((p) => p.package),
      series: [
        { name: "Approved baseline", values: rangeRef(ws.name, 8, tB.first, tB.last), cache: pk.map((p) => p.baseline), color: CHART_COLORS.blue },
        { name: "Anticipated final account", values: rangeRef(ws.name, 9, tB.first, tB.last), cache: pk.map((p) => p.afa), color: CHART_COLORS.orange },
      ],
      from: { col: 0, row: row2 },
      to: { col: 6, row: row2 + CH },
      numFmt: "#,##0",
    });
  if (pts.length)
    add(ws.name, {
      type: "line",
      title: "Cumulative claimed, certified and paid",
      categories: rangeRef(ws.name, 11, tC.first, tC.last),
      catCache: pts.map((p) => formatDate(p.date)),
      series: [
        { name: "Claimed", values: rangeRef(ws.name, 12, tC.first, tC.last), cache: pts.map((p) => p.claimed), color: CHART_COLORS.gold },
        { name: "Certified", values: rangeRef(ws.name, 13, tC.first, tC.last), cache: pts.map((p) => p.certified), color: CHART_COLORS.blue },
        { name: "Paid", values: rangeRef(ws.name, 14, tC.first, tC.last), cache: pts.map((p) => p.paid), color: CHART_COLORS.green },
      ],
      from: { col: 6, row: row2 },
      to: { col: 12, row: row2 + CH },
      numFmt: "#,##0",
    });
  // movement by column, or budget lines when there is no previous report
  const mv = d.movement;
  const moves = movementOk && mv ? mv.kpis.filter((k) => ["G", "H", "J", "K", "L", "M", "N"].includes(k.key)) : [];
  if (moves.length) {
    const tE = dataTable(ws, ws.rowCount + 2, 1, `Movement since ${prevLabel} (SAR)`, ["Column", "", "Previous", "This report", "Movement"], moves.map((k) => [`${k.key} ${k.label}`, "", k.prev, k.now, k.delta]), [undefined, undefined, WHOLE, WHOLE, WHOLE]);
    for (let r = tE.first - 1; r <= tE.last; r++) ws.mergeCells(r, 1, r, 2);
    add(ws.name, {
      type: "barH",
      title: `Movement since ${prevLabel} by cost report column`,
      categories: rangeRef(ws.name, 1, tE.first, tE.last),
      catCache: moves.map((k) => `${k.key} ${k.label}`),
      series: [{ name: "Movement (SAR)", values: rangeRef(ws.name, 5, tE.first, tE.last), cache: moves.map((k) => k.delta), color: CHART_COLORS.teal }],
      from: { col: 12, row: row2 },
      to: { col: 18, row: row2 + CH },
      showValues: true,
      numFmt: "#,##0",
      legend: false,
    });
  } else {
    const items = [...d.costReport.lines].filter((l) => !l.is_budget_hold && l.O !== 0).sort((a, b) => Math.abs(b.O) - Math.abs(a.O)).slice(0, 8);
    if (items.length) {
      const tE = dataTable(ws, ws.rowCount + 2, 1, "Largest variances to budget by cost line (SAR)", ["Cost line", "", "Latest budget", "Anticipated FA", "Variance"], items.map((l) => [`${l.code} ${l.name}`, "", l.G, l.N, l.O]), [undefined, undefined, WHOLE, WHOLE, WHOLE]);
      for (let r = tE.first - 1; r <= tE.last; r++) ws.mergeCells(r, 1, r, 2);
      add(ws.name, {
        type: "barH",
        title: "Largest variances to budget by cost line",
        categories: rangeRef(ws.name, 1, tE.first, tE.last),
        catCache: items.map((l) => `${l.code} ${l.name}`.slice(0, 40)),
        series: [{ name: "Variance (SAR)", values: rangeRef(ws.name, 5, tE.first, tE.last), cache: items.map((l) => l.O), color: CHART_COLORS.teal }],
        from: { col: 12, row: row2 },
        to: { col: 18, row: row2 + CH },
        showValues: true,
        numFmt: "#,##0",
        legend: false,
      });
    }
  }
  ws.addRow([]);
  const foot = ws.addRow([`Generated ${formatDate(d.generatedAt)} by ${APP_NAME} · ${d.locked ? "issued report" : "draft – the period is not locked yet"} · all amounts SAR.`]);
  foot.font = { italic: true, color: { argb: XL.muted }, size: 9 };
  ws.mergeCells(foot.number, 1, foot.number, COLS);
}

