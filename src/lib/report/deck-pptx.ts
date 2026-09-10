import PptxGenJS from "pptxgenjs";
import { CANVAS, PALETTE, SERIES_COLORS, type Deck, type DeckSlide, type DeckBlock, type DeckChart, type DeckTable, type DeckKpi, type Frame, type Tone } from "./deck";

/**
 * The presentation as an editable PowerPoint file: native charts (editable data), real tables,
 * text boxes and shapes – every element can be changed in PowerPoint.
 */
const FONT = "Calibri";
const TONE_COLOR: Record<Tone, string> = { neutral: PALETTE.navy, good: PALETTE.green, bad: PALETTE.red, accent: PALETTE.accent, info: PALETTE.blue };

type Slide = ReturnType<PptxGenJS["addSlide"]>;

export async function renderDeckPptx(deck: Deck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `Monthly Cost Report No ${deck.meta.reportNo}`;
  pptx.author = "Commercial Management";
  pptx.company = deck.meta.appName;
  pptx.subject = deck.meta.programme;
  const total = deck.slides.length;
  deck.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    if (s.layout === "title") titleSlide(pptx, slide, deck, s);
    else contentSlide(pptx, slide, deck, s, i + 1, total);
    if (s.notes) slide.addNotes(s.notes);
  });
  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array);
}

function titleSlide(pptx: PptxGenJS, slide: Slide, deck: Deck, s: DeckSlide) {
  slide.background = { color: PALETTE.navy };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: CANVAS.h, fill: { color: PALETTE.accent }, line: { color: PALETTE.accent } });
  slide.addShape(pptx.ShapeType.rect, { x: 0.9, y: 3.55, w: 2.2, h: 0.08, fill: { color: PALETTE.teal }, line: { color: PALETTE.teal } });
  slide.addText(deck.meta.appName.toUpperCase(), { x: 0.9, y: 1.0, w: 11, h: 0.4, fontFace: FONT, fontSize: 12, color: "9FB3C8", charSpacing: 2 });
  slide.addText(s.title, { x: 0.9, y: 1.5, w: 11.5, h: 1.2, fontFace: FONT, fontSize: 44, bold: true, color: PALETTE.white });
  slide.addText(s.subtitle ?? "", { x: 0.9, y: 2.7, w: 11.5, h: 0.6, fontFace: FONT, fontSize: 20, color: "DCE6F2" });
  for (const b of s.blocks) if (b.kind === "text") slide.addText(b.text.split("\n").map((t, k) => ({ text: t, options: { breakLine: true, fontSize: k === 0 ? 18 : 13, bold: k === 0, color: k === 0 ? PALETTE.white : "C7D3E2" } })), { x: b.frame.x, y: b.frame.y, w: b.frame.w, h: b.frame.h, fontFace: FONT, valign: "top" });
  slide.addText(`Report No ${deck.meta.reportNo}  ·  ${deck.meta.status}  ·  Confidential`, { x: 0.9, y: 6.85, w: 11, h: 0.35, fontFace: FONT, fontSize: 10, color: "9FB3C8" });
}

function contentSlide(pptx: PptxGenJS, slide: Slide, deck: Deck, s: DeckSlide, n: number, total: number) {
  slide.background = { color: PALETTE.white };
  // header
  slide.addText(s.title, { x: 0.45, y: 0.25, w: 8.6, h: 0.55, fontFace: FONT, fontSize: 24, bold: true, color: PALETTE.navy });
  if (s.subtitle) slide.addText(s.subtitle, { x: 0.45, y: 0.72, w: 8.6, h: 0.3, fontFace: FONT, fontSize: 11, color: PALETTE.grey });
  slide.addText([{ text: deck.meta.programmeCode, options: { bold: true, color: PALETTE.navy, breakLine: true } }, { text: `${deck.meta.period} · cut-off ${deck.meta.cutOff}`, options: { color: PALETTE.grey } }], { x: 9.0, y: 0.28, w: 3.9, h: 0.6, fontFace: FONT, fontSize: 10, align: "right", valign: "top" });
  slide.addShape(pptx.ShapeType.rect, { x: 0.45, y: 1.08, w: CANVAS.w - 0.9, h: 0.03, fill: { color: PALETTE.line }, line: { color: PALETTE.line } });
  slide.addShape(pptx.ShapeType.rect, { x: 0.45, y: 1.06, w: 1.4, h: 0.07, fill: { color: PALETTE.accent }, line: { color: PALETTE.accent } });
  // footer
  slide.addShape(pptx.ShapeType.rect, { x: 0.45, y: 7.02, w: CANVAS.w - 0.9, h: 0.01, fill: { color: PALETTE.line }, line: { color: PALETTE.line } });
  slide.addText(`${deck.meta.appName} · Monthly Report No ${deck.meta.reportNo} · ${deck.meta.status} · all amounts SAR`, { x: 0.45, y: 7.05, w: 9, h: 0.3, fontFace: FONT, fontSize: 8, color: PALETTE.grey });
  slide.addText(`Confidential · ${n} / ${total}`, { x: 9.5, y: 7.05, w: 3.4, h: 0.3, fontFace: FONT, fontSize: 8, color: PALETTE.grey, align: "right" });
  for (const b of s.blocks) block(pptx, slide, b);
}

function blockTitle(slide: Slide, f: Frame, title?: string): Frame {
  if (!title) return f;
  slide.addText(title, { x: f.x, y: f.y, w: f.w, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: PALETTE.navy });
  return { x: f.x, y: f.y + 0.32, w: f.w, h: f.h - 0.32 };
}

function block(pptx: PptxGenJS, slide: Slide, b: DeckBlock) {
  if (b.kind === "kpis") return kpis(pptx, slide, b.frame, b.items);
  if (b.kind === "table") return table(slide, blockTitle(slide, b.frame, b.title), b.table);
  if (b.kind === "chart") return chart(pptx, slide, blockTitle(slide, b.frame, b.title), b.chart);
  if (b.kind === "bullets") {
    const f = blockTitle(slide, b.frame, b.title);
    slide.addText(
      b.items.map((t) => ({ text: t, options: { bullet: { indent: 14 }, breakLine: true, paraSpaceAfter: 6 } })),
      { x: f.x, y: f.y, w: f.w, h: f.h, fontFace: FONT, fontSize: b.fontSize ?? 12, color: PALETTE.ink, valign: "top" },
    );
    return;
  }
  const f = blockTitle(slide, b.frame, b.title);
  slide.addText(b.text, { x: f.x, y: f.y, w: f.w, h: f.h, fontFace: FONT, fontSize: b.fontSize ?? 12, color: PALETTE.ink, valign: "top" });
}

function kpis(pptx: PptxGenJS, slide: Slide, f: Frame, items: DeckKpi[]) {
  const gap = 0.15;
  const w = (f.w - gap * (items.length - 1)) / items.length;
  items.forEach((k, i) => {
    const x = f.x + i * (w + gap);
    const color = TONE_COLOR[k.tone ?? "neutral"];
    slide.addShape(pptx.ShapeType.roundRect, { x, y: f.y, w, h: f.h, fill: { color: PALETTE.tile }, line: { color: PALETTE.line, width: 0.75 }, rectRadius: 0.06 });
    slide.addShape(pptx.ShapeType.rect, { x, y: f.y + 0.12, w: 0.06, h: f.h - 0.24, fill: { color }, line: { color } });
    slide.addText(k.label.toUpperCase(), { x: x + 0.15, y: f.y + 0.08, w: w - 0.25, h: 0.3, fontFace: FONT, fontSize: 7.5, color: PALETTE.grey, bold: true, valign: "top" });
    slide.addText(k.value, { x: x + 0.15, y: f.y + 0.36, w: w - 0.25, h: 0.45, fontFace: FONT, fontSize: k.value.length > 14 ? 13 : 17, bold: true, color, valign: "middle", fit: "shrink" });
    if (k.sub) slide.addText(k.sub, { x: x + 0.15, y: f.y + f.h - 0.34, w: w - 0.25, h: 0.28, fontFace: FONT, fontSize: 7.5, color: PALETTE.grey, valign: "top" });
  });
}

function table(slide: Slide, f: Frame, t: DeckTable) {
  const totalW = t.columns.reduce((a, c) => a + c.w, 0);
  const colW = t.columns.map((c) => Math.round(((c.w / totalW) * f.w) * 100) / 100);
  const fs = t.fontSize ?? 9;
  const header: PptxGenJS.TableCell[] = t.columns.map((c) => ({ text: c.label, options: { bold: true, color: PALETTE.white, fill: { color: PALETTE.navy }, align: c.align ?? "left", fontSize: fs, valign: "middle" } }));
  const body: PptxGenJS.TableRow[] = t.rows.map((r, ri) => {
    const isTotal = !!t.totalRow && ri === t.rows.length - 1;
    const tone = t.tones?.[ri];
    return r.map((cell, ci) => ({
      text: cell,
      options: {
        align: t.columns[ci]?.align ?? "left",
        fontSize: fs,
        bold: isTotal,
        color: ci === 0 && tone ? TONE_COLOR[tone] : PALETTE.ink,
        fill: { color: isTotal ? "E8EEF6" : ri % 2 ? PALETTE.zebra : PALETTE.white },
        valign: "middle",
        border: isTotal ? [{ type: "solid", pt: 1, color: PALETTE.navy }, { type: "solid", pt: 0.5, color: PALETTE.line }, { type: "solid", pt: 0.5, color: PALETTE.line }, { type: "solid", pt: 0.5, color: PALETTE.line }] : undefined,
      } as PptxGenJS.TableCellProps,
    }));
  });
  const rowH = Math.min(0.32, Math.max(0.22, (f.h - 0.32) / Math.max(1, t.rows.length)));
  slide.addTable([header, ...body], { x: f.x, y: f.y, w: f.w, colW, fontFace: FONT, border: { type: "solid", pt: 0.5, color: PALETTE.line }, rowH, autoPage: false, margin: 0.04 });
}

function chart(pptx: PptxGenJS, slide: Slide, f: Frame, c: DeckChart) {
  const colors = c.colors ?? c.series.map((s, i) => s.color ?? SERIES_COLORS[i % SERIES_COLORS.length]);
  const fmt = `#,##0${c.decimals ? "." + "0".repeat(c.decimals) : ""}`;
  const data = c.series.map((s) => ({ name: s.name, labels: c.categories, values: s.values }));
  const round = c.type === "doughnut" || c.type === "pie";
  const common: PptxGenJS.IChartOpts = {
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    chartColors: colors,
    showLegend: round || c.series.length > 1,
    legendPos: round ? "r" : "b",
    legendFontSize: 9,
    legendFontFace: FONT,
    catAxisLabelFontSize: 8,
    catAxisLabelFontFace: FONT,
    valAxisLabelFontSize: 8,
    valAxisLabelFontFace: FONT,
    valAxisLabelFormatCode: fmt,
    dataLabelFormatCode: fmt,
    dataLabelFontSize: 7.5,
    dataLabelFontFace: FONT,
    showValue: !!c.showValues,
    valGridLine: { color: "E5E9F0", style: "solid", size: 0.5 },
    catGridLine: { style: "none" },
    showTitle: false,
    valAxisTitle: c.unit,
    showValAxisTitle: !!c.unit && !round,
    valAxisTitleFontSize: 8,
    valAxisTitleColor: PALETTE.grey,
    catAxisLabelColor: PALETTE.grey,
    valAxisLabelColor: PALETTE.grey,
  };
  if (c.type === "doughnut" || c.type === "pie") {
    slide.addChart(c.type === "doughnut" ? pptx.ChartType.doughnut : pptx.ChartType.pie, data, { ...common, holeSize: 55, showPercent: true, showValue: false, showLabel: false, dataLabelColor: PALETTE.white, dataLabelFontSize: 8, dataLabelPosition: "ctr" } as PptxGenJS.IChartOpts);
    return;
  }
  if (c.type === "line") {
    slide.addChart(pptx.ChartType.line, data, { ...common, lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 5, lineSmooth: false } as PptxGenJS.IChartOpts);
    return;
  }
  slide.addChart(pptx.ChartType.bar, data, {
    ...common,
    barDir: c.type === "barH" ? "bar" : "col",
    barGrouping: c.type === "stackedBar" ? "stacked" : "clustered",
    barGapWidthPct: 60,
    catAxisLabelRotate: c.type !== "barH" && c.categories.length > 8 ? -35 : 0,
    dataLabelPosition: c.type === "stackedBar" ? "ctr" : "outEnd",
    dataLabelColor: c.type === "stackedBar" ? PALETTE.white : PALETTE.ink,
  } as PptxGenJS.IChartOpts);
}
