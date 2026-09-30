import PDFDocument from "pdfkit";
import { PDFDocument as PdfLib, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import { formatDate } from "../format";
import { parsePages } from "../kpi/pages";
import { formattedValues } from "./word";
import { packRefLabel, type PackType, type PackValues } from "./shared";

/**
 * The PDF outputs of a document pack: the form itself, drawn from the pack's values in the RSG
 * layout (label / value sections, narrative, signature block), and the compiled pack – a cover,
 * the form, then a divider and the uploaded files for every slot – in one PDF.
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
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(M, A4H - 40).lineTo(A4W - M, A4H - 40).lineWidth(0.6).stroke(LINE);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(`${packRefLabel(type.short, meta.ref)}${meta.revision ? ` Rev. ${meta.revision}` : ""} · ${meta.status} · prepared ${formatDate(meta.generatedAt)} by ${meta.preparedBy} · Commercial Dashboard`, M, A4H - 32, { width: width - 80, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, M + width - 80, A4H - 32, { width: 80, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}

/* ------------------------------------------------------------------ */
/* the compiled pack                                                   */

const A4: [number, number] = [A4W, A4H];
const NAVY = rgb(0.2, 0.22, 0.25);
const GOLD = rgb(0.66, 0.52, 0.36);
const INK_RGB = rgb(0.16, 0.17, 0.19);
const MUTED_RGB = rgb(0.45, 0.47, 0.5);
const LINE_RGB = rgb(0.84, 0.84, 0.83);
const PALE_RGB = rgb(0.95, 0.95, 0.94);
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
}

export interface CompiledInput {
  type: PackType;
  values: PackValues;
  meta: FormMeta;
  fileName: string;
  /** the pages that open the pack, in order: the form itself, the index of annexures */
  front: { name: string; bytes: Buffer }[];
  parts: PackPart[];
}

function clean(text: string): string {
  return String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E -ÿ–—‘’“”…€]/g, "?")
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
}
function text(page: PDFPage, ctx: Ctx, t: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: RGB; width?: number; align?: "left" | "right" | "center" } = {}): number {
  const font = opts.bold ? ctx.bold : ctx.font;
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
function footer(page: PDFPage, ctx: Ctx, input: CompiledInput, label: string) {
  const [w] = A4;
  page.drawLine({ start: { x: 40, y: 34 }, end: { x: w - 40, y: 34 }, thickness: 0.6, color: LINE_RGB });
  const right = `Prepared ${formatDate(input.meta.generatedAt)} by ${input.meta.preparedBy} · Commercial Dashboard`;
  const rightW = ctx.font.widthOfTextAtSize(clean(right), 8);
  text(page, ctx, fit(`${input.fileName} · ${label}`, ctx.font, 8, w - 80 - rightW - 16), 40, 22, 8, { color: MUTED_RGB });
  text(page, ctx, right, w - 40, 22, 8, { color: MUTED_RGB, align: "right" });
}

interface Entry {
  no: number;
  label: string;
  style: "annexure" | "part" | "front";
  docs: { name: string; page: number; pages: number; note?: string }[];
  page: number;
}

const partTitle = (e: { no: number; label: string; style: "annexure" | "part" | "front" }) => (e.style === "annexure" ? `Annexure ${e.no} – ${e.label}` : e.style === "part" ? `Part ${e.no} – ${e.label}` : e.label);

function coverPage(ctx: Ctx, input: CompiledInput, contents: Entry[], totalPages: number) {
  const page = ctx.pdf.insertPage(0, A4);
  const [w, h] = A4;
  const shown = formattedValues(input.type, input.values);
  page.drawRectangle({ x: 0, y: h - 150, width: w, height: 150, color: NAVY });
  page.drawRectangle({ x: 40, y: h - 118, width: 46, height: 2.5, color: GOLD });
  text(page, ctx, "AMAALA  ·  COMMERCIAL  ·  DOCUMENT PACK", 40, h - 44, 8.5, { color: rgb(0.78, 0.78, 0.76) });
  text(page, ctx, fit(input.type.label, ctx.bold, 22, w - 80), 40, h - 80, 22, { bold: true, color: WHITE });
  text(page, ctx, `${packRefLabel(input.type.short, input.meta.ref)}${input.meta.revision ? ` · Rev. ${input.meta.revision}` : ""} · ${input.meta.status}`, 40, h - 104, 11, { color: rgb(0.85, 0.85, 0.83) });
  text(page, ctx, `${input.meta.programme.name} (${input.meta.programme.code})${shown.project_name ? `  ·  ${shown.project_name}` : ""}`, 40, h - 136, 9.5, { color: rgb(0.85, 0.85, 0.83) });
  let y = text(page, ctx, input.meta.title || input.type.label, 40, h - 180, 13, { bold: true, width: w - 80 }) - 6;
  const rows: [string, string][] = [
    ["Contract", [shown.contract_no, shown.contract_title].filter(Boolean).join(" · ") || "–"],
    ["Contractor / Consultant", shown.contractor || "–"],
    ["Works package", shown.works_package || "–"],
    ["Reference", packRefLabel(input.type.short, input.meta.ref)],
    ["Date", shown.date || formatDate(input.meta.generatedAt)],
  ];
  for (const k of ["total_value", "vo_value", "dvo_value", "rom_estimate", "amount", "amount_claimed", "amount_assessed", "days_claimed", "days_assessed", "stage1_price", "stage2_price"]) {
    const f = input.type.fields.find((x) => x.key === k);
    if (f && shown[k]) rows.push([f.label, shown[k]]);
  }
  const labelW = 150;
  for (const [k, v] of rows) {
    const lines = wrap(v, ctx.font, 10, w - 80 - labelW - 10);
    const rowH = Math.max(1, lines.length) * 13.5 + 6;
    page.drawRectangle({ x: 40, y: y - rowH + 10, width: w - 80, height: rowH, color: PALE_RGB, borderColor: LINE_RGB, borderWidth: 0.5 });
    page.drawRectangle({ x: 40, y: y - rowH + 10, width: 2, height: rowH, color: GOLD });
    text(page, ctx, k, 48, y, 9, { bold: true, color: NAVY });
    text(page, ctx, v, 40 + labelW, y, 10, { width: w - 80 - labelW - 10 });
    y -= rowH;
  }
  y -= 14;
  text(page, ctx, "Contents", 40, y, 12, { bold: true, color: NAVY });
  y -= 18;
  for (const c of contents) {
    page.drawRectangle({ x: 40, y: y - 4, width: w - 80, height: 16, color: NAVY });
    page.drawRectangle({ x: 40, y: y - 4, width: 22, height: 16, color: GOLD });
    text(page, ctx, c.style === "front" ? "•" : String(c.no), 51, y, 9.5, { bold: true, color: WHITE, align: "center" });
    text(page, ctx, fit(partTitle(c), ctx.bold, 9.5, w - 180), 68, y, 9.5, { bold: true, color: WHITE });
    text(page, ctx, `page ${c.page}`, w - 46, y, 9, { color: WHITE, align: "right" });
    y -= 20;
    for (const d of c.docs) {
      const line = `${d.name}${d.note ? ` – ${d.note}` : ""}`;
      text(page, ctx, line, 52, y, 9, { width: w - 170 });
      text(page, ctx, d.pages ? `p. ${d.page}${d.pages > 1 ? `–${d.page + d.pages - 1}` : ""}` : "not included", w - 46, y, 9, { color: MUTED_RGB, align: "right" });
      y -= 13.5 * wrap(line, ctx.font, 9, w - 170).length;
      if (y < 60) break;
    }
    y -= 4;
    if (y < 60) break;
  }
  text(page, ctx, `${totalPages} pages in all`, w - 46, Math.max(y, 48), 8, { color: MUTED_RGB, align: "right" });
  footer(page, ctx, input, "Cover");
}

function dividerPage(ctx: Ctx, input: CompiledInput, part: PackPart, docs: { name: string; pages: number; note?: string }[]) {
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  page.drawRectangle({ x: 0, y: 0, width: 34, height: h, color: NAVY });
  page.drawRectangle({ x: 34, y: 0, width: 2.5, height: h, color: GOLD });
  page.drawRectangle({ x: 0, y: h - 150, width: w, height: 150, color: PALE_RGB });
  page.drawRectangle({ x: 0, y: h - 150, width: w, height: 0.8, color: LINE_RGB });
  text(page, ctx, input.type.label.toUpperCase(), 70, h - 52, 8.5, { color: MUTED_RGB });
  text(page, ctx, fit(`${packRefLabel(input.type.short, input.meta.ref)}  ·  ${input.meta.title}`, ctx.font, 9.5, w - 260), 70, h - 68, 9.5, { color: MUTED_RGB });
  text(page, ctx, `${input.meta.programme.code}  ·  ${formatDate(input.meta.generatedAt)}`, w - 40, h - 52, 8.5, { color: MUTED_RGB, align: "right" });
  page.drawCircle({ x: 112, y: h / 2 + 70, size: 46, color: NAVY });
  page.drawCircle({ x: 112, y: h / 2 + 70, size: 41, color: NAVY, borderColor: GOLD, borderWidth: 1.2 });
  text(page, ctx, String(part.no), 112, h / 2 + 54, 44, { bold: true, color: WHITE, align: "center" });
  text(page, ctx, part.style === "annexure" ? "ANNEXURE" : "PART", 112, h / 2 + 108, 8, { color: rgb(0.78, 0.78, 0.76), align: "center" });
  text(page, ctx, part.style === "annexure" ? part.label.toUpperCase() : part.label, 190, h / 2 + 84, part.style === "annexure" ? 17 : 22, { bold: true, color: NAVY, width: w - 230 });
  text(page, ctx, part.hint, 190, h / 2 + 46, 10.5, { color: MUTED_RGB, width: w - 230 });
  page.drawRectangle({ x: 190, y: h / 2 + 30, width: 60, height: 2, color: GOLD });
  let y = h / 2 + 8;
  text(page, ctx, docs.length === 1 ? "Document in this part" : `${docs.length} documents in this part`, 190, y, 9, { bold: true, color: NAVY });
  y -= 16;
  for (const d of docs) {
    const line = `${d.name}${d.note ? ` – ${d.note}` : d.pages ? ` (${d.pages} page${d.pages === 1 ? "" : "s"})` : ""}`;
    page.drawCircle({ x: 194, y: y + 3.5, size: 1.8, color: GOLD });
    y = text(page, ctx, line, 202, y, 10, { width: w - 242, color: INK_RGB }) - 2;
    if (y < 60) break;
  }
  text(page, ctx, "#CLASSIFICATION: INTERNAL SENSITIVE", w / 2 + 17, 52, 8, { color: MUTED_RGB, align: "center" });
  footer(page, ctx, input, partTitle(part));
}

function noticePage(ctx: Ctx, input: CompiledInput, name: string, why: string) {
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  text(page, ctx, name, 40, h - 80, 12, { bold: true, color: NAVY, width: w - 80 });
  text(page, ctx, why, 40, h - 104, 10, { color: MUTED_RGB, width: w - 80 });
  footer(page, ctx, input, "Not included");
}

async function addImage(ctx: Ctx, bytes: Buffer, mime: string, name: string): Promise<number> {
  const isPng = /\.png$/i.test(name) || (!/\.jpe?g$/i.test(name) && /png/i.test(mime));
  const img = isPng ? await ctx.pdf.embedPng(bytes) : await ctx.pdf.embedJpg(bytes);
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  const k = Math.min((w - 60) / img.width, (h - 80) / img.height, 1.5);
  page.drawImage(img, { x: (w - img.width * k) / 2, y: (h - img.height * k) / 2, width: img.width * k, height: img.height * k });
  return 1;
}

interface Loaded {
  item: PartItem;
  src: PdfLib | null;
  image: { bytes: Buffer; mime: string } | null;
  pages: number;
  take: number[];
  note?: string;
}

async function load(item: PartItem): Promise<Loaded> {
  if (!item.bytes) return { item, src: null, image: null, pages: 0, take: [], note: item.note ?? "file missing on the server" };
  const ext = (item.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const mime = item.mime ?? "";
  const isPdf = ext ? ext === "pdf" : /pdf/i.test(mime);
  const isImg = ext ? ["png", "jpg", "jpeg"].includes(ext) : /image\/(png|jpe?g)/i.test(mime);
  if (isPdf) {
    try {
      const src = await PdfLib.load(item.bytes, { ignoreEncryption: true, updateMetadata: false });
      const take = parsePages(item.pages, src.getPageCount());
      return { item, src, image: null, pages: take.length, take, note: take.length < src.getPageCount() ? `pages ${item.pages || "all"} of ${src.getPageCount()}` : undefined };
    } catch (e) {
      return { item, src: null, image: null, pages: 0, take: [], note: `could not be read as a PDF (${e instanceof Error ? e.message.slice(0, 80) : "error"})` };
    }
  }
  if (isImg) return { item, src: null, image: { bytes: item.bytes, mime }, pages: 1, take: [1] };
  return { item, src: null, image: null, pages: 0, take: [], note: "only PDF, JPG and PNG files go into the pack – Word and Excel files are listed for reference" };
}

async function place(ctx: Ctx, input: CompiledInput, l: Loaded): Promise<number> {
  if (l.src) {
    const pages = await ctx.pdf.copyPages(l.src, l.take.map((n) => n - 1));
    for (const p of pages) ctx.pdf.addPage(p);
    return pages.length;
  }
  if (l.image) {
    try {
      return await addImage(ctx, l.image.bytes, l.image.mime, l.item.name);
    } catch {
      noticePage(ctx, input, l.item.name, "The image could not be read.");
      l.note = "image could not be read";
      return 1;
    }
  }
  noticePage(ctx, input, l.item.name, l.note ?? "Not included.");
  return 1;
}

/** Cover, the front pages (the form, the index), then a divider and the files of every part. */
export async function buildCompiledPack(input: CompiledInput): Promise<Buffer> {
  const pdf = await PdfLib.create();
  pdf.setTitle(input.fileName);
  pdf.setAuthor(input.meta.preparedBy);
  pdf.setSubject(`${input.type.label} – ${input.meta.ref}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { pdf, font, bold };
  const contents: Entry[] = [];
  let pageNo = 2;
  for (const f of input.front) {
    try {
      const src = await PdfLib.load(f.bytes, { ignoreEncryption: true, updateMetadata: false });
      const n = src.getPageCount();
      const pages = await pdf.copyPages(src, src.getPageIndices());
      for (const p of pages) pdf.addPage(p);
      contents.push({ no: 0, label: f.name, style: "front", docs: [{ name: f.name, page: pageNo, pages: n }], page: pageNo });
      pageNo += n;
    } catch {
      /* a front page that could not be read is left out */
    }
  }
  for (const part of input.parts) {
    if (!part.items.length) continue;
    const loaded: Loaded[] = [];
    for (const it of part.items) loaded.push(await load(it));
    const entry: Entry = { no: part.no, label: part.label, style: part.style, docs: [], page: pageNo };
    dividerPage(ctx, input, part, loaded.map((l) => ({ name: l.item.name, pages: l.pages, note: l.note })));
    pageNo++;
    for (const l of loaded) {
      const start = pageNo;
      pageNo += await place(ctx, input, l);
      entry.docs.push({ name: l.item.name, page: start, pages: l.pages, note: l.note });
    }
    contents.push(entry);
  }
  if (!contents.length) noticePage(ctx, input, "Nothing to compile yet", "Fill the form and upload the supporting documents into the numbered slots, then create the pack again.");
  coverPage(ctx, input, contents, pageNo - 1);
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

export function safeFileName(base: string, ext: string): string {
  const cleanName = clean(base).replace(/[–—]/g, "-").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "document_pack";
  return `${cleanName}.${ext}`;
}
