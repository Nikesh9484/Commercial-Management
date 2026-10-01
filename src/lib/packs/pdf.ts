import PDFDocument from "pdfkit";
import { PDFDocument as PdfLib, PDFFont, PDFPage, StandardFonts, degrees, rgb, type RGB } from "pdf-lib";
import { convertToPdf, convertible, isJpeg, isPng } from "./convert";
import { positioned } from "./extract";
import type { PosPage } from "./positioned";
import { parsePages } from "../kpi/pages";
import { formattedValues } from "./word";
import { packRefLabel, type PackType, type PackValues } from "./shared";

/**
 * The PDF outputs of a document pack: the form itself, drawn from the pack's values in the RSG
 * layout (label / value sections, narrative, signature block), and the compiled pack – the form,
 * the index of annexures, then a divider and the files of every annexure – in one PDF.
 */

const GRAPHITE = "#33383F";
const BRONZE = "#A8845C";
const INK = "#26292E";
const MUTED = "#6B6F75";
const LINE = "#D6D6D3";
const PALE = "#F2F2F0";
const A4W = 595.28;
const A4H = 841.89;
const M = 42;

export interface FormMeta {
  programme: { code: string; name: string };
  ref: string;
  title: string;
  revision: string;
  status: string;
  preparedBy: string;
  generatedAt: string;
}

/** The form as a PDF, page by page, with the footer written once the page count is known. */
export async function renderFormPdf(type: PackType, values: PackValues, meta: FormMeta): Promise<Buffer> {
  const shown = formattedValues(type, values);
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: `${packRefLabel(type.short, meta.ref)} – ${meta.title}`, Author: meta.preparedBy } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const width = A4W - M * 2;
  const header = () => {
    doc.rect(0, 0, A4W, 64).fill(GRAPHITE);
    doc.rect(M, 58, 40, 2.5).fill(BRONZE);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(15).text(type.label, M, 18, { width: width - 200 });
    doc.fillColor("#C9CBCE").font("Helvetica").fontSize(8).text(`${type.formRef}  ·  Internal : Confidential`, M + width - 200, 22, { width: 200, align: "right" });
    doc.fillColor("#C9CBCE").fontSize(8).text(`${meta.programme.name} (${meta.programme.code})${shown.project_name ? `  ·  ${shown.project_name}` : ""}`, M + width - 300, 36, { width: 300, align: "right" });
    doc.y = 84;
  };
  const ensure = (h: number) => {
    if (doc.y + h > A4H - 60) {
      doc.addPage();
      header();
    }
  };
  header();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(`${packRefLabel(type.short, meta.ref)}${meta.revision ? ` · Rev. ${meta.revision}` : ""}`, M, doc.y, { width });
  doc.fillColor(BRONZE).font("Helvetica").fontSize(10.5).text(meta.title || "", M, doc.y + 2, { width });
  doc.moveDown(0.6);
  const labelW = Math.round(width * 0.21);
  const valueW = Math.round(width / 2) - labelW;
  const cell = (x: number, y: number, w: number, h: number, text: string, opts: { bold?: boolean; shade?: string; size?: number; color?: string }) => {
    if (opts.shade) doc.rect(x, y, w, h).fill(opts.shade);
    doc.rect(x, y, w, h).lineWidth(0.5).stroke(LINE);
    doc.fillColor(opts.color ?? INK).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 8.5).text(text, x + 5, y + 4, { width: w - 10, height: h - 6, ellipsis: false });
  };
  const rowHeight = (texts: { text: string; w: number; size?: number }[]) => Math.max(18, ...texts.map((t) => doc.font("Helvetica").fontSize(t.size ?? 8.5).heightOfString(t.text || " ", { width: t.w - 10 }) + 8));
  for (const group of type.groups) {
    const fields = type.fields.filter((f) => f.group === group);
    if (!fields.length) continue;
    ensure(40);
    doc.rect(M, doc.y, width, 16).fill(GRAPHITE);
    doc.rect(M, doc.y, 4, 16).fill(BRONZE);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8.5).text(group.toUpperCase(), M + 10, doc.y + 4, { width: width - 20 });
    doc.y += 16;
    if (group === "Signatures") {
      const cols = [labelW, valueW, labelW, valueW];
      const heads = ["", "Name", "Position", "Signature / date"];
      let x = M;
      const y0 = doc.y;
      heads.forEach((h, i) => {
        cell(x, y0, cols[i], 16, h, { bold: true, shade: PALE });
        x += cols[i];
      });
      doc.y = y0 + 16;
      for (const [who, name, pos] of [["Prepared by", shown.prepared_by, shown.prepared_position], ["Checked by", shown.checked_by, shown.checked_position], ["Approved by", shown.approved_by, shown.approved_position]]) {
        ensure(30);
        const y = doc.y;
        let xx = M;
        [who, name, pos, ""].forEach((t, i) => {
          cell(xx, y, cols[i], 28, t || "", { bold: i === 0, shade: i === 0 ? PALE : undefined });
          xx += cols[i];
        });
        doc.y = y + 28;
      }
      doc.y += 8;
      continue;
    }
    const short = fields.filter((f) => f.kind !== "long");
    const longs = fields.filter((f) => f.kind === "long");
    for (let i = 0; i < short.length; i += 2) {
      const a = short[i];
      const b = short[i + 1];
      const va = shown[a.key] || "";
      const vb = b ? shown[b.key] || "" : "";
      const h = rowHeight([{ text: a.label, w: labelW }, { text: va, w: b ? valueW : width - labelW }, { text: b?.label ?? "", w: labelW }, { text: vb, w: valueW }]);
      ensure(h);
      const y = doc.y;
      cell(M, y, labelW, h, a.label, { bold: true, shade: PALE });
      cell(M + labelW, y, b ? valueW : width - labelW, h, va, {});
      if (b) {
        cell(M + labelW + valueW, y, labelW, h, b.label, { bold: true, shade: PALE });
        cell(M + labelW * 2 + valueW, y, valueW, h, vb, {});
      }
      doc.y = y + h;
    }
    for (const f of longs) {
      const text = shown[f.key] || "";
      const h = Math.max(42, doc.font("Helvetica").fontSize(9).heightOfString(text || " ", { width: width - 10 }) + 10);
      ensure(16 + Math.min(h, 400));
      cell(M, doc.y, width, 16, f.label, { bold: true, shade: PALE });
      doc.y += 16;
      // a long narrative may run over the page: draw it as a bordered block per page
      const y = doc.y;
      if (h <= A4H - 60 - y) {
        cell(M, y, width, h, text, { size: 9 });
        doc.y = y + h;
      } else {
        doc.rect(M, y, width, A4H - 60 - y).lineWidth(0.5).stroke(LINE);
        doc.fillColor(INK).font("Helvetica").fontSize(9).text(text, M + 5, y + 4, { width: width - 10 });
        doc.y += 4;
      }
    }
    doc.y += 8;
  }
  ensure(24);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`This ${type.short} is issued in accordance with the terms and conditions of the Contract. Terms defined in the Contract have the same meaning here unless otherwise defined.`, M, doc.y + 4, { width });
  doc.end();
  return done;
}

/* ------------------------------------------------------------------ */
/* the compiled pack                                                   */

/**
 * The compiled pack follows the approved RSG packs page for page: the form pages, the index of
 * annexures, then for every annexure its divider page and its documents. The index and the
 * dividers are the very pages of the approved pack set as the template (or uploaded on the pack),
 * copied and re-ticked or re-titled where this pack differs; without one they are drawn in the
 * same layout. There is no cover page – the approved packs have none.
 */

const A4: [number, number] = [A4W, A4H];
const LETTER: [number, number] = [612, 792];
const RSG_NAVY = rgb(0.043, 0.133, 0.224);
const INK_RGB = rgb(0.13, 0.13, 0.13);
const MUTED_RGB = rgb(0.45, 0.47, 0.5);
const LINE_RGB = rgb(0.75, 0.75, 0.75);
const RED = rgb(0.75, 0.05, 0.05);
const WHITE = rgb(1, 1, 1);

export interface PartItem {
  name: string;
  bytes: Buffer | null;
  /** pages to take from a PDF ("1-3, 5"); blank = all */
  pages?: string;
  mime?: string;
  note?: string;
}

export interface PackPart {
  no: number;
  label: string;
  hint: string;
  /** "annexure" prints ANNEXURE n dividers as the RSG packs do; "part" the numbered parts */
  style: "annexure" | "part";
  items: PartItem[];
  /** a line printed in red under the divider's title – Annexure 2 names the approved instruction behind the change */
  note?: string;
  /** bound straight after the pages before it, with no divider – the EVO pack is one run of documents */
  plain?: boolean;
}

export interface CompiledInput {
  type: PackType;
  values: PackValues;
  meta: FormMeta;
  fileName: string;
  /** the pages that open the pack, in order: the form itself */
  front: { name: string; bytes: Buffer }[];
  parts: PackPart[];
  /** the index of annexures after the form pages, headed with this title ("PROPOSED VARIATION ORDER (PVO)") */
  index?: { title: string } | null;
  /** the approved packs whose index and divider pages may be reused – the first that holds them is */
  references?: Buffer[];
}

function clean(text: string): string {
  return String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[‐-―]/g, "-")
    .replace(/[^\x20-\x7E -ÿ‘’“”…€]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}
function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = clean(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > width) t = t.slice(0, -1);
  return t + "…";
}
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = clean(text).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      let piece = w;
      while (font.widthOfTextAtSize(piece, size) > width && piece.length > 1) {
        let i = piece.length - 1;
        while (i > 1 && font.widthOfTextAtSize(piece.slice(0, i), size) > width) i--;
        lines.push(piece.slice(0, i));
        piece = piece.slice(i);
      }
      cur = piece;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
interface Ctx {
  pdf: PdfLib;
  font: PDFFont;
  bold: PDFFont;
  serifBold: PDFFont;
}
function text(page: PDFPage, ctx: Ctx, t: string, x: number, y: number, size: number, opts: { bold?: boolean; font?: PDFFont; color?: RGB; width?: number; align?: "left" | "right" | "center" } = {}): number {
  const font = opts.font ?? (opts.bold ? ctx.bold : ctx.font);
  const lines = opts.width ? wrap(t, font, size, opts.width) : [clean(t)];
  let yy = y;
  for (const line of lines) {
    const w = font.widthOfTextAtSize(line, size);
    const xx = opts.align === "right" ? x - w : opts.align === "center" ? x - w / 2 : x;
    page.drawText(line, { x: xx, y: yy, size, font, color: opts.color ?? INK_RGB });
    yy -= size * 1.35;
  }
  return yy;
}
const norm = (s: string) => clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const annexureLabel = (p: { no: number; style: "annexure" | "part" }) => (p.style === "annexure" ? `ANNEXURE ${p.no}` : `PART ${p.no}`);

function classification(page: PDFPage, ctx: Ctx) {
  const { width } = page.getSize();
  text(page, ctx, "CLASSIFICATION: INTERNAL SENSITIVE", width - 22, 16, 5.5, { color: INK_RGB, align: "right" });
}

/** a tick box as the index of annexures shows it: an empty square, or one with a tick */
function tickBox(page: PDFPage, x: number, y: number, on: boolean) {
  const s = 7.5;
  page.drawRectangle({ x, y, width: s, height: s, borderColor: rgb(0.35, 0.35, 0.35), borderWidth: 0.6, color: WHITE });
  if (on) {
    page.drawLine({ start: { x: x + 1.6, y: y + 3.6 }, end: { x: x + 3.1, y: y + 1.7 }, thickness: 0.9, color: INK_RGB });
    page.drawLine({ start: { x: x + 3.1, y: y + 1.7 }, end: { x: x + 6.2, y: y + 6.2 }, thickness: 0.9, color: INK_RGB });
  }
}

/* ---- the pages of the approved pack that are reused ---------------- */

interface RefPages {
  src: PdfLib;
  pos: PosPage[];
  /** the page number of the index of annexures */
  index: number | null;
  /** annexure / part number → divider page number */
  dividers: Map<number, number>;
}

async function referencePages(bytes: Buffer | null | undefined): Promise<RefPages | null> {
  if (!bytes) return null;
  try {
    const src = await PdfLib.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const pos = await positioned(bytes);
    let index: number | null = null;
    const dividers = new Map<number, number>();
    for (const pg of pos) {
      const cells = pg.rows.flatMap((r) => r.cells.map((c) => c.s.trim()));
      if (index === null && cells.some((s) => /^INDEX OF ANNEXURES$/i.test(s))) index = pg.no;
      const body = cells.filter((s) => !/^CLASSIFICATION/i.test(s));
      const band = body.find((s) => /^(ANNEXURE|PART)\s*\d+$/i.test(s));
      if (band && body.length <= 12 && !cells.some((s) => /INDEX OF/i.test(s))) {
        const n = Number(band.match(/\d+/)![0]);
        if (!dividers.has(n)) dividers.set(n, pg.no);
      }
    }
    if (index === null && !dividers.size) return null;
    return { src, pos, index, dividers };
  } catch (e) {
    console.error("reference pack could not be read for its index and dividers:", e);
    return null;
  }
}

/* ---- the index of annexures --------------------------------------- */

interface IndexRow {
  no: number;
  label: string;
  style: "annexure" | "part";
  attached: boolean;
}

/** The approved pack's own index page: the rows re-ticked, re-worded where this pack differs, extra rows added. */
async function copiedIndexPage(ctx: Ctx, ref: RefPages, rows: IndexRow[]): Promise<boolean> {
  if (ref.index === null) return false;
  const pg = ref.pos.find((p) => p.no === ref.index)!;
  const [page] = await ctx.pdf.copyPages(ref.src, [ref.index - 1]);
  ctx.pdf.addPage(page);
  const { width } = page.getSize();
  const found = pg.rows
    .map((r) => {
      const head = r.cells.find((c) => /^(ANNEXURE|PART)\s*\d+$/i.test(c.s.trim()));
      if (!head) return null;
      const boxes = r.cells.filter((c) => /[☑☐☒✓✔]/.test(c.s)).map((c) => c.x);
      const desc = r.cells.filter((c) => c !== head && !/[☑☐☒✓✔]/.test(c.s));
      return { no: Number(head.s.match(/\d+/)![0]), y: r.y, x: head.x, boxes, descX: desc[0]?.x ?? head.x + 78, descEnd: Math.max(...desc.map((c) => c.x + c.w), head.x + 78), size: head.h || 7.5 };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => b.y - a.y);
  if (!found.length) return false;
  const boxX = found.find((r) => r.boxes.length >= 2)?.boxes ?? [width * 0.76, width * 0.89];
  const [onX, offX] = [Math.min(...boxX), Math.max(...boxX)];
  const step = found.length > 1 ? Math.abs(found[0].y - found[1].y) : 20;
  const tick = (y: number, attached: boolean) => {
    page.drawRectangle({ x: onX - 18, y: y - 4, width: 34, height: 14, color: WHITE });
    page.drawRectangle({ x: offX - 10, y: y - 4, width: 30, height: 14, color: WHITE });
    tickBox(page, onX - 9, y - 0.5, attached);
    tickBox(page, offX, y - 0.5, !attached);
  };
  const descWidth = found[0].descEnd - found[0].descX;
  const leftEdge = found[0].x - 4;
  const rightEdge = offX + 28;
  let lastY = found[found.length - 1].y;
  for (const r of rows) {
    const hit = found.find((f) => f.no === r.no);
    if (hit) {
      tick(hit.y, r.attached);
      const refDesc = pg.rows.find((x) => x.y === hit.y)?.cells.filter((c) => c.x >= hit.descX - 1 && !/[☑☐☒✓✔]/.test(c.s)).map((c) => c.s).join(" ") ?? "";
      if (norm(refDesc) !== norm(r.label) && norm(refDesc).replace(/\s*-\s*/g, " ") !== norm(r.label).replace(/\s*-\s*/g, " ")) {
        page.drawRectangle({ x: hit.descX - 2, y: hit.y - 5, width: onX - 12 - hit.descX, height: 14, color: WHITE });
        text(page, ctx, fit(r.label.toUpperCase(), ctx.bold, hit.size, onX - 16 - hit.descX), hit.descX, hit.y, hit.size, { bold: true, color: INK_RGB });
      }
    } else {
      // a row the approved pack does not have: drawn under the last one, in the same geometry
      const y = lastY - step;
      page.drawRectangle({ x: leftEdge, y: y - 6, width: rightEdge - leftEdge, height: step, borderColor: RSG_NAVY, borderWidth: 0.6, color: WHITE });
      page.drawLine({ start: { x: found[0].descX - 4, y: y - 6 }, end: { x: found[0].descX - 4, y: y - 6 + step }, thickness: 0.6, color: RSG_NAVY });
      page.drawLine({ start: { x: onX - 35, y: y - 6 }, end: { x: onX - 35, y: y - 6 + step }, thickness: 0.6, color: RSG_NAVY });
      page.drawLine({ start: { x: offX - 35, y: y - 6 }, end: { x: offX - 35, y: y - 6 + step }, thickness: 0.6, color: RSG_NAVY });
      text(page, ctx, annexureLabel(r), found[0].x, y, found[0].size, { bold: true });
      text(page, ctx, fit(r.label.toUpperCase(), ctx.bold, found[0].size, Math.max(descWidth, onX - 16 - found[0].descX)), found[0].descX, y, found[0].size, { bold: true });
      tick(y, r.attached);
      lastY = y;
    }
  }
  return true;
}

/** The index of annexures drawn in the RSG layout, for a pack without an approved pack to copy from. */
function drawnIndexPage(ctx: Ctx, title: string, rows: IndexRow[]) {
  const page = ctx.pdf.addPage(LETTER);
  const [w, h] = LETTER;
  const x0 = 23;
  const x1 = w - 21;
  let y = h - 233;
  page.drawRectangle({ x: x0, y: y - 31, width: x1 - x0, height: 31, color: RSG_NAVY });
  text(page, ctx, title, w / 2, y - 21, 13, { bold: true, color: WHITE, align: "center" });
  y -= 31;
  page.drawRectangle({ x: x0, y: y - 23, width: x1 - x0, height: 23, borderColor: RSG_NAVY, borderWidth: 0.8, color: WHITE });
  text(page, ctx, "INDEX OF ANNEXURES", w / 2, y - 16, 10.5, { bold: true, color: INK_RGB, align: "center" });
  y -= 23;
  const cols = [x0, 101, 431, 511, x1];
  page.drawRectangle({ x: x0, y: y - 62, width: x1 - x0, height: 62, color: RSG_NAVY });
  text(page, ctx, "SECTION", (cols[0] + cols[1]) / 2, y - 34, 6.5, { bold: true, color: WHITE, align: "center" });
  text(page, ctx, "DESCRIPTION", (cols[1] + cols[2]) / 2, y - 34, 6.5, { bold: true, color: WHITE, align: "center" });
  page.drawText("ATTACHED", { x: (cols[2] + cols[3]) / 2 + 3, y: y - 48, size: 6.5, font: ctx.bold, color: WHITE, rotate: degrees(90) });
  page.drawText("NOT", { x: (cols[3] + cols[4]) / 2 - 4, y: y - 40, size: 6.5, font: ctx.bold, color: WHITE, rotate: degrees(90) });
  page.drawText("APPLICABLE", { x: (cols[3] + cols[4]) / 2 + 5, y: y - 52, size: 6.5, font: ctx.bold, color: WHITE, rotate: degrees(90) });
  for (let i = 1; i < cols.length - 1; i++) page.drawLine({ start: { x: cols[i], y: y - 62 }, end: { x: cols[i], y }, thickness: 0.6, color: WHITE });
  y -= 62;
  for (const r of rows) {
    const rh = 20;
    page.drawRectangle({ x: x0, y: y - rh, width: x1 - x0, height: rh, borderColor: RSG_NAVY, borderWidth: 0.6, color: WHITE });
    for (let i = 1; i < cols.length - 1; i++) page.drawLine({ start: { x: cols[i], y: y - rh }, end: { x: cols[i], y }, thickness: 0.6, color: RSG_NAVY });
    text(page, ctx, annexureLabel(r), cols[0] + 4, y - 13, 7.5, { bold: true });
    text(page, ctx, fit(r.label.toUpperCase(), ctx.bold, 7.5, cols[2] - cols[1] - 8), cols[1] + 4, y - 13, 7.5, { bold: true });
    tickBox(page, (cols[2] + cols[3]) / 2 - 4, y - 14, r.attached);
    tickBox(page, (cols[3] + cols[4]) / 2 - 4, y - 14, !r.attached);
    y -= rh;
    if (y < 60) break;
  }
  classification(page, ctx);
}

/* ---- the divider pages -------------------------------------------- */

/** The approved pack's own divider page for this annexure (or any of its dividers, re-numbered), re-titled where this pack differs. */
async function copiedDividerPage(ctx: Ctx, ref: RefPages, part: PackPart): Promise<boolean> {
  const own = ref.dividers.get(part.no);
  const pageNo = own ?? [...ref.dividers.values()][0];
  if (!pageNo) return false;
  const pg = ref.pos.find((p) => p.no === pageNo)!;
  const [page] = await ctx.pdf.copyPages(ref.src, [pageNo - 1]);
  ctx.pdf.addPage(page);
  const { width } = page.getSize();
  const bandRow = pg.rows.find((r) => r.cells.some((c) => /^(ANNEXURE|PART)\s*\d+$/i.test(c.s.trim())));
  if (!bandRow) return true;
  const band = bandRow.cells.find((c) => /^(ANNEXURE|PART)\s*\d+$/i.test(c.s.trim()))!;
  const titleRow = pg.rows.filter((r) => r.y < bandRow.y && r.y > bandRow.y - 40 && r.cells.some((c) => !/^CLASSIFICATION/i.test(c.s))).sort((a, b) => b.y - a.y)[0];
  const size = band.h || 8.5;
  if (!own || norm(band.s) !== norm(annexureLabel(part))) {
    page.drawRectangle({ x: 25, y: bandRow.y - 4, width: width - 50, height: size + 7, color: RSG_NAVY });
    text(page, ctx, annexureLabel(part).replace(" ", "  "), width / 2, bandRow.y, size, { bold: true, color: WHITE, align: "center" });
  }
  const refTitle = titleRow ? titleRow.cells.map((c) => c.s).join(" ") : "";
  const titleY = titleRow ? titleRow.y : bandRow.y - 17;
  if (norm(refTitle) !== norm(part.label)) {
    page.drawRectangle({ x: 26, y: titleY - 5, width: width - 52, height: size + 9, color: WHITE });
    text(page, ctx, fit(part.label.toUpperCase(), ctx.bold, size, width - 70), width / 2, titleY, size, { bold: true, color: INK_RGB, align: "center" });
  }
  // the red line under the title (the approved instruction behind the change): always this pack's own
  const noteRows = pg.rows.filter((r) => r.y < titleY - 8 && r.y > titleY - 60 && r.cells.some((c) => !/^CLASSIFICATION/i.test(c.s)));
  for (const r of noteRows) page.drawRectangle({ x: 30, y: r.y - 5, width: width - 60, height: (r.cells[0]?.h || 10) + 8, color: WHITE });
  if (part.note) {
    const y = noteRows.length ? noteRows[0].y : titleY - 32;
    text(page, ctx, fit(part.note, ctx.serifBold, 10, width - 80), width / 2, y, 10, { font: ctx.serifBold, color: RED, align: "center" });
  }
  return true;
}

/** A divider drawn in the RSG layout: the navy band with the annexure number, the title row, the red note. */
function drawnDividerPage(ctx: Ctx, part: PackPart) {
  const page = ctx.pdf.addPage(LETTER);
  const [w, h] = LETTER;
  const top = h - 333;
  page.drawRectangle({ x: 23, y: top - 16, width: w - 44, height: 16, color: RSG_NAVY });
  text(page, ctx, annexureLabel(part).replace(" ", "  "), w / 2, top - 11.5, 8.5, { bold: true, color: WHITE, align: "center" });
  page.drawRectangle({ x: 23, y: top - 37, width: w - 44, height: 21, borderColor: RSG_NAVY, borderWidth: 0.8, color: WHITE });
  text(page, ctx, fit(part.label.toUpperCase(), ctx.bold, 8.5, w - 70), w / 2, top - 29, 8.5, { bold: true, color: INK_RGB, align: "center" });
  if (part.note) text(page, ctx, fit(part.note, ctx.serifBold, 10, w - 80), w / 2, top - 65, 10, { font: ctx.serifBold, color: RED, align: "center" });
  classification(page, ctx);
}

/* ---- the documents ------------------------------------------------ */

function noticePage(ctx: Ctx, name: string, why: string) {
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  text(page, ctx, name, 48, h - 90, 11, { bold: true, color: INK_RGB, width: w - 96 });
  text(page, ctx, why, 48, h - 112, 9.5, { color: MUTED_RGB, width: w - 96 });
  page.drawLine({ start: { x: 48, y: h - 124 }, end: { x: w - 48, y: h - 124 }, thickness: 0.5, color: LINE_RGB });
}

async function addImage(ctx: Ctx, bytes: Buffer, png: boolean): Promise<number> {
  const img = png ? await ctx.pdf.embedPng(bytes) : await ctx.pdf.embedJpg(bytes);
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  const k = Math.min((w - 60) / img.width, (h - 80) / img.height, 1.5);
  page.drawImage(img, { x: (w - img.width * k) / 2, y: (h - img.height * k) / 2, width: img.width * k, height: img.height * k });
  return 1;
}

interface Loaded {
  item: PartItem;
  src: PdfLib | null;
  image: { bytes: Buffer; png: boolean } | null;
  pages: number;
  take: number[];
  note?: string;
}

async function loadPdf(item: PartItem, bytes: Buffer, note?: string): Promise<Loaded> {
  try {
    const src = await PdfLib.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const take = parsePages(item.pages, src.getPageCount());
    return { item, src, image: null, pages: take.length, take, note: note ?? (take.length < src.getPageCount() ? `pages ${item.pages || "all"} of ${src.getPageCount()}` : undefined) };
  } catch (e) {
    return { item, src: null, image: null, pages: 0, take: [], note: `could not be read as a PDF (${e instanceof Error ? e.message.slice(0, 80) : "error"})` };
  }
}

/** Every file goes into the pack: PDFs as they are, images on a page, mails and Office files converted to pages. */
async function load(item: PartItem): Promise<Loaded> {
  if (!item.bytes) return { item, src: null, image: null, pages: 0, take: [], note: item.note ?? "file missing on the server" };
  const mime = item.mime ?? "";
  const ext = (item.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const isPdf = ext ? ext === "pdf" : /pdf/i.test(mime) || item.bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  if (isPdf) return loadPdf(item, item.bytes, item.note);
  if (isPng(item.name, mime)) return { item, src: null, image: { bytes: item.bytes, png: true }, pages: 1, take: [1], note: item.note };
  if (isJpeg(item.name, mime)) return { item, src: null, image: { bytes: item.bytes, png: false }, pages: 1, take: [1], note: item.note };
  if (convertible(item.name)) {
    try {
      const conv = await convertToPdf(item.bytes, item.name);
      if (conv) return loadPdf({ ...item, pages: "" }, conv.pdf, `${conv.kind} shown as pages`);
    } catch (e) {
      console.error("file conversion failed:", item.name, e);
    }
  }
  return { item, src: null, image: null, pages: 0, take: [], note: `this ${ext ? `.${ext} ` : ""}file cannot be shown as pages – it is kept with the pack and listed here` };
}

async function place(ctx: Ctx, l: Loaded): Promise<number> {
  if (l.src) {
    const pages = await ctx.pdf.copyPages(l.src, l.take.map((n) => n - 1));
    for (const p of pages) ctx.pdf.addPage(p);
    return pages.length;
  }
  if (l.image) {
    try {
      return await addImage(ctx, l.image.bytes, l.image.png);
    } catch {
      noticePage(ctx, l.item.name, "The image could not be read.");
      l.note = "image could not be read";
      return 1;
    }
  }
  noticePage(ctx, l.item.name, l.note ?? "Not included.");
  return 1;
}

/** The form pages, the index of annexures, then a divider and the files of every part – as the approved packs are bound. */
export async function buildCompiledPack(input: CompiledInput): Promise<Buffer> {
  const pdf = await PdfLib.create();
  pdf.setTitle(input.fileName);
  pdf.setAuthor(input.meta.preparedBy);
  pdf.setSubject(`${input.type.label} – ${input.meta.ref}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const ctx: Ctx = { pdf, font, bold, serifBold };
  let pages = 0;
  for (const f of input.front) {
    try {
      const src = await PdfLib.load(f.bytes, { ignoreEncryption: true, updateMetadata: false });
      const copied = await pdf.copyPages(src, src.getPageIndices());
      for (const p of copied) pdf.addPage(p);
      pages += copied.length;
    } catch (e) {
      console.error("front pages could not be read:", f.name, e);
    }
  }
  let ref: RefPages | null = null;
  for (const b of input.references ?? []) if (!(ref = await referencePages(b))) continue; else break;
  const parts = input.parts;
  if (input.index) {
    const rows: IndexRow[] = parts.map((p) => ({ no: p.no, label: p.label, style: p.style, attached: p.items.length > 0 }));
    if (!(ref && (await copiedIndexPage(ctx, ref, rows)))) drawnIndexPage(ctx, input.index.title, rows);
    pages++;
  }
  for (const part of parts) {
    if (!part.items.length) continue;
    const loaded: Loaded[] = [];
    for (const it of part.items) loaded.push(await load(it));
    if (!part.plain) {
      if (!(ref && (await copiedDividerPage(ctx, ref, part)))) drawnDividerPage(ctx, part);
      pages++;
    }
    for (const l of loaded) pages += await place(ctx, l);
  }
  if (!pages) noticePage(ctx, "Nothing to compile yet", "Upload the documents of the pack into their entries, then create the pack again.");
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

export function safeFileName(base: string, ext: string): string {
  const cleanName = clean(base).replace(/[–—]/g, "-").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "document_pack";
  return `${cleanName}.${ext}`;
}
