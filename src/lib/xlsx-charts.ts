import JSZip from "jszip";

/**
 * Native, editable Excel charts. ExcelJS cannot write charts, so the finished workbook is opened
 * again and the chart parts (chartN.xml), the drawing that places them on a sheet and the
 * relationships / content types are added by hand – standard SpreadsheetML, so Excel treats them
 * like any chart (Chart Design tab, Select Data, colours, type …).
 */
export type XlsxChartType = "bar" | "stackedBar" | "barH" | "line" | "doughnut" | "pie";

export interface XlsxSeries {
  name: string;
  /** cell range with the values, e.g. "'Level 1'!$B$7:$F$7" */
  values: string;
  /** the values themselves (cached so the chart shows before Excel recalculates) */
  cache: number[];
  color?: string;
}

export interface XlsxChart {
  type: XlsxChartType;
  title?: string;
  /** cell range with the category labels */
  categories: string;
  catCache: string[];
  series: XlsxSeries[];
  /** top-left and bottom-right cells (0-based column / row) the chart is anchored to */
  from: { col: number; row: number };
  to: { col: number; row: number };
  numFmt?: string;
  showValues?: boolean;
  legend?: boolean;
  /** per-point colours for pie / doughnut charts */
  pointColors?: string[];
}

/** A decorative or button shape drawn over the cells (gradient fill, shadow, 3-D bevel, optional macro). */
export interface XlsxShape {
  kind: "roundRect" | "ellipse" | "rect" | "diamond" | "hexagon";
  name: string;
  from: { col: number; row: number; colOff?: number; rowOff?: number };
  to: { col: number; row: number; colOff?: number; rowOff?: number };
  /** gradient stops top→bottom (hex); one colour = solid */
  colors: string[];
  /** 0–1, gradient angle in degrees (90 = top to bottom) */
  angle?: number;
  alpha?: number;
  shadow?: boolean;
  bevel?: boolean;
  glow?: string;
  text?: string;
  textColor?: string;
  fontSize?: number;
  bold?: boolean;
  align?: "l" | "ctr" | "r";
  /** macro to run when clicked, e.g. "modMain.SignIn" */
  macro?: string;
  /** rounded-corner radius 0–0.5 for roundRect */
  radius?: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XDR_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const FONT = "Calibri";

/** Adds the charts to the workbook (a finished .xlsx buffer). Keys are worksheet names. */
export async function addChartsToXlsx(xlsx: Buffer, charts: Record<string, XlsxChart[]>, shapes: Record<string, XlsxShape[]> = {}): Promise<Buffer> {
  const zip = await JSZip.loadAsync(xlsx);
  const sheetFile = await sheetFiles(zip);
  let chartNo = 0;
  let drawingNo = 0;
  let contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  const sheetNames = [...new Set([...Object.keys(charts), ...Object.keys(shapes)])];
  for (const sheetName of sheetNames) {
    const list = charts[sheetName] ?? [];
    const shapeList = shapes[sheetName] ?? [];
    if (!list.length && !shapeList.length) continue;
    const file = sheetFile.get(sheetName);
    if (!file) continue;
    drawingNo++;
    const drawingPath = `xl/drawings/drawing${drawingNo}.xml`;
    const drawingRels: string[] = [];
    const anchors: string[] = [];
    let shapeId = 2;
    // shapes first so buttons and decoration sit under the charts in z-order
    shapeList.forEach((sh) => anchors.push(shapeXml(sh, shapeId++)));
    list.forEach((chart, i) => {
      chartNo++;
      const chartPath = `xl/charts/chart${chartNo}.xml`;
      zip.file(chartPath, chartXml(chart));
      contentTypes = addOverride(contentTypes, `/${chartPath}`, "application/vnd.openxmlformats-officedocument.drawingml.chart+xml");
      const rid = `rId${i + 1}`;
      drawingRels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/>`);
      anchors.push(anchorXml(chart, shapeId++, `Chart ${chartNo}`, rid));
    });
    zip.file(drawingPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="${XDR_NS}" xmlns:a="${A_NS}">${anchors.join("")}</xdr:wsDr>`);
    if (drawingRels.length) zip.file(`xl/drawings/_rels/drawing${drawingNo}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${drawingRels.join("")}</Relationships>`);
    contentTypes = addOverride(contentTypes, `/${drawingPath}`, "application/vnd.openxmlformats-officedocument.drawing+xml");
    // relationship from the sheet to its drawing, and the <drawing> element in the sheet
    const relsPath = file.replace("worksheets/", "worksheets/_rels/") + ".rels";
    const existing = zip.file(relsPath) ? await zip.file(relsPath)!.async("string") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"></Relationships>`;
    const ids = [...existing.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
    const rid = `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
    zip.file(relsPath, existing.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`));
    let sheetXml = await zip.file(file)!.async("string");
    if (!/xmlns:r=/.test(sheetXml.slice(0, 600))) sheetXml = sheetXml.replace("<worksheet ", `<worksheet xmlns:r="${R_NS}" `);
    const drawingEl = `<drawing r:id="${rid}"/>`;
    const before = sheetXml.search(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
    sheetXml = before >= 0 ? sheetXml.slice(0, before) + drawingEl + sheetXml.slice(before) : sheetXml.replace("</worksheet>", `${drawingEl}</worksheet>`);
    zip.file(file, sheetXml);
  }
  zip.file("[Content_Types].xml", contentTypes);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** worksheet name → part path (xl/worksheets/sheetN.xml) */
async function sheetFiles(zip: JSZip): Promise<Map<string, string>> {
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) target.set(m[1], m[2]);
  for (const m of rels.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g)) target.set(m[2], m[1]);
  const out = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0];
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    const rid = /r:id="([^"]*)"/.exec(tag)?.[1];
    const t = rid ? target.get(rid) : undefined;
    if (name && t) out.set(unesc(name), t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  return out;
}
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function addOverride(xml: string, part: string, type: string): string {
  if (xml.includes(`PartName="${part}"`)) return xml;
  return xml.replace("</Types>", `<Override PartName="${part}" ContentType="${type}"/></Types>`);
}

function anchorXml(c: XlsxChart, id: number, name: string, rid: string): string {
  const pos = (p: { col: number; row: number }) => `<xdr:col>${p.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
  return (
    `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${pos(c.from)}</xdr:from><xdr:to>${pos(c.to)}</xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${esc(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${C_NS}"><c:chart xmlns:c="${C_NS}" xmlns:r="${R_NS}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame>` +
    `<xdr:clientData/></xdr:twoCellAnchor>`
  );
}

const solid = (hex: string) => `<a:solidFill><a:srgbClr val="${hex.replace(/^#/, "").slice(-6)}"/></a:solidFill>`;
const SHADOW = `<a:effectLst><a:outerShdw blurRad="76200" dist="38100" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="0B1B33"><a:alpha val="38000"/></a:srgbClr></a:outerShdw></a:effectLst>`;

function shapeXml(sh: XlsxShape, id: number): string {
  const pos = (p: { col: number; row: number; colOff?: number; rowOff?: number }) => `<xdr:col>${p.col}</xdr:col><xdr:colOff>${p.colOff ?? 0}</xdr:colOff><xdr:row>${p.row}</xdr:row><xdr:rowOff>${p.rowOff ?? 0}</xdr:rowOff>`;
  const hex = (c: string) => c.replace(/^#/, "").slice(-6);
  const alpha = sh.alpha === undefined ? "" : `<a:alpha val="${Math.round(sh.alpha * 100000)}"/>`;
  const fill =
    sh.colors.length > 1
      ? `<a:gradFill rotWithShape="1"><a:gsLst>${sh.colors.map((c, i) => `<a:gs pos="${Math.round((i / (sh.colors.length - 1)) * 100000)}"><a:srgbClr val="${hex(c)}">${alpha}</a:srgbClr></a:gs>`).join("")}</a:gsLst><a:lin ang="${Math.round((sh.angle ?? 90) * 60000)}" scaled="0"/></a:gradFill>`
      : `<a:solidFill><a:srgbClr val="${hex(sh.colors[0])}">${alpha}</a:srgbClr></a:solidFill>`;
  const geom = sh.kind === "roundRect" ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round((sh.radius ?? 0.2) * 100000)}"/></a:avLst></a:prstGeom>` : `<a:prstGeom prst="${sh.kind}"><a:avLst/></a:prstGeom>`;
  const effects = [sh.glow ? `<a:glow rad="101600"><a:srgbClr val="${hex(sh.glow)}"><a:alpha val="40000"/></a:srgbClr></a:glow>` : "", sh.shadow ? `<a:outerShdw blurRad="76200" dist="38100" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="0B1B33"><a:alpha val="38000"/></a:srgbClr></a:outerShdw>` : ""].join("");
  const scene = sh.bevel ? `<a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d><a:sp3d prstMaterial="softEdge"><a:bevelT w="50800" h="25400"/></a:sp3d>` : "";
  const text = sh.text
    ? `<xdr:txBody><a:bodyPr vertOverflow="clip" wrap="square" lIns="45720" tIns="18288" rIns="45720" bIns="18288" rtlCol="0" anchor="ctr"/><a:lstStyle/>${sh.text
        .split("\n")
        .map((line, i) => `<a:p><a:pPr algn="${sh.align ?? "ctr"}"/><a:r><a:rPr lang="en-US" sz="${Math.round((i === 0 ? sh.fontSize ?? 11 : Math.max(8, (sh.fontSize ?? 11) * 0.7)) * 100)}" b="${sh.bold === false ? 0 : 1}"><a:solidFill><a:srgbClr val="${hex(sh.textColor ?? "FFFFFF")}"/></a:solidFill><a:latin typeface="${FONT}"/></a:rPr><a:t>${esc(line)}</a:t></a:r></a:p>`)
        .join("")}</xdr:txBody>`
    : `<xdr:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-US"/></a:p></xdr:txBody>`;
  return (
    `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${pos(sh.from)}</xdr:from><xdr:to>${pos(sh.to)}</xdr:to>` +
    `<xdr:sp${sh.macro ? ` macro="[0]!${esc(sh.macro)}"` : ""} textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${esc(sh.name)}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>${geom}${fill}<a:ln><a:noFill/></a:ln>${effects ? `<a:effectLst>${effects}</a:effectLst>` : ""}${scene}</xdr:spPr>${text}</xdr:sp>` +
    `<xdr:clientData/></xdr:twoCellAnchor>`
  );
}
const txt = (sz: number, color = "5B6577", bold = false) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz * 100}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
const DEFAULT_COLORS = ["2A78D6", "EB6834", "0E7C86", "C9A227", "7C5CBF", "2E9E5B", "D64545", "6B7280"];

function strRef(f: string, cache: string[]): string {
  return `<c:strRef><c:f>${esc(f)}</c:f><c:strCache><c:ptCount val="${cache.length}"/>${cache.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strCache></c:strRef>`;
}
function numRef(f: string, cache: number[], fmt: string): string {
  return `<c:numRef><c:f>${esc(f)}</c:f><c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${cache.length}"/>${cache.map((v, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(v) ? v : 0}</c:v></c:pt>`).join("")}</c:numCache></c:numRef>`;
}

function dLbls(c: XlsxChart, round: boolean): string {
  if (!c.showValues && !round) return "";
  const fmt = c.numFmt ?? "#,##0";
  return (
    `<c:dLbls><c:numFmt formatCode="${esc(round ? "0%" : fmt)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txt(8, round ? "FFFFFF" : "172033", round)}` +
    `${round ? "" : c.type === "stackedBar" ? `<c:dLblPos val="ctr"/>` : c.type === "line" ? `<c:dLblPos val="t"/>` : `<c:dLblPos val="outEnd"/>`}` +
    `<c:showLegendKey val="0"/><c:showVal val="${round ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${round ? 1 : 0}"/><c:showBubbleSize val="0"/></c:dLbls>`
  );
}

function seriesXml(c: XlsxChart, s: XlsxSeries, i: number, round: boolean): string {
  const fmt = c.numFmt ?? "#,##0";
  const color = s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];
  let sp = "";
  if (c.type === "line") sp = `<c:spPr><a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${solid(color)}<a:ln>${solid(color)}</a:ln></c:spPr></c:marker>`;
  else if (!round) sp = `<c:spPr>${solid(color)}<a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>`;
  else sp = `<c:spPr><a:ln w="19050">${solid("FFFFFF")}</a:ln></c:spPr>`;
  const pts = round ? s.cache.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr>${solid((c.pointColors ?? DEFAULT_COLORS)[k % (c.pointColors ?? DEFAULT_COLORS).length])}<a:ln w="19050">${solid("FFFFFF")}</a:ln></c:spPr></c:dPt>`).join("") : "";
  return (
    `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${esc(s.name)}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
    sp +
    pts +
    dLbls(c, round) +
    `<c:cat>${strRef(c.categories, c.catCache)}</c:cat><c:val>${numRef(s.values, s.cache, fmt)}</c:val>` +
    (c.type === "line" ? `<c:smooth val="0"/>` : "") +
    `</c:ser>`
  );
}

function chartXml(c: XlsxChart): string {
  const round = c.type === "doughnut" || c.type === "pie";
  const fmt = c.numFmt ?? "#,##0";
  const series = c.series.map((s, i) => seriesXml(c, s, i, round)).join("");
  let plot: string;
  if (c.type === "doughnut") plot = `<c:doughnutChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  else if (c.type === "pie") plot = `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`;
  else if (c.type === "line") plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>`;
  else {
    const stacked = c.type === "stackedBar";
    plot = `<c:barChart><c:barDir val="${c.type === "barH" ? "bar" : "col"}"/><c:grouping val="${stacked ? "stacked" : "clustered"}"/><c:varyColors val="0"/>${series}<c:gapWidth val="${stacked ? 60 : 80}"/>${stacked ? `<c:overlap val="100"/>` : ""}<c:axId val="10"/><c:axId val="20"/></c:barChart>`;
  }
  const horizontal = c.type === "barH";
  const axes = round
    ? ""
    : `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D9DEE8"/></a:solidFill></a:ln></c:spPr>${txt(8)}<c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
      `<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/><c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E5E9F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txt(8)}<c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const title = c.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"><a:solidFill><a:srgbClr val="0F2B4C"/></a:solidFill><a:latin typeface="${FONT}"/></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1100" b="1"><a:solidFill><a:srgbClr val="0F2B4C"/></a:solidFill><a:latin typeface="${FONT}"/></a:rPr><a:t>${esc(c.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : `<c:autoTitleDeleted val="1"/>`;
  const legend = (c.legend ?? (round || c.series.length > 1)) ? `<c:legend><c:legendPos val="${round ? "r" : "b"}"/><c:overlay val="0"/>${txt(9)}</c:legend>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}">` +
    `<c:roundedCorners val="1"/><c:chart>${title}<c:plotArea><c:layout/>${plot}${axes}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="EEF3FA"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9DEE8"/></a:solidFill></a:ln>${SHADOW}</c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr><a:latin typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>` +
    `</c:chartSpace>`
  );
}
