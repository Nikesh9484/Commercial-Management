import PDFDocument from "pdfkit";
import { executiveTotals } from "../cost-report/executive";
import type { ReportData } from "./data";
import { REPORT_SCHEDULES } from "./schedules";
import { MONEY_COLUMNS, type Money } from "../cost-report/columns";
import { formatMoney, formatDate, formatNumber, formatPercent, formatDateTime } from "../format";
import type { FieldDef } from "../registers/types";
import { APP_NAME } from "../brand";
import { buildClaimsReport } from "./claims-report";
import { buildFaReport } from "./fa-report";

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

/** Renders the full monthly report and returns the PDF bytes. */
/** Section keys accepted by the per-page export: "minutes", "exec", "movement", schedule letters, register keys, "level1", "level2", "cashflow". */
export function resolveSections(keys: string[]): { title: string; run: (ctx: Ctx) => void }[] {
  const out: { title: string; run: (ctx: Ctx) => void }[] = [];
  for (const raw of keys) {
    const k = raw.trim();
    if (k === "minutes") out.push({ title: "Minutes of Meeting", run: minutes });
    else if (k === "exec") out.push({ title: "Executive Summary", run: executiveSummary });
    else if (k === "movement") out.push({ title: "Movement since the previous report", run: movementSection });
    else if (k === "claims_report") out.push({ title: "Claims Status Report", run: claimsStatusReport });
    else if (k === "fa_report") out.push({ title: "Final Account Status Report", run: faStatusReport });
    else if (k === "level1") out.push({ title: "Schedule A – Cost Report Level 1 (Executive)", run: costLevel1 });
    else if (k === "level2") out.push({ title: "Schedule B – Cost Report Level 2 (Detailed)", run: costLevel2 });
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
export async function renderSectionsPdf(data: ReportData, keys: string[]): Promise<Buffer> {
  const parts = resolveSections(keys);
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

function subheading(ctx: Ctx, title: string, note?: string) {
  const { doc } = ctx;
  ensureSpace(ctx, 40);
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
  // KPI grid 4 x 2
  const cw = (PAGE.width - PAGE.margin * 2 - 3 * 10) / 4;
  let x = PAGE.margin;
  let y = doc.y;
  kpis.forEach((k, i) => {
    doc.rect(x, y, cw, 52).fillAndStroke("#ffffff", LINE);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(k[0].toUpperCase(), x + 8, y + 7, { width: cw - 16 });
    const adverse = (k[0].startsWith("Variance") || k[0].startsWith("Period")) && k[1].startsWith("-") === false && !["0.00"].includes(k[1]);
    doc.fillColor(adverse ? "#b91c1c" : NAVY).font("Helvetica-Bold").fontSize(12).text(k[1], x + 8, y + 20, { width: cw - 16 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(k[2], x + 8, y + 37, { width: cw - 16 });
    x += cw + 10;
    if (i === 3) {
      x = PAGE.margin;
      y += 62;
    }
  });
  doc.y = y + 62;
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
  subheading(ctx, `Cost report: ${m.previous.label} -> ${m.current.label}`, "Executive view (budget columns include the budget hold; change and forecast columns exclude it).");
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
  const cw = (PAGE.width - PAGE.margin * 2 - 3 * 10) / 4;
  let x = PAGE.margin;
  let y = doc.y;
  kpis.forEach((k, i) => {
    doc.rect(x, y, cw, 52).fillAndStroke("#ffffff", LINE);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(k[0].toUpperCase(), x + 8, y + 7, { width: cw - 16 });
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(k[1], x + 8, y + 20, { width: cw - 16 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(k[2], x + 8, y + 37, { width: cw - 16 });
    x += cw + 10;
    if (i === 3) {
      x = PAGE.margin;
      y += 62;
    }
  });
  doc.y = y + 62;
  doc.x = PAGE.margin;

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

  subheading(ctx, "Claims register at cut-off", "Pending claims first, largest value first. Days = days since the (detailed) claim was received, pending claims only.");
  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  table(
    ctx,
    [
      { key: "claim_no", label: "Ref", width: 0.8 },
      { key: "contractor", label: "Contractor", width: 1.6 },
      { key: "description", label: "Claim", width: 3.2 },
      { key: "type", label: "Type", width: 0.9 },
      { key: "claimedSar", label: "Claimed SAR", width: 1.2, align: "right", format: money },
      { key: "assessedSar", label: "Assessed SAR", width: 1.2, align: "right", format: money },
      { key: "determinedSar", label: "Determined SAR", width: 1.2, align: "right", format: money },
      { key: "eot", label: "EOT days cl./gr.", width: 0.9, align: "right" },
      { key: "status", label: "Status", width: 0.8 },
      { key: "stage", label: "Stage / next step", width: 2 },
      { key: "actionWith", label: "Action with", width: 1.1 },
      { key: "daysSinceReceipt", label: "Days", width: 0.5, align: "right" },
      { key: "notice", label: "Notice", width: 0.5 },
    ],
    r.claims.map((c) => ({ ...c, eot: c.eotClaimed === null && c.eotGranted === null ? "" : `${c.eotClaimed ?? "–"} / ${c.eotGranted ?? "–"}` })) as unknown as Record<string, unknown>[],
    { zebra: true, totalRow: { claim_no: "TOTAL", claimedSar: formatMoney(h.claimedSar), determinedSar: formatMoney(h.determinedSar), eot: `${h.eotClaimed} / ${h.eotGranted}` } },
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
  doc.moveDown(0.5);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`Prepared from the Claims & Disputes register of ${APP_NAME} as at ${formatDate(r.asOf)}${data.locked ? "" : " (draft – period not locked)"}. Claimed = contractor's claim; assessed = Employer's assessment, else Engineer's recommendation; determined = determination or agreement.`, { width });
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
  const cw = (PAGE.width - PAGE.margin * 2 - 3 * 10) / 4;
  let x = PAGE.margin;
  let y = doc.y;
  kpis.forEach((k, i) => {
    doc.rect(x, y, cw, 52).fillAndStroke("#ffffff", LINE);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(k[0].toUpperCase(), x + 8, y + 7, { width: cw - 16 });
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(k[1], x + 8, y + 20, { width: cw - 16 });
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(k[2], x + 8, y + 37, { width: cw - 16 });
    x += cw + 10;
    if (i === 3) {
      x = PAGE.margin;
      y += 62;
    }
  });
  doc.y = y + 62;
  doc.x = PAGE.margin;

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
  subheading(ctx, "Final account status by package", "Open packages first, earliest forecast closure first. Committed and anticipated final account are read from the cost report.");
  const money = (v: unknown) => (v === null || v === undefined ? "" : formatMoney(v as number));
  table(
    ctx,
    [
      { key: "acc_ref", label: "ACC code", width: 0.9 },
      { key: "description", label: "Package", width: 2.4 },
      { key: "contractor", label: "Contractor / consultant", width: 1.8 },
      { key: "type", label: "Type", width: 0.7 },
      { key: "committed", label: "Committed (I)", width: 1.2, align: "right", format: money },
      { key: "afa", label: "Anticipated FA (N)", width: 1.2, align: "right", format: money },
      { key: "uncommitted", label: "Uncommitted", width: 1.1, align: "right", format: money },
      { key: "responsible", label: "Responsible", width: 1 },
      { key: "forecast", label: "Forecast closure", width: 0.9, format: (v) => formatDate(v as string) },
      { key: "daysRemaining", label: "Days", width: 0.5, align: "right" },
      { key: "status", label: "Status", width: 0.9 },
      { key: "comments", label: "Comments", width: 2 },
    ],
    r.rows as unknown as Record<string, unknown>[],
    { zebra: true, totalRow: { acc_ref: "TOTAL", committed: formatMoney(r.rows.reduce((t, x) => t + x.committed, 0)), afa: formatMoney(h.totalAfa), uncommitted: formatMoney(r.rows.reduce((t, x) => t + x.uncommitted, 0)) } },
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
        { label: "Total excl. budget hold (executive)", values: r.totalsExclHold, labelKey: "code" },
        { label: "Check: L1 - L2 (must be zero)", values: r.check, labelKey: "code", tone: r.checkOk ? "green" : "red" },
      ],
    });
  };
  part("Columns E – I", ["E", "F", "G", "H", "I"]);
  part("Columns J – S", ["J", "K", "L", "M", "N", "O", "P", "Q", "R", "S"]);
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
    format: (v) => formatField(f, v),
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
    if (st?.span) drawRow([String(r[cols[0].key] ?? "")], { bold: true, color: st.color ?? NAVY, span: true });
    else drawRow(cols.map((c) => cellText(c, r)), { bg: st?.bg ?? (opts.zebra && i % 2 === 1 ? ZEBRA : undefined), bold: st?.bold, color: st?.color });
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
  doc.rect(x0, doc.y, 8, 8).fill("#2a78d6");
  doc.fillColor(MUTED).fontSize(7).text(labelA, x0 + 12, doc.y - 1, { continued: true });
  doc.rect(doc.x + 10, doc.y - 1, 8, 8).fill("#eb6834");
  doc.fillColor(MUTED).text(`     ${labelB}`);
  doc.moveDown(0.5);
  doc.x = PAGE.margin;
}

function compact(v: number) {
  if (v >= 1e9) return `${Number((v / 1e9).toFixed(2))}bn`;
  if (v >= 1e6) return `${Number((v / 1e6).toFixed(2))}M`;
  if (v >= 1e3) return `${Number((v / 1e3).toFixed(1))}k`;
  return String(Math.round(v));
}
