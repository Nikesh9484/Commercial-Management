import PDFDocument from "pdfkit";
import { CANVAS, PALETTE, SERIES_COLORS, type Deck, type DeckSlide, type DeckBlock, type DeckChart, type DeckTable, type DeckKpi, type Frame, type Tone } from "./deck";

/**
 * The same presentation as a PDF (16:9 pages, one per slide), drawn with vector graphics so it
 * prints crisply. Mirrors deck-pptx.ts: same frames, colours and content.
 */
const S = 72; // points per inch
const TONE_COLOR: Record<Tone, string> = { neutral: PALETTE.navy, good: PALETTE.green, bad: PALETTE.red, accent: PALETTE.accent, info: PALETTE.blue };
const hex = (c: string) => `#${c}`;
type Doc = InstanceType<typeof PDFDocument>;
const px = (f: Frame) => ({ x: f.x * S, y: f.y * S, w: f.w * S, h: f.h * S });

export async function renderDeckPdf(deck: Deck): Promise<Buffer> {
  const doc = new PDFDocument({ size: [CANVAS.w * S, CANVAS.h * S], margin: 0, autoFirstPage: false, info: { Title: `Monthly Cost Report No ${deck.meta.reportNo}`, Author: "Commercial Management", Subject: deck.meta.programme } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const total = deck.slides.length;
  deck.slides.forEach((s, i) => {
    doc.addPage();
    if (s.layout === "title") titleSlide(doc, deck, s);
    else contentSlide(doc, deck, s, i + 1, total);
  });
  doc.end();
  return done;
}

const text = (doc: Doc, str: string, x: number, y: number, w: number, o: { size?: number; bold?: boolean; color?: string; align?: "left" | "right" | "center"; h?: number; ellipsis?: boolean; lineGap?: number } = {}) => {
  doc
    .font(o.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(o.size ?? 10)
    .fillColor(hex(o.color ?? PALETTE.ink))
    .text(str, x, y, { width: w, height: o.h, align: o.align ?? "left", ellipsis: o.ellipsis ?? (o.h !== undefined), lineBreak: o.h !== undefined && o.h > (o.size ?? 10) * 1.4, lineGap: o.lineGap ?? 1 });
};

function titleSlide(doc: Doc, deck: Deck, s: DeckSlide) {
  doc.rect(0, 0, CANVAS.w * S, CANVAS.h * S).fill(hex(PALETTE.navy));
  doc.rect(0, 0, 0.35 * S, CANVAS.h * S).fill(hex(PALETTE.accent));
  doc.rect(0.9 * S, 3.55 * S, 2.2 * S, 0.08 * S).fill(hex(PALETTE.teal));
  text(doc, deck.meta.appName.toUpperCase(), 0.9 * S, 1.0 * S, 11 * S, { size: 12, color: "9FB3C8" });
  text(doc, s.title, 0.9 * S, 1.5 * S, 11.5 * S, { size: 44, bold: true, color: PALETTE.white });
  text(doc, s.subtitle ?? "", 0.9 * S, 2.75 * S, 11.5 * S, { size: 20, color: "DCE6F2" });
  for (const b of s.blocks) {
    if (b.kind !== "text") continue;
    const f = px(b.frame);
    let y = f.y;
    b.text.split("\n").forEach((line, k) => {
      text(doc, line, f.x, y, f.w, { size: k === 0 ? 18 : 13, bold: k === 0, color: k === 0 ? PALETTE.white : "C7D3E2" });
      y += (k === 0 ? 18 : 13) * 1.5;
    });
  }
  text(doc, `Report No ${deck.meta.reportNo}  ·  ${deck.meta.status}  ·  Confidential`, 0.9 * S, 6.85 * S, 11 * S, { size: 10, color: "9FB3C8" });
}

function contentSlide(doc: Doc, deck: Deck, s: DeckSlide, n: number, total: number) {
  doc.rect(0, 0, CANVAS.w * S, CANVAS.h * S).fill(hex(PALETTE.white));
  text(doc, s.title, 0.45 * S, 0.3 * S, 8.6 * S, { size: 24, bold: true, color: PALETTE.navy });
  if (s.subtitle) text(doc, s.subtitle, 0.45 * S, 0.76 * S, 8.6 * S, { size: 11, color: PALETTE.grey });
  text(doc, deck.meta.programmeCode, 9.0 * S, 0.32 * S, 3.9 * S, { size: 10, bold: true, color: PALETTE.navy, align: "right" });
  text(doc, `${deck.meta.period} · cut-off ${deck.meta.cutOff}`, 9.0 * S, 0.52 * S, 3.9 * S, { size: 10, color: PALETTE.grey, align: "right" });
  doc.rect(0.45 * S, 1.08 * S, (CANVAS.w - 0.9) * S, 0.03 * S).fill(hex(PALETTE.line));
  doc.rect(0.45 * S, 1.06 * S, 1.4 * S, 0.07 * S).fill(hex(PALETTE.accent));
  doc.rect(0.45 * S, 7.02 * S, (CANVAS.w - 0.9) * S, 0.01 * S).fill(hex(PALETTE.line));
  text(doc, `${deck.meta.appName} · Monthly Report No ${deck.meta.reportNo} · ${deck.meta.status} · all amounts SAR`, 0.45 * S, 7.1 * S, 9 * S, { size: 8, color: PALETTE.grey });
  text(doc, `Confidential · ${n} / ${total}`, 9.5 * S, 7.1 * S, 3.4 * S, { size: 8, color: PALETTE.grey, align: "right" });
  for (const b of s.blocks) block(doc, b);
}

function blockTitle(doc: Doc, f: Frame, title?: string): Frame {
  if (!title) return f;
  text(doc, title, f.x * S, f.y * S + 2, f.w * S, { size: 11, bold: true, color: PALETTE.navy });
  return { x: f.x, y: f.y + 0.32, w: f.w, h: f.h - 0.32 };
}

function block(doc: Doc, b: DeckBlock) {
  if (b.kind === "kpis") return kpis(doc, b.frame, b.items);
  if (b.kind === "table") return table(doc, blockTitle(doc, b.frame, b.title), b.table);
  if (b.kind === "chart") return chart(doc, blockTitle(doc, b.frame, b.title), b.chart);
  const f = px(blockTitle(doc, b.frame, b.title));
  if (b.kind === "bullets") {
    const size = b.fontSize ?? 12;
    let y = f.y;
    for (const item of b.items) {
      doc.circle(f.x + 4, y + size * 0.55, 2).fill(hex(PALETTE.accent));
      doc.font("Helvetica").fontSize(size).fillColor(hex(PALETTE.ink));
      const h = doc.heightOfString(item, { width: f.w - 14, lineGap: 2 });
      if (y + h > f.y + f.h) break;
      doc.text(item, f.x + 14, y, { width: f.w - 14, lineGap: 2 });
      y += h + size * 0.6;
    }
    return;
  }
  doc.font("Helvetica").fontSize(b.fontSize ?? 12).fillColor(hex(PALETTE.ink)).text(b.text, f.x, f.y, { width: f.w, height: f.h, lineGap: 2 });
}

function kpis(doc: Doc, frame: Frame, items: DeckKpi[]) {
  const f = px(frame);
  const gap = 0.15 * S;
  const w = (f.w - gap * (items.length - 1)) / items.length;
  items.forEach((k, i) => {
    const x = f.x + i * (w + gap);
    const color = TONE_COLOR[k.tone ?? "neutral"];
    doc.roundedRect(x, f.y, w, f.h, 5).fillAndStroke(hex(PALETTE.tile), hex(PALETTE.line));
    doc.rect(x, f.y + 0.12 * S, 0.06 * S, f.h - 0.24 * S).fill(hex(color));
    text(doc, k.label.toUpperCase(), x + 0.15 * S, f.y + 0.1 * S, w - 0.25 * S, { size: 7, bold: true, color: PALETTE.grey, h: 0.3 * S });
    text(doc, k.value, x + 0.15 * S, f.y + 0.42 * S, w - 0.25 * S, { size: k.value.length > 14 ? 12 : 16, bold: true, color, h: 0.4 * S });
    if (k.sub) text(doc, k.sub, x + 0.15 * S, f.y + f.h - 0.32 * S, w - 0.25 * S, { size: 7, color: PALETTE.grey, h: 0.26 * S });
  });
}

function table(doc: Doc, frame: Frame, t: DeckTable) {
  const f = px(frame);
  const totalW = t.columns.reduce((a, c) => a + c.w, 0);
  const colW = t.columns.map((c) => (c.w / totalW) * f.w);
  const fs = t.fontSize ?? 9;
  const rowH = Math.min(0.32 * S, Math.max(0.22 * S, (f.h - 0.3 * S) / Math.max(1, t.rows.length)));
  const headH = 0.3 * S;
  let y = f.y;
  doc.rect(f.x, y, f.w, headH).fill(hex(PALETTE.navy));
  let x = f.x;
  t.columns.forEach((c, i) => {
    text(doc, c.label, x + 3, y + (headH - fs) / 2 - 1, colW[i] - 6, { size: fs, bold: true, color: PALETTE.white, align: c.align ?? "left", h: headH, ellipsis: true });
    x += colW[i];
  });
  y += headH;
  t.rows.forEach((r, ri) => {
    if (y + rowH > f.y + f.h + 1) return;
    const isTotal = !!t.totalRow && ri === t.rows.length - 1;
    doc.rect(f.x, y, f.w, rowH).fill(hex(isTotal ? "E8EEF6" : ri % 2 ? PALETTE.zebra : PALETTE.white));
    if (isTotal) doc.moveTo(f.x, y).lineTo(f.x + f.w, y).lineWidth(1).stroke(hex(PALETTE.navy));
    const tone = t.tones?.[ri];
    let cx = f.x;
    r.forEach((cell, ci) => {
      text(doc, cell, cx + 3, y + (rowH - fs) / 2 - 1, colW[ci] - 6, { size: fs, bold: isTotal, color: ci === 0 && tone ? TONE_COLOR[tone] : PALETTE.ink, align: t.columns[ci]?.align ?? "left", h: rowH, ellipsis: true });
      cx += colW[ci];
    });
    y += rowH;
  });
  doc.rect(f.x, f.y, f.w, y - f.y).lineWidth(0.5).stroke(hex(PALETTE.line));
}

const fmtVal = (v: number, decimals: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

function chart(doc: Doc, frame: Frame, c: DeckChart) {
  const f = px(frame);
  const colors = (c.colors ?? c.series.map((s, i) => s.color ?? SERIES_COLORS[i % SERIES_COLORS.length])).map(hex);
  if (c.type === "doughnut" || c.type === "pie") return roundChart(doc, f, c, colors);
  const legendH = c.series.length > 1 ? 16 : 0;
  const pad = { l: 46, r: 8, t: 8, b: c.type === "barH" ? 18 : c.categories.length > 8 ? 40 : 26 };
  const plot = { x: f.x + pad.l, y: f.y + pad.t, w: f.w - pad.l - pad.r, h: f.h - pad.t - pad.b - legendH };
  const stacked = c.type === "stackedBar";
  const maxV = Math.max(
    1e-9,
    ...(stacked ? c.categories.map((_, i) => c.series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0)) : c.series.flatMap((s) => s.values)),
  );
  const minV = Math.min(0, ...c.series.flatMap((s) => s.values));
  const nice = niceMax(maxV);
  const niceMin = minV < 0 ? -niceMax(-minV) : 0;
  const span = nice - niceMin;
  const horizontal = c.type === "barH";
  const valPos = (v: number) => (horizontal ? plot.x + ((v - niceMin) / span) * plot.w : plot.y + plot.h - ((v - niceMin) / span) * plot.h);
  // grid + axis labels
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = niceMin + (span * i) / ticks;
    if (horizontal) {
      const x = valPos(v);
      doc.moveTo(x, plot.y).lineTo(x, plot.y + plot.h).lineWidth(0.5).stroke("#E5E9F0");
      text(doc, fmtVal(v, c.decimals ?? 0), x - 20, plot.y + plot.h + 3, 40, { size: 7, color: PALETTE.grey, align: "center" });
    } else {
      const y = valPos(v);
      doc.moveTo(plot.x, y).lineTo(plot.x + plot.w, y).lineWidth(0.5).stroke("#E5E9F0");
      text(doc, fmtVal(v, c.decimals ?? 0), f.x, y - 4, pad.l - 6, { size: 7, color: PALETTE.grey, align: "right" });
    }
  }
  if (c.unit && !horizontal) {
    doc.save().rotate(-90, { origin: [f.x + 8, plot.y + plot.h / 2] });
    text(doc, c.unit, f.x + 8 - 60, plot.y + plot.h / 2 - 12, 120, { size: 7, color: PALETTE.grey, align: "center" });
    doc.restore();
  }
  const n = c.categories.length;
  if (horizontal) {
    const band = plot.h / Math.max(1, n);
    const barH = Math.min(18, band * 0.6);
    c.categories.forEach((cat, i) => {
      const y = plot.y + i * band + (band - barH) / 2;
      const v = c.series[0]?.values[i] ?? 0;
      const x0 = valPos(0);
      const x1 = valPos(v);
      doc.rect(Math.min(x0, x1), y, Math.abs(x1 - x0), barH).fill(v < 0 ? hex(PALETTE.red) : colors[0]);
      text(doc, cat, f.x - 2, y + barH / 2 - 4, pad.l + 2, { size: 6.5, color: PALETTE.grey, align: "right", h: 12, ellipsis: true });
      if (c.showValues) text(doc, fmtVal(v, c.decimals ?? 0), v < 0 ? x1 - 44 : x1 + 3, y + barH / 2 - 4, 44, { size: 7, color: PALETTE.ink, align: v < 0 ? "right" : "left" });
    });
  } else if (c.type === "line") {
    const step = n > 1 ? plot.w / (n - 1) : 0;
    c.series.forEach((s, si) => {
      doc.lineWidth(2).strokeColor(colors[si]);
      s.values.forEach((v, i) => {
        const x = plot.x + i * step;
        const y = valPos(v);
        if (i === 0) doc.moveTo(x, y);
        else doc.lineTo(x, y);
      });
      doc.stroke();
      s.values.forEach((v, i) => doc.circle(plot.x + i * step, valPos(v), 2.5).fill(colors[si]));
    });
    c.categories.forEach((cat, i) => {
      if (n > 12 && i % 2) return;
      text(doc, cat, plot.x + i * step - 24, plot.y + plot.h + 4, 48, { size: 6.5, color: PALETTE.grey, align: "center" });
    });
  } else {
    const band = plot.w / Math.max(1, n);
    const groups = stacked ? 1 : c.series.length;
    const barW = Math.min(28, (band * 0.7) / groups);
    c.categories.forEach((cat, i) => {
      let acc = 0;
      c.series.forEach((s, si) => {
        const v = s.values[i] ?? 0;
        const x = stacked ? plot.x + i * band + (band - barW) / 2 : plot.x + i * band + (band - barW * groups) / 2 + si * barW;
        const y0 = valPos(stacked ? acc : 0);
        const y1 = valPos(stacked ? acc + v : v);
        doc.rect(x, Math.min(y0, y1), barW, Math.abs(y1 - y0)).fill(colors[si]);
        if (c.showValues && v) text(doc, fmtVal(v, c.decimals ?? 0), x - 10, stacked ? (y0 + y1) / 2 - 4 : y1 - 10, barW + 20, { size: 6.5, color: stacked ? PALETTE.white : PALETTE.ink, align: "center" });
        if (stacked) acc += v;
      });
      if (n > 8) {
        doc.save().rotate(-35, { origin: [plot.x + i * band + band / 2, plot.y + plot.h + 6] });
        text(doc, cat, plot.x + i * band + band / 2 - 60, plot.y + plot.h + 6, 60, { size: 6.5, color: PALETTE.grey, align: "right" });
        doc.restore();
      } else text(doc, cat, plot.x + i * band, plot.y + plot.h + 4, band, { size: 7, color: PALETTE.grey, align: "center", h: 22, ellipsis: true });
    });
  }
  doc.moveTo(plot.x, horizontal ? plot.y : valPos(0)).lineTo(horizontal ? plot.x : plot.x + plot.w, horizontal ? plot.y + plot.h : valPos(0)).lineWidth(0.8).stroke(hex(PALETTE.grey));
  if (legendH) {
    let lx = plot.x;
    const ly = f.y + f.h - 11;
    c.series.forEach((s, si) => {
      doc.rect(lx, ly, 8, 8).fill(colors[si]);
      text(doc, s.name, lx + 11, ly - 1, 160, { size: 7.5, color: PALETTE.grey });
      lx += 14 + doc.widthOfString(s.name) + 14;
    });
  }
}

function roundChart(doc: Doc, f: { x: number; y: number; w: number; h: number }, c: DeckChart, colors: string[]) {
  const values = c.series[0]?.values ?? [];
  const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const r = Math.min(f.h, f.w * 0.5) / 2 - 6;
  const cx = f.x + r + 10;
  const cy = f.y + f.h / 2;
  let a = -Math.PI / 2;
  values.forEach((v, i) => {
    const frac = Math.max(0, v) / total;
    if (!frac) return;
    const a1 = a + frac * Math.PI * 2;
    doc.moveTo(cx, cy).lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    // approximate the arc with short segments (pdfkit paths have no native arc-by-angle)
    const steps = Math.max(2, Math.ceil(frac * 48));
    for (let k = 1; k <= steps; k++) {
      const t = a + ((a1 - a) * k) / steps;
      doc.lineTo(cx + r * Math.cos(t), cy + r * Math.sin(t));
    }
    doc.closePath().fill(colors[i % colors.length]);
    if (frac > 0.06) {
      const mid = (a + a1) / 2;
      const lr = c.type === "doughnut" ? r * 0.78 : r * 0.62;
      text(doc, `${Math.round(frac * 100)}%`, cx + lr * Math.cos(mid) - 16, cy + lr * Math.sin(mid) - 4, 32, { size: 7.5, bold: true, color: PALETTE.white, align: "center" });
    }
    a = a1;
  });
  if (c.type === "doughnut") doc.circle(cx, cy, r * 0.55).fill(hex(PALETTE.white));
  // legend
  const lx = cx + r + 18;
  const lw = f.x + f.w - lx;
  const lh = Math.min(18, f.h / Math.max(1, values.length));
  let ly = cy - (values.length * lh) / 2;
  c.categories.forEach((cat, i) => {
    doc.rect(lx, ly + 4, 8, 8).fill(colors[i % colors.length]);
    text(doc, `${cat} – ${fmtVal(values[i] ?? 0, c.decimals ?? 0)}${c.unit ? "" : ""}`, lx + 12, ly + 2, lw - 12, { size: 7.5, color: PALETTE.ink, h: lh, ellipsis: true });
    ly += lh;
  });
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}
