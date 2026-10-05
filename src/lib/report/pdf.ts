import PDFDocument from "pdfkit";
import { executiveTotals } from "../cost-report/executive";
import type { ReportData } from "./data";
import { REPORT_SCHEDULES } from "./schedules";
import { MONEY_COLUMNS, type Money } from "../cost-report/columns";
import { formatMoney, formatDate, formatNumber, formatPercent, formatDateTime, formatMonthYear } from "../format";
import type { FieldDef } from "../registers/types";
import { APP_NAME } from "../brand";
import { buildClaimsReport, STALE_UPDATE_DAYS, type ClaimLine } from "./claims-report";
import { buildPaymentsReport } from "./payments-report";
import { buildChangesReport } from "./changes-report";
import { buildEwReport } from "./ew-report";
import { buildPsReport } from "./provisional-sums-report";
import { buildBondsReport } from "./bonds-report";
import { NO_BONDS_FILTER, bondsFilterLabel, type BondsFilter } from "../bonds/filter";
import { groupByParty, plural, type PartyGroup } from "./report-utils";
import { buildTransfersReport } from "./transfers-report";
import { buildFaReport } from "./fa-report";
import { buildPeriodSummary, sar, sarMove } from "./period-summary";
import { getAccommodationSummary, getCustomsSummary } from "../recovery/summary";
import { buildCashflowForecast, monthLabel, type CashMonth } from "../cashflow/forecast";
import { buildBudgetEac, level02Table, LEVEL02_MONEY, EAC_COLUMNS, type Level02Row } from "./budget-eac";
import { buildUncommittedTable } from "./uncommitted-ew";
import { buildAconexReconciliation, ACONEX_MEASURES } from "../recovery/aconex";
import { buildAconexChangeCheck } from "../recovery/aconex-changes";

type Doc = PDFKit.PDFDocument;

const NAVY = "#0f2b4c";
const ACCENT = "#2f80ed";
const MUTED = "#5b6577";
const LINE = "#d9dee8";
const ZEBRA = "#f6f8fb";
const PAGE = { width: 841.89, height: 595.28, margin: 36 }; // A4 landscape

interface Col {
  key: string;
  label: string;
  width: number; // relative weight
  align?: "left" | "right";
  format?: (v: unknown, row: Record<string, unknown>) => string;
}

interface Ctx {
  doc: Doc;
  data: ReportData;
  sections: { title: string; page: number }[];
  sectionTitle: string;
}

/** Page-level choices carried into a section, so a download matches what the page was showing. */
export interface SectionOptions {
  bonds?: BondsFilter;
}

/** Renders the full monthly report and returns the PDF bytes. */
/** Section keys accepted by the per-page export: "minutes", "exec", "movement", schedule letters, register keys, "level1", "level2", "cashflow". */
export function resolveSections(keys: string[], opts: SectionOptions = {}): { title: string; run: (ctx: Ctx) => void }[] {
  const out: { title: string; run: (ctx: Ctx) => void }[] = [];
  for (const raw of keys) {
    const k = raw.trim();
    if (k === "minutes") out.push({ title: "Minutes of Meeting", run: minutes });
    else if (k === "exec") out.push({ title: "Executive Summary", run: executiveSummary });
    else if (k === "movement") out.push({ title: "Movement since the previous report", run: movementSection });
    else if (k === "claims_report") out.push({ title: "Claims Status Report", run: claimsStatusReport });
    else if (k === "fa_report") out.push({ title: "Final Account Status Report", run: faStatusReport });
    else if (k === "payments_report") out.push({ title: "Invoice & Payment Status Report", run: paymentsStatusReport });
    else if (k === "changes_report") out.push({ title: "Change Management Status Report", run: changesStatusReport });
    else if (k === "ew_report") out.push({ title: "Early Warnings & Risks / Opportunities Status Report", run: ewStatusReport });
    else if (k === "ps_report") out.push({ title: "Provisional Sums Status Report", run: psStatusReport });
    else if (k === "bonds_report") {
      const f = opts.bonds ?? NO_BONDS_FILTER;
      const tag = bondsFilterLabel(f);
      out.push({ title: `Bonds & Insurance Status Report${tag ? ` – ${tag}` : ""}`, run: (ctx) => bondsStatusReport(ctx, f) });
    }
    else if (k === "transfers_report") out.push({ title: "Budget Transfers Status Report", run: transfersStatusReport });
    else if (k === "period_summary") out.push({ title: "Period Summary – Key Period Movements", run: periodSummaryReport });
    else if (k === "recovery_report") out.push({ title: "Cost Recovery – Accommodation & Customs Duty", run: recoveryReport });
    else if (k === "uncommitted_ew") out.push({ title: "Uncommitted Costs and Early Warnings", run: uncommittedEwReport });
    else if (k === "cashflow_forecast") out.push({ title: "Cash Flow Forecast – Employer Executive Review", run: cashflowForecastReport });
    else if (k === "aconex_report") out.push({ title: "Aconex Cost Check – control accounts vs cost report", run: aconexReport });
    else if (k === "level1") out.push({ title: "Schedule A – Cost Report Level 1 (Executive)", run: costLevel1 });
    else if (k === "level2") out.push({ title: "Schedule B – Cost Report Level 2 (Detailed)", run: costLevel2 });
    else if (k === "level02r1") out.push({ title: "Cost Report Level 02 (R1) – head office Budget EAC layout", run: costLevel02R1 });
    else if (k === "cashflow") out.push({ title: "Schedule I – Cash Flow", run: cashflow });
    else {
      const sched = REPORT_SCHEDULES.find((sc) => sc.letter === k.toUpperCase());
      if (sched) {
        const run = (ctx: Ctx) => {
          if (sched.special === "cost_l1") costLevel1(ctx);
          else if (sched.special === "cost_l2") costLevel2(ctx);
          else if (sched.special === "cashflow") cashflow(ctx);
          else for (const key of Array.isArray(sched.register) ? sched.register : [sched.register!]) registerTable(ctx, key);
        };
        out.push({ title: `Schedule ${sched.letter} – ${sched.title}`, run });
      } else {
        const sched2 = REPORT_SCHEDULES.find((sc) => (Array.isArray(sc.register) ? sc.register.includes(k) : sc.register === k));
        if (sched2) out.push({ title: `Schedule ${sched2.letter} – ${sched2.title}`, run: (ctx) => registerTable(ctx, k) });
      }
    }
  }
  return out;
}

/** One or more sections only (no cover / index): used by the "Download PDF" buttons on each page. */
export async function renderSectionsPdf(data: ReportData, keys: string[], opts: SectionOptions = {}): Promise<Buffer> {
  const parts = resolveSections(keys, opts);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: PAGE.margin, bufferPages: true, info: { Title: `${data.period.label} – ${parts.map((p) => p.title).join(", ")}`, Author: APP_NAME } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ctx: Ctx = { doc, data, sections: [], sectionTitle: "" };
  parts.forEach((part, i) => {
    if (i > 0) doc.addPage();
    ctx.sections.push({ title: part.title, page: doc.bufferedPageRange().count });
    ctx.sectionTitle = part.title;
    heading(ctx, part.title, `${data.programme.code} · ${data.programme.name} · ${data.period.label}${data.locked ? "" : " · DRAFT (period not locked)"} · generated ${formatDateTime(data.generatedAt)}`);
    part.run(ctx);
  });
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    footer(ctx, i + 1, range.count);
  }
  doc.end();
  return done;
}

export async function renderMonthlyReportPdf(data: ReportData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: PAGE.margin, bufferPages: true, info: { Title: `${data.period.label} – ${data.programme.code}`, Author: APP_NAME } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const ctx: Ctx = { doc, data, sections: [], sectionTitle: "" };

  cover(ctx);
  doc.addPage();
  const indexPage = doc.bufferedPageRange().count - 1;
  // index is written at the end, once page numbers are known
  doc.addPage();
  minutes(ctx);
  newSection(ctx, "Executive Summary");
  executiveSummary(ctx);
  newSection(ctx, "Movement since the previous report");
  movementSection(ctx);
  for (const s of REPORT_SCHEDULES) {
    newSection(ctx, `Schedule ${s.letter} – ${s.title}`);
    if (s.special === "cost_l1") costLevel1(ctx);
    else if (s.special === "cost_l2") costLevel2(ctx);
    else if (s.special === "cashflow") cashflow(ctx);
    else for (const key of Array.isArray(s.register) ? s.register : [s.register!]) registerTable(ctx, key);
  }

  // Footers on every page except the cover, then the index
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    footer(ctx, i + 1, range.count);
  }
  doc.switchToPage(indexPage);
  index(ctx);
  doc.end();
  return done;
}

/* ------------------------------------------------------------------ */

function newSection(ctx: Ctx, title: string) {
  ctx.doc.addPage();
  ctx.sections.push({ title, page: ctx.doc.bufferedPageRange().count });
  ctx.sectionTitle = title;
  heading(ctx, title);
}

function heading(ctx: Ctx, title: string, sub?: string) {
  const { doc } = ctx;
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(15).text(title, PAGE.margin, PAGE.margin - 6);
  if (sub) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(sub);
  doc.moveDown(0.4);
  const y = doc.y;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).strokeColor(ACCENT).lineWidth(1.2).stroke();
  doc.y = y + 10;
  doc.fillColor("#172033").font("Helvetica").fontSize(9);
}

/**
 * A section heading. It reserves enough room for itself *and the first rows of whatever follows it*,
 * because 40pt was only the heading: a heading that fitted but whose table did not was left stranded
 * at the foot of a page with nothing under it, which reads as a printing fault.
 */
function subheading(ctx: Ctx, title: string, note?: string) {
  const { doc } = ctx;
  ensureSpace(ctx, 110);
  doc.moveDown(0.3);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(title);
  if (note) doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(note);
  doc.moveDown(0.3);
  doc.fillColor("#172033").font("Helvetica").fontSize(9);
}

function footer(ctx: Ctx, pageNo: number, total: number) {
  const { doc, data } = ctx;
  const y = PAGE.height - PAGE.margin + 10;
  // Writing below the bottom margin would make pdfkit start a new page: lift the margin while drawing the footer.
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
  doc.text(`${data.programme.code} · ${data.period.label}${data.locked ? "" : " · DRAFT (period not locked)"}`, PAGE.margin, y, { lineBreak: false });
  doc.text(`Page ${pageNo} of ${total}`, PAGE.width - PAGE.margin - 100, y, { width: 100, align: "right", lineBreak: false });
  doc.restore();
  doc.page.margins.bottom = bottom;
}

function ensureSpace(ctx: Ctx, needed: number) {
  const { doc } = ctx;
  if (doc.y + needed > PAGE.height - PAGE.margin - 14) {
    doc.addPage();
    heading(ctx, `${ctx.sectionTitle} (continued)`);
  }
}

/* ------------------------------------------------------------------ */
/* Cover                                                               */

function cover(ctx: Ctx) {
  const { doc, data } = ctx;
  doc.rect(0, 0, PAGE.width, PAGE.height).fill(NAVY);
  doc.rect(0, 0, 14, PAGE.height).fill(ACCENT);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(30).text("Monthly Commercial Report", 70, 110);
  doc.font("Helvetica").fontSize(16).fillColor("#cfe0f5").text(data.period.label, 70, 152);
  doc.moveDown(1.5);
  let ly = 210;
  const line = (k: string, v: string) => {
    doc.font("Helvetica").fontSize(10).fillColor("#9fb8d8").text(k, 70, ly + 2, { width: 150, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#ffffff").text(v || "—", 230, ly, { width: 540 });
    ly = Math.max(ly + 22, doc.y + 6);
  };
  line("Programme", `${data.programme.code} · ${data.programme.name}`);
  line("Asset", data.asset ? `${data.asset.code} · ${data.asset.name}` : "");
  if (data.client) line("Client", data.client);
  if (data.location) line("Location", data.location);
  line("Report No", String(data.period.report_no));
  line("Cut-off date", formatDate(data.period.period_end));
  line("Aconex reference", String((data.period as unknown as { aconex_ref?: string }).aconex_ref ?? ""));
  line("Status", data.locked ? `Locked ${formatDate(data.period.locked_at)} by ${data.period.locked_by ?? ""}` : "DRAFT – reporting period not yet locked");

  // Sign-off block
  const p = data.period as unknown as Record<string, string | null>;
  const boxes: [string, string | null, string | null][] = [
    ["Prepared by", p.prepared_by, p.prepared_date],
    ["Reviewed by", p.reviewed_by, p.reviewed_date],
    ["Approved by", p.approved_by, p.approved_date],
  ];
  const w = 220;
  let x = 70;
  const y = PAGE.height - 150;
  for (const [label, name, date] of boxes) {
    doc.rect(x, y, w, 72).lineWidth(1).strokeColor("#3d5f86").stroke();
    doc.fillColor("#9fb8d8").font("Helvetica").fontSize(8).text(label.toUpperCase(), x + 10, y + 8);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(12).text(name || "—", x + 10, y + 24, { width: w - 20 });
    doc.fillColor("#cfe0f5").font("Helvetica").fontSize(9).text(date ? formatDate(date) : "Date: ____________", x + 10, y + 50);
    x += w + 16;
  }
  doc.fillColor("#9fb8d8").font("Helvetica").fontSize(8).text(`Generated ${formatDateTime(data.generatedAt)} by ${APP_NAME} · all amounts SAR`, 70, PAGE.height - 50);
}

/* ------------------------------------------------------------------ */
/* Index                                                               */

function index(ctx: Ctx) {
  const { doc, data } = ctx;
  doc.x = PAGE.margin;
  doc.y = PAGE.margin;
  heading(ctx, "Index");
  const cols: Col[] = [
    { key: "no", label: "Section", width: 1, align: "left" },
    { key: "title", label: "Title", width: 5 },
    { key: "status", label: "Checklist", width: 1.5 },
    { key: "page", label: "Page", width: 1, align: "right" },
  ];
  const rows: Record<string, unknown>[] = [];
  const check = (moduleNo: number) => {
    const c = data.checklist.find((x) => x.module_no === moduleNo);
    return c ? (c.done ? "Done" : "Not done") : "";
  };
  ctx.sections.forEach((s, i) => {
    const sched = REPORT_SCHEDULES.find((x) => s.title.startsWith(`Schedule ${x.letter} `));
    rows.push({ no: sched ? `Schedule ${sched.letter}` : String(i + 1), title: s.title.replace(/^Schedule [A-Z] – /, ""), status: sched ? check(sched.moduleNo) : s.title === "Executive Summary" ? check(11) : s.title.startsWith("Minutes") ? check(11) : "", page: String(s.page) });
  });
  table(ctx, cols, rows, { zebra: true });
  doc.moveDown(1);
  subheading(ctx, "Distribution list");
  table(
    ctx,
    [
      { key: "role", label: "Role / position", width: 3 },
      { key: "name", label: "Name", width: 2 },
      { key: "organisation", label: "Organisation", width: 2 },
      { key: "in_distribution", label: "Distribution", width: 1, format: (v) => (v ? "Yes" : "No") },
    ],
    data.team as Record<string, unknown>[],
  );
}

/* ------------------------------------------------------------------ */
/* Minutes                                                             */

function minutes(ctx: Ctx) {
  const { doc, data } = ctx;
  ctx.sections.push({ title: "Minutes of Meeting", page: doc.bufferedPageRange().count });
  ctx.sectionTitle = "Minutes of Meeting";
  heading(ctx, "Minutes of Meeting");
  if (!data.meetings.length) {
    doc.fillColor(MUTED).text("No meeting recorded for this reporting period.");
    return;
  }
  const itemCols: Col[] = [
    { key: "item_no", label: "Item", width: 1 },
    { key: "topic", label: "Topic", width: 2 },
    { key: "discussion", label: "Discussion", width: 3.5 },
    { key: "action", label: "Action", width: 3 },
    { key: "owner", label: "Owner", width: 1.2 },
    { key: "due_date", label: "Due", width: 1, format: (v) => formatDate(v as string) },
    { key: "status", label: "Status", width: 1 },
  ];
  for (const m of data.meetings) {
    const mt = m.meeting;
    subheading(ctx, `${mt.meeting_no} · ${mt.title} · ${formatDate(mt.meeting_date as string)}`, [mt.venue, mt.chair ? `Chair: ${mt.chair}` : ""].filter(Boolean).join(" · "));
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#172033").text("Attendees: ", { continued: true }).font("Helvetica").text(String(mt.attendees ?? "—").replace(/\n/g, ", "));
    if (mt.apologies) doc.font("Helvetica-Bold").text("Apologies: ", { continued: true }).font("Helvetica").text(String(mt.apologies));
    if (mt.notes) doc.font("Helvetica").fillColor(MUTED).text(String(mt.notes));
    doc.moveDown(0.4);
    if (m.carried.length) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text("Carried forward (open items from earlier meetings)");
      doc.moveDown(0.2);
      table(ctx, itemCols, m.carried as Record<string, unknown>[], { zebra: true });
      doc.moveDown(0.4);
    }
    doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text("Items raised at this meeting");
    doc.moveDown(0.2);
    if (m.items.length) table(ctx, itemCols, m.items as Record<string, unknown>[], { zebra: true });
    else doc.font("Helvetica").fillColor(MUTED).fontSize(8.5).text("No items recorded.");
    doc.moveDown(0.6);
  }
}

/* ------------------------------------------------------------------ */
/* Executive summary                                                   */

/**
 * The row of figure cards at the top of every status report. Kept in one place because it was
 * copied into nine reports and drifted: the figure was set at a fixed 12pt, so a long one (a money
 * pair, or a nine-figure SAR amount) wrapped onto a second line and printed straight through the
 * caption underneath it. Here it is shrunk until it fits on one line, and the caption is given a
 * height so it can never grow into the card below.
 */
function kpiCards(ctx: Ctx, kpis: [string, string, string][], tone?: (k: [string, string, string]) => string | null) {
  const { doc } = ctx;
  const cw = (PAGE.width - PAGE.margin * 2 - 3 * 10) / 4;
  const top = doc.y;
  let x = PAGE.margin;
  let y = top;
  kpis.forEach((k, i) => {
    doc.rect(x, y, cw, 52).fillAndStroke("#ffffff", LINE);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(k[0].toUpperCase(), x + 8, y + 7, { width: cw - 16, height: 10, ellipsis: true, lineBreak: false });
    let size = 12;
    doc.font("Helvetica-Bold");
    while (size > 6.5 && doc.fontSize(size).widthOfString(k[1]) > cw - 16) size -= 0.5;
    doc.fillColor(tone?.(k) ?? NAVY).fontSize(size).text(k[1], x + 8, y + 21 - size / 2, { width: cw - 16, lineBreak: false, ellipsis: true });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(k[2], x + 8, y + 36, { width: cw - 16, height: 14, ellipsis: true });
    x += cw + 10;
    if ((i + 1) % 4 === 0) {
      x = PAGE.margin;
      y += 62;
    }
  });
  doc.y = top + Math.ceil(kpis.length / 4) * 62;
  doc.x = PAGE.margin;
}

/**
 * A report's rows printed one party at a time – a heading with that party's name, a line saying what
 * they hold, then their own table. A status report is worked one contractor at a time, so it reads
 * far better that way than as one long list sorted by a column nobody chases by.
 */
function partyTables<T>(
  ctx: Ctx,
  groups: PartyGroup<T>[],
  columns: Col[],
  note?: (g: PartyGroup<T>) => string,
  /** The column naming the party, used for the combined table of one-item parties. */
  partyColumn?: Col,
) {
  const { doc } = ctx;
  const width = PAGE.width - PAGE.margin * 2;
  // A heading and a full set of column titles above a single row is more furniture than information.
  // Parties with one item each are collected into one table with their name as a column instead,
  // which keeps the page readable when a register has a long tail of one-offs.
  const many = partyColumn ? groups.filter((g) => g.count > 1) : groups;
  const singles = partyColumn ? groups.filter((g) => g.count === 1) : [];
  for (const g of many) {
    ensureSpace(ctx, 70);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(g.party, PAGE.margin, doc.y, { width });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(note?.(g) ?? plural(g.count, "item"), PAGE.margin, doc.y + 1, { width });
    doc.moveDown(0.35);
    doc.x = PAGE.margin;
    table(ctx, columns, g.items as unknown as Record<string, unknown>[], { zebra: true });
    doc.moveDown(0.5);
  }
  if (singles.length === 1) {
    const g = singles[0];
    ensureSpace(ctx, 70);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(g.party, PAGE.margin, doc.y, { width });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(note?.(g) ?? plural(g.count, "item"), PAGE.margin, doc.y + 1, { width });
    doc.moveDown(0.35);
    doc.x = PAGE.margin;
    table(ctx, columns, g.items as unknown as Record<string, unknown>[], { zebra: true });
    doc.moveDown(0.5);
  } else if (singles.length > 1) {
    ensureSpace(ctx, 70);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(`${plural(singles.length, "contractor")} with one item each`, PAGE.margin, doc.y, { width });
    doc.moveDown(0.35);
    doc.x = PAGE.margin;
    table(ctx, [partyColumn!, ...columns], singles.flatMap((g) => g.items) as unknown as Record<string, unknown>[], { zebra: true });
    doc.moveDown(0.5);
  }
}

function executiveSummary(ctx: Ctx) {
  const { doc, data } = ctx;
  const g = executiveTotals(data.costReport);
  const d = data.dashboard;
  const kpis: [string, string, string][] = [
    ["Approved Budget (E)", formatMoney(g.E), ""],
    ["Latest Budget (G)", formatMoney(g.G), `incl. transfers ${formatMoney(g.F)}`],
    ["Committed (I)", formatMoney(g.I), `incl. DVOs ${formatMoney(g.H)}`],
    ["Anticipated Final Account (N)", formatMoney(g.N), `PVO/RFC/EW/claims ${formatMoney(g.J + g.K + g.L + g.M)}`],
    ["Variance to Latest Budget (O)", formatMoney(g.O), g.O > 0 ? "over budget" : g.O < 0 ? "under budget" : "on budget"],
    ["Certified to Date (P)", formatMoney(g.P), g.N ? `${Math.round((g.P / g.N) * 100)}% of AFA` : ""],
    ["Works to Complete (Q)", formatMoney(g.Q), ""],
    ["Period Movement (S)", formatMoney(g.S), data.costReport.previousPeriod ? (data.costReport.previousPeriod.snapshotAvailable ? `vs ${data.costReport.previousPeriod.label}` : (data.costReport.previousPeriod.note ?? "previous period not locked")) : "no previous period"],
  ];
  kpiCards(ctx, kpis, (k) => ((k[0].startsWith("Variance") || k[0].startsWith("Period")) && !k[1].startsWith("-") && k[1] !== "0.00" ? "#b91c1c" : null));
  doc.x = PAGE.margin;

  subheading(ctx, "Open items");
  table(
    ctx,
    [
      { key: "k", label: "Measure", width: 3 },
      { key: "v", label: "Value", width: 2.2, align: "right" },
      { key: "n", label: "Note", width: 4 },
    ],
    [
      { k: "Open changes (RFC / PVO / VO / DVO)", v: d.openStages.map((s) => `${s.stage} ${s.open}`).join("  "), n: `${d.openChanges} change(s) open in total` },
      { k: "Open claims", v: String(d.openClaims), n: `${formatMoney(d.claimsPendingValue)} claimed and pending` },
      { k: "Open early warnings", v: String(d.openEarlyWarnings), n: `${formatMoney(d.ewOpenValue)} potential cost · ${d.openRisks} open risk(s)` },
      { k: "Bonds & insurance expiring within 60 days", v: String(d.bonds.expiring.length), n: `${d.bonds.expired} expired · ${d.bonds.red} within 30 days${d.bonds.released ? ` · ${d.bonds.released} released (contract closed)` : ""}` },
    ],
    { zebra: true },
  );

  paymentTrackerSection(ctx);

  subheading(ctx, "Key issues this period");
  doc.font("Helvetica").fontSize(9).fillColor("#172033").text(d.keyIssues || "No key issues recorded for this period.", { width: PAGE.width - PAGE.margin * 2 });

  subheading(ctx, "Open actions");
  if (!d.actions.length) doc.fillColor(MUTED).text("No open actions.");
  else
    table(
      ctx,
      [
        { key: "item_no", label: "Item", width: 1 },
        { key: "topic", label: "Topic", width: 2 },
        { key: "action", label: "Action", width: 4 },
        { key: "owner", label: "Owner", width: 1.2 },
        { key: "due_date", label: "Due", width: 1, format: (v) => formatDate(v as string) },
        { key: "days_to_due", label: "Days", width: 0.7, align: "right" },
        { key: "status", label: "Status", width: 1 },
      ],
      d.actions as Record<string, unknown>[],
      { zebra: true },
    );

  ensureSpace(ctx, 230);
  subheading(ctx, "Cost report by package");
  barChart(
    ctx,
    data.costReport.chart.map((c) => ({ label: c.package, a: c.baseline, b: c.afa })),
    "Approved Baseline Budget",
    "Anticipated Final Account",
  );
}

/* ------------------------------------------------------------------ */
/* Movement since the previous issued report                           */

function movementSection(ctx: Ctx) {
  const { doc, data } = ctx;
  const m = data.movement;
  if (!m || !m.previous) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("No earlier locked report to compare with yet. Lock each month in turn; this section then lists every change month on month.");
    doc.moveDown(0.5);
    if (m) keyMovementsAndStatus(ctx);
    return;
  }
  const money = (v: unknown) => formatMoney(v as number);
  const signed = (v: unknown) => {
    const n = Number(v ?? 0);
    return Math.abs(n) < 0.005 ? "–" : `${n > 0 ? "+" : ""}${formatMoney(n)}`;
  };
  subheading(ctx, `Cost report: ${m.previous.label} -> ${m.current.label}`, "Executive view: budget and anticipated final account include the remaining budget hold; changes, early warnings and claims are shown without the hold's offsets.");
  if (m.warning) {
    doc.fillColor("#92400e").font("Helvetica-Bold").fontSize(8.5).text(m.warning, { width: PAGE.width - PAGE.margin * 2 });
    doc.moveDown(0.4);
  }
  table(
    ctx,
    [
      { key: "label", label: "Column", width: 3 },
      { key: "prev", label: `Previous (${m.previous.label})`, width: 2, align: "right", format: money },
      { key: "now", label: "This report", width: 2, align: "right", format: money },
      { key: "delta", label: "Movement", width: 2, align: "right", format: signed },
    ],
    m.kpis.map((k) => ({ label: `${k.key}  ${k.label}`, prev: k.prev, now: k.now, delta: k.delta })),
    { zebra: true },
  );
  subheading(ctx, "Open changes by stage", "Number of open changes at each stage and the cost-report amount they carry.");
  table(
    ctx,
    [
      { key: "stage", label: "Stage", width: 1.5 },
      { key: "prevCount", label: "Previous count", width: 1.2, align: "right" },
      { key: "nowCount", label: "This report", width: 1.2, align: "right" },
      { key: "prevAmount", label: "Previous amount", width: 2, align: "right", format: money },
      { key: "nowAmount", label: "This report amount", width: 2, align: "right", format: money },
      { key: "delta", label: "Movement", width: 2, align: "right", format: signed },
    ],
    m.stages.map((st) => ({ ...st, delta: st.nowAmount - st.prevAmount })),
    { zebra: true },
  );
  keyMovementsAndStatus(ctx);
  for (const g of m.groups) {
    const rows: Record<string, unknown>[] = [
      ...g.added.map((it) => ({ kind: "New", key: it.key, title: it.title, from: "", to: it.to ?? "", amount: it.amount ?? null })),
      ...g.changed.map((it) => ({ kind: "Updated", key: it.key, title: it.title, from: it.from ?? "", to: it.to ?? "", amount: it.delta ?? null })),
      ...g.removed.map((it) => ({ kind: "Removed", key: it.key, title: it.title, from: it.from ?? "", to: "", amount: it.amount === null || it.amount === undefined ? null : -it.amount })),
    ];
    subheading(ctx, `${g.label}: ${g.prevCount} -> ${g.nowCount} rows · ${g.valueLabel} ${formatMoney(g.prevValue)} -> ${formatMoney(g.nowValue)} (${signed(g.nowValue - g.prevValue)})`);
    if (!rows.length) {
      doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("No movement.");
      doc.moveDown(0.3);
      continue;
    }
    table(
      ctx,
      [
        { key: "kind", label: "What", width: 0.9 },
        { key: "key", label: "Ref", width: 1.1 },
        { key: "title", label: "Description", width: 4 },
        { key: "from", label: "Was", width: 2 },
        { key: "to", label: "Now", width: 2 },
        { key: "amount", label: "Amount / movement", width: 1.6, align: "right", format: (v) => (v === null || v === undefined ? "" : signed(v)) },
      ],
      rows,
      { zebra: true },
    );
  }
}

/** Key period movements per cost-report column, change status counts and DVO ageing (Excel "Executive Summary" boxes). */
function keyMovementsAndStatus(ctx: Ctx) {
  const { doc, data } = ctx;
  const m = data.movement!;
  const signed = (v: unknown) => {
    const n = Number(v ?? 0);
    return Math.abs(n) < 0.005 ? "–" : `${n > 0 ? "+" : ""}${formatMoney(n)}`;
  };
  const pair = (p: { prev: number; now: number }) => (m.previous ? `${p.prev} -> ${p.now}${p.now !== p.prev ? ` (${p.now > p.prev ? "+" : ""}${p.now - p.prev})` : ""}` : String(p.now));
  if (m.previous) {
    subheading(ctx, "Key period movements", `The changes, early warnings and claims that moved each cost-report column since ${m.previous.label}.`);
    for (const k of m.keyMovements) {
      ensureSpace(ctx, 60);
      const tie = Math.abs(k.itemsTotal - k.kpiDelta) < 0.5;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text(`${k.col}  ${k.label}: ${signed(k.kpiDelta)}${tie ? "" : `  (items listed ${signed(k.itemsTotal)}; the rest is not linked to a cost line or sits in a budget hold)`}`);
      doc.moveDown(0.2);
      if (!k.items.length) {
        doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("No movement.");
        doc.moveDown(0.4);
        continue;
      }
      table(
        ctx,
        [
          { key: "key", label: "Ref", width: 1.1 },
          { key: "title", label: "Description", width: 4.5 },
          { key: "note", label: "What happened", width: 2.4 },
          { key: "prev", label: "Previous", width: 1.4, align: "right", format: (v) => formatMoney(v as number) },
          { key: "now", label: "This report", width: 1.4, align: "right", format: (v) => formatMoney(v as number) },
          { key: "delta", label: "Movement", width: 1.4, align: "right", format: signed },
        ],
        k.items as unknown as Record<string, unknown>[],
        { zebra: true },
      );
    }
  }
  subheading(ctx, "Change management status", `Changes that have reached each stage and their outcome${m.previous ? ` (${m.previous.label} -> this report)` : ""}.`);
  table(
    ctx,
    [
      { key: "stage", label: "Stage", width: 1.2 },
      { key: "total", label: "Total", width: 1.5, align: "right" },
      { key: "approved", label: "Approved", width: 1.5, align: "right" },
      { key: "pending", label: "Pending", width: 1.5, align: "right" },
      { key: "cancelled", label: "Cancelled", width: 1.5, align: "right" },
    ],
    m.statusCounts.map((s) => ({ stage: s.stage, total: pair(s.total), approved: pair(s.approved), pending: pair(s.pending), cancelled: pair(s.cancelled) })),
    { zebra: true },
  );
  subheading(ctx, "DVO ageing", "Determined variation orders still pending, by days since the DVO was raised, at the cut-off date.");
  table(
    ctx,
    [
      { key: "bucket", label: "Age", width: 3 },
      { key: "count", label: m.previous ? "Previous -> this report" : "Count", width: 2, align: "right" },
    ],
    m.dvoAgeing.map((b) => ({ bucket: b.bucket, count: pair({ prev: b.prev, now: b.now }) })),
    { zebra: true },
  );
}

/** Payment status per contract (Excel "Payment Status Tracker"). */
function paymentTrackerSection(ctx: Ctx) {
  const { doc, data } = ctx;
  const m = data.movement;
  if (!m) return;
  const pct = (v: unknown) => (v === null || v === undefined ? "–" : `${Number(v).toFixed(1)}%`);
  subheading(ctx, "Payment status tracker", "Certified = gross cumulative certified excl. VAT; paid = net payments released; late = after the contractual due date.");
  if (!m.payments.length) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("No contracts yet.");
    return;
  }
  const rows = m.payments.map((r) => ({ ...r, contract: `${r.key} ${r.title}`.trim() }));
  const tot = (k: "revised" | "certified" | "certifiedPeriod" | "paid") => rows.reduce((t, r) => t + r[k], 0);
  rows.push({
    key: "", title: "", contract: "TOTAL", contractor: "", status: "", revised: tot("revised"), certified: tot("certified"), certifiedPeriod: tot("certifiedPeriod"), paid: tot("paid"),
    pctCertified: tot("revised") ? (tot("certified") / tot("revised")) * 100 : null, pctPaid: null, lateIpcs: rows.reduce((t, r) => t + r.lateIpcs, 0), latePayments: rows.reduce((t, r) => t + r.latePayments, 0),
  });
  table(
    ctx,
    [
      { key: "contract", label: "Contract", width: 2.6 },
      { key: "contractor", label: "Contractor / consultant", width: 2.2 },
      { key: "status", label: "Status", width: 0.9 },
      { key: "revised", label: "Revised value", width: 1.5, align: "right", format: (v) => formatMoney(v as number) },
      { key: "certified", label: "Certified to date", width: 1.5, align: "right", format: (v) => formatMoney(v as number) },
      { key: "certifiedPeriod", label: "This period", width: 1.3, align: "right", format: (v) => formatMoney(v as number) },
      { key: "pctCertified", label: "% cert.", width: 0.8, align: "right", format: pct },
      { key: "paid", label: "Paid (net)", width: 1.5, align: "right", format: (v) => formatMoney(v as number) },
      { key: "pctPaid", label: "% paid", width: 0.8, align: "right", format: pct },
      { key: "lateIpcs", label: "Late IPCs", width: 0.7, align: "right" },
      { key: "latePayments", label: "Late pay.", width: 0.7, align: "right" },
    ],
    rows as unknown as Record<string, unknown>[],
    { zebra: true },
  );
}


/* ------------------------------------------------------------------ */
/* Claims Status Report (executive)                                    */

function claimsStatusReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const r = buildClaimsReport(data);
  const h = r.headline;
  const sar = (n: number) => formatMoney(n);
  const kpis: [string, string, string][] = [
    ["Claims recorded", String(h.total), `${h.pending} pending · ${h.approved} determined · ${h.rejected} rejected`],
    ["Contractors with claims", String(h.contractors), ""],
    ["Claimed (SAR)", sar(h.claimedSar), `${h.eotClaimed} EOT days claimed`],
    ["Determined (SAR)", sar(h.determinedSar), `${h.claimedSar ? Math.round((h.determinedSar / h.claimedSar) * 100) : 0}% of value · ${h.eotGranted} days granted`],
    ["Open exposure (SAR)", sar(h.pendingSar), "gross value of pending claims"],
    ["Carried in cost report (M)", sar(h.costReportM), "determined / assessed amounts"],
    ["Late notices / particulars", `${h.noticeLate} / ${h.detailLate}`, "later than 28 / 42 business days"],
    ["Disputes", String(h.disputes), "Notice of Dissatisfaction / Dispute"],
  ];
  kpiCards(ctx, kpis);

  const width = PAGE.width - PAGE.margin * 2;
  subheading(ctx, "Commercial narrative");
  for (const p of r.narrative) {
    ensureSpace(ctx, 50);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(p.heading, { width });
    doc.fillColor("#172033").font("Helvetica").fontSize(9.5).text(p.text, { width, lineGap: 1.5 });
    doc.moveDown(0.5);
  }
  if (r.movement) {
    subheading(ctx, r.movement.label);
    if (!r.movement.items.length) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("No movement in the claims register.");
    for (const it of r.movement.items) {
      ensureSpace(ctx, 14);
      doc.fillColor("#172033").font("Helvetica").fontSize(9).text(`•  ${it}`, { width, indent: 0 });
    }
    doc.moveDown(0.4);
  }
  if (r.attention.length) {
    subheading(ctx, "Items requiring attention");
    for (const it of r.attention) {
      ensureSpace(ctx, 14);
      doc.fillColor("#7c2d12").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }

  // Where each claim still being worked actually stands, in the tracker's own words (Remarks, column
  // BR) – the latest dated entry, how long ago it was written, and whose desk the claim is on. Printed
  // before the register because it is what the reader acts on; contractor by contractor, the ones
  // gone quiet longest first.
  if (r.latestPosition.length) {
    subheading(
      ctx,
      "Where each open claim stands – latest from the Claims Tracker remarks",
      `The newest dated entry in the tracker's Remarks for each claim still being worked. Amber after ${STALE_UPDATE_DAYS} days without an update; claims gone quiet longest are listed first.`,
    );
    partyTables(
      ctx,
      groupByParty(
        r.latestPosition.map((c) => ({
          ...c,
          updated: c.lastUpdate ? formatDate(c.lastUpdate) : "none recorded",
          age: c.daysSinceUpdate === null ? "–" : `${c.daysSinceUpdate}d`,
          latest: c.latestRemark || "No remark recorded in the tracker.",
          __tone: c.daysSinceUpdate === null || c.daysSinceUpdate > STALE_UPDATE_DAYS ? "amber" : null,
        })),
        (c) => c.contractor,
      ),
      [
        { key: "claim_no", label: "Ref", width: 0.7 },
        { key: "description", label: "Claim", width: 2.3 },
        { key: "actionWith", label: "Currently with", width: 1.15 },
        { key: "updated", label: "Last update", width: 0.85 },
        { key: "age", label: "Age", width: 0.5, align: "right" },
        { key: "latest", label: "Latest remark", width: 5 },
      ],
      (g) => `${plural(g.count, "open claim")}`,
      { key: "contractor", label: "Contractor", width: 1.5 },
    );
  }

  // The register, contractor by contractor. A claim is negotiated with one contractor at a time, so
  // the page is read that way; the totals for each are under their own block.
  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  const claimColumns: Col[] = [
    { key: "claim_no", label: "Ref", width: 0.8 },
    { key: "description", label: "Claim", width: 3.4 },
    { key: "type", label: "Type", width: 0.9 },
    { key: "claimedSar", label: "Claimed SAR", width: 1.2, align: "right", format: money },
    { key: "determinedSar", label: "Determined SAR", width: 1.2, align: "right", format: money },
    { key: "eot", label: "EOT days cl./gr.", width: 0.9, align: "right" },
    { key: "status", label: "Status", width: 0.8 },
    { key: "stage", label: "Stage / next step", width: 1.9 },
    { key: "actionWith", label: "Action with", width: 1.2 },
    { key: "daysSinceReceipt", label: "Days", width: 0.5, align: "right" },
  ];
  const withEot = (c: ClaimLine) => ({ ...c, eot: c.eotClaimed === null && c.eotGranted === null ? "" : `${c.eotClaimed ?? "–"} / ${c.eotGranted ?? "–"}` });
  subheading(ctx, "Claims register at cut-off", "One block per contractor; pending claims first, largest value first.");
  partyTables(
    ctx,
    groupByParty(
      r.claims,
      (c) => c.contractor,
      (c) => ({ claimed: c.claimedSar, determined: c.determinedSar ?? 0, eotClaimed: c.eotClaimed ?? 0, eotGranted: c.eotGranted ?? 0 }),
    ).map((g) => ({ ...g, items: g.items.map(withEot) })),
    claimColumns,
    (g) => `${plural(g.count, "claim")} · ${formatMoney(g.totals.claimed ?? 0)} claimed, ${formatMoney(g.totals.determined ?? 0)} determined · ${g.totals.eotClaimed ?? 0} / ${g.totals.eotGranted ?? 0} EOT days claimed / granted`,
    { key: "contractor", label: "Contractor", width: 1.6 },
  );

  subheading(ctx, "By contractor");
  table(
    ctx,
    [
      { key: "contractor", label: "Contractor / consultant", width: 3 },
      { key: "claims", label: "Claims", width: 0.8, align: "right" },
      { key: "pending", label: "Pending", width: 0.8, align: "right" },
      { key: "claimedSar", label: "Claimed SAR", width: 1.5, align: "right", format: money },
      { key: "determinedSar", label: "Determined SAR", width: 1.5, align: "right", format: money },
      { key: "eotClaimed", label: "EOT claimed (days)", width: 1.2, align: "right" },
      { key: "eotGranted", label: "EOT granted (days)", width: 1.2, align: "right" },
    ],
    r.byContractor as unknown as Record<string, unknown>[],
    { zebra: true },
  );

  // Ageing and action holders (the Claims Tracker's "Required actions" view)
  subheading(ctx, "Ageing of open claims", "Days since the (detailed) claim was received, pending claims only – the tracker's response-time bands.");
  table(
    ctx,
    [
      { key: "bucket", label: "Days since receipt", width: 2 },
      { key: "n", label: "Claims", width: 0.8, align: "right" },
      { key: "sar", label: "Claimed SAR", width: 1.5, align: "right", format: money },
      { key: "refsTxt", label: "References", width: 5 },
    ],
    r.ageing.map((a) => ({ ...a, refsTxt: a.refs.join(", ") })) as unknown as Record<string, unknown>[],
    { zebra: true },
  );
  if (r.byAction.length) {
    subheading(ctx, "Open claims by action holder", "Who the next step rests with, from the tracker's \"Action with\" column.");
    table(
      ctx,
      [
        { key: "actionWith", label: "Action with", width: 2 },
        { key: "n", label: "Claims", width: 0.8, align: "right" },
        { key: "sar", label: "Claimed SAR", width: 1.5, align: "right", format: money },
        { key: "refsTxt", label: "References", width: 5 },
      ],
      r.byAction.map((a) => ({ ...a, refsTxt: a.refs.join(", ") })) as unknown as Record<string, unknown>[],
      { zebra: true },
    );
  }

  // EAR / HLEAR timetable
  if (r.ear.length) {
    subheading(ctx, "Extension assessment reports (EAR / HLEAR) – progress against the tracker timetable", "Days = days allowed for the step from the trigger date (or the previous step); state at the cut-off date.");
    table(
      ctx,
      [
        { key: "claim_no", label: "Ref", width: 0.8 },
        { key: "contractor", label: "Contractor", width: 1.8 },
        { key: "assessmentType", label: "Assessment", width: 1 },
        { key: "start", label: "Trigger date", width: 0.9 },
        { key: "s1", label: "Draft (pre-TIA)", width: 1.6 },
        { key: "s2", label: "TIA assessment", width: 1.6 },
        { key: "s3", label: "Finalisation", width: 1.6 },
        { key: "status", label: "Status", width: 1.6 },
      ],
      r.ear.map((e) => ({
        ...e,
        s1: [e.steps[0].days && `${e.steps[0].days}d`, e.steps[0].done || e.steps[0].state].filter(Boolean).join(" · "),
        s2: [e.steps[1].days && `${e.steps[1].days}d`, e.steps[1].done || e.steps[1].state].filter(Boolean).join(" · "),
        s3: [e.steps[2].days && `${e.steps[2].days}d`, e.steps[2].done || e.steps[2].state].filter(Boolean).join(" · "),
      })) as unknown as Record<string, unknown>[],
      { zebra: true },
    );
  }

  // Rejections, notices of dissatisfaction and disputes
  if (r.escalations.length) {
    subheading(ctx, "Rejections, notices of dissatisfaction and disputes");
    table(
      ctx,
      [
        { key: "claim_no", label: "Ref", width: 0.8 },
        { key: "contractor", label: "Contractor", width: 1.6 },
        { key: "description", label: "Claim", width: 2.6 },
        { key: "rejection", label: "Rejected / revise & resubmit", width: 1.4 },
        { key: "nod", label: "NoD", width: 0.5 },
        { key: "dispute", label: "Dispute", width: 0.6 },
        { key: "assessmentReport", label: "Assessment report", width: 1.3 },
        { key: "eiDvo", label: "EI / DVO", width: 1.2 },
        { key: "closure", label: "Closure months", width: 1.4 },
      ],
      r.escalations as unknown as Record<string, unknown>[],
      { zebra: true },
    );
  }

  // Claim-by-claim detail: every column of the Claims Tracker
  doc.addPage();
  subheading(ctx, "Claim-by-claim detail", "Every column of the Claims Tracker for each claim: notice, particulars, assessment by each party, EAR timetable, status and actions.");
  const kvCols = [
    { key: "l1", label: "Item", width: 1.6 },
    { key: "v1", label: "Detail", width: 3.4 },
    { key: "l2", label: "Item", width: 1.6 },
    { key: "v2", label: "Detail", width: 3.4 },
  ];
  // two lists side by side; when one is short the items are re-flowed so neither column is left blank
  const pairRows = (left: { label: string; value: string }[], right: { label: string; value: string }[]) => {
    const rows: Record<string, unknown>[] = [];
    let a = left;
    let b = right;
    if (a.length < 2 || b.length < 2) {
      const all = [...a, ...b];
      const half = Math.ceil(all.length / 2);
      a = all.slice(0, half);
      b = all.slice(half);
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) rows.push({ l1: a[i]?.label ?? "", v1: a[i]?.value ?? "", l2: b[i]?.label ?? "", v2: b[i]?.value ?? "" });
    return rows;
  };
  for (const c of r.claims) {
    const d = c.detail;
    ensureSpace(ctx, 120);
    doc.moveDown(0.4);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(`${c.claim_no} · ${c.contractor}${d.contractNo ? ` · ${d.contractNo}` : ""}`, { width });
    doc.fillColor("#172033").font("Helvetica").fontSize(9).text(c.description, { width });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text([c.type && `Type: ${c.type}`, d.assessmentType && `Assessment: ${d.assessmentType}`, `Status: ${c.status}`, `Stage: ${c.stage}`, c.actionWith && `Action with: ${c.actionWith}`, d.trackerItem && `Tracker item ${d.trackerItem}`, c.package && `Package: ${c.package}`].filter(Boolean).join("   ·   "), { width });
    if (d.scope) doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Scope: ${d.scope}`, { width });
    doc.moveDown(0.2);
    table(ctx, kvCols, pairRows(d.notice, d.particulars), { zebra: false });
    table(
      ctx,
      [
        { key: "party", label: "Assessment", width: 2.2 },
        { key: "eot", label: "EOT days", width: 0.9, align: "right" },
        { key: "compensable", label: "Compensable days", width: 1.2, align: "right" },
        { key: "sar", label: "SAR", width: 1.5, align: "right" },
        { key: "ref", label: "Letter / VO reference", width: 2.6 },
        { key: "date", label: "Date", width: 1 },
      ],
      d.parties as unknown as Record<string, unknown>[],
      { zebra: true },
    );
    const right = [...d.actions, ...d.kpi, ...d.project];
    if (d.ear.length || right.length) table(ctx, kvCols, pairRows(d.ear, right), { zebra: false });
    if (d.lastAction) doc.fillColor("#172033").font("Helvetica").fontSize(8.5).text(`Last action / discussion: ${d.lastAction}`, { width });
    if (d.remark) doc.fillColor("#172033").font("Helvetica").fontSize(8.5).text(`Remark: ${d.remark}`, { width });
    if (c.status === "Pending" && c.daysSinceReceipt !== null) doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`${c.daysSinceReceipt} days since receipt at the cut-off.`, { width });
  }

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from the Claims & Disputes register of ${APP_NAME} as at ${formatDate(r.asOf)}${data.locked ? "" : " (draft – period not locked)"}. Claimed = contractor's claim; assessed = Employer's assessment, else Engineer's recommendation; determined = determination or agreement. Tracker columns are as imported from the AMAALA Claims Tracker (AMA-CM-FRM-0018).`, { width });
}


/* ------------------------------------------------------------------ */
/* Final Account Status Report (executive)                             */

function faStatusReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const r = buildFaReport(data);
  const h = r.headline;
  const sar = (n: number) => formatMoney(n);
  const kpis: [string, string, string][] = [
    ["Packages tracked", String(h.total), `${h.open} open · ${h.closed} closed · ${h.notRequired} not required`],
    ["Open (SAR)", sar(h.openValue), "anticipated final account of open packages"],
    ["Closed – FAS signed (SAR)", sar(h.closedValue), ""],
    ["Not required / direct payment (SAR)", sar(h.notRequiredValue), ""],
    ["Total anticipated final account", sar(h.totalAfa), "all tracked packages"],
    ["Uncommitted on open packages", sar(h.uncommittedOpen), "still to be agreed"],
    ["Past forecast closure date", String(h.overdue), `${h.dueSoon} due within 60 days`],
    ["No forecast date", String(h.noDate), "open packages"],
  ];
  kpiCards(ctx, kpis);

  const width = PAGE.width - PAGE.margin * 2;
  subheading(ctx, "Commercial narrative");
  for (const p of r.narrative) {
    ensureSpace(ctx, 50);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(p.heading, { width });
    doc.fillColor("#172033").font("Helvetica").fontSize(9.5).text(p.text, { width, lineGap: 1.5 });
    doc.moveDown(0.5);
  }
  if (r.movement) {
    subheading(ctx, r.movement.label);
    if (!r.movement.items.length) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("No change to the final account status.");
    for (const it of r.movement.items) {
      ensureSpace(ctx, 14);
      doc.fillColor("#172033").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }
  if (r.attention.length) {
    subheading(ctx, "Items requiring attention");
    for (const it of r.attention) {
      ensureSpace(ctx, 14);
      doc.fillColor("#7c2d12").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }
  // Final accounts, contractor by contractor: closing one out is a negotiation with one company,
  // and a contractor with four packages open is a different conversation from one with a single one.
  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  subheading(ctx, "Final account status", "One block per contractor; open packages first, earliest forecast closure first. Committed and anticipated final account are read from the cost report.");
  partyTables(
    ctx,
    groupByParty(
      r.rows,
      (x) => x.contractor,
      (x) => ({ committed: x.committed, afa: x.afa, uncommitted: x.uncommitted }),
    ),
    [
      { key: "acc_ref", label: "ACC code", width: 0.9 },
      { key: "description", label: "Package", width: 2.6 },
      { key: "type", label: "Type", width: 1 },
      { key: "committed", label: "Committed (I)", width: 1.2, align: "right", format: money },
      { key: "afa", label: "Anticipated FA (N)", width: 1.2, align: "right", format: money },
      { key: "uncommitted", label: "Uncommitted", width: 1.1, align: "right", format: money },
      { key: "responsible", label: "Responsible", width: 1 },
      { key: "forecast", label: "Forecast closure", width: 0.9, format: (v) => formatDate(v as string) },
      { key: "daysRemaining", label: "Days", width: 0.5, align: "right" },
      { key: "status", label: "Status", width: 0.9 },
      { key: "comments", label: "Comments", width: 2 },
    ],
    (g) => `${plural(g.count, "package")} · ${formatMoney(g.totals.afa ?? 0)} anticipated final account · ${formatMoney(g.totals.uncommitted ?? 0)} uncommitted`,
    { key: "contractor", label: "Contractor / consultant", width: 1.8 },
  );
  subheading(ctx, "By status");
  table(
    ctx,
    [
      { key: "status", label: "Status", width: 2 },
      { key: "count", label: "Packages", width: 1, align: "right" },
      { key: "afa", label: "Anticipated final account (SAR)", width: 2, align: "right", format: money },
    ],
    r.byStatus as unknown as Record<string, unknown>[],
    { zebra: true },
  );
  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from the Final Account Status register of ${APP_NAME} as at ${formatDate(r.asOf)}${data.locked ? "" : " (draft – period not locked)"}.`, { width });
}


/* ------------------------------------------------------------------ */
/* Invoice & Payment Status Report (executive)                         */

function paymentsStatusReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const r = buildPaymentsReport(data);
  const h = r.headline;
  const sar = (n: number) => formatMoney(n);
  const kpis: [string, string, string][] = [
    ["Contracts", String(h.contracts), `${h.contractors} contractor(s) · ${h.applications} application(s)`],
    ["Revised contract value", sar(h.revised), "awarded value plus approved changes and claims"],
    ["Certified to date (gross)", sar(h.certified), `${h.pctCertified ?? 0}% of revised value`],
    ["Paid to date (net)", sar(h.netPaid), `${h.pctPaid ?? 0}% of certified released`],
    h.balanceToCertify >= 0 ? ["Balance to certify", sar(h.balanceToCertify), "cash requirement to completion"] : ["Certified beyond the value", sar(-h.balanceToCertify), "contract sums to be brought up to date"],
    ["Certified, awaiting payment", sar(h.awaitingPayment), `${r.overdue.filter((o) => o.stage === "Payment").length} past the payment date`],
    ["Retention held", sar(h.retentionHeld), `advance recovered ${sar(h.advanceRecovered)}`],
    ["Certify / pay (avg days)", `${h.avgDaysToCertify ?? "–"} / ${h.avgDaysToPay ?? "–"}`, `${h.onTimeCertification ?? "–"}% / ${h.onTimePayment ?? "–"}% within the contract`],
  ];
  kpiCards(ctx, kpis);

  const width = PAGE.width - PAGE.margin * 2;
  subheading(ctx, "Commercial narrative");
  for (const p of r.narrative) {
    ensureSpace(ctx, 50);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(p.heading, { width });
    doc.fillColor("#172033").font("Helvetica").fontSize(9.5).text(p.text, { width, lineGap: 1.5 });
    doc.moveDown(0.5);
  }
  if (r.movement) {
    subheading(ctx, r.movement.label);
    if (!r.movement.items.length) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("No movement in the payment registers.");
    for (const it of r.movement.items) {
      ensureSpace(ctx, 14);
      doc.fillColor("#172033").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }
  if (r.attention.length) {
    subheading(ctx, "Items requiring attention");
    for (const it of r.attention) {
      ensureSpace(ctx, 14);
      doc.fillColor("#7c2d12").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }

  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  const pctFmt = (v: unknown) => (v === null || v === undefined ? "" : `${v}%`);
  subheading(ctx, "Contract position at cut-off", "Largest revised value first. Certified is the gross cumulative amount; paid is net of advance recovery and retention.");
  table(
    ctx,
    [
      { key: "po", label: "PO / ref", width: 0.9 },
      { key: "contractor", label: "Contractor / consultant", width: 2.2 },
      { key: "package", label: "Package", width: 1.6 },
      { key: "revised", label: "Revised value", width: 1.3, align: "right", format: money },
      { key: "certified", label: "Certified (gross)", width: 1.3, align: "right", format: money },
      { key: "pctCertified", label: "%", width: 0.6, align: "right", format: pctFmt },
      { key: "balanceToCertify", label: "To certify", width: 1.2, align: "right", format: money },
      { key: "netPaid", label: "Paid (net)", width: 1.2, align: "right", format: money },
      { key: "awaitingPayment", label: "Awaiting payment", width: 1.2, align: "right", format: money },
      { key: "retentionHeld", label: "Retention", width: 1, align: "right", format: money },
      { key: "applications", label: "IPCs", width: 0.5, align: "right" },
      { key: "status", label: "Status", width: 1.2 },
    ],
    r.contracts as unknown as Record<string, unknown>[],
    {
      zebra: true,
      totalRow: { po: "TOTAL", revised: formatMoney(h.revised), certified: formatMoney(h.certified), balanceToCertify: formatMoney(h.balanceToCertify), netPaid: formatMoney(h.netPaid), awaitingPayment: formatMoney(h.awaitingPayment), retentionHeld: formatMoney(h.retentionHeld) },
    },
  );

  subheading(ctx, "By contractor");
  table(
    ctx,
    [
      { key: "contractor", label: "Contractor / consultant", width: 2.6 },
      { key: "contracts", label: "Contracts", width: 0.8, align: "right" },
      { key: "revised", label: "Revised value", width: 1.4, align: "right", format: money },
      { key: "certified", label: "Certified", width: 1.4, align: "right", format: money },
      { key: "pctCertified", label: "% certified", width: 0.9, align: "right", format: pctFmt },
      { key: "netPaid", label: "Paid (net)", width: 1.4, align: "right", format: money },
      { key: "pctPaid", label: "% released", width: 0.9, align: "right", format: pctFmt },
      { key: "retentionHeld", label: "Retention held", width: 1.2, align: "right", format: money },
      { key: "awaitingPayment", label: "Awaiting payment", width: 1.2, align: "right", format: money },
    ],
    r.byContractor as unknown as Record<string, unknown>[],
    { zebra: true },
  );

  subheading(ctx, "Certified and unpaid – ageing", "Days between the certificate and the cut-off date.");
  table(
    ctx,
    [
      { key: "bucket", label: "Age of certificate", width: 2 },
      { key: "n", label: "Certificates", width: 1, align: "right" },
      { key: "value", label: "Net amount (SAR)", width: 2, align: "right", format: money },
    ],
    r.ageing as unknown as Record<string, unknown>[],
    { zebra: true },
  );

  if (r.overdue.length) {
    subheading(ctx, "Overdue against the contractual timetable", "Applications not certified within the contract period, and certificates not paid within it.");
    table(
      ctx,
      [
        { key: "stage", label: "Overdue", width: 1 },
        { key: "po", label: "PO / ref", width: 0.9 },
        { key: "contractor", label: "Contractor", width: 2 },
        { key: "application", label: "Application / IPC", width: 1.6 },
        { key: "applicationDate", label: "Applied", width: 0.9, format: (v) => formatDate(v as string) },
        { key: "ipcDate", label: "Certified", width: 0.9, format: (v) => formatDate(v as string) },
        { key: "dueDate", label: "Due", width: 0.9, format: (v) => formatDate(v as string) },
        { key: "daysLate", label: "Days late", width: 0.7, align: "right" },
        { key: "amount", label: "Net amount", width: 1.3, align: "right", format: money },
      ],
      r.overdue as unknown as Record<string, unknown>[],
      { zebra: true },
    );
  }

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from the contracts register and the IPC log of ${APP_NAME} as at ${formatDate(r.asOf)}${data.locked ? "" : " (draft – period not locked)"}. Certified is gross and excludes VAT; paid is the net amount released after advance recovery and retention.`, { width });
}


/* ------------------------------------------------------------------ */
/* Change Management Status Report (executive)                         */

function changesStatusReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const r = buildChangesReport(data);
  const h = r.headline;
  const sar = (n: number) => formatMoney(n);
  const kpis: [string, string, string][] = [
    ["Changes", String(h.total), `${h.open} open · ${h.closed} closed`],
    ["Pending over 30 / 60 days", `${h.overdue30} / ${h.overdue60}`, "open items by days since raised"],
    ["Cost report – DVO (H)", sar(h.dvoValue), `PVO / VO (J) ${sar(h.pvoValue)}`],
    ["Cost report – RFC (K)", sar(h.rfcValue), h.unlinked ? `${h.unlinked} change(s) not linked to a cost line` : "all changes linked to a cost line"],
  ];
  kpiCards(ctx, kpis);

  const width = PAGE.width - PAGE.margin * 2;
  subheading(ctx, "Commercial narrative");
  for (const p of r.narrative) {
    ensureSpace(ctx, 50);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(p.heading, { width });
    doc.fillColor("#172033").font("Helvetica").fontSize(9.5).text(p.text, { width, lineGap: 1.5 });
    doc.moveDown(0.5);
  }
  if (r.movement) {
    subheading(ctx, r.movement.label);
    if (!r.movement.items.length) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("No movement in the change register.");
    for (const it of r.movement.items) {
      ensureSpace(ctx, 14);
      doc.fillColor("#172033").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }
  if (r.attention.length) {
    subheading(ctx, "Items requiring attention");
    for (const it of r.attention) {
      ensureSpace(ctx, 14);
      doc.fillColor("#7c2d12").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }

  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  subheading(ctx, "By stage", "Every change that has reached that stage, whichever stage it is at now.");
  table(
    ctx,
    [
      { key: "stage", label: "Stage", width: 1.3 },
      { key: "full", label: "Description", width: 2.4 },
      { key: "total", label: "Total", width: 1, align: "right" },
      { key: "approved", label: "Approved", width: 1, align: "right" },
      { key: "pending", label: "Pending", width: 1, align: "right" },
      { key: "dead", label: "Rejected / cancelled", width: 1.3, align: "right" },
      { key: "value", label: "Approved value (SAR)", width: 1.5, align: "right", format: money },
    ],
    r.byStage as unknown as Record<string, unknown>[],
    { zebra: true },
  );

  subheading(ctx, "Ageing of open changes", "Days since the change was raised.");
  table(
    ctx,
    [
      { key: "bucket", label: "Age", width: 2 },
      { key: "n", label: "Changes", width: 1, align: "right" },
      { key: "value", label: "Value (SAR)", width: 2, align: "right", format: money },
    ],
    r.ageing as unknown as Record<string, unknown>[],
    { zebra: true },
  );

  // Open changes: a table per stage, and inside it a block per contractor. A DVO pending with the
  // Engineer and a PVO awaiting a quotation are chased separately, and each chase is one contractor.
  const changeColumns: Col[] = [
    { key: "item_no", label: "Item", width: 0.7 },
    { key: "description", label: "Description", width: 3.2 },
    { key: "package", label: "Package", width: 1.4 },
    { key: "amount", label: "Value (SAR)", width: 1.1, align: "right", format: money },
    { key: "dateRaised", label: "Raised", width: 0.85, format: (v) => formatDate(v as string) },
    { key: "daysOpen", label: "Days open", width: 0.7, align: "right" },
    { key: "actionPendingBy", label: "Action with", width: 1.2 },
    { key: "status", label: "Status", width: 1 },
  ];
  for (const sec of r.sections) {
    ensureSpace(ctx, 150);
    subheading(ctx, `${sec.title} – ${plural(sec.count, "item")}`, `${plural(sec.groups.length, "contractor")} · ${formatMoney(sec.value)} carried at this stage.`);
    partyTables(ctx, sec.groups, changeColumns, (g) => `${plural(g.count, "item")} · ${formatMoney(g.totals.amount ?? 0)}`, { key: "contractor", label: "Contractor", width: 1.5 });
  }

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from the Change Management Tracker of ${APP_NAME} as at ${formatDate(r.asOf)}${data.locked ? "" : " (draft – period not locked)"}. Value is the cost-report amount at the change's current live stage.`, { width });
}

/* ------------------------------------------------------------------ */
/* Period Summary – the month's story as the directors get it by email  */

/** Horizontal signed bars: increases to the right in red, reductions to the left in green. */
/** Cost recovery: what contractors owe RSG for staff accommodation and for customs duties RSG paid on their imports. */
function recoveryReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const width = PAGE.width - PAGE.margin * 2;
  const money = (v: unknown) => (v === null || v === undefined || v === "" ? "" : formatMoney(v as number));
  const acc = getAccommodationSummary(data.recovery.accommodation, data.recovery.accommodationInvoices);
  const cus = getCustomsSummary(data.recovery.customs, data.registers.changes?.rows ?? [], data.recovery.customsDeclarations);
  const red = (n: number) => (n > 0.5 ? "#b91c1c" : null);

  subheading(ctx, "Accommodation cost recovery", `Construction village lease-agreement invoices per contractor${acc.asOf ? ` – tracker as of ${formatDate(acc.asOf)}` : ""}.`);
  if (!acc.totals.rows) {
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("No accommodation invoice tracker has been uploaded for this project yet.", { width });
    doc.moveDown(0.5);
  } else {
    kpiCards(
      ctx,
      [
        ["Invoiced to date (incl. VAT)", formatMoney(acc.totals.invoiced), `${acc.totals.rows} lease agreement(s), ${acc.totals.open} open`],
        ["Received + recovered", formatMoney(acc.totals.received), `${formatMoney(acc.totals.offset)} offset through IPCs`],
        ["Outstanding", formatMoney(acc.totals.outstanding), `${formatMoney(acc.totals.withheld)} withheld under IPCs`],
        ["Not covered by an IPC withholding", formatMoney(acc.totals.exposed), `${formatMoney(acc.totals.settleInFa)} to settle in the final account`],
      ],
      (k) => (k[0] === "Outstanding" ? red(acc.totals.outstanding) : k[0].startsWith("Not covered") ? red(acc.totals.exposed) : null),
    );
    table(
      ctx,
      [
        { key: "contractor", label: "Contractor", width: 2.4 },
        { key: "invoiced", label: "Invoiced", width: 1.1, align: "right", format: money },
        { key: "received", label: "Received + recovered", width: 1.1, align: "right", format: money },
        { key: "outstanding", label: "Outstanding", width: 1.1, align: "right", format: money },
        { key: "withheld", label: "Withheld in IPC", width: 1.1, align: "right", format: money },
        { key: "settleInFa", label: "To settle in FA", width: 1.1, align: "right", format: money },
        { key: "note", label: "Tracker note", width: 2.4 },
      ],
      acc.byContractor.map((c) => ({ contractor: c.contractor, ...c.totals, note: c.note })),
      { zebra: true, totalRow: { contractor: "Total", ...acc.totals, note: "" }, rowStyle: (r) => (Number(r.outstanding) > 0.5 ? { color: "#b91c1c" } : undefined) },
    );
    doc.moveDown(0.5);
    // the unpaid invoices behind each balance, as on the tracker's invoice sets
    const withUnpaid = acc.byContractor.filter((c) => c.detail.unpaid.length);
    if (withUnpaid.length) {
      subheading(ctx, "Unpaid accommodation invoices by contractor", "From the tracker's invoice sets: what each contractor has been invoiced and has not settled, with the due date and the days overdue at the tracker date.");
      const rows: Record<string, unknown>[] = [];
      for (const c of withUnpaid) {
        const sum = c.detail.unpaid.reduce((t, i) => t + Number(i.balance_due ?? 0), 0);
        rows.push({ __span: true, invoice: `${c.contractor} – ${c.detail.unpaid.length} unpaid invoice(s), SAR ${formatMoney(sum)}${c.detail.notYetInvoiced > 0.5 ? ` · ${formatMoney(c.detail.notYetInvoiced)} assessed, not yet invoiced` : ""}${c.detail.lateHistory.count ? ` · earlier invoices settled ${c.detail.lateHistory.min}–${c.detail.lateHistory.max} days late` : ""}` });
        for (const i of c.detail.unpaid) rows.push({ invoice: String(i.invoice_no ?? ""), lease: String(i.tracker_name ?? ""), period: formatMonthYear(i.invoice_period as string), invoiceDate: formatDate(i.invoice_date as string), issued: formatDate(i.issued_date as string), due: formatDate(i.due_date as string), amount: Number(i.amount_gross ?? 0), unpaid: Number(i.balance_due ?? 0), days: Number(i.days_overdue ?? 0) > 0 ? String(i.days_overdue) : "due", status: String(i.status ?? "") });
      }
      table(
        ctx,
        [
          { key: "invoice", label: "Invoice no", width: 1 },
          { key: "lease", label: "Lease agreement", width: 2 },
          { key: "period", label: "Occupancy", width: 0.9 },
          { key: "invoiceDate", label: "Invoice date", width: 0.9 },
          { key: "issued", label: "Issued on", width: 0.9 },
          { key: "due", label: "Due date", width: 0.9 },
          { key: "amount", label: "Amount incl. VAT", width: 1.1, align: "right", format: money },
          { key: "unpaid", label: "Unpaid", width: 1, align: "right", format: money },
          { key: "days", label: "Days overdue", width: 0.8, align: "right" },
          { key: "status", label: "Status", width: 0.8 },
        ],
        rows,
        { zebra: true, rowStyle: (r) => (r.__span ? { span: true } : Number(r.unpaid) > 0.5 ? { color: "#b91c1c" } : undefined) },
      );
      doc.moveDown(0.5);
    }
  }

  subheading(ctx, "Customs duty recovery", `Customs duties RSG paid on contractors' imports and their recovery under each contract${cus.asOf ? ` – tracker as of ${formatDate(cus.asOf)}` : ""}.`);
  if (!cus.totals.rows) {
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("No customs recovery tracker has been uploaded for this project yet.", { width });
    doc.moveDown(0.5);
  } else {
    kpiCards(
      ctx,
      [
        ["Customs paid by RSG", formatMoney(cus.totals.rsgPaid), `${cus.totals.rows} contract / vendor row(s)`],
        ["RSG / AMAALA to recover", formatMoney(cus.totals.toRecover), `${formatMoney(cus.totals.contractorPaid)} paid by the contractors`],
        ["Recovered by DVO", formatMoney(cus.totals.recoveredByDvo), "determined variation orders recorded for the recovery"],
        ["Still to recover", formatMoney(cus.totals.stillToRecover), `${formatMoney(cus.totals.ewn)} notified in EWNs, ${formatMoney(cus.totals.unrecoverable)} unrecoverable`],
      ],
      (k) => (k[0] === "Still to recover" ? red(cus.totals.stillToRecover) : null),
    );
    table(
      ctx,
      [
        { key: "contractor", label: "Contractor", width: 2.2 },
        { key: "payer", label: "Who pays per contract", width: 1.3 },
        { key: "rsgPaid", label: "Paid by RSG", width: 1, align: "right", format: money },
        { key: "toRecover", label: "To recover", width: 1, align: "right", format: money },
        { key: "recoveredByDvo", label: "Recovered by DVO", width: 1, align: "right", format: money },
        { key: "stillToRecover", label: "Still to recover", width: 1, align: "right", format: money },
        { key: "ewn", label: "EWN", width: 0.9, align: "right", format: money },
        { key: "remainingToPay", label: "Remaining to pay", width: 1.1, align: "right", format: money },
        { key: "change", label: "Change item (RFC / PVO / VO / DVO)", width: 2.2 },
        { key: "next", label: "Next action", width: 1.3 },
      ],
      cus.byContractor.map((c) => ({ contractor: c.contractor, payer: c.payer, ...c.totals, change: c.change ? c.change.summary : c.dvoNote || "none yet", next: c.nextAction })),
      { zebra: true, totalRow: { contractor: "Total", payer: "", ...cus.totals, change: "", next: "" }, rowStyle: (r) => (Number(r.stillToRecover) > 0.5 ? { color: "#b91c1c" } : undefined) },
    );
    if (cus.noFigures.length) {
      doc.moveDown(0.3);
      doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8).text(`${cus.noFigures.length} contract(s) are annotated on the tracker without customs figures yet: ${cus.noFigures.map((r) => `${String(r.contract_code ?? r.vendor ?? "")}`).join(", ")}.`, { width });
    }
    // the customs declarations RSG paid, contractor by contractor
    const withDecl = cus.byContractor.filter((c) => c.rsgPaidList.length);
    if (withDecl.length) {
      doc.moveDown(0.5);
      subheading(ctx, "Customs declarations paid by RSG, by contractor", "From the tracker's Breakdown sheet: every customs declaration on the contractor's imports whose duty RSG paid.");
      const rows: Record<string, unknown>[] = [];
      for (const c of withDecl) {
        rows.push({ __span: true, date: `${c.contractor} – ${c.rsgPaidList.length} declaration(s), SAR ${formatMoney(c.rsgPaidListed)} paid by RSG · still to recover SAR ${formatMoney(c.totals.stillToRecover)}` });
        for (const d of c.rsgPaidList) rows.push({ date: formatDate((d.payment_date ?? d.statement_date) as string), bayan: String(d.bayan_no ?? ""), port: String(d.port ?? ""), broker: String(d.broker ?? ""), supplier: String(d.supplier ?? ""), invoice: String(d.invoice_no ?? ""), duty: Number(d.customs_duty ?? 0), rsg: Number(d.rsg_paid ?? 0) || Number(d.customs_duty ?? 0) });
      }
      table(
        ctx,
        [
          { key: "date", label: "Payment date", width: 0.9 },
          { key: "bayan", label: "Bayan no", width: 0.9 },
          { key: "port", label: "Port", width: 1.3 },
          { key: "broker", label: "Broker", width: 1.3 },
          { key: "supplier", label: "Supplier", width: 1.8 },
          { key: "invoice", label: "Invoice no", width: 1 },
          { key: "duty", label: "Customs duty", width: 1, align: "right", format: money },
          { key: "rsg", label: "Paid by RSG", width: 1, align: "right", format: money },
        ],
        rows,
        { zebra: true, rowStyle: (r) => (r.__span ? { span: true } : undefined) },
      );
    }
  }
}

/** The Aconex control account export against the cost report, figure by figure. */
function aconexReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const width = PAGE.width - PAGE.margin * 2;
  const rec = buildAconexReconciliation(data);
  const money = (v: unknown) => (v === null || v === undefined ? "–" : formatMoney(v as number));
  subheading(ctx, "1. Control accounts – budget, commitments and estimate at completion per contract");
  if (!rec.counts.aconex) {
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("No Aconex control account export has been uploaded for this project yet.", { width });
    doc.moveDown(0.6);
    aconexChangeEventsReport(ctx);
    return;
  }
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(`${rec.counts.matched} contract and budget-hold lines compared (${rec.counts.aconex} Aconex rows${rec.asOf ? `, export uploaded ${formatDate(rec.asOf)}` : ""}, ${rec.counts.dashboard} cost report lines in ${data.period.label}). A contract differs when its commitments, estimate at completion or incurred to date disagree; a budget hold when its budget or estimate at completion does. Approved budget, DVOs and PVOs on a contract are shown for information, because the two systems hold them on different bases. Differences under SAR ${rec.counts.tolerance} are rounding.`, { width });
  doc.moveDown(0.4);
  kpiCards(
    ctx,
    [
      ["Lines with a difference", String(rec.counts.differing), rec.counts.differing ? "listed below, largest first" : "every compared figure agrees"],
      ["Estimate at completion – difference", formatMoney(rec.totals.diff.eac), `Aconex ${formatMoney(rec.totals.aconex.eac)} vs dashboard ${formatMoney(rec.totals.dashboard.eac)}`],
      ["Commitments – difference", formatMoney(rec.totals.diff.commitments), `Aconex ${formatMoney(rec.totals.aconex.commitments)} vs dashboard ${formatMoney(rec.totals.dashboard.commitments)}`],
      ["Only on one side", String(rec.aconexOnly.length + rec.dashboardOnly.length), `${rec.aconexOnly.length} only in Aconex, ${rec.dashboardOnly.length} only on the dashboard`],
    ],
    (k) => (k[0].startsWith("Lines with") && rec.counts.differing ? "#b91c1c" : null),
  );
  subheading(ctx, "Totals – Aconex vs dashboard", `Over the ${rec.counts.matched} lines both systems hold; the ${rec.aconexOnly.length} row(s) only in Aconex (EAC ${formatMoney(rec.unmatched.aconex.eac)}) and the ${rec.dashboardOnly.length} line(s) only on the dashboard (EAC ${formatMoney(rec.unmatched.dashboard.eac)}) are listed apart and not compared.`);
  table(
    ctx,
    [
      { key: "label", label: "Figure", width: 1.6 },
      { key: "aconex", label: "Aconex", width: 1.1, align: "right", format: money },
      { key: "dashboard", label: "Dashboard", width: 1.1, align: "right", format: money },
      { key: "diff", label: "Difference", width: 1.1, align: "right", format: money },
      { key: "note", label: "What is compared", width: 3.2 },
    ],
    ACONEX_MEASURES.map((m) => ({ label: `${m.label} (${rec.totals.lines[m.key]} ${m.key === "hold" ? "budget holds" : m.key === "budget" || m.key === "eac" || m.key === "eac_rsg" || m.key === "ew" ? "lines" : "contracts"})`, aconex: rec.totals.aconex[m.key], dashboard: rec.totals.dashboard[m.key], diff: rec.totals.diff[m.key], note: m.note })),
    { zebra: true, rowStyle: (r) => (Math.abs(Number(r.diff)) >= rec.counts.tolerance ? { color: "#b91c1c" } : undefined) },
  );
  const listed = [...rec.discrepancies, ...rec.aconexOnly, ...rec.dashboardOnly];
  subheading(ctx, "Discrepancies, line by line", listed.length ? "Matched lines with a difference (largest first), then the lines only one side knows about." : "Every compared figure agrees with the dashboard.");
  if (listed.length) {
    table(
      ctx,
      [
        { key: "line", label: "Line", width: 2 },
        { key: "status", label: "Status", width: 0.8 },
        ...ACONEX_MEASURES.flatMap((m) => [
          { key: `${m.key}_a`, label: `${m.label} – Aconex`, width: 0.85, align: "right" as const, format: money },
          { key: `${m.key}_d`, label: `${m.label} – dashboard`, width: 0.85, align: "right" as const, format: money },
          { key: `${m.key}_x`, label: "Diff", width: 0.75, align: "right" as const, format: money },
        ]),
      ],
      listed.map((l) => {
        const row: Record<string, unknown> = { line: `${l.code || l.aconexCode} – ${l.name}`, status: l.status === "matched" ? "differs" : l.status === "aconex_only" ? "only in Aconex" : "only on dashboard" };
        for (const m of ACONEX_MEASURES) {
          row[`${m.key}_a`] = l.aconex[m.key];
          row[`${m.key}_d`] = l.dashboard[m.key];
          row[`${m.key}_x`] = l.diff[m.key];
        }
        return row;
      }),
      { zebra: true },
    );
  }
  doc.moveDown(0.6);
  aconexChangeEventsReport(ctx);
}

/** The Aconex change events against the change register: the variance per contractor, then each contractor's breakdown. */
function aconexChangeEventsReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const width = PAGE.width - PAGE.margin * 2;
  const check = buildAconexChangeCheck(data);
  const money = (v: unknown) => (v === null || v === undefined ? "–" : formatMoney(v as number));
  subheading(ctx, "2. Change events – PVOs, RFCs and budget transfers against the change register, contractor by contractor");
  if (!check.counts.events) {
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(9).text("No Aconex change-event export has been uploaded for this project yet.", { width });
    return;
  }
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(`${check.counts.matched} of ${check.counts.events} Aconex events matched to a change register entry by contract and PVO / RFC number (${check.counts.changes} register entries carry such a number${check.asOf ? `; export uploaded ${formatDate(check.asOf)}` : ""}). Approved: the approved cost impact of events marked approved in Aconex, against the register's Approved / Closed changes (DVO value once there is one, else the PVO value). Pending: events in planning or potential against the register's Pending, Review Complete and Revised entries. Transfers in: approved BTR events under the contractor's contracts against the register's approved transfers into its packages – for information. Differences under SAR ${check.counts.tolerance} are rounding.`, { width });
  doc.moveDown(0.4);
  kpiCards(
    ctx,
    [
      ["Events with a difference", String(check.counts.differing), check.counts.differing ? "value or status differs" : "every matched event agrees"],
      ["Approved changes – variance", formatMoney(check.totals.variance.approved), `Aconex ${formatMoney(check.totals.aconex.approved)} vs register ${formatMoney(check.totals.dashboard.approved)}`],
      ["Pending changes – variance", formatMoney(check.totals.variance.pending), `Aconex ${formatMoney(check.totals.aconex.pending)} vs register ${formatMoney(check.totals.dashboard.pending)}`],
      ["Only on one side", String(check.counts.aconexOnly + check.counts.dashboardOnly), `${check.counts.aconexOnly} only in Aconex, ${check.counts.dashboardOnly} only on the register`],
    ],
    (k) => (k[0].startsWith("Events with") && check.counts.differing ? "#b91c1c" : null),
  );
  subheading(ctx, "Contractor-wise variance", "Largest variance first; the breakdown of each contractor follows.");
  table(
    ctx,
    [
      { key: "contractor", label: "Contractor (contracts)", width: 2.2 },
      { key: "aa", label: "Approved – Aconex", width: 0.95, align: "right", format: money },
      { key: "ad", label: "Approved – register", width: 0.95, align: "right", format: money },
      { key: "av", label: "Variance", width: 0.9, align: "right", format: money },
      { key: "pa", label: "Pending – Aconex", width: 0.95, align: "right", format: money },
      { key: "pd", label: "Pending – register", width: 0.95, align: "right", format: money },
      { key: "pv", label: "Variance", width: 0.9, align: "right", format: money },
      { key: "ta", label: "Transfers in – Aconex", width: 0.95, align: "right", format: money },
      { key: "td", label: "Transfers in – register", width: 0.95, align: "right", format: money },
      { key: "tv", label: "Variance", width: 0.9, align: "right", format: money },
      { key: "items", label: "Items A / R", width: 0.6, align: "right" },
    ],
    [
      ...check.contractors.map((b) => ({ contractor: `${b.contractor}${b.contracts.length ? ` (${b.contracts.join(", ")})` : ""}`, aa: b.aconex.approved, ad: b.dashboard.approved, av: b.variance.approved, pa: b.aconex.pending, pd: b.dashboard.pending, pv: b.variance.pending, ta: b.aconex.transfers, td: b.dashboard.transfers, tv: b.variance.transfers, items: `${b.aconex.items} / ${b.dashboard.items}`, _flag: Math.abs(b.variance.approved) >= check.counts.tolerance || Math.abs(b.variance.pending) >= check.counts.tolerance })),
      { contractor: "Total", aa: check.totals.aconex.approved, ad: check.totals.dashboard.approved, av: check.totals.variance.approved, pa: check.totals.aconex.pending, pd: check.totals.dashboard.pending, pv: check.totals.variance.pending, ta: check.totals.aconex.transfers, td: check.totals.dashboard.transfers, tv: check.totals.variance.transfers, items: `${check.totals.aconex.items} / ${check.totals.dashboard.items}`, _total: true },
    ],
    { zebra: true, rowStyle: (r) => (r._total ? { bold: true } : r._flag ? { color: "#b91c1c" } : undefined) },
  );
  for (const b of check.contractors) {
    subheading(ctx, `${b.contractor}${b.contracts.length ? ` – contracts ${b.contracts.join(", ")}` : ""}`, `${b.differing} differ · ${b.onlyAconex} only in Aconex · ${b.onlyDashboard} only on the register · approved variance ${formatMoney(b.variance.approved)}, pending variance ${formatMoney(b.variance.pending)}`);
    table(
      ctx,
      [
        { key: "event", label: "Aconex event", width: 1.2 },
        { key: "name", label: "Name", width: 2.4 },
        { key: "as", label: "Aconex status", width: 0.8 },
        { key: "av", label: "Aconex value", width: 0.95, align: "right", format: money },
        { key: "item", label: "Register entry", width: 0.9 },
        { key: "ds", label: "Register status", width: 0.8 },
        { key: "pvo", label: "PVO value", width: 0.9, align: "right", format: money },
        { key: "dvo", label: "DVO value", width: 0.9, align: "right", format: money },
        { key: "diff", label: "Difference", width: 0.9, align: "right", format: money },
        { key: "finding", label: "Finding", width: 2.2 },
      ],
      b.lines.map((l) => ({
        event: l.eventNo || "–",
        name: l.name,
        as: l.aconexStatus || "–",
        av: l.aconexValue,
        item: l.changeItems.join(" + ") || "–",
        ds: l.changeStatus || "–",
        pvo: l.dashboardPvo,
        dvo: l.dashboardDvo,
        diff: l.diff,
        finding: `${l.status === "aconex_only" ? (l.kind === "BTR" ? "transfer" : "only in Aconex") : l.status === "dashboard_only" ? "only on register" : l.differs ? "differs" : "agrees"}${l.note ? ` – ${l.note}` : ""}`,
        _flag: l.differs,
        _amber: l.status !== "matched" && l.kind !== "BTR",
      })),
      { zebra: true, rowStyle: (r) => (r._flag ? { color: "#b91c1c" } : r._amber ? { color: "#b45309" } : undefined) },
    );
  }
}

/** The consolidated "Uncommitted Costs and Early Warnings" table for the report, one row per cost report line, in the programme-wide Level 5 layout, with the early warnings behind it. */
function uncommittedEwReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const width = PAGE.width - PAGE.margin * 2;
  const t = buildUncommittedTable(data);
  const money = (v: unknown) => (v === null || v === undefined || Math.abs(Number(v)) < 0.005 ? "–" : formatMoney(v as number));
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(
    `Every cost report line of ${data.programme.name} in ${data.period.label}, as the programme-wide "Level 5 – Contracts" sheet lays them out: approved budget, commitments, the uncommitted amounts by kind, what is uncommitted / not required, the early warnings (cost report column L) and the estimate at completion – from this report's own registers${data.locked ? " (issued)" : " (draft)"}.`,
    { width },
  );
  doc.moveDown(0.5);
  table(
    ctx,
    [
      { key: "code", label: "Code", width: 1.5 },
      { key: "name", label: "Name", width: 2.2 },
      { key: "contractor", label: "Contractor", width: 1.5 },
      { key: "budget", label: "Current approved budget", width: 1, align: "right", format: money },
      { key: "commitments", label: "Total commitments", width: 1, align: "right", format: money },
      { key: "voUnderProcess", label: "VO under process", width: 0.9, align: "right", format: money },
      { key: "eotClaims", label: "EOT claims", width: 0.9, align: "right", format: money },
      { key: "otherClaims", label: "Other claims", width: 0.9, align: "right", format: money },
      { key: "uncommittedScope", label: "Identified uncommitted scope", width: 0.9, align: "right", format: money },
      { key: "plantSupply", label: "Plant supply", width: 0.8, align: "right", format: money },
      { key: "ffe", label: "FF&E", width: 0.8, align: "right", format: money },
      { key: "totalUncommitted", label: "Total uncommitted", width: 1, align: "right", format: money },
      { key: "notRequired", label: "Uncommitted / not required", width: 1, align: "right", format: money },
      { key: "earlyWarnings", label: "Early warnings", width: 1, align: "right", format: money },
      { key: "eac", label: "Estimate at completion", width: 1, align: "right", format: money },
    ],
    t.rows.map((r) => ({ ...r, code: r.kind === "line" ? r.code : "" })) as unknown as Record<string, unknown>[],
    { totalRow: { ...t.total, code: "" } as unknown as Record<string, unknown>, rowStyle: (r) => (r.kind === "category" ? { bold: true, bg: ZEBRA, color: NAVY } : undefined) },
  );
  const withEws = t.rows.filter((r) => r.kind === "line" && r.ews.length);
  if (withEws.length || t.unlinkedEws.length) {
    subheading(ctx, "Early warnings behind column L", `${t.counts.ews} early warning(s) on the register, ${t.counts.openEws} open – as on the Early Warning sheet of the workbook, contract by contract; each is carried in the column its wording names (EOT claims, other claims, identified uncommitted scope, plant supply, FF&E) and the rest stays under early warnings.`);
    const rows: Record<string, unknown>[] = [];
    for (const r of withEws) {
      rows.push({ __span: true, ewNo: `${r.code} – ${r.name}${r.contractor ? ` (${r.contractor})` : ""} – column L ${formatMoney(r.earlyWarnings)}` });
      for (const e of r.ews) rows.push({ ewNo: e.ewNo, description: e.description, contractor: e.contractor, status: e.status, bucket: e.bucketLabel, amount: e.amount });
    }
    if (t.unlinkedEws.length) {
      rows.push({ __span: true, ewNo: "Not linked to a cost report line (not in column L)" });
      for (const e of t.unlinkedEws) rows.push({ ewNo: e.ewNo, description: e.description, contractor: e.contractor, status: e.status, bucket: e.bucketLabel, amount: e.amount });
    }
    table(
      ctx,
      [
        { key: "ewNo", label: "EW No", width: 0.8 },
        { key: "description", label: "Description", width: 3.4 },
        { key: "contractor", label: "Contractor", width: 1.6 },
        { key: "status", label: "Status", width: 0.7 },
        { key: "bucket", label: "Counted under", width: 1.2 },
        { key: "amount", label: "Cost impact (SAR)", width: 1, align: "right", format: money },
      ],
      rows,
      { zebra: true, rowStyle: (r) => (r.__span ? { span: true } : undefined) },
    );
  }
}

function signedBars(ctx: Ctx, rows: { short: string; value: number }[]) {
  const { doc } = ctx;
  if (!rows.length) return;
  const rowH = 16;
  const h = rows.length * rowH + 10;
  ensureSpace(ctx, h + 20);
  const labelW = 120;
  const x0 = PAGE.margin + labelW;
  const w = PAGE.width - PAGE.margin * 2 - labelW - 90;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const mid = x0 + w / 2;
  const top = doc.y + 4;
  doc.moveTo(mid, top).lineTo(mid, top + rows.length * rowH).strokeColor(LINE).lineWidth(0.7).stroke();
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const len = (Math.abs(r.value) / max) * (w / 2 - 4);
    doc.fillColor("#172033").font("Helvetica").fontSize(7.5).text(r.short, PAGE.margin, y + 3, { width: labelW - 8, ellipsis: true, lineBreak: false });
    if (Math.abs(r.value) >= 0.5) {
      const adverse = r.value > 0;
      doc.rect(adverse ? mid : mid - len, y + 3, len, rowH - 6).fill(adverse ? "#dc2626" : "#059669");
    }
    doc.fillColor(r.value > 0.5 ? "#b91c1c" : r.value < -0.5 ? "#047857" : MUTED).font("Helvetica-Bold").fontSize(7.5).text(sarMove(r.value), x0 + w + 6, y + 3, { width: 84, align: "right", lineBreak: false });
  });
  doc.y = top + rows.length * rowH + 8;
  doc.x = PAGE.margin;
}

function periodSummaryReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const ps = buildPeriodSummary(data, { name: "" });
  const width = PAGE.width - PAGE.margin * 2;
  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  const move = (v: unknown) => (v === null || v === undefined ? "" : sarMove(v as number));
  const adverse = (n: number | null) => (n === null ? null : n > 0.5 ? "#b91c1c" : n < -0.5 ? "#047857" : null);

  // headline cards
  const kpis: [string, string, string][] = [
    [`Previous report${ps.previous ? ` – ${ps.previous.short}` : ""}`, ps.projected.prev === null ? "–" : sar(ps.projected.prev), "projected cost to complete (anticipated final account)"],
    [`Updated position – ${ps.period.short}`, sar(ps.projected.now), `cut-off ${ps.period.cutOff}${ps.locked ? "" : " · draft"}`],
    ["Net movement", sarMove(ps.projected.delta), ps.projected.deltaPct === null ? "no issued previous report" : `${ps.projected.deltaPct > 0 ? "+" : ""}${ps.projected.deltaPct.toFixed(2)}% on the previous forecast`],
    [`Variance to approved budget – ${ps.budget.verdict}`, sarMove(ps.budget.variance), `${ps.budget.variancePct > 0 ? "+" : ""}${ps.budget.variancePct.toFixed(2)}% of ${sar(ps.budget.approved)}`],
  ];
  kpiCards(ctx, kpis, (k) => (k[0].startsWith("Net movement") ? adverse(ps.projected.delta) : k[0].startsWith("Variance") ? adverse(ps.budget.variance) : null));

  subheading(ctx, "Projected cost to complete");
  doc.fillColor("#172033").font("Helvetica").fontSize(9.5).text(ps.projected.narrative, { width, lineGap: 1.5 });
  doc.moveDown(0.4);

  subheading(ctx, "Budget position");
  table(
    ctx,
    [
      { key: "label", label: "", width: 3 },
      { key: "value", label: "SAR", width: 1.4, align: "right", format: (v, r) => (r.signed ? sarMove(v as number) : money(v)) },
    ],
    [
      { label: "Current forecast (anticipated final account)", value: ps.budget.forecast },
      { label: "Approved budget (latest, incl. transfers)", value: ps.budget.approved },
      { label: `Variance (${ps.budget.verdict})`, value: ps.budget.variance, signed: true, __bold: true },
    ],
    { rowStyle: (r) => (r.__bold ? { bold: true, bg: ZEBRA, color: adverse(ps.budget.variance) ?? undefined } : undefined) },
  );
  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8).text(`Note: ${ps.budget.note}`, { width });
  doc.moveDown(0.5);

  if (ps.hasComparison) {
    subheading(ctx, "Forecast movement analysis", `What moved the anticipated final account since ${ps.previous!.label}.`);
    table(
      ctx,
      [
        { key: "label", label: "Movement", width: 3 },
        { key: "value", label: "SAR", width: 1.4, align: "right", format: move },
        { key: "note", label: "", width: 2.2 },
      ],
      [...ps.movement.rows, { label: "NET FORECAST MOVEMENT", value: ps.movement.net, __bold: true, note: "" }] as unknown as Record<string, unknown>[],
      { rowStyle: (r) => (r.__bold ? { bold: true, bg: ZEBRA, color: adverse(ps.movement.net) ?? undefined } : undefined) },
    );
    doc.moveDown(0.3);
    signedBars(ctx, ps.movement.rows);
  }

  if (ps.status.length) {
    subheading(ctx, "Key period movements – change management monthly status", "Items still pending at each stage.");
    table(
      ctx,
      [
        { key: "label", label: "Category", width: 1.5 },
        { key: "prev", label: ps.previous ? `Position last month (${ps.previous.short})` : "Position", width: 1.6, align: "right", format: (v) => `${v} pending` },
        { key: "delta", label: "Movement", width: 1, align: "right", format: (v) => (Number(v) > 0 ? `+${v}` : String(v)) },
        { key: "now", label: "Current outstanding", width: 1.4, align: "right", format: (v) => `${v} pending` },
      ],
      ps.status as unknown as Record<string, unknown>[],
      { zebra: true },
    );
  }

  if (ps.hasComparison && ps.categories.length) {
    subheading(ctx, "Key period movements by category (value)");
    table(
      ctx,
      [
        { key: "label", label: "Category", width: 3 },
        { key: "total", label: "Movement (SAR)", width: 1.4, align: "right", format: move },
        { key: "balance", label: "Balance in this report (SAR)", width: 1.6, align: "right", format: money },
        { key: "count", label: "Items", width: 0.6, align: "right" },
      ],
      ps.categories as unknown as Record<string, unknown>[],
      { zebra: true, rowStyle: (r) => ({ color: adverse(r.total as number) ?? undefined }) },
    );

    const cols: Col[] = [
      { key: "key", label: "Ref", width: 0.9 },
      { key: "title", label: "Description", width: 3.4 },
      { key: "party", label: "Contractor", width: 1.4 },
      { key: "prev", label: "Previous (SAR)", width: 1.1, align: "right", format: money },
      { key: "now", label: "Current (SAR)", width: 1.1, align: "right", format: money },
      { key: "delta", label: "Movement", width: 1.1, align: "right", format: move },
      { key: "note", label: "What happened", width: 1.6 },
    ];
    for (const c of ps.categories) {
      ensureSpace(ctx, 120);
      subheading(ctx, `${c.label} – ${sarMove(c.total)}`, `${plural(c.count, "item")} moved · balance now ${sar(c.balance)}`);
      doc.fillColor("#172033").font("Helvetica").fontSize(9).text(c.narrative, { width, lineGap: 1.2 });
      doc.moveDown(0.3);
      if (c.groups.length) {
        const rows = c.groups.flatMap((gr) => [{ key: `${gr.heading} – ${sarMove(gr.total)}`, __span: true }, ...gr.items]);
        table(ctx, cols, rows as unknown as Record<string, unknown>[], { zebra: true, rowStyle: (r) => (r.__span ? { span: true } : { color: adverse(r.delta as number) ?? undefined }) });
      }
      doc.moveDown(0.3);
    }
  }

  subheading(ctx, "Balances carried in the cost report");
  table(
    ctx,
    [
      { key: "label", label: "Column", width: 3 },
      { key: "value", label: "SAR", width: 1.4, align: "right", format: money },
    ],
    ps.balances as unknown as Record<string, unknown>[],
    { zebra: true },
  );

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from ${APP_NAME} as at ${formatDateTime(ps.generatedAt)}${ps.locked ? "" : " (draft – period not locked)"}. Figures are the cost report's anticipated final account; movements compare with the previous issued report. Positive movements are increases in forecast cost.`, { width });
}

/* ------------------------------------------------------------------ */
/* Early Warnings & Risks / Opportunities Status Report (executive)    */

function ewStatusReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const r = buildEwReport(data);
  const h = r.headline;
  const sar = (n: number) => formatMoney(n);
  const kpis: [string, string, string][] = [
    ["Open early warnings", String(h.ewOpen), `${sar(h.ewOpenValue)} in column L · ${h.ewConverted} converted to a change`],
    ["Late early warnings (30 / 60d)", `${h.ewOverdue30} / ${h.ewOverdue60}`, "open items by days since raised"],
    ["Risk exposure", sar(h.riskExposure), `${h.risksOpen} open risk(s), ${h.highRated} rated High`],
    ["Opportunity value", sar(h.opportunityValue), `net exposure ${sar(h.netExposure)}`],
  ];
  kpiCards(ctx, kpis);

  const width = PAGE.width - PAGE.margin * 2;
  subheading(ctx, "Commercial narrative");
  for (const p of r.narrative) {
    ensureSpace(ctx, 50);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(p.heading, { width });
    doc.fillColor("#172033").font("Helvetica").fontSize(9.5).text(p.text, { width, lineGap: 1.5 });
    doc.moveDown(0.5);
  }
  if (r.movement) {
    subheading(ctx, r.movement.label);
    if (!r.movement.items.length) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("No movement in the early warning or risk registers.");
    for (const it of r.movement.items) {
      ensureSpace(ctx, 14);
      doc.fillColor("#172033").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }
  if (r.attention.length) {
    subheading(ctx, "Items requiring attention");
    for (const it of r.attention) {
      ensureSpace(ctx, 14);
      doc.fillColor("#7c2d12").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }

  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  subheading(ctx, "Open early warnings", "One block per contractor; largest cost impact first.");
  partyTables(
    ctx,
    groupByParty(
      r.ewOpen,
      (x) => x.contractor,
      (x) => ({ cost: x.costImpact ?? 0, days: x.timeImpactDays ?? 0 }),
    ),
    [
      { key: "ew_no", label: "EW No", width: 0.7 },
      { key: "description", label: "Description", width: 3.8 },
      { key: "likelihood", label: "Likelihood", width: 0.9 },
      { key: "costImpact", label: "Cost impact (SAR)", width: 1.2, align: "right", format: money },
      { key: "timeImpactDays", label: "Time (days)", width: 0.8, align: "right" },
      { key: "daysOpen", label: "Days open", width: 0.7, align: "right" },
    ],
    (g) => `${plural(g.count, "open item")} · ${formatMoney(g.totals.cost ?? 0)} of potential cost · ${plural(g.totals.days ?? 0, "day")} of potential delay`,
    { key: "contractor", label: "Contractor", width: 1.5 },
  );

  if (r.risksOpen.length) {
    subheading(ctx, "Open risks & opportunities", "Largest expected value first.");
    table(
      ctx,
      [
        { key: "ro_no", label: "No", width: 0.6 },
        { key: "type", label: "Type", width: 0.9 },
        { key: "description", label: "Description", width: 2.8 },
        { key: "owner", label: "Owner", width: 1.2 },
        { key: "probability", label: "Prob. %", width: 0.7, align: "right" },
        { key: "costImpact", label: "Cost impact (SAR)", width: 1.2, align: "right", format: money },
        { key: "expectedValue", label: "Expected value (SAR)", width: 1.3, align: "right", format: money },
        { key: "rating", label: "Rating", width: 0.7 },
      ],
      r.risksOpen as unknown as Record<string, unknown>[],
      { zebra: true },
    );
  }

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from the Early Warnings and Risks & Opportunities registers of ${APP_NAME} as at ${formatDate(r.asOf)}${data.locked ? "" : " (draft – period not locked)"}. Expected value = probability × cost impact.`, { width });
}

/* ------------------------------------------------------------------ */
/* Provisional Sums Status Report (executive)                          */

function psStatusReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const r = buildPsReport(data);
  const h = r.headline;
  const sar = (n: number) => formatMoney(n);
  const kpis: [string, string, string][] = [
    ["Provisional sums", String(h.total), `${h.withValue} of ${h.total} instructed`],
    ["Total budget", sar(h.budget), "sum of all provisional sum allowances"],
    ["Total instructed", sar(h.instructed), h.withoutValue ? `${h.withoutValue} item(s) not yet instructed` : "every item instructed"],
    [h.net >= 0 ? "Net extra vs budget" : "Net saving vs budget", sar(Math.abs(h.net)), `extras ${sar(h.extras)} · savings ${sar(h.savings)}`],
  ];
  kpiCards(ctx, kpis);

  const width = PAGE.width - PAGE.margin * 2;
  subheading(ctx, "Commercial narrative");
  for (const p of r.narrative) {
    ensureSpace(ctx, 50);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(p.heading, { width });
    doc.fillColor("#172033").font("Helvetica").fontSize(9.5).text(p.text, { width, lineGap: 1.5 });
    doc.moveDown(0.5);
  }
  if (r.movement) {
    subheading(ctx, r.movement.label);
    if (!r.movement.items.length) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("No movement in the provisional sums register.");
    for (const it of r.movement.items) {
      ensureSpace(ctx, 14);
      doc.fillColor("#172033").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }
  if (r.attention.length) {
    subheading(ctx, "Items requiring attention");
    for (const it of r.attention) {
      ensureSpace(ctx, 14);
      doc.fillColor("#7c2d12").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }

  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  subheading(ctx, "Provisional sums at cut-off", "Largest (saving) / extra first.");
  table(
    ctx,
    [
      { key: "item", label: "Item", width: 0.7 },
      { key: "description", label: "Description", width: 2.8 },
      { key: "contractor", label: "Contractor", width: 1.6 },
      { key: "status", label: "Status", width: 1 },
      { key: "budget", label: "Budget (SAR)", width: 1.1, align: "right", format: money },
      { key: "contractValue", label: "Instructed (SAR)", width: 1.1, align: "right", format: money },
      { key: "savingExtra", label: "(Saving) / Extra", width: 1.1, align: "right", format: money },
    ],
    r.rows as unknown as Record<string, unknown>[],
    { zebra: true, totalRow: { item: "TOTAL", budget: formatMoney(h.budget), contractValue: formatMoney(h.instructed), savingExtra: formatMoney(h.net) } },
  );

  subheading(ctx, "By status");
  table(
    ctx,
    [
      { key: "status", label: "Status", width: 2 },
      { key: "n", label: "Items", width: 1, align: "right" },
      { key: "budget", label: "Budget (SAR)", width: 1.5, align: "right", format: money },
      { key: "contractValue", label: "Instructed (SAR)", width: 1.5, align: "right", format: money },
    ],
    r.byStatus as unknown as Record<string, unknown>[],
    { zebra: true },
  );

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from the Provisional Sums register of ${APP_NAME} as at ${formatDate(r.asOf)}${data.locked ? "" : " (draft – period not locked)"}. (Saving) / Extra = instructed value − budget.`, { width });
}

/* ------------------------------------------------------------------ */
/* Bonds & Insurance Status Report (executive)                         */

function bondsStatusReport(ctx: Ctx, filter: BondsFilter = NO_BONDS_FILTER) {
  const { doc, data } = ctx;
  const r = buildBondsReport(data, filter);
  const h = r.headline;
  const sar = (n: number) => formatMoney(n);
  if (r.filterLabel) {
    const w = PAGE.width - PAGE.margin * 2;
    const y0 = doc.y;
    doc.rect(PAGE.margin, y0, w, 20).fillAndStroke("#eff6ff", "#bfdbfe");
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(`Filtered report:  ${r.filterLabel}`, PAGE.margin + 8, y0 + 6, { width: w - 16 });
    doc.y = y0 + 28;
    doc.x = PAGE.margin;
  }
  const kpis: [string, string, string][] = [
    ["Bonds & policies", String(h.total), `${h.expired} expired · ${h.expiring15} within 15d · ${h.expiring30} within 30d · ${h.expiring60} within 60d`],
    ["Cover held", sar(h.provided), `of ${sar(h.required)} required`],
    ["Shortfalls", String(h.shortfallCount), h.shortfallCount ? `${sar(h.shortfallValue)} below requirement` : "every item meets its requirement"],
    ["Checks outstanding", `${h.notApproved} / ${h.notVerified}`, "not approved / not bank-verified"],
  ];
  kpiCards(ctx, kpis);

  const width = PAGE.width - PAGE.margin * 2;
  subheading(ctx, "Commercial narrative");
  for (const p of r.narrative) {
    ensureSpace(ctx, 50);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(p.heading, { width });
    doc.fillColor("#172033").font("Helvetica").fontSize(9.5).text(p.text, { width, lineGap: 1.5 });
    doc.moveDown(0.5);
  }
  if (r.movement) {
    subheading(ctx, r.movement.label);
    if (!r.movement.items.length) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("No movement in the bonds and insurance register.");
    for (const it of r.movement.items) {
      ensureSpace(ctx, 14);
      doc.fillColor("#172033").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }
  if (r.attention.length) {
    subheading(ctx, "Items requiring attention");
    for (const it of r.attention) {
      ensureSpace(ctx, 14);
      doc.fillColor("#7c2d12").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }

  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  const detailColumns: Col[] = [
    { key: "ref", label: "Ref", width: 0.6 },
    { key: "contractor", label: "Contractor / consultant", width: 1.8 },
    { key: "package", label: "Package", width: 1.4 },
    { key: "type", label: "Type", width: 1.5 },
    { key: "required", label: "Required (SAR)", width: 1.1, align: "right", format: money },
    { key: "provided", label: "Provided (SAR)", width: 1.1, align: "right", format: money },
    { key: "expiryDate", label: "Expiry", width: 0.85, format: (v) => formatDate(v as string) },
    { key: "daysToExpiry", label: "Days", width: 0.55, align: "right" },
    { key: "status", label: "Status", width: 0.75 },
  ];
  if (r.sections.length) {
    // Bonds and insurance are chased separately and each chase is one conversation per contractor,
    // so each gets its own table, broken by contractor, with that contractor's subtotal under it.
    const chaseColumns: Col[] = [
      { key: "ref", label: "Ref", width: 0.55 },
      { key: "type", label: "Type of bond / policy", width: 1.9 },
      { key: "policyNo", label: "Policy / bond no", width: 1.2 },
      { key: "package", label: "Package", width: 1.3 },
      { key: "expiryDate", label: "Expiry", width: 0.85, format: (v) => formatDate(v as string) },
      { key: "daysToExpiry", label: "Days", width: 0.6, align: "right", format: (v) => (v === null || v === undefined ? "" : Number(v) < 0 ? `${-Number(v)} ago` : String(v)) },
      { key: "required", label: "Required (SAR)", width: 1.05, align: "right", format: money },
      { key: "provided", label: "Provided (SAR)", width: 1.05, align: "right", format: money },
      { key: "status", label: "Status", width: 0.8 },
    ];
    for (const sec of r.sections) {
      // the heading, the first contractor's name and a row or two of their table have to fit, or the
      // heading is left stranded at the foot of the page with nothing under it
      ensureSpace(ctx, 150);
      subheading(
        ctx,
        `${sec.title} – ${sec.count} item(s)`,
        `${sec.contractors.length} contractor(s) · ${sar(sec.provided)} held against ${sar(sec.required)} required${sec.shortfall ? ` · ${sar(sec.shortfall)} short` : ""}.`,
      );
      partyTables(
        ctx,
        sec.contractors.map((g) => ({ party: g.contractor, count: g.count, totals: { required: g.required, provided: g.provided, shortfall: g.shortfall }, items: g.items })),
        chaseColumns,
        (g) => `${plural(g.count, "item")} · ${sar(g.totals.provided ?? 0)} held against ${sar(g.totals.required ?? 0)} required${g.totals.shortfall ? ` · ${sar(g.totals.shortfall)} short` : ""}`,
        { key: "contractor", label: "Contractor / consultant", width: 1.8 },
      );
    }
  } else if (r.filterLabel) {
    subheading(ctx, `${r.filterLabel} – full list`, `${r.rows.length} item(s), earliest expiry first.`);
    table(ctx, detailColumns, r.rows as unknown as Record<string, unknown>[], { zebra: true });
  } else if (r.expiring.length) {
    subheading(ctx, "Expired or expiring soon", "Earliest expiry first.");
    table(
      ctx,
      [
        { key: "ref", label: "Ref", width: 0.6 },
        { key: "contractor", label: "Contractor / consultant", width: 2 },
        { key: "type", label: "Type", width: 1.6 },
        { key: "provided", label: "Provided (SAR)", width: 1.1, align: "right", format: money },
        { key: "expiryDate", label: "Expiry", width: 0.9, format: (v) => formatDate(v as string) },
        { key: "daysToExpiry", label: "Days", width: 0.6, align: "right" },
        { key: "status", label: "Status", width: 0.8 },
      ],
      r.expiring as unknown as Record<string, unknown>[],
      { zebra: true },
    );
  }
  if (r.byCategory.length > 1) {
    subheading(ctx, "Bonds vs insurance");
    table(
      ctx,
      [
        { key: "category", label: "Category", width: 2.5 },
        { key: "n", label: "Items", width: 1, align: "right" },
        { key: "required", label: "Required (SAR)", width: 1.5, align: "right", format: money },
        { key: "provided", label: "Provided (SAR)", width: 1.5, align: "right", format: money },
      ],
      r.byCategory as unknown as Record<string, unknown>[],
      { zebra: true },
    );
  }
  subheading(ctx, "By type of bond / insurance");
  table(
    ctx,
    [
      { key: "type", label: "Type", width: 2.5 },
      { key: "n", label: "Items", width: 1, align: "right" },
      { key: "required", label: "Required (SAR)", width: 1.5, align: "right", format: money },
      { key: "provided", label: "Provided (SAR)", width: 1.5, align: "right", format: money },
    ],
    r.byType as unknown as Record<string, unknown>[],
    { zebra: true },
  );

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from the Bonds & Insurance register of ${APP_NAME} as at ${formatDate(r.asOf)}${data.locked ? "" : " (draft – period not locked)"}${r.filterLabel ? `, filtered to ${r.filterLabel.toLowerCase()}` : ""}. Released and superseded items are excluded from the cover totals.`, { width });
}

/* ------------------------------------------------------------------ */
/* Budget Transfers Status Report (executive)                          */

function transfersStatusReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const r = buildTransfersReport(data);
  const h = r.headline;
  const sar = (n: number) => formatMoney(n);
  const kpis: [string, string, string][] = [
    ["Transfers", String(h.total), `${h.approved} approved · ${h.pending} pending`],
    ["Approved amount moved", sar(h.approvedAmount), "leaves the From package, arrives in the To package"],
    ["Pending approval", sar(h.pendingAmount), "not yet in the cost report"],
    h.columnFFromWorkbook ? ["Cost report column F", sar(h.columnF), "Schedule B grand total, brought forward from the Excel cost report"] : ["Not applied", String(h.notApplied), h.notApplied ? "approved transfers missing a cost line" : "all approved transfers applied"],
  ];
  kpiCards(ctx, kpis);

  const width = PAGE.width - PAGE.margin * 2;
  subheading(ctx, "Commercial narrative");
  for (const p of r.narrative) {
    ensureSpace(ctx, 50);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(p.heading, { width });
    doc.fillColor("#172033").font("Helvetica").fontSize(9.5).text(p.text, { width, lineGap: 1.5 });
    doc.moveDown(0.5);
  }
  if (r.movement) {
    subheading(ctx, r.movement.label);
    if (!r.movement.items.length) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("No movement in the budget transfers register.");
    for (const it of r.movement.items) {
      ensureSpace(ctx, 14);
      doc.fillColor("#172033").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }
  if (r.attention.length) {
    subheading(ctx, "Items requiring attention");
    for (const it of r.attention) {
      ensureSpace(ctx, 14);
      doc.fillColor("#7c2d12").font("Helvetica").fontSize(9).text(`•  ${it}`, { width });
    }
    doc.moveDown(0.4);
  }

  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  subheading(ctx, "Net movement by package");
  table(
    ctx,
    [
      { key: "package", label: "Package", width: 3 },
      { key: "out", label: "Out (SAR)", width: 1.5, align: "right", format: money },
      { key: "in", label: "In (SAR)", width: 1.5, align: "right", format: money },
      { key: "net", label: "Net (SAR)", width: 1.5, align: "right", format: money },
    ],
    r.byPackage as unknown as Record<string, unknown>[],
    { zebra: true },
  );

  subheading(ctx, "Transfers", "Most recent first.");
  table(
    ctx,
    [
      { key: "item", label: "Item", width: 0.7 },
      { key: "description", label: "Description", width: 2.4 },
      { key: "fromPackage", label: "From", width: 1.6 },
      { key: "toPackage", label: "To", width: 1.6 },
      { key: "amount", label: "Amount (SAR)", width: 1.2, align: "right", format: money },
      { key: "date", label: "Date", width: 0.9, format: (v) => formatDate(v as string) },
      { key: "status", label: "Status", width: 0.9 },
    ],
    r.rows as unknown as Record<string, unknown>[],
    { zebra: true, totalRow: { item: "TOTAL", amount: formatMoney(h.approvedAmount + h.pendingAmount) } },
  );

  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from the Budget Transfers register of ${APP_NAME} as at ${formatDate(r.asOf)}${data.locked ? "" : " (draft – period not locked)"}.`, { width });
}

/* ------------------------------------------------------------------ */
/* Cost report                                                         */

const moneyCols = (keys: readonly string[]): Col[] =>
  MONEY_COLUMNS.filter((c) => keys.includes(c.key)).map((c) => ({ key: c.key, label: `${c.key} ${c.label}`, width: 1.25, align: "right" as const, format: (v) => formatMoney(v as number) }));

function costLevel1(ctx: Ctx) {
  const { data } = ctx;
  const r = data.costReport;
  const m = data.level1Matrix;
  const note = `${r.period?.label ?? ""} · previous report: ${m.previousLabel ?? "none"}${m.previousAvailable ? "" : " (no issued previous report – previous and movement columns empty)"} · source: ${data.sources.cost_report} · executive view: budget rows include the unallocated budget hold, all other rows exclude it`;
  subheading(ctx, "Cost Report – Executive (Excel Level 01 layout)", note);
  const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "" : formatMoney(v as number));
  const cols: Col[] = [
    { key: "label", label: "SAR", width: 2.4 },
    ...m.columns.map((c) => ({ key: c.key, label: c.label, width: 1.15, align: "right" as const, format: fmt })),
    { key: "total", label: `Total ${data.asset?.name ?? data.programme.name}`, width: 1.3, align: "right", format: fmt },
    { key: "previous", label: "Previous", width: 1.15, align: "right", format: fmt },
    { key: "movement", label: "Movement", width: 1.15, align: "right", format: fmt },
  ];
  const rows: Record<string, unknown>[] = m.rows.map((row) => {
    const o: Record<string, unknown> = { label: row.label, total: row.kind === "group" ? null : row.total, previous: row.previous, movement: row.movement, __kind: row.kind };
    m.columns.forEach((c, i) => (o[c.key] = row.kind === "group" ? null : row.values[i]));
    return o;
  });
  table(ctx, cols, rows, {
    rowStyle: (row) => (row.__kind === "group" ? { span: true } : row.__kind === "strong" ? { bold: true, bg: "#eef2f8" } : row.__kind === "muted" ? { color: MUTED } : undefined),
  });
  subheading(ctx, "Reasons for variance – this month", m.previousAvailable ? `Movement of the anticipated final account since ${m.previousLabel}` : "No issued previous report to compare with");
  if (m.reasons.length) {
    table(
      ctx,
      [
        { key: "col", label: "Col", width: 0.4 },
        { key: "title", label: "Item", width: 3 },
        { key: "amount", label: "Amount (SAR)", width: 1.2, align: "right", format: fmt },
        { key: "remark", label: "Remarks", width: 2.2 },
      ],
      m.reasons as unknown as Record<string, unknown>[],
      { zebra: true, totalRow: { col: "", title: "NET Movement (variance to last month)", amount: formatMoney(m.netMovement), remark: "" } },
    );
  } else {
    ctx.doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(m.previousAvailable ? "Nothing moved the anticipated final account this period." : "Lock the previous month's report to list the movements.", { width: PAGE.width - PAGE.margin * 2 });
    ctx.doc.moveDown(0.5);
  }
  ctx.doc.font("Helvetica").fontSize(7.5).fillColor(r.checkOk ? "#047857" : "#b91c1c").text(`Check: Level 1 total - Level 2 total (must be zero): ${r.checkOk ? "OK" : "FAILED – " + MONEY_COLUMNS.filter((c) => Math.abs(r.check[c.key]) >= 0.005).map((c) => `${c.key} ${formatMoney(r.check[c.key])}`).join(", ")}`, { width: PAGE.width - PAGE.margin * 2 });
  ctx.doc.moveDown(0.5);
}

function costLevel2(ctx: Ctx) {
  const { data } = ctx;
  const r = data.costReport;
  const textCols: Col[] = [
    { key: "code", label: "A Code", width: 1 },
    { key: "package", label: "B Package", width: 1.5 },
    { key: "name", label: "C Name", width: 1.5 },
    { key: "contractor", label: "D Contractor", width: 1.3 },
  ];
  const part = (title: string, keys: string[]) => {
    subheading(ctx, title, `grouped by cost category as on the Excel Level 02 sheet · "Remaining budget" lines are the unallocated budget hold · source: ${data.sources.cost_report}`);
    const cols = [...textCols, ...moneyCols(keys)];
    const rows: Record<string, unknown>[] = [];
    const bands: { index: number; label: string; values?: Money; kind: "section" | "subtotal" }[] = [];
    for (const b of r.categories) {
      bands.push({ index: rows.length, label: b.label, kind: "section" });
      for (const l of b.lines) rows.push(l as unknown as Record<string, unknown>);
      bands.push({ index: rows.length, label: `Sub-Total ${b.category || b.label}`, values: b.subtotal, kind: "subtotal" });
    }
    table(ctx, cols, rows, {
      zebra: true,
      bands,
      rowStyle: (row) => (row.is_budget_hold ? { color: MUTED } : undefined),
      totals: [
        { label: "GRAND TOTAL", values: r.grandTotal, labelKey: "code" },
        { label: "Total excl. budget-hold lines", values: r.totalsExclHold, labelKey: "code" },
        { label: "Check: L1 - L2 (must be zero)", values: r.check, labelKey: "code", tone: r.checkOk ? "green" : "red" },
      ],
    });
  };
  part("Columns E – I", ["E", "F", "G", "H", "I"]);
  part("Columns J – S", ["J", "K", "L", "M", "N", "O", "P", "Q", "R", "S"]);
}

/** Level 02 in the head office "Budget EAC" layout (Peter Ayliffe's consolidated format): the head office columns, the site forecast and how the uncommitted budget is used. */
function costLevel02R1(ctx: Ctx) {
  const { data } = ctx;
  const e = buildBudgetEac(data);
  const t = level02Table(e);
  const money = (v: unknown) => (typeof v === "number" ? formatMoney(v) : String(v ?? ""));
  const textCols: Col[] = [
    { key: "subCategory", label: "Sub-category", width: 1 },
    { key: "contractCode", label: "Contract Code", width: 1.2 },
    { key: "name", label: "Name", width: 2 },
  ];
  const flat = (row: Level02Row): Record<string, unknown> => ({
    ...row,
    subCategory: row.kind === "subtotal" ? `Sub-Total ${row.asset}` : row.kind === "total" ? "GRAND TOTAL" : row.subCategory,
    ...Object.fromEntries(EAC_COLUMNS.map((c) => [`use_${c.key}`, row.use[c.key]])),
  });
  const rows = t.rows.map(flat);
  const bands: TableOpts["bands"] = [];
  let i = 0;
  for (const a of e.assets) {
    bands.push({ index: i, label: a.name, kind: "section" });
    i += a.lines.length + 1;
  }
  const m = (key: string, label: string, width = 1.15): Col => ({ key, label, width, align: "right", format: money });
  const part = (title: string, cols: Col[]) => {
    subheading(ctx, title, `${e.month} · ${e.periodLabel} · the Level 02 tab of the head office "Programme XX Budget EAC" workbook, filled from the dashboard · source: ${data.sources.cost_report}`);
    table(ctx, [...textCols, ...cols], rows, {
      zebra: true,
      bands,
      rowStyle: (row) => (row.kind === "subtotal" ? { bold: true, bg: "#FFEB9C", color: "#9C5700" } : row.isHold ? { color: MUTED } : undefined),
      totalRow: flat(t.total),
    });
  };
  part("As per Head Office cost report", LEVEL02_MONEY.filter((c) => c.group === "ho").map((c) => m(c.key, c.label)));
  part("Site forecast and how the uncommitted budget is used", [...LEVEL02_MONEY.filter((c) => c.group === "site").map((c) => m(c.key, c.label)), ...EAC_COLUMNS.map((c) => m(`use_${c.key}`, c.label, 1))]);
  doc_notes(ctx, e.notes);
}

function doc_notes(ctx: Ctx, notes: string[]) {
  const { doc } = ctx;
  ensureSpace(ctx, 80);
  doc.moveDown(0.4);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
  for (const n of notes) doc.text(`• ${n}`, { width: PAGE.width - PAGE.margin * 2 });
  doc.fillColor("#172033").fontSize(9);
}

/* ------------------------------------------------------------------ */
/* Cash flow                                                           */

function cashflow(ctx: Ctx) {
  const { data } = ctx;
  const cf = data.cashflow;
  subheading(ctx, "Monthly forecast vs actual (SAR excl. VAT)", `${cf.actualsNote} · source: ${data.sources.cashflow}`);
  const months = cf.months;
  // chunk months so each table fits: 4 months x 3 columns per page width
  const chunk = 4;
  for (let i = 0; i < months.length; i += chunk) {
    const slice = months.slice(i, i + chunk);
    const cols: Col[] = [
      { key: "description", label: "Line description", width: 2.2 },
      { key: "supplier", label: "Supplier", width: 1.4 },
    ];
    for (const m of slice) {
      cols.push({ key: `${m.key}|f`, label: `${m.label} Forecast`, width: 1, align: "right" });
      cols.push({ key: `${m.key}|a`, label: `${m.label} Actual`, width: 1, align: "right" });
      cols.push({ key: `${m.key}|d`, label: `${m.label} Diff`, width: 1, align: "right" });
    }
    const rows = cf.rows.map((r) => {
      const o: Record<string, unknown> = { description: r.description, supplier: r.supplier };
      for (const m of slice) {
        o[`${m.key}|f`] = formatMoney(r.cells[m.key].forecast ?? 0);
        o[`${m.key}|a`] = formatMoney(r.cells[m.key].actual);
        o[`${m.key}|d`] = r.cells[m.key].difference === null ? "" : formatMoney(r.cells[m.key].difference);
      }
      return o;
    });
    const totals: Record<string, unknown> = { description: "Total" };
    for (const m of slice) {
      totals[`${m.key}|f`] = formatMoney(cf.monthTotals[m.key].forecast);
      totals[`${m.key}|a`] = formatMoney(cf.monthTotals[m.key].actual);
      totals[`${m.key}|d`] = formatMoney(cf.monthTotals[m.key].difference);
    }
    if (i > 0) subheading(ctx, `Months ${slice[0].label} – ${slice[slice.length - 1].label}`);
    table(ctx, cols, rows, { zebra: true, totalRow: totals });
  }
  subheading(ctx, "Totals", `Forecast ${formatMoney(cf.grand.forecast)} · Actual ${formatMoney(cf.grand.actual)} · Difference ${formatMoney(cf.grand.difference)}`);
  subheading(ctx, "Accruals – certified but not paid");
  table(
    ctx,
    [
      { key: "contract", label: "Contract", width: 3 },
      { key: "supplier", label: "Supplier", width: 2 },
      { key: "net_certified", label: "Net certified", width: 1.2, align: "right", format: (v) => formatMoney(v as number) },
      { key: "net_paid", label: "Net paid", width: 1.2, align: "right", format: (v) => formatMoney(v as number) },
      { key: "accrued", label: "Accrued", width: 1.2, align: "right", format: (v) => formatMoney(v as number) },
    ],
    cf.accruals.byContract as unknown as Record<string, unknown>[],
    { zebra: true, totalRow: { contract: "Total", accrued: formatMoney(cf.accruals.totalAccrued) } },
  );
}

/* ------------------------------------------------------------------ */
/* Generic register table                                              */

function registerTable(ctx: Ctx, key: string) {
  const { data } = ctx;
  const { def, rows } = data.registers[key];
  subheading(ctx, `${def.title} (${rows.length})`, `source: ${data.sources[key]}`);
  const fields = def.fields.filter((f) => !f.hideInTable && f.type !== "password");
  const cols: Col[] = fields.map((f) => ({
    key: f.type === "lookup" ? `${f.key}__label` : f.key,
    label: f.label,
    width: f.type === "textarea" ? 2.4 : f.type === "money" ? 1.3 : f.type === "date" ? 0.9 : f.type === "number" || f.type === "percent" ? 0.8 : f.type === "boolean" ? 0.7 : 1.2,
    align: f.type === "money" || f.type === "number" || f.type === "percent" ? "right" : "left",
    // a payment not yet made shows its expected date and running total, marked
    format: (v, row) => ((v === null || v === undefined || v === "") && row[`${f.key}__expected`] !== undefined && row[`${f.key}__expected`] !== null ? `${formatField(f, row[`${f.key}__expected`])} (exp.)` : formatField(f, v)),
  }));
  const totalRow: Record<string, unknown> | undefined = def.totals?.length
    ? Object.fromEntries([[cols[0].key, `Total (${rows.length})`], ...def.totals.map((k) => [k, formatMoney(rows.reduce((t, r) => t + (Number(r[k] ?? 0) || 0), 0))])])
    : undefined;
  if (!rows.length) {
    ctx.doc.fillColor(MUTED).fontSize(8.5).text("No records.");
    return;
  }
  table(ctx, cols, rows as Record<string, unknown>[], { zebra: true, totalRow });
}

function formatField(f: FieldDef, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "money":
      return formatMoney(v as number);
    case "number":
      return formatNumber(v as number, Number.isInteger(v) ? 0 : 2);
    case "percent":
      return formatPercent(v as number);
    case "date":
      return formatDate(v as string);
    case "boolean":
      return v ? "Yes" : "No";
    default:
      return String(v);
  }
}

/* ------------------------------------------------------------------ */
/* Table engine                                                        */

interface TableOpts {
  zebra?: boolean;
  /** per-row emphasis, e.g. bold sub-totals inside the rows */
  rowStyle?: (row: Record<string, unknown>, index: number) => { bold?: boolean; bg?: string; color?: string; span?: boolean } | undefined;
  totalRow?: Record<string, unknown>;
  totals?: { label: string; values: Money; labelKey: string; tone?: "green" | "red" }[];
  bands?: { index: number; label: string; values?: Money; kind: "section" | "subtotal" }[];
}

function table(ctx: Ctx, cols: Col[], rows: Record<string, unknown>[], opts: TableOpts = {}) {
  const { doc } = ctx;
  const totalW = PAGE.width - PAGE.margin * 2;
  const weight = cols.reduce((t, c) => t + c.width, 0);
  const widths = cols.map((c) => (c.width / weight) * totalW);
  const fontSize = cols.length > 12 ? 6.2 : cols.length > 8 ? 6.8 : 7.5;
  const pad = 3;

  const cellText = (c: Col, r: Record<string, unknown>) => (c.format ? c.format(r[c.key], r) : r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key]));
  const rowHeight = (texts: string[], bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    let h = 0;
    texts.forEach((t, i) => {
      h = Math.max(h, doc.heightOfString(t || " ", { width: widths[i] - pad * 2 }));
    });
    return Math.min(h + pad * 2, 110);
  };
  const drawRow = (texts: string[], style: { bg?: string; bold?: boolean; color?: string; span?: boolean } = {}) => {
    if (style.span) {
      ensureSpace(ctx, 16);
      if (doc.y === PAGE.margin + 33) drawHeader();
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(fontSize).fillColor(style.color ?? NAVY).text(texts[0], PAGE.margin + pad, y + pad, { width: totalW - pad * 2 });
      doc.moveTo(PAGE.margin, y + fontSize + pad * 2).lineTo(PAGE.margin + totalW, y + fontSize + pad * 2).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.y = y + fontSize + pad * 2;
      doc.x = PAGE.margin;
      return;
    }
    const h = rowHeight(texts, style.bold);
    ensureSpace(ctx, h + 2);
    if (doc.y === PAGE.margin + 33) drawHeader(); // new page: header repeated
    const y = doc.y;
    if (style.bg) doc.rect(PAGE.margin, y, totalW, h).fill(style.bg);
    let x = PAGE.margin;
    doc.font(style.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).fillColor(style.color ?? "#172033");
    texts.forEach((t, i) => {
      doc.text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: cols[i].align ?? "left", height: h - pad * 2, ellipsis: true });
      x += widths[i];
    });
    doc.moveTo(PAGE.margin, y + h).lineTo(PAGE.margin + totalW, y + h).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.y = y + h;
    doc.x = PAGE.margin;
  };
  const drawHeader = () => {
    const texts = cols.map((c) => c.label);
    const h = rowHeight(texts, true);
    const y = doc.y;
    doc.rect(PAGE.margin, y, totalW, h).fill(NAVY);
    let x = PAGE.margin;
    doc.font("Helvetica-Bold").fontSize(fontSize).fillColor("#ffffff");
    texts.forEach((t, i) => {
      doc.text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: cols[i].align ?? "left" });
      x += widths[i];
    });
    doc.y = y + h;
    doc.x = PAGE.margin;
  };

  ensureSpace(ctx, 40);
  drawHeader();
  const moneyRow = (label: string, values: Money, labelKey: string) => {
    const r: Record<string, unknown> = { [labelKey]: label };
    for (const c of MONEY_COLUMNS) r[c.key] = values[c.key];
    return r;
  };
  rows.forEach((r, i) => {
    for (const b of opts.bands ?? []) {
      if (b.index === i) {
        if (b.kind === "section") drawRow([b.label.toUpperCase()], { bold: true, color: NAVY, span: true });
        else drawRow(cols.map((c) => cellText(c, moneyRow(b.label, b.values!, cols[0].key))), { bold: true, bg: ZEBRA });
      }
    }
    const st = opts.rowStyle?.(r, i);
    // a row can flag itself: a claim gone quiet, an item past its date – shaded in the report's own
    // muted amber / red so it stands out without shouting
    const toneBg = r.__tone === "amber" ? "#fbf3e2" : r.__tone === "red" ? "#f8e7e5" : undefined;
    if (st?.span) drawRow([String(r[cols[0].key] ?? "")], { bold: true, color: st.color ?? NAVY, span: true });
    else drawRow(cols.map((c) => cellText(c, r)), { bg: st?.bg ?? toneBg ?? (opts.zebra && i % 2 === 1 ? ZEBRA : undefined), bold: st?.bold, color: st?.color });
  });
  for (const b of opts.bands ?? []) if (b.index === rows.length && b.kind === "subtotal") drawRow(cols.map((c) => cellText(c, moneyRow(b.label, b.values!, cols[0].key))), { bold: true, bg: ZEBRA });
  if (opts.totalRow) drawRow(cols.map((c) => (opts.totalRow![c.key] === undefined ? "" : String(opts.totalRow![c.key]))), { bold: true, bg: "#e8eef7" });
  for (const t of opts.totals ?? []) drawRow(cols.map((c) => cellText(c, moneyRow(t.label, t.values, t.labelKey))), { bold: true, bg: "#e8eef7", color: t.tone === "green" ? "#047857" : t.tone === "red" ? "#b91c1c" : NAVY });
  doc.moveDown(0.5);
}

/* ------------------------------------------------------------------ */
/* Simple grouped bar chart                                            */

function barChart(ctx: Ctx, data: { label: string; a: number; b: number }[], labelA: string, labelB: string) {
  const { doc } = ctx;
  if (!data.length) return doc.fillColor(MUTED).text("No cost lines.");
  const h = 150;
  ensureSpace(ctx, h + 40);
  const x0 = PAGE.margin + 60;
  const w = PAGE.width - PAGE.margin * 2 - 60;
  const y0 = doc.y + 10;
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const band = w / data.length;
  const bw = Math.min(18, band / 3);
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const y = y0 + h - (v / max) * h;
    doc.moveTo(x0, y).lineTo(x0 + w, y).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text(compact(v), PAGE.margin, y - 3, { width: 55, align: "right" });
  }
  data.forEach((d, i) => {
    const cx = x0 + band * i + band / 2;
    const ha = (d.a / max) * h;
    const hb = (d.b / max) * h;
    doc.rect(cx - bw - 1, y0 + h - ha, bw, ha).fill("#2a78d6");
    doc.rect(cx + 1, y0 + h - hb, bw, hb).fill("#eb6834");
    doc.fillColor("#172033").font("Helvetica").fontSize(6.5).text(d.label, cx - band / 2, y0 + h + 4, { width: band, align: "center", ellipsis: true, height: 10 });
  });
  doc.y = y0 + h + 18;
  doc.x = PAGE.margin;
  const ly = doc.y;
  doc.rect(x0, ly, 8, 8).fill("#2a78d6");
  doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(labelA, x0 + 12, ly - 1, { lineBreak: false });
  const wA = doc.widthOfString(labelA);
  doc.rect(x0 + 12 + wA + 14, ly, 8, 8).fill("#eb6834");
  doc.fillColor(MUTED).text(labelB, x0 + 12 + wA + 26, ly - 1, { lineBreak: false });
  doc.y = ly + 14;
  doc.x = PAGE.margin;
}

function compact(v: number) {
  if (v >= 1e9) return `${Number((v / 1e9).toFixed(2))}bn`;
  if (v >= 1e6) return `${Number((v / 1e6).toFixed(2))}M`;
  if (v >= 1e3) return `${Number((v / 1e3).toFixed(1))}k`;
  return String(Math.round(v));
}

/* ------------------------------------------------------------------ */
/* Cash Flow Forecast – the Employer's executive review pages          */

function cashflowForecastReport(ctx: Ctx) {
  const { doc, data } = ctx;
  const cf = buildCashflowForecast(data);
  const width = PAGE.width - PAGE.margin * 2;
  const money = (v: unknown) => (v === null || v === undefined || Math.abs(Number(v)) < 0.005 ? "–" : formatMoney(v as number));
  const pctText = (v: number | null) => (v === null ? "–" : `${formatNumber(v)}%`);
  const s = cf.summary;
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(
    `${cf.programme.name} (${cf.programme.code}) · ${cf.period.label} · Total approved budget SAR ${formatMoney(s.budget)} · ${monthLabel(s.start)} to ${monthLabel(s.end)} (${s.durationMonths} months) · Currency SAR, excl. VAT. Built from the cost report, the IPC log and the contracts' completion dates – see the assumptions at the end.`,
    { width },
  );
  doc.moveDown(0.5);

  // 1. executive summary
  subheading(ctx, "1. Executive summary");
  kpiCards(ctx, [
    ["Total approved budget", formatMoney(s.budget), "cost report column G"],
    ["Actual spend to date", formatMoney(s.actual), `certified to ${cf.period.label}`],
    ["Committed cost", formatMoney(s.committed), "awarded contracts + determined VOs"],
    ["Forecast remaining cost", formatMoney(s.forecastRemaining), "cash to completion"],
    ["Forecast final cost", formatMoney(s.forecastFinal), `anticipated final account SAR ${formatMoney(s.afa)}`],
    ["Budget variance", `${s.variance > 0 ? "+" : ""}${formatMoney(s.variance)}`, s.variance > 0 ? "forecast above budget" : "within budget"],
    ["Previous forecast final", s.previousForecastFinal === null ? "–" : formatMoney(s.previousForecastFinal), s.forecastChange === null ? "no previous report" : `${s.forecastChange >= 0 ? "+" : ""}${formatMoney(s.forecastChange)} since last report`],
    ["Peak funding month", cf.kpis.peakMonth ? cf.kpis.peakMonth.label : "–", cf.kpis.peakMonth ? `SAR ${formatMoney(cf.kpis.peakMonth.amount)}` : ""],
  ], (k) => (k[0] === "Budget variance" ? (s.variance > 0 ? "#b42318" : "#067647") : null));

  // 6. management dashboard (KPIs) – placed with the summary so page one is the dashboard
  subheading(ctx, "Management dashboard – KPIs");
  const k = cf.kpis;
  kpiCards(ctx, [
    ["Budget utilisation %", pctText(k.budgetUtilisation), "forecast final ÷ approved budget"],
    ["Cost committed %", pctText(k.committedPct), "committed ÷ approved budget"],
    ["Cost spent %", pctText(k.spentPct), "actual to date ÷ approved budget"],
    ["Forecast completion %", pctText(k.completionPct), "actual to date ÷ forecast final"],
    ["Remaining budget", formatMoney(k.remainingBudget), "approved budget less actual to date"],
    ["Peak funding month", k.peakMonth ? `${k.peakMonth.label}` : "–", k.peakMonth ? `SAR ${formatMoney(k.peakMonth.amount)}` : ""],
  ], (x) => (x[0] === "Budget utilisation %" && (k.budgetUtilisation ?? 0) > 100 ? "#b42318" : null));

  // 7. graphs
  subheading(ctx, "Budget vs actual vs forecast (SAR)");
  const trio = [
    { label: "Approved budget", value: s.budget, color: "#2a78d6" },
    { label: "Committed", value: s.committed, color: "#7c3aed" },
    { label: "Actual to date", value: s.actual, color: "#067647" },
    { label: "Forecast final", value: s.forecastFinal, color: "#eb6834" },
  ];
  const maxV = Math.max(1, ...trio.map((t) => t.value));
  ensureSpace(ctx, trio.length * 16 + 10);
  for (const t of trio) {
    const y = doc.y;
    doc.fillColor("#172033").font("Helvetica").fontSize(7.5).text(t.label, PAGE.margin, y + 2, { width: 110, lineBreak: false });
    const w = Math.max(1, ((width - 230) * t.value) / maxV);
    doc.rect(PAGE.margin + 115, y, w, 10).fill(t.color);
    doc.fillColor("#172033").fontSize(7.5).text(formatMoney(t.value), PAGE.margin + 120 + w, y + 2, { width: 110, lineBreak: false });
    doc.y = y + 15;
  }
  doc.x = PAGE.margin;
  doc.moveDown(0.5);

  const idx = cf.months.findIndex((m) => m.kind === "current");
  const windowMonths = cf.months.slice(Math.max(0, idx - 11), Math.min(cf.months.length, idx + 13));
  subheading(ctx, "Monthly cash flow (SAR)", `${windowMonths[0]?.label ?? ""} to ${windowMonths[windowMonths.length - 1]?.label ?? ""}: planned against actual (to the report month) and forecast (after it)`);
  barChart(ctx, windowMonths.map((m) => ({ label: m.label, a: m.planned, b: m.total })), "Planned", "Actual / forecast");

  subheading(ctx, "Cumulative cash flow – S-curve (SAR)", `${monthLabel(s.start)} to ${monthLabel(s.end)}`);
  sCurveChart(ctx, cf.months.map((m) => ({ label: m.label, planned: m.cumulativePlanned, actual: m.cumulative, forecast: m.kind === "forecast" })));

  // 2. monthly table
  subheading(ctx, "2. Monthly cash flow table (SAR excl. VAT)", "Actual spend = certified in the month; forecast spend = works to complete spread to completion; total = actual + forecast");
  const monthCols: Col[] = [
    { key: "label", label: "Month", width: 0.9 },
    { key: "planned", label: "Planned spend", width: 1.1, align: "right", format: money },
    { key: "actual", label: "Actual spend", width: 1.1, align: "right", format: money },
    { key: "forecast", label: "Forecast spend", width: 1.1, align: "right", format: money },
    { key: "contractor", label: "Contractor payments", width: 1.1, align: "right", format: money },
    { key: "consultant", label: "Consultant payments", width: 1.1, align: "right", format: money },
    { key: "other", label: "Other project costs", width: 1.1, align: "right", format: money },
    { key: "total", label: "Total monthly outflow", width: 1.2, align: "right", format: money },
    { key: "cumulative", label: "Cumulative outflow", width: 1.3, align: "right", format: money },
  ];
  const sum = (key: keyof CashMonth) => cf.months.reduce((t, m) => t + (Number(m[key]) || 0), 0);
  table(ctx, monthCols, cf.months as unknown as Record<string, unknown>[], {
    zebra: true,
    rowStyle: (r) => (r.kind === "current" ? { bold: true, bg: "#fff4e5" } : undefined),
    totalRow: { label: "Total", planned: formatMoney(sum("planned")), actual: formatMoney(sum("actual")), forecast: formatMoney(sum("forecast")), contractor: formatMoney(sum("contractor")), consultant: formatMoney(sum("consultant")), other: formatMoney(sum("other")), total: formatMoney(sum("total")), cumulative: "" },
  });

  // 3. by package
  subheading(ctx, "3. Cash flow by major package (SAR excl. VAT)");
  table(
    ctx,
    [
      { key: "category", label: "Package", width: 1.5 },
      { key: "lines", label: "Lines", width: 0.5, align: "right" },
      { key: "budget", label: "Approved budget", width: 1.1, align: "right", format: money },
      { key: "committed", label: "Committed", width: 1.1, align: "right", format: money },
      { key: "actual", label: "Actual to date", width: 1.1, align: "right", format: money },
      { key: "forecastRemaining", label: "Forecast remaining", width: 1.1, align: "right", format: money },
      { key: "forecastFinal", label: "Forecast final", width: 1.1, align: "right", format: money },
      { key: "variance", label: "Variance", width: 1, align: "right", format: money },
      { key: "window", label: "Spending period", width: 1.3 },
      { key: "peak", label: "Peak month", width: 1.1 },
    ],
    cf.packages.map((p) => ({ ...p, window: p.firstMonth ? `${monthLabel(p.firstMonth)} – ${p.lastMonth ? monthLabel(p.lastMonth) : ""}` : "–", peak: p.peakMonth ? `${monthLabel(p.peakMonth)} (${formatMoney(p.peakAmount)})` : "–" })),
    { zebra: true, totalRow: { category: "Total", lines: String(cf.packages.reduce((t, p) => t + p.lines, 0)), budget: formatMoney(s.budget), committed: formatMoney(s.committed), actual: formatMoney(s.actual), forecastRemaining: formatMoney(s.forecastRemaining), forecastFinal: formatMoney(s.forecastFinal), variance: formatMoney(s.variance), window: "", peak: "" } },
  );

  // 4. yearly
  subheading(ctx, "4. Yearly summary (SAR excl. VAT)");
  table(
    ctx,
    [
      { key: "year", label: "Year", width: 0.6 },
      { key: "budget", label: "Annual budget (planned)", width: 1.2, align: "right", format: money },
      { key: "forecast", label: "Annual forecast (actual + forecast)", width: 1.4, align: "right", format: money },
      { key: "actual", label: "Actual spend", width: 1.2, align: "right", format: money },
      { key: "variance", label: "Variance", width: 1.2, align: "right", format: money },
    ],
    cf.years as unknown as Record<string, unknown>[],
    { zebra: true, totalRow: { year: "Total", budget: formatMoney(cf.years.reduce((t, y) => t + y.budget, 0)), forecast: formatMoney(cf.years.reduce((t, y) => t + y.forecast, 0)), actual: formatMoney(cf.years.reduce((t, y) => t + y.actual, 0)), variance: formatMoney(cf.years.reduce((t, y) => t + y.variance, 0)) } },
  );

  // 5. observations
  subheading(ctx, "5. Key observations");
  for (const o of cf.observations) {
    ensureSpace(ctx, 24);
    doc.fillColor("#172033").font("Helvetica").fontSize(8.5).text(`• ${o}`, { width, indent: 0 });
    doc.moveDown(0.2);
  }
  subheading(ctx, "Basis of the forecast");
  for (const a of cf.assumptions) {
    ensureSpace(ctx, 20);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`• ${a}`, { width });
  }
  doc.moveDown(0.5);
}

/** Cumulative S-curve: planned against actual (solid) and forecast (dashed) across the whole project. */
function sCurveChart(ctx: Ctx, pts: { label: string; planned: number; actual: number; forecast: boolean }[]) {
  const { doc } = ctx;
  if (!pts.length) return;
  const h = 150;
  ensureSpace(ctx, h + 40);
  const x0 = PAGE.margin + 60;
  const w = PAGE.width - PAGE.margin * 2 - 60;
  const y0 = doc.y + 10;
  const max = Math.max(1, ...pts.flatMap((p) => [p.planned, p.actual]));
  const x = (i: number) => x0 + (pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w);
  const y = (v: number) => y0 + h - (v / max) * h;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    doc.moveTo(x0, y(v)).lineTo(x0 + w, y(v)).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.5).text(compact(v), PAGE.margin, y(v) - 3, { width: 55, align: "right" });
  }
  const line = (key: "planned" | "actual", color: string, from: number, to: number, dash: boolean) => {
    if (to <= from) return;
    doc.save();
    doc.strokeColor(color).lineWidth(1.5);
    if (dash) doc.dash(3, { space: 2 });
    doc.moveTo(x(from), y(pts[from][key]));
    for (let i = from + 1; i <= to; i++) doc.lineTo(x(i), y(pts[i][key]));
    doc.stroke();
    doc.restore();
  };
  const firstForecast = pts.findIndex((p) => p.forecast);
  line("planned", "#2a78d6", 0, pts.length - 1, false);
  line("actual", "#067647", 0, firstForecast < 0 ? pts.length - 1 : firstForecast - 1, false);
  if (firstForecast > 0) line("actual", "#eb6834", firstForecast - 1, pts.length - 1, true);
  const step = Math.max(1, Math.ceil(pts.length / 12));
  pts.forEach((p, i) => {
    if (i % step !== 0 && i !== pts.length - 1) return;
    doc.fillColor("#172033").font("Helvetica").fontSize(6.5).text(p.label, x(i) - 20, y0 + h + 4, { width: 40, align: "center", lineBreak: false });
  });
  doc.y = y0 + h + 18;
  doc.x = PAGE.margin;
  const legend: [string, string][] = [["Planned (budget S-curve)", "#2a78d6"], ["Actual (certified)", "#067647"], ["Forecast", "#eb6834"]];
  let lx = x0;
  for (const [label, color] of legend) {
    doc.rect(lx, doc.y, 8, 8).fill(color);
    doc.fillColor(MUTED).fontSize(7).text(label, lx + 12, doc.y - 1, { lineBreak: false });
    lx += 150;
  }
  doc.moveDown(1);
  doc.x = PAGE.margin;
}
