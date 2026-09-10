import { APP_NAME } from "../brand";
import ExcelJS from "exceljs";
import { executiveTotals } from "../cost-report/executive";
import { buildClaimsReport } from "./claims-report";
import { buildFaReport } from "./fa-report";
import type { ReportData } from "./data";
import { REPORT_SCHEDULES } from "./schedules";
import { MONEY_COLUMNS, type Money } from "../cost-report/columns";
import { formatDate, formatDateTime, formatMoney, toDate } from "../format";
import type { FieldDef, RecordRow, RegisterDef } from "../registers/types";

const NAVY = "FF0F2B4C";

function header(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  row.alignment = { wrapText: true, vertical: "middle" };
}
function bold(row: ExcelJS.Row, fill = "FFDCE6F2") {
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
}
const MONEY_FMT = "#,##0.00;[Red]-#,##0.00";

/** One or more sections only, used by the "Download Excel" buttons on each page. */
export async function renderSectionsExcel(data: ReportData, keys: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  for (const raw of keys) {
    const k = raw.trim();
    if (k === "minutes") momSheet(wb, data);
    else if (k === "exec") execSheet(wb, data);
    else if (k === "movement") movementSheet(wb, data);
    else if (k === "claims_report") claimsReportSheet(wb, data);
    else if (k === "fa_report") faReportSheet(wb, data);
    else if (k === "level1") costL1(wb.addWorksheet("Level 1 - Executive"), data);
    else if (k === "level2") costL2(wb.addWorksheet("Level 2 - Detailed"), data);
    else if (k === "cashflow") cashflowSheet(wb.addWorksheet("Cash Flow"), data);
    else {
      const sched = REPORT_SCHEDULES.find((sc) => sc.letter === k.toUpperCase());
      const reg = sched ? null : REPORT_SCHEDULES.find((sc) => (Array.isArray(sc.register) ? sc.register.includes(k) : sc.register === k));
      if (sched) addSchedule(wb, sched, data);
      else if (reg && data.registers[k]) registerBlock(wb.addWorksheet(data.registers[k].def.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " ")), data.registers[k].def, data.registers[k].rows, data.sources[k]);
    }
  }
  if (!wb.worksheets.length) wb.addWorksheet("Empty").addRow(["Nothing to export for this section."]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addSchedule(wb: ExcelJS.Workbook, s: (typeof REPORT_SCHEDULES)[number], data: ReportData) {
  const name = `Sch ${s.letter} - ${s.title}`.slice(0, 31).replace(/[\\/?*[\]:]/g, " ");
  if (s.special === "cost_l1") costL1(wb.addWorksheet(name), data);
  else if (s.special === "cost_l2") costL2(wb.addWorksheet(name), data);
  else if (s.special === "cashflow") cashflowSheet(wb.addWorksheet(name), data);
  else {
    const ws = wb.addWorksheet(name);
    for (const key of Array.isArray(s.register) ? s.register : [s.register!]) registerBlock(ws, data.registers[key].def, data.registers[key].rows, data.sources[key]);
  }
}

function movementSheet(wb: ExcelJS.Workbook, d: ReportData) {
  const ws = wb.addWorksheet("Movement");
  [44, 22, 22, 22, 30, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const m = d.movement;
  ws.addRow([`Movement since the previous issued report · ${d.period.label}`]).font = { bold: true, size: 12, color: { argb: NAVY } };
  if (!m || !m.previous) {
    ws.addRow(["No earlier locked report to compare with yet."]);
    if (m) statusAndAgeing(ws, m);
    return;
  }
  ws.addRow([`${m.previous.label}  →  ${m.current.label}`]).font = { italic: true };
  if (m.warning) ws.addRow([m.warning]).font = { bold: true, color: { argb: "FF92400E" } };
  ws.addRow([]);
  header(ws.addRow(["Cost report column", `Previous (${m.previous.label})`, "This report", "Movement"]));
  for (const k of m.kpis) {
    const r = ws.addRow([`${k.key}  ${k.label}`, k.prev, k.now, k.delta]);
    [2, 3, 4].forEach((c) => (r.getCell(c).numFmt = MONEY_FMT));
    if (["N", "O"].includes(k.key)) bold(r, "FFEFF6FF");
  }
  ws.addRow([]);
  header(ws.addRow(["Open changes by stage", "Previous count", "This report", "Previous amount", "This report amount", "Movement"]));
  for (const st of m.stages) {
    const r = ws.addRow([st.stage, st.prevCount, st.nowCount, st.prevAmount, st.nowAmount, st.nowAmount - st.prevAmount]);
    [4, 5, 6].forEach((c) => (r.getCell(c).numFmt = MONEY_FMT));
  }
  ws.addRow([]);
  ws.addRow(["Key period movements – the items that moved each cost-report column"]).font = { bold: true, size: 11, color: { argb: NAVY } };
  for (const k of m.keyMovements) {
    ws.addRow([]);
    const tie = Math.abs(k.itemsTotal - k.kpiDelta) < 0.5;
    const t = ws.addRow([`${k.col}  ${k.label}`, null, null, k.kpiDelta, tie ? "" : `items listed ${formatMoney(k.itemsTotal)} – rest not linked to a cost line / in budget hold`]);
    t.font = { bold: true, color: { argb: NAVY } };
    t.getCell(4).numFmt = MONEY_FMT;
    header(ws.addRow(["Ref", "Description", "What happened", "Previous", "This report", "Movement"]));
    if (!k.items.length) ws.addRow(["No movement."]);
    for (const it of k.items) {
      const r = ws.addRow([it.key, it.title, it.note, it.prev, it.now, it.delta]);
      [4, 5, 6].forEach((c) => (r.getCell(c).numFmt = MONEY_FMT));
    }
  }
  statusAndAgeing(ws, m);
  for (const g of m.groups) {
    ws.addRow([]);
    const t = ws.addRow([`${g.label}: ${g.prevCount} → ${g.nowCount} rows · ${g.valueLabel} ${formatMoney(g.prevValue)} → ${formatMoney(g.nowValue)}`]);
    t.font = { bold: true, color: { argb: NAVY } };
    header(ws.addRow(["What", "Ref", "Description", "Was", "Now", "Amount / movement"]));
    const rows = [
      ...g.added.map((it) => ["New", it.key, it.title, "", it.to ?? "", it.amount ?? null]),
      ...g.changed.map((it) => ["Updated", it.key, it.title, it.from ?? "", it.to ?? "", it.delta ?? null]),
      ...g.removed.map((it) => ["Removed", it.key, it.title, it.from ?? "", "", it.amount === null || it.amount === undefined ? null : -it.amount]),
    ];
    if (!rows.length) ws.addRow(["No movement."]);
    for (const row of rows) {
      const r = ws.addRow(row);
      r.getCell(6).numFmt = MONEY_FMT;
      const fill = row[0] === "New" ? "FFDCFCE7" : row[0] === "Removed" ? "FFFEE2E2" : "FFFEF3C7";
      r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    }
  }
}


function statusAndAgeing(ws: ExcelJS.Worksheet, m: NonNullable<ReportData["movement"]>) {
  const pair = (p: { prev: number; now: number }) => (m.previous ? `${p.prev} → ${p.now}` : p.now);
  ws.addRow([]);
  ws.addRow([`Change management status${m.previous ? ` (${m.previous.label} → this report)` : ""}`]).font = { bold: true, size: 11, color: { argb: NAVY } };
  header(ws.addRow(["Stage", "Total", "Approved", "Pending", "Cancelled"]));
  for (const s of m.statusCounts) ws.addRow([s.stage, pair(s.total), pair(s.approved), pair(s.pending), pair(s.cancelled)]);
  ws.addRow([]);
  ws.addRow(["DVO ageing – pending determined variation orders by days since raised"]).font = { bold: true, size: 11, color: { argb: NAVY } };
  header(ws.addRow(["Age", m.previous ? "Previous → this report" : "Count"]));
  for (const b of m.dvoAgeing) ws.addRow([b.bucket, pair({ prev: b.prev, now: b.now })]);
}

function paymentTrackerBlock(ws: ExcelJS.Worksheet, d: ReportData) {
  const m = d.movement;
  if (!m) return;
  ws.addRow([]);
  ws.addRow(["Payment status tracker"]).font = { bold: true, size: 11, color: { argb: NAVY } };
  header(ws.addRow(["Contract", "Contractor / consultant", "Status", "Revised value", "Certified to date", "Certified this period", "% certified", "Paid (net)", "% of certified paid", "Late IPCs", "Late payments"]));
  for (const r of m.payments) {
    const row = ws.addRow([`${r.key} ${r.title}`.trim(), r.contractor, r.status, r.revised, r.certified, r.certifiedPeriod, r.pctCertified === null ? null : r.pctCertified / 100, r.paid, r.pctPaid === null ? null : r.pctPaid / 100, r.lateIpcs, r.latePayments]);
    [4, 5, 6, 8].forEach((c) => (row.getCell(c).numFmt = MONEY_FMT));
    [7, 9].forEach((c) => (row.getCell(c).numFmt = "0.0%"));
  }
  const tot = (k: "revised" | "certified" | "certifiedPeriod" | "paid") => m.payments.reduce((t, r) => t + r[k], 0);
  const t = ws.addRow(["TOTAL", "", "", tot("revised"), tot("certified"), tot("certifiedPeriod"), tot("revised") ? tot("certified") / tot("revised") : null, tot("paid"), null, m.payments.reduce((a, r) => a + r.lateIpcs, 0), m.payments.reduce((a, r) => a + r.latePayments, 0)]);
  bold(t);
  [4, 5, 6, 8].forEach((c) => (t.getCell(c).numFmt = MONEY_FMT));
  t.getCell(7).numFmt = "0.0%";
  ws.addRow(["Certified = gross cumulative certified excl. VAT. Paid = net payments released. Late = after the contractual due date."]).font = { italic: true, size: 9 };
}


function claimsReportSheet(wb: ExcelJS.Workbook, d: ReportData) {
  const r = buildClaimsReport(d);
  const ws = wb.addWorksheet("Claims Status Report");
  [12, 30, 60, 14, 16, 16, 16, 10, 10, 34, 22, 8, 8].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.addRow([r.title]).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.addRow([`${d.programme.code} · ${d.asset ? `${d.asset.code} ${d.asset.name}` : d.programme.name} · as at ${formatDate(r.asOf)}${d.locked ? "" : " · DRAFT"}`]).font = { italic: true };
  ws.addRow([]);
  const h = r.headline;
  header(ws.addRow(["Headline", "Value", "Note"]));
  const kp: [string, unknown, string][] = [
    ["Claims recorded", h.total, `${h.pending} pending · ${h.approved} determined · ${h.rejected} rejected`],
    ["Contractors with claims", h.contractors, ""],
    ["Claimed (SAR)", h.claimedSar, `${h.eotClaimed} EOT days claimed`],
    ["Determined (SAR)", h.determinedSar, `${h.eotGranted} days granted`],
    ["Open exposure (SAR)", h.pendingSar, "gross value of pending claims"],
    ["Carried in cost report (M)", h.costReportM, ""],
    ["Late notices / late particulars", `${h.noticeLate} / ${h.detailLate}`, "later than 28 / 42 business days"],
    ["Disputes", h.disputes, "Notice of Dissatisfaction / Dispute"],
  ];
  for (const [k, v, n] of kp) {
    const row = ws.addRow([k, v, n]);
    if (typeof v === "number" && /SAR|\(M\)/.test(k)) row.getCell(2).numFmt = MONEY_FMT;
  }
  ws.addRow([]);
  ws.addRow(["Commercial narrative"]).font = { bold: true, size: 12, color: { argb: NAVY } };
  for (const p of r.narrative) {
    ws.addRow([p.heading]).font = { bold: true };
    const row = ws.addRow([p.text]);
    ws.mergeCells(row.number, 1, row.number, 10);
    row.alignment = { wrapText: true, vertical: "top" };
    row.height = Math.min(120, 15 * Math.ceil(p.text.length / 150));
  }
  if (r.movement) {
    ws.addRow([]);
    ws.addRow([r.movement.label]).font = { bold: true, size: 12, color: { argb: NAVY } };
    if (!r.movement.items.length) ws.addRow(["No movement in the claims register."]);
    for (const it of r.movement.items) ws.addRow([`• ${it}`]);
  }
  if (r.attention.length) {
    ws.addRow([]);
    ws.addRow(["Items requiring attention"]).font = { bold: true, size: 12, color: { argb: "FF7C2D12" } };
    for (const it of r.attention) ws.addRow([`• ${it}`]);
  }
  ws.addRow([]);
  ws.addRow(["Claims register at cut-off"]).font = { bold: true, size: 12, color: { argb: NAVY } };
  header(ws.addRow(["Ref", "Contractor", "Claim", "Type", "Claimed SAR", "Assessed SAR", "Determined SAR", "EOT claimed", "EOT granted", "Stage / next step", "Action with", "Days", "Notice", "Status", "Package"]));
  for (const c of r.claims) {
    const row = ws.addRow([c.claim_no, c.contractor, c.description, c.type, c.claimedSar, c.assessedSar, c.determinedSar, c.eotClaimed, c.eotGranted, c.stage, c.actionWith, c.daysSinceReceipt, c.notice, c.status, c.package]);
    [5, 6, 7].forEach((i) => (row.getCell(i).numFmt = MONEY_FMT));
    if (c.status === "Pending") row.getCell(14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  }
  const t = ws.addRow(["TOTAL", "", "", "", h.claimedSar, null, h.determinedSar, h.eotClaimed, h.eotGranted]);
  bold(t);
  [5, 7].forEach((i) => (t.getCell(i).numFmt = MONEY_FMT));
  ws.addRow([]);
  ws.addRow(["By contractor"]).font = { bold: true, size: 12, color: { argb: NAVY } };
  header(ws.addRow(["Contractor / consultant", "Claims", "Pending", "Claimed SAR", "Determined SAR", "EOT claimed", "EOT granted"]));
  for (const c of r.byContractor) {
    const row = ws.addRow([c.contractor, c.claims, c.pending, c.claimedSar, c.determinedSar, c.eotClaimed, c.eotGranted]);
    [4, 5].forEach((i) => (row.getCell(i).numFmt = MONEY_FMT));
  }
}


function faReportSheet(wb: ExcelJS.Workbook, d: ReportData) {
  const r = buildFaReport(d);
  const ws = wb.addWorksheet("Final Account Status Report");
  [12, 40, 30, 12, 18, 18, 16, 18, 14, 8, 14, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.addRow([r.title]).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.addRow([`${d.programme.code} · ${d.asset ? `${d.asset.code} ${d.asset.name}` : d.programme.name} · as at ${formatDate(r.asOf)}${d.locked ? "" : " · DRAFT"}`]).font = { italic: true };
  ws.addRow([]);
  const h = r.headline;
  header(ws.addRow(["Headline", "Value", "Note"]));
  const kp: [string, unknown, string][] = [
    ["Packages tracked", h.total, `${h.open} open · ${h.closed} closed · ${h.notRequired} not required`],
    ["Open (SAR)", h.openValue, "anticipated final account of open packages"],
    ["Closed – FAS signed (SAR)", h.closedValue, ""],
    ["Not required / direct payment (SAR)", h.notRequiredValue, ""],
    ["Total anticipated final account (SAR)", h.totalAfa, ""],
    ["Uncommitted on open packages (SAR)", h.uncommittedOpen, "still to be agreed"],
    ["Past forecast closure date", h.overdue, `${h.dueSoon} due within 60 days`],
    ["No forecast date", h.noDate, "open packages"],
  ];
  for (const [k, v, n] of kp) {
    const row = ws.addRow([k, v, n]);
    if (typeof v === "number" && /SAR/.test(k)) row.getCell(2).numFmt = MONEY_FMT;
  }
  ws.addRow([]);
  ws.addRow(["Commercial narrative"]).font = { bold: true, size: 12, color: { argb: NAVY } };
  for (const p of r.narrative) {
    ws.addRow([p.heading]).font = { bold: true };
    const row = ws.addRow([p.text]);
    ws.mergeCells(row.number, 1, row.number, 10);
    row.alignment = { wrapText: true, vertical: "top" };
    row.height = Math.min(120, 15 * Math.ceil(p.text.length / 150));
  }
  if (r.movement) {
    ws.addRow([]);
    ws.addRow([r.movement.label]).font = { bold: true, size: 12, color: { argb: NAVY } };
    if (!r.movement.items.length) ws.addRow(["No change to the final account status."]);
    for (const it of r.movement.items) ws.addRow([`• ${it}`]);
  }
  if (r.attention.length) {
    ws.addRow([]);
    ws.addRow(["Items requiring attention"]).font = { bold: true, size: 12, color: { argb: "FF7C2D12" } };
    for (const it of r.attention) ws.addRow([`• ${it}`]);
  }
  ws.addRow([]);
  ws.addRow(["Final account status by package"]).font = { bold: true, size: 12, color: { argb: NAVY } };
  header(ws.addRow(["ACC code", "Package", "Contractor / consultant", "Type", "Committed (I)", "Anticipated FA (N)", "Uncommitted", "Responsible", "Forecast closure", "Days", "Status", "Comments"]));
  for (const x of r.rows) {
    const row = ws.addRow([x.acc_ref, x.description, x.contractor, x.type, x.committed, x.afa, x.uncommitted, x.responsible, x.forecast ? toDate(x.forecast) : null, x.daysRemaining, x.status, x.comments]);
    [5, 6, 7].forEach((i) => (row.getCell(i).numFmt = MONEY_FMT));
    row.getCell(9).numFmt = "DD-MMM-YY";
    if (x.status === "Open") row.getCell(11).fill = { type: "pattern", pattern: "solid", fgColor: { argb: x.daysRemaining !== null && x.daysRemaining < 0 ? "FFFEE2E2" : "FFFEF3C7" } };
  }
  const t = ws.addRow(["TOTAL", "", "", "", r.rows.reduce((a, x) => a + x.committed, 0), h.totalAfa, r.rows.reduce((a, x) => a + x.uncommitted, 0)]);
  bold(t);
  [5, 6, 7].forEach((i) => (t.getCell(i).numFmt = MONEY_FMT));
  ws.addRow([]);
  ws.addRow(["By status"]).font = { bold: true, size: 12, color: { argb: NAVY } };
  header(ws.addRow(["Status", "Packages", "Anticipated final account (SAR)"]));
  for (const s of r.byStatus) ws.addRow([s.status, s.count, s.afa]).getCell(3).numFmt = MONEY_FMT;
}

export async function renderMonthlyReportExcel(data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = APP_NAME;
  coverSheet(wb, data);
  indexSheet(wb, data);
  momSheet(wb, data);
  execSheet(wb, data);
  movementSheet(wb, data);
  for (const s of REPORT_SCHEDULES) {
    const name = `Sch ${s.letter} - ${s.title}`.slice(0, 31).replace(/[\\/?*[\]:]/g, " ");
    if (s.special === "cost_l1") costL1(wb.addWorksheet(name), data);
    else if (s.special === "cost_l2") costL2(wb.addWorksheet(name), data);
    else if (s.special === "cashflow") cashflowSheet(wb.addWorksheet(name), data);
    else {
      const ws = wb.addWorksheet(name);
      for (const key of Array.isArray(s.register) ? s.register : [s.register!]) registerBlock(ws, data.registers[key].def, data.registers[key].rows, data.sources[key]);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function coverSheet(wb: ExcelJS.Workbook, d: ReportData) {
  const ws = wb.addWorksheet("Cover");
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 60;
  ws.addRow(["Monthly Commercial Report"]).font = { bold: true, size: 18, color: { argb: NAVY } };
  ws.addRow([d.period.label]).font = { size: 13 };
  ws.addRow([]);
  const p = d.period as unknown as Record<string, string | null>;
  const rows: [string, string][] = [
    ["Programme", `${d.programme.code} · ${d.programme.name}`],
    ["Asset", d.asset ? `${d.asset.code} · ${d.asset.name}` : ""],
    ["Client", d.client],
    ["Location", d.location],
    ["Report No", String(d.period.report_no)],
    ["Period", `${formatDate(d.period.period_start)} – ${formatDate(d.period.period_end)}`],
    ["Aconex reference", p.aconex_ref ?? ""],
    ["Status", d.locked ? `Locked ${formatDate(d.period.locked_at)} by ${d.period.locked_by ?? ""}` : "DRAFT – reporting period not locked"],
    ["", ""],
    ["Prepared by", `${p.prepared_by ?? ""}${p.prepared_date ? " · " + formatDate(p.prepared_date) : ""}`],
    ["Reviewed by", `${p.reviewed_by ?? ""}${p.reviewed_date ? " · " + formatDate(p.reviewed_date) : ""}`],
    ["Approved by", `${p.approved_by ?? ""}${p.approved_date ? " · " + formatDate(p.approved_date) : ""}`],
    ["", ""],
    ["Generated", formatDateTime(d.generatedAt)],
  ];
  for (const [k, v] of rows) {
    const r = ws.addRow([k, v]);
    r.getCell(1).font = { bold: true, color: { argb: "FF5B6577" } };
  }
}

function indexSheet(wb: ExcelJS.Workbook, d: ReportData) {
  const ws = wb.addWorksheet("Index");
  [14, 50, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  header(ws.addRow(["Section", "Title", "Checklist"]));
  const check = (n: number) => {
    const c = d.checklist.find((x) => x.module_no === n);
    return c ? (c.done ? "Done" : "Not done") : "";
  };
  ws.addRow(["", "Minutes of Meeting", check(11)]);
  ws.addRow(["", "Executive Summary", check(11)]);
  for (const s of REPORT_SCHEDULES) ws.addRow([`Schedule ${s.letter}`, s.title, check(s.moduleNo)]);
  ws.addRow([]);
  header(ws.addRow(["Role / position", "Name", "Organisation"]));
  for (const t of d.team) ws.addRow([t.role, t.name, t.organisation]);
}

function momSheet(wb: ExcelJS.Workbook, d: ReportData) {
  const ws = wb.addWorksheet("MoM");
  [12, 22, 40, 40, 14, 12, 12, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  if (!d.meetings.length) ws.addRow(["No meeting recorded for this reporting period."]);
  for (const m of d.meetings) {
    const mt = m.meeting;
    ws.addRow([`${mt.meeting_no} · ${mt.title} · ${formatDate(mt.meeting_date as string)}`]).font = { bold: true, size: 12, color: { argb: NAVY } };
    ws.addRow(["Attendees", String(mt.attendees ?? "").replace(/\n/g, ", ")]);
    if (mt.apologies) ws.addRow(["Apologies", String(mt.apologies)]);
    if (mt.notes) ws.addRow(["Notes", String(mt.notes)]);
    const items = (title: string, rows: RecordRow[]) => {
      ws.addRow([title]).font = { bold: true };
      header(ws.addRow(["Item", "Topic", "Discussion", "Action", "Owner", "Due", "Status", "Latest update"]));
      for (const i of rows) ws.addRow([i.item_no, i.topic, i.discussion, i.action, i.owner, i.due_date ? toDate(String(i.due_date)) : "", i.status, i.update]);
      if (!rows.length) ws.addRow(["", "No items."]);
    };
    if (m.carried.length) items("Carried forward", m.carried);
    items("Items raised at this meeting", m.items);
    ws.addRow([]);
  }
  ws.getColumn(6).numFmt = "DD-MMM-YY";
}

function execSheet(wb: ExcelJS.Workbook, d: ReportData) {
  const ws = wb.addWorksheet("Executive Summary");
  [40, 28, 50, 18, 18, 18, 12, 18, 14, 10, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const g = executiveTotals(d.costReport);
  const dash = d.dashboard;
  header(ws.addRow(["Measure", "SAR", "Note"]));
  const kp: [string, number, string][] = [
    ["Approved Budget (E)", g.E, ""],
    ["Latest Budget (G)", g.G, `incl. transfers ${formatMoney(g.F)}`],
    ["Committed (I)", g.I, `incl. DVOs ${formatMoney(g.H)}`],
    ["Anticipated Final Account (N)", g.N, ""],
    ["Variance to Latest Budget (O)", g.O, ""],
    ["Certified to Date (P)", g.P, ""],
    ["Works to Complete (Q)", g.Q, ""],
    ["Period Movement (S)", g.S, d.costReport.previousPeriod ? (d.costReport.previousPeriod.snapshotAvailable ? `vs ${d.costReport.previousPeriod.label}` : (d.costReport.previousPeriod.note ?? "previous period not locked")) : "no previous period"],
  ];
  for (const [k, v, n] of kp) ws.addRow([k, v, n]).getCell(2).numFmt = MONEY_FMT;
  ws.addRow([]);
  header(ws.addRow(["Open items", "Count", "Note"]));
  ws.addRow(["Open changes by stage", dash.openStages.map((s) => `${s.stage} ${s.open}`).join("  "), `${dash.openChanges} open in total`]);
  ws.addRow(["Open claims", dash.openClaims, `${formatMoney(dash.claimsPendingValue)} claimed and pending`]);
  ws.addRow(["Open early warnings", dash.openEarlyWarnings, `${formatMoney(dash.ewOpenValue)} potential cost`]);
  ws.addRow(["Bonds & insurance expiring within 60 days", dash.bonds.expiring.length, `${dash.bonds.expired} expired${dash.bonds.released ? ` · ${dash.bonds.released} released (contract closed)` : ""}`]);
  paymentTrackerBlock(ws, d);
  ws.addRow([]);
  ws.addRow(["Key issues this period"]).font = { bold: true, color: { argb: NAVY } };
  ws.addRow([dash.keyIssues || "None recorded."]).alignment = { wrapText: true };
  ws.addRow([]);
  ws.addRow(["Open actions"]).font = { bold: true, color: { argb: NAVY } };
  header(ws.addRow(["Item", "Topic", "Action", "Owner", "Due", "Status"]));
  for (const a of dash.actions) ws.addRow([a.item_no, a.topic, a.action, a.owner, a.due_date ? toDate(String(a.due_date)) : "", a.status]);
}

function moneyValues(m: Money) {
  return MONEY_COLUMNS.map((c) => m[c.key]);
}

function costL1(ws: ExcelJS.Worksheet, d: ReportData) {
  const r = d.costReport;
  ws.addRow([`Schedule A – Cost Report Level 1 · ${d.period.label} · source: ${d.sources.cost_report}`]).font = { bold: true, size: 12, color: { argb: NAVY } };
  header(ws.addRow(["Asset code", "Asset", "Cost category", "Lines", ...MONEY_COLUMNS.map((c) => `${c.key} ${c.label}`)]));
  for (const l of r.level1) ws.addRow([l.asset_code, l.asset_name, l.category, l.lines, ...moneyValues(l)]);
  bold(ws.addRow(["Total", "", "", r.lines.length, ...moneyValues(r.level1Total)]));
  bold(ws.addRow(["Total excl. budget hold", "", "", r.lines.filter((l) => !l.is_budget_hold).length, ...moneyValues(r.totalsExclHold)]), "FFF1F5F9");
  const chk = ws.addRow(["Check: L1 − L2 (must be zero)", "", "", "", ...moneyValues(r.check)]);
  chk.font = { bold: true, color: { argb: r.checkOk ? "FF047857" : "FFB91C1C" } };
  [14, 26, 22, 8].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  MONEY_COLUMNS.forEach((_, i) => {
    ws.getColumn(4 + i).width = 18;
    ws.getColumn(4 + i).numFmt = MONEY_FMT;
  });
}

function costL2(ws: ExcelJS.Worksheet, d: ReportData) {
  const r = d.costReport;
  ws.addRow([`Schedule B – Cost Report Level 2 · ${d.period.label} · source: ${d.sources.cost_report}`]).font = { bold: true, size: 12, color: { argb: NAVY } };
  header(ws.addRow(["A Code", "B Package", "C Name", "D Contractor", "Asset", ...MONEY_COLUMNS.map((c) => `${c.key} ${c.label}`)]));
  for (const s of r.sections) {
    ws.addRow([s.name]).font = { bold: true, color: { argb: NAVY } };
    for (const l of s.lines) ws.addRow([l.code, l.package, l.name, l.contractor, l.asset_code, ...moneyValues(l)]);
    bold(ws.addRow([`${s.name} subtotal`, "", "", "", "", ...moneyValues(s.subtotal)]), "FFF3F5F9");
  }
  bold(ws.addRow(["Grand total", "", "", "", "", ...moneyValues(r.grandTotal)]));
  [14, 24, 28, 24, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  MONEY_COLUMNS.forEach((_, i) => {
    ws.getColumn(6 + i).width = 18;
    ws.getColumn(6 + i).numFmt = MONEY_FMT;
  });
  ws.views = [{ state: "frozen", xSplit: 5, ySplit: 2 }];
}

function cashflowSheet(ws: ExcelJS.Worksheet, d: ReportData) {
  const cf = d.cashflow;
  ws.addRow([`Schedule I – Cash Flow · ${d.period.label} · SAR excl. VAT · source: ${d.sources.cashflow}`]).font = { bold: true, size: 12, color: { argb: NAVY } };
  const text = ["Transaction No", "Supplier", "Line Description", "Coding", "CBS", "Programme"];
  header(ws.addRow([...text, ...cf.months.flatMap((m) => [`${m.label} Forecast`, `${m.label} Actual`, `${m.label} Diff`]), "Total Forecast", "Total Actual", "Total Diff"]));
  for (const r of cf.rows) ws.addRow([r.transaction_no, r.supplier, r.description, r.coding, r.cbs, r.programme, ...cf.months.flatMap((m) => [r.cells[m.key].forecast ?? 0, r.cells[m.key].actual, r.cells[m.key].difference ?? 0]), r.total_forecast, r.total_actual, r.total_difference]);
  bold(ws.addRow(["Total", "", "", "", "", "", ...cf.months.flatMap((m) => [cf.monthTotals[m.key].forecast, cf.monthTotals[m.key].actual, cf.monthTotals[m.key].difference]), cf.grand.forecast, cf.grand.actual, cf.grand.difference]));
  [16, 22, 30, 12, 12, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (let i = text.length + 1; i <= text.length + (cf.months.length + 1) * 3; i++) {
    ws.getColumn(i).width = 15;
    ws.getColumn(i).numFmt = MONEY_FMT;
  }
  ws.addRow([]);
  ws.addRow(["Accruals – certified but not paid"]).font = { bold: true, color: { argb: NAVY } };
  header(ws.addRow(["Contract", "Supplier", "Net certified", "Net paid", "Accrued"]));
  for (const c of cf.accruals.byContract) ws.addRow([c.contract, c.supplier, c.net_certified, c.net_paid, c.accrued]);
  bold(ws.addRow(["Total", "", "", "", cf.accruals.totalAccrued]));
}

function registerBlock(ws: ExcelJS.Worksheet, def: RegisterDef, rows: RecordRow[], source: string) {
  const fields = def.fields.filter((f) => f.type !== "password");
  ws.addRow([`${def.title} (${rows.length}) · source: ${source}`]).font = { bold: true, size: 12, color: { argb: NAVY } };
  header(ws.addRow(fields.map((f) => f.label)));
  for (const r of rows) ws.addRow(fields.map((f) => cell(f, r)));
  if (def.totals?.length) {
    bold(ws.addRow(fields.map((f, i) => (i === 0 ? `Total (${rows.length})` : def.totals!.includes(f.key) ? rows.reduce((t, r) => t + (Number(r[f.key] ?? 0) || 0), 0) : ""))));
  }
  fields.forEach((f, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(col.width ?? 0, f.type === "textarea" ? 40 : Math.max(14, f.label.length + 2));
    if (f.type === "money") col.numFmt = MONEY_FMT;
    if (f.type === "date") col.numFmt = "DD-MMM-YY";
  });
  ws.addRow([]);
}

function cell(f: FieldDef, r: RecordRow): unknown {
  const v = r[f.key];
  if (v === null || v === undefined) return "";
  switch (f.type) {
    case "date":
      return toDate(String(v)) ?? "";
    case "boolean":
      return v ? "Yes" : "No";
    case "lookup":
      return r[`${f.key}__label`] ?? "";
    case "money":
    case "number":
    case "percent":
      return Number(v);
    default:
      return v;
  }
}
