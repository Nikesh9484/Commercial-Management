import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import type { KpiItem } from "./model";
import { KPI_SECTIONS, KPI_SECTION_LABEL, type KpiDoc, type KpiSection } from "./store";
import { KPI_SECTION_NO } from "./shared";
import { parsePages } from "./pages";

/**
 * The supporting-document pack for one KPI entry, as the head office asks for it: a cover with the
 * entry's details and a contents list, a divider for each part of the chronology (DVO, instruction,
 * PVO, RFC / CRF, correspondence) and the uploaded documents behind it, in one PDF named the way the
 * register expects.
 */

const A4: [number, number] = [595.28, 841.89];
// graphite and warm grey with a bronze accent – no blue, so the pack reads as a document, not a dashboard
const NAVY = rgb(0.2, 0.22, 0.25); // graphite
const GOLD = rgb(0.66, 0.52, 0.36); // bronze
const INK = rgb(0.16, 0.17, 0.19);
const MUTED = rgb(0.45, 0.47, 0.5);
const WHITE = rgb(1, 1, 1);

export interface PackInput {
  item: KpiItem;
  sn: string;
  fileName: string;
  rootCause: string;
  programme: { code: string; name: string };
  periodLabel: string;
  docs: { doc: KpiDoc; bytes: Buffer | null }[];
  generatedAt: string;
  by: string;
}

/** Characters the standard fonts cannot draw are replaced, so a stray Arabic or symbol never stops the pack. */
function clean(text: string): string {
  return String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E -ÿ–—‘’“”…€]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

/** One line at most: cut with an ellipsis when it would run past the width. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = clean(text).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      // a single word longer than the line is cut
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
  pdf: PDFDocument;
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
    page.drawText(line, { x: xx, y: yy, size, font, color: opts.color ?? INK });
    yy -= size * 1.35;
  }
  return yy;
}

function dividerPage(ctx: Ctx, section: KpiSection) {
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  // a graphite spine with the part number and the title across the page – nothing else
  page.drawRectangle({ x: 0, y: 0, width: 34, height: h, color: NAVY });
  page.drawRectangle({ x: 34, y: 0, width: 2.5, height: h, color: GOLD });
  page.drawCircle({ x: 112, y: h / 2 + 70, size: 46, color: NAVY });
  page.drawCircle({ x: 112, y: h / 2 + 70, size: 41, color: NAVY, borderColor: GOLD, borderWidth: 1.2 });
  text(page, ctx, String(KPI_SECTION_NO[section]), 112, h / 2 + 54, 44, { bold: true, color: WHITE, align: "center" });
  text(page, ctx, "PART", 112, h / 2 + 108, 8, { color: rgb(0.78, 0.78, 0.76), align: "center" });
  text(page, ctx, KPI_SECTION_LABEL[section], 190, h / 2 + 84, 22, { bold: true, color: NAVY, width: w - 230 });
  page.drawRectangle({ x: 190, y: h / 2 + 40, width: 60, height: 2, color: GOLD });
}

function noticePage(ctx: Ctx, input: PackInput, name: string, why: string) {
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  text(page, ctx, name, 40, h - 80, 12, { bold: true, color: NAVY, width: w - 80 });
  text(page, ctx, why, 40, h - 104, 10, { color: MUTED, width: w - 80 });
}

async function addImage(ctx: Ctx, bytes: Buffer, mime: string, name: string): Promise<number> {
  const isPng = /\.png$/i.test(name) || (!/\.jpe?g$/i.test(name) && /png/i.test(mime));
  const img = isPng ? await ctx.pdf.embedPng(bytes) : await ctx.pdf.embedJpg(bytes);
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  const maxW = w - 60;
  const maxH = h - 80;
  const k = Math.min(maxW / img.width, maxH / img.height, 1.5);
  const dw = img.width * k;
  const dh = img.height * k;
  page.drawImage(img, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
  return 1;
}

export async function buildKpiPack(input: PackInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.fileName}`);
  pdf.setAuthor(input.by);
  pdf.setSubject(`KPI F1 supporting documents – ${input.item.itemNo}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = { pdf, font, bold };
  // every document is opened first, so the cover can say where each one starts
  const loaded: { doc: KpiDoc; src: PDFDocument | null; image: { bytes: Buffer; mime: string } | null; pages: number; take: number[]; note?: string }[] = [];
  for (const { doc, bytes } of input.docs) {
    if (!bytes) {
      loaded.push({ doc, src: null, image: null, pages: 0, take: [], note: "file missing on the server" });
      continue;
    }
    // the file's own extension decides; the browser's mime type only when there is no extension
    const ext = (doc.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
    const isPdf = ext ? ext === "pdf" : /pdf/i.test(doc.mime);
    const isImg = ext ? ["png", "jpg", "jpeg"].includes(ext) : /image\/(png|jpe?g)/i.test(doc.mime);
    if (isPdf) {
      try {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        // only the key pages go in – the selection made when the file was read, or the one typed on the page
        const take = parsePages(doc.pages, src.getPageCount());
        loaded.push({ doc, src, image: null, pages: take.length, take, note: take.length < src.getPageCount() ? `pages ${doc.pages || "all"} of ${src.getPageCount()}` : undefined });
      } catch (e) {
        loaded.push({ doc, src: null, image: null, pages: 0, take: [], note: `could not be read as a PDF (${e instanceof Error ? e.message.slice(0, 80) : "error"})` });
      }
    } else if (isImg) loaded.push({ doc, src: null, image: { bytes, mime: doc.mime }, pages: 1, take: [1] });
    else loaded.push({ doc, src: null, image: null, pages: 0, take: [], note: "only PDF, JPG and PNG files go into the pack" });
  }
  const contents: { section: KpiSection; docs: { name: string; page: number; pages: number; note?: string }[]; page: number }[] = [];
  let pageNo = 1;
  for (const section of KPI_SECTIONS) {
    const inSection = loaded.filter((l) => l.doc.section === section);
    if (!inSection.length) continue;
    const entry: (typeof contents)[number] = { section, docs: [], page: pageNo };
    dividerPage(ctx, section);
    pageNo++;
    for (const l of inSection) {
      const start = pageNo;
      if (l.src) {
        const pages = await pdf.copyPages(l.src, l.take.map((n) => n - 1));
        for (const p of pages) pdf.addPage(p);
        pageNo += pages.length;
      } else if (l.image) {
        try {
          pageNo += await addImage(ctx, l.image.bytes, l.image.mime, l.doc.name);
        } catch {
          noticePage(ctx, input, l.doc.name, "The image could not be read.");
          l.note = "image could not be read";
          pageNo++;
        }
      } else {
        noticePage(ctx, input, l.doc.name, l.note ?? "Not included.");
        pageNo++;
      }
      entry.docs.push({ name: l.doc.name, page: start, pages: l.pages, note: l.note });
    }
    contents.push(entry);
  }
  if (!contents.length) noticePage(ctx, input, "No supporting documents uploaded yet", "Upload the Aconex approvals, the DVO / PVO / VO front pages and the VO-issued reference on the KPI Report page, then create the pack again.");
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

export function packFileName(base: string): string {
  const cleanName = clean(base).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "KPI_pack";
  return `${cleanName}.pdf`;
}
