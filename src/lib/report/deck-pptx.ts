import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { CANVAS, PALETTE, SERIES_COLORS, type Deck, type DeckSlide, type DeckBlock, type DeckChart, type DeckTable, type DeckKpi, type Frame, type Tone } from "./deck";

/**
 * The presentation as an editable PowerPoint file: native charts (editable data), real tables,
 * text boxes and shapes – every element can be changed in PowerPoint. Each slide gets a fade
 * transition and its content fades in group by group (KPI tiles first, then each panel); the
 * animations are ordinary PowerPoint animations and can be changed or removed in the Animation pane.
 */
const FONT = "Calibri";
const TONE_COLOR: Record<Tone, string> = { neutral: PALETTE.navy, good: PALETTE.green, bad: PALETTE.red, accent: PALETTE.accent, info: PALETTE.blue };
/** neutral KPI tiles cycle through these so a row of tiles is never one flat colour */
const NEUTRAL_TILES = [PALETTE.navy, PALETTE.teal, PALETTE.purple, "3B6EA5"];
const BAND_W = 0.16;

type Slide = ReturnType<PptxGenJS["addSlide"]>;
/** Every shape that should animate is named "anim-<group>"; shapes in one group appear together. */
const anim = (group: number) => ({ objectName: `anim-${group}` });

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
  const buf = Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array);
  return addAnimations(buf);
}

function titleSlide(pptx: PptxGenJS, slide: Slide, deck: Deck, s: DeckSlide) {
  slide.background = { color: PALETTE.navy };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: CANVAS.h, fill: { color: s.accent }, line: { color: s.accent } });
  // soft colour blocks in the top right corner
  slide.addShape(pptx.ShapeType.ellipse, { x: 9.6, y: -1.6, w: 5.2, h: 5.2, fill: { color: PALETTE.teal, transparency: 70 }, line: { color: PALETTE.teal, transparency: 100 } });
  slide.addShape(pptx.ShapeType.ellipse, { x: 11.2, y: 0.9, w: 3.4, h: 3.4, fill: { color: s.accent, transparency: 55 }, line: { color: s.accent, transparency: 100 } });
  slide.addShape(pptx.ShapeType.rect, { x: 0.9, y: 3.55, w: 2.2, h: 0.08, fill: { color: s.accent }, line: { color: s.accent } });
  slide.addText(deck.meta.appName.toUpperCase(), { x: 0.9, y: 1.0, w: 8, h: 0.4, fontFace: FONT, fontSize: 12, color: "9FB3C8", charSpacing: 2, ...anim(1) });
  slide.addText(s.title, { x: 0.9, y: 1.5, w: 9, h: 1.2, fontFace: FONT, fontSize: 44, bold: true, color: PALETTE.white, ...anim(1) });
  slide.addText(s.subtitle ?? "", { x: 0.9, y: 2.7, w: 9, h: 0.6, fontFace: FONT, fontSize: 20, color: "DCE6F2", ...anim(2) });
  for (const b of s.blocks) if (b.kind === "text") slide.addText(b.text.split("\n").map((t, k) => ({ text: t, options: { breakLine: true, fontSize: k === 0 ? 18 : 13, bold: k === 0, color: k === 0 ? PALETTE.white : "C7D3E2" } })), { x: b.frame.x, y: b.frame.y, w: b.frame.w, h: b.frame.h, fontFace: FONT, valign: "top", ...anim(3) });
  slide.addText(`Report No ${deck.meta.reportNo}  ·  ${deck.meta.status}  ·  Confidential`, { x: 0.9, y: 6.85, w: 11, h: 0.35, fontFace: FONT, fontSize: 10, color: "9FB3C8" });
}

function contentSlide(pptx: PptxGenJS, slide: Slide, deck: Deck, s: DeckSlide, n: number, total: number) {
  slide.background = { color: PALETTE.white };
  // colour band down the left edge and a matching tag under the title
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: BAND_W, h: CANVAS.h, fill: { color: s.accent }, line: { color: s.accent } });
  slide.addText(s.title, { x: 0.45, y: 0.25, w: 8.6, h: 0.55, fontFace: FONT, fontSize: 24, bold: true, color: PALETTE.navy });
  if (s.subtitle) slide.addText(s.subtitle, { x: 0.45, y: 0.72, w: 8.6, h: 0.3, fontFace: FONT, fontSize: 11, color: PALETTE.grey });
  slide.addText([{ text: deck.meta.programmeCode, options: { bold: true, color: PALETTE.navy, breakLine: true } }, { text: `${deck.meta.period} · cut-off ${deck.meta.cutOff}`, options: { color: PALETTE.grey } }], { x: 9.0, y: 0.28, w: 3.9, h: 0.6, fontFace: FONT, fontSize: 10, align: "right", valign: "top" });
  slide.addShape(pptx.ShapeType.rect, { x: 0.45, y: 1.08, w: CANVAS.w - 0.9, h: 0.03, fill: { color: PALETTE.line }, line: { color: PALETTE.line } });
  slide.addShape(pptx.ShapeType.rect, { x: 0.45, y: 1.06, w: 1.4, h: 0.07, fill: { color: s.accent }, line: { color: s.accent } });
  // footer with a coloured page pill
  slide.addShape(pptx.ShapeType.rect, { x: 0.45, y: 7.02, w: CANVAS.w - 0.9, h: 0.01, fill: { color: PALETTE.line }, line: { color: PALETTE.line } });
  slide.addText(`${deck.meta.appName} · Monthly Report No ${deck.meta.reportNo} · ${deck.meta.status} · all amounts SAR`, { x: 0.45, y: 7.05, w: 9, h: 0.3, fontFace: FONT, fontSize: 8, color: PALETTE.grey });
  slide.addText("Confidential", { x: 10.4, y: 7.05, w: 1.6, h: 0.3, fontFace: FONT, fontSize: 8, color: PALETTE.grey, align: "right" });
  slide.addShape(pptx.ShapeType.roundRect, { x: 12.1, y: 7.07, w: 0.78, h: 0.26, fill: { color: s.accent }, line: { color: s.accent }, rectRadius: 0.13 });
  slide.addText(`${n} / ${total}`, { x: 12.1, y: 7.07, w: 0.78, h: 0.26, fontFace: FONT, fontSize: 8, bold: true, color: PALETTE.white, align: "center", valign: "middle" });
  let group = 1;
  for (const b of s.blocks) group = block(pptx, slide, b, s.accent, group);
}

function blockTitle(slide: Slide, pptx: PptxGenJS, f: Frame, accent: string, group: number, title?: string): Frame {
  if (!title) return f;
  slide.addShape(pptx.ShapeType.rect, { x: f.x, y: f.y + 0.09, w: 0.12, h: 0.12, fill: { color: accent }, line: { color: accent }, ...anim(group) });
  slide.addText(title, { x: f.x + 0.18, y: f.y, w: f.w - 0.18, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: PALETTE.navy, ...anim(group) });
  return { x: f.x, y: f.y + 0.32, w: f.w, h: f.h - 0.32 };
}

/** draws a block and returns the next animation group number */
function block(pptx: PptxGenJS, slide: Slide, b: DeckBlock, accent: string, group: number): number {
  if (b.kind === "kpis") return kpis(pptx, slide, b.frame, b.items, group);
  const f = blockTitle(slide, pptx, b.frame, accent, group, b.title);
  if (b.kind === "table") table(slide, f, b.table, accent, group);
  else if (b.kind === "chart") chart(pptx, slide, f, b.chart, group);
  else if (b.kind === "bullets") {
    slide.addShape(pptx.ShapeType.roundRect, { x: f.x, y: f.y, w: f.w, h: f.h, fill: { color: PALETTE.tile }, line: { color: PALETTE.line, width: 0.75 }, rectRadius: 0.06, ...anim(group) });
    slide.addText(
      b.items.map((t) => ({ text: t, options: { bullet: { indent: 14, code: "25A0" }, breakLine: true, paraSpaceAfter: 8 } })),
      { x: f.x + 0.1, y: f.y + 0.08, w: f.w - 0.2, h: f.h - 0.16, fontFace: FONT, fontSize: b.fontSize ?? 12, color: PALETTE.ink, valign: "top", ...anim(group) },
    );
  } else slide.addText(b.text, { x: f.x, y: f.y, w: f.w, h: f.h, fontFace: FONT, fontSize: b.fontSize ?? 12, color: PALETTE.ink, valign: "top", ...anim(group) });
  return group + 1;
}

function kpis(pptx: PptxGenJS, slide: Slide, f: Frame, items: DeckKpi[], group: number): number {
  const gap = 0.15;
  const w = (f.w - gap * (items.length - 1)) / items.length;
  let neutral = 0;
  items.forEach((k, i) => {
    const x = f.x + i * (w + gap);
    const tone = k.tone ?? "neutral";
    const color = tone === "neutral" ? NEUTRAL_TILES[neutral++ % NEUTRAL_TILES.length] : TONE_COLOR[tone];
    const g = group + i;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: f.y, w, h: f.h, fill: { color }, line: { color }, rectRadius: 0.08, ...anim(g) });
    slide.addShape(pptx.ShapeType.rect, { x: x + 0.15, y: f.y + f.h - 0.16, w: 0.5, h: 0.05, fill: { color: PALETTE.white, transparency: 35 }, line: { color: PALETTE.white, transparency: 100 }, ...anim(g) });
    slide.addText(k.label.toUpperCase(), { x: x + 0.15, y: f.y + 0.08, w: w - 0.25, h: 0.3, fontFace: FONT, fontSize: 7.5, color: "E4ECF6", bold: true, valign: "top", ...anim(g) });
    slide.addText(k.value, { x: x + 0.15, y: f.y + 0.36, w: w - 0.25, h: 0.45, fontFace: FONT, fontSize: k.value.length > 14 ? 14 : 18, bold: true, color: PALETTE.white, valign: "middle", fit: "shrink", ...anim(g) });
    if (k.sub) slide.addText(k.sub, { x: x + 0.15, y: f.y + f.h - 0.42, w: w - 0.25, h: 0.26, fontFace: FONT, fontSize: 7.5, color: "E4ECF6", valign: "top", ...anim(g) });
  });
  return group + items.length;
}

function table(slide: Slide, f: Frame, t: DeckTable, accent: string, group: number) {
  const totalW = t.columns.reduce((a, c) => a + c.w, 0);
  const colW = t.columns.map((c) => Math.round(((c.w / totalW) * f.w) * 100) / 100);
  const fs = t.fontSize ?? 9;
  const header: PptxGenJS.TableCell[] = t.columns.map((c) => ({ text: c.label, options: { bold: true, color: PALETTE.white, fill: { color: accent }, align: c.align ?? "left", fontSize: fs, valign: "middle" } }));
  const body: PptxGenJS.TableRow[] = t.rows.map((r, ri) => {
    const isTotal = !!t.totalRow && ri === t.rows.length - 1;
    const tone = t.tones?.[ri];
    return r.map((cell, ci) => ({
      text: cell,
      options: {
        align: t.columns[ci]?.align ?? "left",
        fontSize: fs,
        bold: isTotal || (ci === 0 && !!tone),
        color: ci === 0 && tone ? TONE_COLOR[tone] : PALETTE.ink,
        fill: { color: isTotal ? "E8EEF6" : ri % 2 ? PALETTE.zebra : PALETTE.white },
        valign: "middle",
        border: isTotal ? [{ type: "solid", pt: 1, color: PALETTE.navy }, { type: "solid", pt: 0.5, color: PALETTE.line }, { type: "solid", pt: 0.5, color: PALETTE.line }, { type: "solid", pt: 0.5, color: PALETTE.line }] : undefined,
      } as PptxGenJS.TableCellProps,
    }));
  });
  // rows share the panel height so the table fills its space
  const rowH = Math.min(0.42, Math.max(0.22, f.h / (t.rows.length + 1)));
  slide.addTable([header, ...body], { x: f.x, y: f.y, w: f.w, colW, fontFace: FONT, border: { type: "solid", pt: 0.5, color: PALETTE.line }, rowH, autoPage: false, margin: 0.04, ...anim(group) });
}

function chart(pptx: PptxGenJS, slide: Slide, f: Frame, c: DeckChart, group: number) {
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
    chartArea: { fill: { color: PALETTE.tile }, roundedCorners: true, border: { color: PALETTE.line, pt: 0.75 } },
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
    ...anim(group),
  };
  if (c.type === "doughnut" || c.type === "pie") {
    slide.addChart(c.type === "doughnut" ? pptx.ChartType.doughnut : pptx.ChartType.pie, data, { ...common, holeSize: 55, showPercent: true, showValue: false, showLabel: false, dataLabelColor: PALETTE.white, dataLabelFontSize: 8, dataLabelPosition: "ctr" } as PptxGenJS.IChartOpts);
    return;
  }
  if (c.type === "line") {
    slide.addChart(pptx.ChartType.line, data, { ...common, lineSize: 2.25, lineDataSymbol: "circle", lineDataSymbolSize: 6, lineSmooth: false } as PptxGenJS.IChartOpts);
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

/* ------------------------------------------------------------------ */
/* Transitions and entrance animations                                 */
/* ------------------------------------------------------------------ */
/**
 * pptxgenjs writes no animation, so the finished file is opened and every slide gets a fade
 * transition plus a fade-in for each named "anim-<group>" shape: group 1 starts as soon as the
 * slide appears, later groups follow a fraction of a second apart (all "with previous", so no
 * clicks are needed). Standard PresentationML, so PowerPoint shows them in the Animation pane.
 */
async function addAnimations(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  for (const name of names) {
    const xml = await zip.file(name)!.async("string");
    zip.file(name, animateSlide(xml));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

interface Target {
  id: string;
  group: number;
  graphic: boolean;
}

function animateSlide(xml: string): string {
  const targets: Target[] = [];
  const re = /<p:(sp|graphicFrame)>\s*<p:nv(?:Sp|GraphicFrame)Pr>\s*<p:cNvPr id="(\d+)" name="anim-(\d+)"/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) targets.push({ id: m[2], group: Number(m[3]), graphic: m[1] === "graphicFrame" });
  const transition = `<p:transition spd="med"><p:fade/></p:transition>`;
  const timing = targets.length ? timingXml(targets) : "";
  const tail = transition + timing;
  if (xml.includes("</p:clrMapOvr>")) return xml.replace("</p:clrMapOvr>", `</p:clrMapOvr>${tail}`);
  return xml.replace("</p:sld>", `${tail}</p:sld>`);
}

function timingXml(targets: Target[]): string {
  const groups = [...new Set(targets.map((t) => t.group))].sort((a, b) => a - b);
  let id = 5;
  const effects = targets
    .sort((a, b) => a.group - b.group)
    .map((t, i) => {
      const first = i === 0;
      const delay = groups.indexOf(t.group) * 220;
      const c = id;
      id += 3;
      return (
        `<p:par><p:cTn id="${c}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="${first ? "afterEffect" : "withEffect"}">` +
        `<p:stCondLst><p:cond delay="${first ? 0 : delay}"/></p:stCondLst><p:childTnLst>` +
        `<p:set><p:cBhvr><p:cTn id="${c + 1}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${t.id}"/></p:tgtEl>` +
        `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>` +
        `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${c + 2}" dur="500"/><p:tgtEl><p:spTgt spid="${t.id}"/></p:tgtEl></p:cBhvr></p:animEffect>` +
        `</p:childTnLst></p:cTn></p:par>`
      );
    })
    .join("");
  const builds = targets.map((t) => (t.graphic ? `<p:bldGraphic spid="${t.id}" grpId="0"><p:bldAsOne/></p:bldGraphic>` : `<p:bldP spid="${t.id}" grpId="0"/>`)).join("");
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>` +
    `<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>` +
    `<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
    effects +
    `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>` +
    `</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>${builds}</p:bldLst></p:timing>`
  );
}
