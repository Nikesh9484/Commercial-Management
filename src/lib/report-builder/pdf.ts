import PDFDocument from "pdfkit";
import { APP_NAME } from "../brand";
import { formatDate, formatDateTime } from "../format";
import type { RecordRow } from "../registers/types";
import type { BuiltReport, ResultColumn } from "./build";
import { fmtMoney } from "./build";
import { PALETTE, TONE_SHAPE, TONE_TEXT, seriesColor, type ToneName } from "./palette";

/**
 * The PDF of a custom report, built to the conventions a commercial report is normally read under:
 * the answer first as a sentence, then the figures, then the detail. Numbers are right-aligned with
 * their headers, negatives sit in brackets, nothing is shown to a decimal that does not carry a
 * decision, and status is never left to colour alone – every flag carries its own words.
 */

type Doc = PDFKit.PDFDocument;

const NAVY = PALETTE.brand;
const DEEP = PALETTE.brandDeep;
const MUTED = PALETTE.muted;
const INK = PALETTE.ink;
const LINE = PALETTE.line;
const ZEBRA = PALETTE.zebra;
const BAND = PALETTE.headlineTint;
const TONE: Record<string, string> = TONE_TEXT;

const PAGE = { width: 841.89, height: 595.28, margin: 34 };
const CONTENT = PAGE.width - PAGE.margin * 2;

export async function renderBuilderPdf(r: BuiltReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: PAGE.margin, bufferPages: true, info: { Title: r.title, Author: APP_NAME } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  titleBlock(doc, r);
  headline(doc, r);
  if (r.notes) note(doc, r.notes);
  if (r.filterSummary.length) filterLine(doc, r);
  if (r.kpis.length) kpiTiles(doc, r);
  for (const p of r.narrative) paragraph(doc, p.heading, p.text);
  if (r.attention.length) attentionList(doc, r.attention);
  if (r.breakdown && r.breakdown.bands.length) bandTable(doc, `By ${r.breakdown.label.toLowerCase()}`, r.breakdown.bands, r.breakdown.label);
  if (r.ageing && r.ageing.bands.length) bandTable(doc, `Ageing – ${r.ageing.label.toLowerCase()}`, r.ageing.bands, "Age band", r.ageMode === "since" ? `Counted back from ${r.ageing.label.toLowerCase()}.` : "Counted from the date each item falls due.");
  if (r.columns.length) detail(doc, r);
  basis(doc, r);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    pageFooter(doc, r, i + 1, range.count);
  }
  doc.end();
  return done;
}

/* ------------------------------------------------------------------ furniture */

function titleBlock(doc: Doc, r: BuiltReport) {
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(17).text(r.title, PAGE.margin, PAGE.margin, { width: CONTENT });
  doc.moveDown(0.2);
  for (const line of r.subtitle) doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(line, { width: CONTENT });
  doc.moveDown(0.45);
  const ry = doc.y;
  doc.rect(PAGE.margin, ry, CONTENT, 2.2).fill(NAVY);
  doc.rect(PAGE.margin, ry, 120, 2.2).fill(PALETTE.warn);
  doc.y = ry + 12;
  doc.x = PAGE.margin;
}

/** The one-sentence answer, boxed, before anything else on the page. */
function headline(doc: Doc, r: BuiltReport) {
  doc.font("Helvetica-Bold").fontSize(10.5);
  const h = doc.heightOfString(r.headline, { width: CONTENT - 22 }) + 14;
  const y = doc.y;
  doc.rect(PAGE.margin, y, CONTENT, h).fill(BAND);
  doc.rect(PAGE.margin, y, 3.5, h).fill(NAVY);
  doc.fillColor(DEEP).font("Helvetica-Bold").fontSize(10.5).text(r.headline, PAGE.margin + 12, y + 7, { width: CONTENT - 22 });
  doc.y = y + h + 10;
  doc.x = PAGE.margin;
}

function note(doc: Doc, text: string) {
  doc.fillColor(INK).font("Helvetica-Oblique").fontSize(9).text(text, PAGE.margin, doc.y, { width: CONTENT });
  doc.moveDown(0.5);
  doc.x = PAGE.margin;
}

function filterLine(doc: Doc, r: BuiltReport) {
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Filtered to:  ${r.filterSummary.join("   ·   ")}`, PAGE.margin, doc.y, { width: CONTENT });
  doc.moveDown(0.6);
  doc.x = PAGE.margin;
}

function kpiTiles(doc: Doc, r: BuiltReport) {
  const tiles = r.kpis.slice(0, 4);
  const gap = 9;
  const w = (CONTENT - gap * (tiles.length - 1)) / tiles.length;
  const y = doc.y;
  tiles.forEach((k, i) => {
    const x = PAGE.margin + i * (w + gap);
    doc.rect(x, y, w, 52).fill(PALETTE.panel);
    doc.rect(x, y, w, 2.2).fill(seriesColor(i));
    doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(k.label.toUpperCase(), x + 8, y + 9, { width: w - 16 });
    doc.fillColor(DEEP).font("Helvetica-Bold").fontSize(13).text(k.value, x + 8, y + 21, { width: w - 16, ellipsis: true });
    if (k.note) doc.fillColor(MUTED).font("Helvetica").fontSize(6.8).text(k.note, x + 8, y + 39, { width: w - 16, ellipsis: true });
  });
  doc.y = y + 62;
  doc.x = PAGE.margin;
}

function subheading(doc: Doc, text: string, hint?: string) {
  space(doc, 46);
  doc.moveDown(0.45);
  const y0 = doc.y;
  doc.rect(PAGE.margin, y0 + 1.5, 2.5, 11).fill(PALETTE.brandSoft);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10.5).text(text, PAGE.margin + 8, y0, { width: CONTENT - 8 });
  if (hint) doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(hint, PAGE.margin + 8, doc.y, { width: CONTENT - 8 });
  doc.moveDown(0.3);
  doc.x = PAGE.margin;
}

function paragraph(doc: Doc, heading: string, text: string) {
  space(doc, 52);
  const y0 = doc.y;
  doc.rect(PAGE.margin, y0 + 1.5, 2, 9).fill(PALETTE.lineStrong);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5).text(heading, PAGE.margin + 7, y0, { width: CONTENT - 7 });
  doc.fillColor(INK).font("Helvetica").fontSize(9.5).text(text, PAGE.margin + 7, doc.y, { width: CONTENT - 7, lineGap: 1.6 });
  doc.moveDown(0.5);
  doc.x = PAGE.margin;
}

function attentionList(doc: Doc, items: string[]) {
  subheading(doc, "Needs attention");
  for (const it of items) {
    doc.font("Helvetica").fontSize(9);
    const h = doc.heightOfString(`•  ${it}`, { width: CONTENT - 26 }) + 9;
    space(doc, h + 4);
    const y = doc.y;
    doc.rect(PAGE.margin, y, CONTENT, h).fill(PALETTE.badTint);
    doc.rect(PAGE.margin, y, 2.5, h).fill(PALETTE.bad);
    doc.fillColor(PALETTE.bad).font("Helvetica").fontSize(9).text(`•  ${it}`, PAGE.margin + 13, y + 4.5, { width: CONTENT - 26 });
    doc.y = y + h + 3;
    doc.x = PAGE.margin;
  }
  doc.moveDown(0.3);
  doc.x = PAGE.margin;
}

function basis(doc: Doc, r: BuiltReport) {
  space(doc, 60);
  doc.moveDown(0.4);
  const text = r.basis.join(" ");
  doc.font("Helvetica").fontSize(7.5);
  const h = doc.heightOfString(text, { width: CONTENT - 24 }) + 20;
  const y = doc.y;
  doc.rect(PAGE.margin, y, CONTENT, h).fill(PALETTE.basisTint);
  doc.rect(PAGE.margin, y, 2.5, h).fill(PALETTE.lineStrong);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(7.5).text("BASIS OF PREPARATION", PAGE.margin + 12, y + 6, { width: CONTENT - 24 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(text, PAGE.margin + 12, y + 15, { width: CONTENT - 24 });
  doc.y = y + h;
}

function pageFooter(doc: Doc, r: BuiltReport, page: number, total: number) {
  const y = PAGE.height - PAGE.margin + 6;
  doc.fillColor(MUTED).font("Helvetica").fontSize(7);
  doc.text(`${r.title}  ·  as at ${formatDate(r.asOf)}  ·  generated ${formatDateTime(r.generatedAt)} by ${APP_NAME}`, PAGE.margin, y, { width: CONTENT - 70 });
  doc.text(`Page ${page} of ${total}`, PAGE.margin + CONTENT - 70, y, { width: 70, align: "right" });
}

/** Starts a new page when less than `need` points remain. */
function space(doc: Doc, need: number) {
  if (doc.y + need > PAGE.height - PAGE.margin - 14) {
    doc.addPage();
    doc.x = PAGE.margin;
    doc.y = PAGE.margin;
  }
}

/* ------------------------------------------------------------------ tables */

interface Cell {
  text: string;
  align: "left" | "right";
  tone?: string | null;
}

/** Count / value / share, the way a bucket summary is normally read. */
function bandTable(doc: Doc, title: string, bands: { label: string; n: number; value: number; share: number }[], firstLabel: string, hint?: string) {
  subheading(doc, title, hint);
  const hasValue = bands.some((b) => b.value !== 0);
  const cols: { label: string; w: number; align: "left" | "right" }[] = [
    { label: firstLabel, w: 3, align: "left" },
    { label: "Items", w: 1, align: "right" },
    ...(hasValue ? ([{ label: "Value (SAR)", w: 1.6, align: "right" as const }, { label: "% of value", w: 1, align: "right" as const }]) : []),
  ];
  const tableW = CONTENT * 0.62;
  const barW = CONTENT * 0.3;
  const widths = scale(cols.map((c) => c.w), tableW);
  header(doc, cols.map((c) => ({ text: c.label, align: c.align })), widths, tableW);
  // a bar beside each row: one hue stepped in lightness, with the figure already printed alongside
  const max = Math.max(1, ...bands.map((b) => (hasValue ? Math.abs(b.value) : b.n)));
  bands.forEach((b, i) => {
    const cells: Cell[] = [{ text: b.label, align: "left" }, { text: b.n.toLocaleString("en-US"), align: "right" }];
    if (hasValue) {
      cells.push({ text: fmtMoney(b.value), align: "right" });
      cells.push({ text: `${b.share.toFixed(1)}%`, align: "right" });
    }
    const y = doc.y;
    row(doc, cells, widths, i % 2 === 1 && bands.length > 8, tableW);
    const w = Math.max(1.5, ((hasValue ? Math.abs(b.value) : b.n) / max) * barW);
    doc.rect(PAGE.margin + tableW + 12, y + 4.5, barW, 5).fill(PALETTE.neutralTint);
    doc.rect(PAGE.margin + tableW + 12, y + 4.5, w, 5).fill(seriesColor(i));
  });
  const totals: Cell[] = [{ text: "Total", align: "left" }, { text: bands.reduce((t, b) => t + b.n, 0).toLocaleString("en-US"), align: "right" }];
  if (hasValue) {
    totals.push({ text: fmtMoney(bands.reduce((t, b) => t + b.value, 0)), align: "right" });
    totals.push({ text: "100.0%", align: "right" });
  }
  totalRow(doc, totals, widths, true, tableW);
  doc.moveDown(0.5);
}

function detail(doc: Doc, r: BuiltReport) {
  const zebra = r.rows.length > 12 || r.columns.length > 7;
  const widths = scale(r.columns.map(colWidth));
  const head = r.columns.map((c) => ({ text: c.label, align: (c.numeric ? "right" : "left") as "left" | "right" }));

  if (r.groups) {
    subheading(doc, `Detail by ${r.groupLabel?.toLowerCase() ?? "group"}`, `${r.count.toLocaleString("en-US")} record(s)${r.limited ? " (trimmed to the limit set)" : ""}.`);
    for (const g of r.groups) {
      space(doc, 60);
      const gy = doc.y + 3;
      doc.rect(PAGE.margin, gy, CONTENT, 14).fill(PALETTE.panel);
      doc.fillColor(DEEP).font("Helvetica-Bold").fontSize(8.5).text(`${g.label}  (${g.rows.length})`, PAGE.margin + 6, gy + 3.5, { width: CONTENT - 12 });
      doc.y = gy + 16;
      doc.x = PAGE.margin;
      header(doc, head, widths);
      g.rows.forEach((row_, i) => row(doc, cellsOf(row_, r.columns), widths, zebra && i % 2 === 1));
      totalRow(doc, subtotalCells(g.totals, r.columns, `${g.label} total`), widths, false);
      doc.moveDown(0.4);
    }
    space(doc, 30);
    totalRow(doc, subtotalCells(r.totals, r.columns, "Grand total"), widths, true);
  } else {
    subheading(doc, "Detail", `${r.count.toLocaleString("en-US")} record(s)${r.limited ? " (trimmed to the limit set)" : ""}.`);
    header(doc, head, widths);
    r.rows.forEach((row_, i) => {
      if (doc.y + 16 > PAGE.height - PAGE.margin - 20) {
        doc.addPage();
        doc.x = PAGE.margin;
        doc.y = PAGE.margin;
        header(doc, head, widths);
      }
      row(doc, cellsOf(row_, r.columns), widths, zebra && i % 2 === 1);
    });
    if (r.totalKeys.length) totalRow(doc, subtotalCells(r.totals, r.columns, "Total"), widths, true);
  }
  doc.moveDown(0.4);
}

function colWidth(c: ResultColumn): number {
  if (c.type === "money") return 1.35;
  if (c.type === "date") return 1;
  if (c.type === "number" || c.type === "percent") return 0.95;
  if (c.type === "textarea") return 3;
  return Math.min(2.4, Math.max(1.1, c.label.length / 9));
}

function scale(weights: number[], total = CONTENT): number[] {
  const sum = weights.reduce((t, w) => t + w, 0) || 1;
  return weights.map((w) => (w / sum) * total);
}

function cellsOf(row_: RecordRow, columns: ResultColumn[]): Cell[] {
  return columns.map((c) => ({ text: format(row_[c.key], c), align: (c.numeric ? "right" : "left") as "left" | "right", tone: (row_[`${c.key}__tone`] as string | null) ?? null }));
}

function subtotalCells(totals: Record<string, number>, columns: ResultColumn[], label: string): Cell[] {
  return columns.map((c, i) => {
    if (i === 0) return { text: label, align: "left" as const };
    if (c.numeric && c.type !== "percent" && totals[c.key] !== undefined) return { text: fmtMoney(totals[c.key], c.type === "money" ? 0 : 0), align: "right" as const };
    return { text: "", align: "left" as const };
  });
}

export function format(v: unknown, c: ResultColumn): string {
  if (v === null || v === undefined || v === "") return "–";
  switch (c.type) {
    case "money":
      return fmtMoney(v);
    case "number":
      return fmtMoney(v, Number.isInteger(Number(v)) ? 0 : 2);
    case "percent": {
      const n = Number(v);
      return Number.isFinite(n) ? `${n.toFixed(1)}%` : "–";
    }
    case "date":
      return formatDate(String(v));
    case "boolean":
      return v === true ? "Yes" : "No";
    default: {
      const s = String(v);
      return s.length > 90 ? `${s.slice(0, 87)}…` : s;
    }
  }
}

function header(doc: Doc, cells: Cell[], widths: number[], width = CONTENT) {
  space(doc, 34);
  const y = doc.y;
  const h = 21;
  doc.rect(PAGE.margin, y, width, h).fill(NAVY);
  let x = PAGE.margin;
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7);
  cells.forEach((c, i) => {
    // two lines of room, so a long heading is never clipped mid-word
    doc.text(c.text, x + 4, y + 3.5, { width: widths[i] - 8, align: c.align, height: 16, lineGap: -1 });
    x += widths[i];
  });
  doc.y = y + h;
  doc.x = PAGE.margin;
}

/** A small shape beside a status word, so the status survives a greyscale photocopy. */
function marker(doc: Doc, tone: string, x: number, y: number) {
  const shape = TONE_SHAPE[tone as ToneName];
  const c = TONE_TEXT[tone as ToneName];
  if (!shape) return;
  doc.fillColor(c);
  if (shape === "triangle") doc.moveTo(x + 2.6, y).lineTo(x + 5.2, y + 4.6).lineTo(x, y + 4.6).fill();
  else if (shape === "square") doc.rect(x + 0.6, y + 0.6, 4, 4).fill();
  else doc.circle(x + 2.6, y + 2.6, 2.2).fill();
}

function row(doc: Doc, cells: Cell[], widths: number[], striped: boolean, width = CONTENT) {
  if (doc.y + 15 > PAGE.height - PAGE.margin - 16) {
    doc.addPage();
    doc.x = PAGE.margin;
    doc.y = PAGE.margin;
  }
  const y = doc.y;
  const h = 14;
  if (striped) doc.rect(PAGE.margin, y, width, h).fill(ZEBRA);
  // no wash across the whole row: an exception is marked on the value it belongs to
  let x = PAGE.margin;
  cells.forEach((c, i) => {
    const toned = c.tone && TONE[c.tone];
    // a status word gets its shape as well as its colour; a figure keeps its sign and brackets
    const withMarker = !!toned && c.align === "left" && !!c.text && c.text !== "–";
    if (withMarker) marker(doc, c.tone!, x + 4, y + 4.6);
    doc.font("Helvetica").fontSize(7.4).fillColor(toned ? TONE[c.tone!] : INK);
    doc.text(c.text, x + (withMarker ? 12 : 4), y + 4, { width: widths[i] - (withMarker ? 16 : 8), align: c.align, height: 9, ellipsis: true, lineBreak: false });
    x += widths[i];
  });
  doc.strokeColor(LINE).lineWidth(0.4).moveTo(PAGE.margin, y + h).lineTo(PAGE.margin + width, y + h).stroke();
  doc.y = y + h;
  doc.x = PAGE.margin;
}

/** Single rule above a subtotal, double above a grand total – the accounting convention. */
function totalRow(doc: Doc, cells: Cell[], widths: number[], grand: boolean, width = CONTENT) {
  if (doc.y + 20 > PAGE.height - PAGE.margin - 16) {
    doc.addPage();
    doc.x = PAGE.margin;
    doc.y = PAGE.margin;
  }
  const y = doc.y;
  doc.strokeColor(NAVY).lineWidth(grand ? 0.9 : 0.6).moveTo(PAGE.margin, y + 1).lineTo(PAGE.margin + width, y + 1).stroke();
  if (grand) doc.strokeColor(NAVY).lineWidth(0.5).moveTo(PAGE.margin, y + 3).lineTo(PAGE.margin + width, y + 3).stroke();
  let x = PAGE.margin;
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(7.4);
  cells.forEach((c, i) => {
    doc.text(c.text, x + 4, y + 6, { width: widths[i] - 8, align: c.align, ellipsis: true, lineBreak: false });
    x += widths[i];
  });
  doc.y = y + 18;
  doc.x = PAGE.margin;
}
