import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import { formatDate, formatMoney } from "../format";
import type { KpiItem } from "./model";
import { KPI_SECTIONS, KPI_SECTION_LABEL, type KpiDoc, type KpiSection } from "./store";
import { KPI_SECTION_HINT, KPI_SECTION_NO } from "./shared";
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
const LINE = rgb(0.84, 0.84, 0.83);
const PALE = rgb(0.95, 0.95, 0.94);
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

function band(page: PDFPage, ctx: Ctx, input: PackInput, title: string, subtitle: string) {
  const [w, h] = A4;
  page.drawRectangle({ x: 0, y: h - 150, width: w, height: 150, color: NAVY });
  page.drawRectangle({ x: 40, y: h - 118, width: 46, height: 2.5, color: GOLD });
  text(page, ctx, "AMAALA  ·  COMMERCIAL KPI REPORTING  ·  F1 VARIATION ORDERS", 40, h - 44, 8.5, { color: rgb(0.78, 0.78, 0.76) });
  text(page, ctx, title, 40, h - 80, 24, { bold: true, color: WHITE });
  text(page, ctx, subtitle, 40, h - 104, 11, { color: rgb(0.85, 0.85, 0.83) });
  text(page, ctx, `${input.programme.name} (${input.programme.code})  ·  ${input.periodLabel}`, 40, h - 136, 9.5, { color: rgb(0.85, 0.85, 0.83) });
}

function footer(page: PDFPage, ctx: Ctx, input: PackInput, label: string) {
  const [w] = A4;
  page.drawLine({ start: { x: 40, y: 34 }, end: { x: w - 40, y: 34 }, thickness: 0.6, color: LINE });
  const right = `Prepared ${formatDate(input.generatedAt)} by ${input.by} · Commercial Dashboard`;
  const rightW = ctx.font.widthOfTextAtSize(clean(right), 8);
  text(page, ctx, fit(`${input.fileName} · ${label}`, ctx.font, 8, w - 80 - rightW - 16), 40, 22, 8, { color: MUTED });
  text(page, ctx, right, w - 40, 22, 8, { color: MUTED, align: "right" });
}

function coverPage(ctx: Ctx, input: PackInput, contents: { section: KpiSection; docs: { name: string; page: number; pages: number; note?: string }[]; page: number }[], totalPages: number) {
  const page = ctx.pdf.insertPage(0, A4);
  const [w, h] = A4;
  const it = input.item;
  band(page, ctx, input, it.category === "closed" ? "Closed KPI – DVO approved" : "Open KPI – DVO in progress", "Supporting documents for the Open VO Register entry");
  let y = text(page, ctx, it.description, 40, h - 180, 13, { bold: true, width: w - 80 }) - 6;
  const rows: [string, string][] = [
    ["Head office S/N", input.sn || "New entry – S/N to be assigned"],
    ["Dashboard item", it.itemNo],
    ["Program / project", `${it.program} · ${it.projectName} · ${it.assetCode}`],
    ["Contract / REEF PO", `${it.accContractRef || "–"}${it.reefPo ? ` · PO ${it.reefPo}` : ""}`],
    ["Vendor", `${it.vendor}${it.vendorType ? ` (${it.vendorType})` : ""}`],
    ["Instruction (CI / EI / VO)", `${it.instructionRef || "–"}${it.instructionDate ? ` · ${formatDate(it.instructionDate)}` : ""}`],
    ["PVO", `${it.pvoRef ? `${it.pvoRef} · ` : ""}${it.pvoValue !== null ? `SAR ${formatMoney(it.pvoValue)}` : "–"}`],
    ["DVO", it.category === "closed" ? `${it.dvoRef || "–"} · approved ${it.dvoDate ? formatDate(it.dvoDate) : "–"} · AVV ${it.avvValue !== null ? `SAR ${formatMoney(it.avvValue)}` : "–"}` : `${it.dvoRef ? `${it.dvoRef} – ` : ""}in progress`],
    ["KPI status", it.category === "closed" ? `APPROVED · ${it.daysToClose !== null ? `${it.daysToClose} calendar days from instruction to DVO` : "days to close not available"}${it.f1 !== null ? ` · F1 ${it.f1 ? "met" : "not met"} (90-day norm)` : ""}` : `PENDING · deadline ${it.deadline ? formatDate(it.deadline) : "–"} · ${it.remainingDays === null ? "" : it.remainingDays < 0 ? `${-it.remainingDays} days over the 90-day norm` : `${it.remainingDays} days remaining`}`],
    ["Movement this report", it.movementNote || "–"],
  ];
  if (input.rootCause) rows.push(["Root cause (over 90 days)", input.rootCause]);
  const labelW = 150;
  for (const [k, v] of rows) {
    const lines = wrap(v, ctx.font, 10, w - 80 - labelW - 10);
    const rowH = Math.max(1, lines.length) * 13.5 + 6;
    page.drawRectangle({ x: 40, y: y - rowH + 10, width: w - 80, height: rowH, color: PALE, borderColor: LINE, borderWidth: 0.5 });
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
    text(page, ctx, String(KPI_SECTION_NO[c.section]), 51, y, 9.5, { bold: true, color: WHITE, align: "center" });
    text(page, ctx, KPI_SECTION_LABEL[c.section], 68, y, 9.5, { bold: true, color: WHITE });
    text(page, ctx, `page ${c.page}`, w - 46, y, 9, { color: WHITE, align: "right" });
    y -= 20;
    for (const d of c.docs) {
      const line = `${d.name}${d.note ? ` – ${d.note}` : ""}`;
      text(page, ctx, line, 52, y, 9, { width: w - 170 });
      text(page, ctx, d.pages ? `p. ${d.page}${d.pages > 1 ? `–${d.page + d.pages - 1}` : ""}` : "not included", w - 46, y, 9, { color: MUTED, align: "right" });
      y -= 13.5 * wrap(line, ctx.font, 9, w - 170).length;
      if (y < 60) break;
    }
    y -= 4;
    if (y < 60) break;
  }
  text(page, ctx, `${totalPages} pages in all`, w - 46, Math.max(y, 48), 8, { color: MUTED, align: "right" });
  footer(page, ctx, input, "Cover");
}

function dividerPage(ctx: Ctx, input: PackInput, section: KpiSection, docs: { name: string; pages: number; note?: string }[]) {
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  // a graphite spine with the part number, the title across the page, a bronze rule and the files behind it
  page.drawRectangle({ x: 0, y: 0, width: 34, height: h, color: NAVY });
  page.drawRectangle({ x: 34, y: 0, width: 2.5, height: h, color: GOLD });
  page.drawRectangle({ x: 0, y: h - 150, width: w, height: 150, color: PALE });
  page.drawRectangle({ x: 0, y: h - 150, width: w, height: 0.8, color: LINE });
  text(page, ctx, "SUPPORTING DOCUMENTS", 70, h - 52, 8.5, { color: MUTED });
  text(page, ctx, `${input.item.itemNo}  ·  ${input.item.vendor}`, 70, h - 68, 9.5, { color: MUTED });
  text(page, ctx, `${input.item.category === "closed" ? "Closed KPI" : "Open KPI"}  ·  ${input.periodLabel}`, w - 40, h - 52, 8.5, { color: MUTED, align: "right" });
  page.drawCircle({ x: 112, y: h / 2 + 70, size: 46, color: NAVY });
  page.drawCircle({ x: 112, y: h / 2 + 70, size: 41, color: NAVY, borderColor: GOLD, borderWidth: 1.2 });
  text(page, ctx, String(KPI_SECTION_NO[section]), 112, h / 2 + 54, 44, { bold: true, color: WHITE, align: "center" });
  text(page, ctx, "PART", 112, h / 2 + 108, 8, { color: rgb(0.78, 0.78, 0.76), align: "center" });
  text(page, ctx, KPI_SECTION_LABEL[section], 190, h / 2 + 84, 22, { bold: true, color: NAVY, width: w - 230 });
  text(page, ctx, KPI_SECTION_HINT[section], 190, h / 2 + 56, 10.5, { color: MUTED, width: w - 230 });
  page.drawRectangle({ x: 190, y: h / 2 + 40, width: 60, height: 2, color: GOLD });
  let y = h / 2 + 18;
  text(page, ctx, docs.length === 1 ? "Document in this part" : `${docs.length} documents in this part`, 190, y, 9, { bold: true, color: NAVY });
  y -= 16;
  for (const d of docs) {
    const line = `${d.name}${d.note ? ` – ${d.note}` : d.pages ? ` (${d.pages} page${d.pages === 1 ? "" : "s"})` : ""}`;
    page.drawCircle({ x: 194, y: y + 3.5, size: 1.8, color: GOLD });
    y = text(page, ctx, line, 202, y, 10, { width: w - 242, color: INK }) - 2;
    if (y < 60) break;
  }
  footer(page, ctx, input, `Part ${KPI_SECTION_NO[section]} – ${KPI_SECTION_LABEL[section]}`);
}

function noticePage(ctx: Ctx, input: PackInput, name: string, why: string) {
  const page = ctx.pdf.addPage(A4);
  const [w, h] = A4;
  text(page, ctx, name, 40, h - 80, 12, { bold: true, color: NAVY, width: w - 80 });
  text(page, ctx, why, 40, h - 104, 10, { color: MUTED, width: w - 80 });
  footer(page, ctx, input, "Not included");
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
  let pageNo = 2; // the cover is page 1
  for (const section of KPI_SECTIONS) {
    const inSection = loaded.filter((l) => l.doc.section === section);
    if (!inSection.length) continue;
    const entry: (typeof contents)[number] = { section, docs: [], page: pageNo };
    dividerPage(ctx, input, section, inSection.map((l) => ({ name: l.doc.name, pages: l.pages, note: l.note })));
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
  coverPage(ctx, input, contents, pageNo - 1);
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

export function packFileName(base: string): string {
  const cleanName = clean(base).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "KPI_pack";
  return `${cleanName}.pdf`;
}
