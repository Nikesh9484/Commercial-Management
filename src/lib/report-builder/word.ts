import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, PageNumber, PageOrientation, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from "docx";
import { APP_NAME } from "../brand";
import { formatDate, formatDateTime } from "../format";
import type { RecordRow } from "../registers/types";
import type { BuiltReport, ResultColumn } from "./build";
import { fmtMoney } from "./build";
import { PALETTE, TONE_GLYPH, TONE_TEXT, bare } from "./palette";

/**
 * The Word version: the report written up as a document rather than printed as a table. It follows
 * the shape a commercial summary is normally read in – the bottom line in one sentence, the three or
 * four things that matter with their numbers, what is being asked of the reader, and only then the
 * supporting detail.
 *
 * Typography follows the usual print conventions: a serif face for the body at 11pt on 14pt leading,
 * a sans face in the tables so they read as a different register, three heading levels numbered so
 * the report can be cited in correspondence, and tables ruled only under the header and at the
 * totals.
 */

const SERIF = "Cambria";
const SANS = "Calibri";
const NAVY = bare(PALETTE.brand);
const DEEP = bare(PALETTE.brandDeep);
const MUTED = bare(PALETTE.muted);
const INK = bare(PALETTE.ink);
const RULE = bare(PALETTE.line);
const PANEL = bare(PALETTE.panel);
const TONE: Record<string, string> = { red: bare(TONE_TEXT.red), amber: bare(TONE_TEXT.amber), green: bare(TONE_TEXT.green) };

const A4 = { w: 11906, h: 16838 };
const MARGIN = 1134; // 2cm
const PORTRAIT_W = A4.w - MARGIN * 2;
const LANDSCAPE_W = A4.h - MARGIN * 2;

export async function renderBuilderWord(r: BuiltReport): Promise<Buffer> {
  const wide = r.columns.length > 6;
  const body = [...titleBlock(r), ...executiveSummary(r), ...figures(r), ...(wide ? [] : detailTable(r, PORTRAIT_W)), ...basisBlock(r)];

  type Section = ConstructorParameters<typeof Document>[0]["sections"][number];
  const sections: Section[] = [
    {
      properties: { page: { size: { width: A4.w, height: A4.h }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      footers: { default: footer(r) },
      children: body,
    },
  ];
  if (wide && r.columns.length) {
    sections.push({
      properties: { page: { size: { width: A4.w, height: A4.h, orientation: PageOrientation.LANDSCAPE }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      footers: { default: footer(r) },
      children: detailTable(r, LANDSCAPE_W),
    });
  }
  return Packer.toBuffer(new Document({ creator: APP_NAME, title: r.title, description: r.headline, sections }));
}

/* ------------------------------------------------------------------ blocks */

function footer(r: BuiltReport): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({ text: `${r.title} · as at ${formatDate(r.asOf)} · ${APP_NAME}          `, font: SANS, size: 14, color: MUTED }),
          new TextRun({ text: "Page ", font: SANS, size: 14, color: MUTED }),
          new TextRun({ children: [PageNumber.CURRENT], font: SANS, size: 14, color: MUTED }),
          new TextRun({ text: " of ", font: SANS, size: 14, color: MUTED }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: SANS, size: 14, color: MUTED }),
        ],
      }),
    ],
  });
}

function titleBlock(r: BuiltReport): Paragraph[] {
  const out = [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: r.title.toUpperCase(), bold: true, font: SANS, size: 30, color: NAVY })],
    }),
  ];
  for (const line of r.subtitle) {
    out.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: line, font: SANS, size: 17, color: MUTED })] }));
  }
  out.push(new Paragraph({ spacing: { after: 220 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 6 } }, children: [] }));
  return out;
}

/** One page: the bottom line, the points that carry it, and what is being asked for. */
function executiveSummary(r: BuiltReport): Paragraph[] {
  const out: Paragraph[] = [h1("1.  Executive summary")];
  out.push(
    new Paragraph({
      spacing: { before: 60, after: 200, line: 280, lineRule: "exact" },
      shading: { type: ShadingType.CLEAR, fill: bare(PALETTE.calloutWarm), color: "auto" },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: NAVY, space: 8 } },
      indent: { left: 120, right: 120 },
      children: [new TextRun({ text: r.headline, bold: true, font: SERIF, size: 24, color: DEEP })],
    }),
  );

  if (r.notes) out.push(body(r.notes, true));

  const points = summaryPoints(r);
  if (points.length) {
    out.push(h3("The points behind it"));
    for (const p of points) out.push(bullet(p));
  }

  if (r.attention.length) {
    out.push(h3("What is needed, and from whom"));
    for (const a of r.attention.slice(0, 6)) out.push(alertBullet(a));
    out.push(new Paragraph({ spacing: { before: 80, after: 200 }, children: [new TextRun({ text: "Each point above sits with the commercial team unless a name is given against it. Dates for action are the dates shown in the tables that follow.", italics: true, font: SERIF, size: 20, color: MUTED })] }));
  }
  return out;
}

/** Three to five claims, each carrying its number – drawn from the figures, never typed. */
function summaryPoints(r: BuiltReport): string[] {
  const out: string[] = [];
  for (const k of r.kpis.slice(0, 4)) out.push(`${k.label}: ${k.value}${k.note ? ` (${k.note})` : ""}.`);
  // the "largest …" KPI already says this, so only add it when that tile is not there
  if (r.breakdown?.bands.length && !r.kpis.some((k) => k.label.startsWith("Largest"))) {
    const top = r.breakdown.bands[0];
    out.push(`The largest ${r.breakdown.label.toLowerCase()} is ${top.label}, with ${top.n} record(s)${top.value ? ` worth SAR ${fmtMoney(top.value)} – ${top.share.toFixed(0)}% of the total` : ""}.`);
  }
  if (r.ageing?.bands.length) {
    const late = r.ageing.bands.filter((b) => b.label !== "Not yet due" && b.label !== "No date");
    if (late.length) out.push(`${late.reduce((t, b) => t + b.n, 0)} item(s) are ${r.ageMode === "since" ? "dated in the past" : "past the date they fall due"}${late.some((b) => b.value) ? `, carrying SAR ${fmtMoney(late.reduce((t, b) => t + b.value, 0))}` : ""}.`);
  }
  return out.slice(0, 5);
}

function figures(r: BuiltReport): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let n = 2;
  if (r.narrative.length) {
    out.push(h1(`${n++}.  The position in detail`));
    r.narrative.forEach((p, i) => {
      out.push(h2(`${n - 1}.${i + 1}  ${p.heading}`));
      out.push(body(p.text));
    });
  }
  if (r.breakdown?.bands.length || r.ageing?.bands.length) {
    out.push(h1(`${n++}.  Analysis`));
    if (r.breakdown?.bands.length) {
      out.push(h2(`${n - 1}.1  By ${r.breakdown.label.toLowerCase()}`));
      out.push(bandTable(r.breakdown.bands, PORTRAIT_W));
      out.push(spacer());
    }
    if (r.ageing?.bands.length) {
      out.push(h2(`${n - 1}.${r.breakdown?.bands.length ? 2 : 1}  Ageing`));
      out.push(body(r.ageMode === "since" ? `Counted back from ${r.ageing!.label.toLowerCase()}.` : "Counted from the date each item falls due, not from when it was raised.", true));
      out.push(bandTable(r.ageing.bands, PORTRAIT_W));
      out.push(spacer());
    }
  }
  return out;
}

function detailTable(r: BuiltReport, width: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [h1(`${r.narrative.length ? 4 : 3}.  Detail`)];
  out.push(body(`${r.count.toLocaleString("en-US")} record(s)${r.limited ? ", trimmed to the limit set" : ""}${r.filterSummary.length ? `, filtered to ${r.filterSummary.join("; ").toLowerCase()}` : ""}.`, true));

  const widths = columnWidths(r.columns, width);
  const rows: TableRow[] = [headRow(r.columns, widths)];
  if (r.groups) {
    for (const g of r.groups) {
      rows.push(groupRow(`${g.label} (${g.rows.length})`, widths));
      g.rows.forEach((row, i) => rows.push(dataRow(row, r.columns, widths, i % 2 === 1)));
      rows.push(totalRow(r.columns, g.totals, `${g.label} total`, widths, false));
    }
    rows.push(totalRow(r.columns, r.totals, "Grand total", widths, true));
  } else {
    r.rows.forEach((row, i) => rows.push(dataRow(row, r.columns, widths, i % 2 === 1)));
    if (r.totalKeys.length) rows.push(totalRow(r.columns, r.totals, "Total", widths, true));
  }
  out.push(new Table({ columnWidths: widths, width: { size: width, type: WidthType.DXA }, rows, borders: noBorders() }));
  return out;
}

function basisBlock(r: BuiltReport): Paragraph[] {
  const out = [h1(`${r.narrative.length ? 5 : 4}.  Basis of preparation`)];
  for (const b of r.basis) out.push(new Paragraph({ spacing: { after: 80, line: 260, lineRule: "exact" }, children: [new TextRun({ text: b, font: SERIF, size: 19, color: MUTED })] }));
  out.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: `Generated by ${APP_NAME} on ${formatDateTime(r.generatedAt)}. Every figure in this document is taken from the dashboard's own records at that moment; nothing is typed by hand.`, italics: true, font: SERIF, size: 18, color: MUTED })] }));
  return out;
}

/* ------------------------------------------------------------------ text helpers */

const h1 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 4 } },
    children: [new TextRun({ text, bold: true, font: SANS, size: 26, color: NAVY })],
  });
const h2 = (text: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 }, children: [new TextRun({ text, bold: true, font: SANS, size: 22, color: NAVY })] });
const h3 = (text: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 180, after: 80 }, children: [new TextRun({ text, bold: true, font: SANS, size: 20, color: INK })] });

/** 11pt on 14pt, the standard readable setting for a printed body. */
const body = (text: string, small = false) =>
  new Paragraph({ spacing: { after: 140, line: 280, lineRule: "exact" }, alignment: AlignmentType.LEFT, children: [new TextRun({ text, font: SERIF, size: small ? 19 : 22, color: small ? MUTED : INK })] });

const bullet = (text: string) =>
  new Paragraph({ spacing: { after: 90, line: 270, lineRule: "exact" }, indent: { left: 360, hanging: 200 }, children: [new TextRun({ text: `—   ${text}`, font: SERIF, size: 21, color: INK })] });

const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [] });

/** A point that needs action: its own marker, its own colour and its own tint. */
const alertBullet = (text: string) =>
  new Paragraph({
    spacing: { after: 90, line: 270, lineRule: "exact" },
    shading: { type: ShadingType.CLEAR, fill: bare(PALETTE.badTint), color: "auto" },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: bare(PALETTE.bad), space: 6 } },
    indent: { left: 180, right: 120 },
    children: [new TextRun({ text: `${TONE_GLYPH.red}   ${text}`, font: SERIF, size: 21, color: bare(PALETTE.bad) })],
  });

/* ------------------------------------------------------------------ table helpers */

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
}

function columnWidths(columns: ResultColumn[], total: number): number[] {
  const weight = (c: ResultColumn) => (c.type === "money" ? 1.3 : c.type === "date" ? 1 : c.type === "number" || c.type === "percent" ? 0.8 : Math.min(2.6, Math.max(1.2, c.label.length / 8)));
  const weights = columns.map(weight);
  const sum = weights.reduce((t, w) => t + w, 0) || 1;
  const out = weights.map((w) => Math.floor((w / sum) * total));
  out[out.length - 1] = total - out.slice(0, -1).reduce((t, w) => t + w, 0); // exact fit
  return out;
}

function cell(text: string, width: number, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; color?: string; shade?: string; size?: number; top?: boolean; double?: boolean } = {}): TableCell {
  const line = { style: BorderStyle.SINGLE, size: opts.double ? 12 : 4, color: opts.top || opts.double ? NAVY : RULE };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    verticalAlign: VerticalAlign.TOP,
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade, color: "auto" } : undefined,
    borders: { top: opts.top || opts.double ? line : none, bottom: opts.double ? { ...line, size: 6 } : none, left: none, right: none },
    children: [new Paragraph({ alignment: opts.align ?? AlignmentType.LEFT, spacing: { after: 0, line: 240, lineRule: "auto" }, children: [new TextRun({ text, bold: opts.bold, font: SANS, size: opts.size ?? 16, color: opts.color ?? INK })] })],
  });
}

function headRow(columns: ResultColumn[], widths: number[]): TableRow {
  return new TableRow({
    tableHeader: true, // repeats on every page
    children: columns.map((c, i) => cell(c.label, widths[i], { bold: true, color: "FFFFFF", shade: NAVY, align: c.numeric ? AlignmentType.RIGHT : AlignmentType.LEFT, size: 15 })),
  });
}

function groupRow(label: string, widths: number[]): TableRow {
  const total = widths.reduce((t, w) => t + w, 0);
  return new TableRow({ children: [cell(label, total, { bold: true, color: NAVY, shade: PANEL, top: true })] });
}

function dataRow(row: RecordRow, columns: ResultColumn[], widths: number[], banded = false): TableRow {
  return new TableRow({
    children: columns.map((c, i) => {
      const tone = row[`${c.key}__tone`] as string | undefined;
      const toned = tone && TONE[tone];
      const text = format(row[c.key], c);
      const marked = toned && !c.numeric && text !== "–" ? `${TONE_GLYPH[tone as keyof typeof TONE_GLYPH] ?? ""}  ${text}` : text;
      return cell(marked, widths[i], { align: c.numeric ? AlignmentType.RIGHT : AlignmentType.LEFT, color: toned ? TONE[tone!] : INK, bold: !!toned, shade: banded ? bare(PALETTE.zebra) : undefined });
    }),
  });
}

function totalRow(columns: ResultColumn[], totals: Record<string, number>, label: string, widths: number[], grand: boolean): TableRow {
  return new TableRow({
    children: columns.map((c, i) =>
      cell(i === 0 ? label : c.numeric && c.type !== "percent" && totals[c.key] !== undefined ? fmtMoney(totals[c.key]) : "", widths[i], {
        bold: true,
        color: NAVY,
        align: c.numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
        top: true,
        double: grand,
      }),
    ),
  });
}

function bandTable(bands: { label: string; n: number; value: number; share: number }[], width: number): Table {
  const hasValue = bands.some((b) => b.value !== 0);
  const labels = hasValue ? ["Band", "Items", "Value (SAR)", "% of value"] : ["Band", "Items"];
  const widths = hasValue ? [Math.round(width * 0.45), Math.round(width * 0.15), Math.round(width * 0.25), width - Math.round(width * 0.45) - Math.round(width * 0.15) - Math.round(width * 0.25)] : [Math.round(width * 0.7), width - Math.round(width * 0.7)];
  const rows: TableRow[] = [
    new TableRow({ tableHeader: true, children: labels.map((l, i) => cell(l, widths[i], { bold: true, color: "FFFFFF", shade: NAVY, align: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, size: 15 })) }),
  ];
  for (const b of bands) {
    const values = hasValue ? [b.label, b.n.toLocaleString("en-US"), fmtMoney(b.value), `${b.share.toFixed(1)}%`] : [b.label, b.n.toLocaleString("en-US")];
    rows.push(new TableRow({ children: values.map((v, i) => cell(v, widths[i], { align: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT })) }));
  }
  const totals = hasValue
    ? ["Total", bands.reduce((t, b) => t + b.n, 0).toLocaleString("en-US"), fmtMoney(bands.reduce((t, b) => t + b.value, 0)), "100.0%"]
    : ["Total", bands.reduce((t, b) => t + b.n, 0).toLocaleString("en-US")];
  rows.push(new TableRow({ children: totals.map((v, i) => cell(v, widths[i], { bold: true, color: NAVY, align: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, top: true, double: true })) }));
  return new Table({ columnWidths: widths, width: { size: width, type: WidthType.DXA }, rows, borders: noBorders() });
}

function format(v: unknown, c: ResultColumn): string {
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
      return s.length > 120 ? `${s.slice(0, 117)}…` : s;
    }
  }
}
