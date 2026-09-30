import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import { formatDate, formatMoney } from "../format";
import type { KpiItem } from "./model";
import { KPI_SECTIONS, KPI_SECTION_LABEL, type KpiDoc, type KpiSection } from "./store";

/**
 * The supporting-document pack for one KPI entry, as the head office asks for it: a cover with the
 * entry's details and a contents list, a divider for each part of the chronology (DVO, instruction,
 * PVO, RFC / CRF, correspondence) and the uploaded documents behind it, in one PDF named the way the
 * register expects.
 */

const A4: [number, number] = [595.28, 841.89];
const NAVY = rgb(0.12, 0.23, 0.41);
const GOLD = rgb(0.72, 0.58, 0.32);
const INK = rgb(0.13, 0.15, 0.2);
const MUTED = rgb(0.42, 0.46, 0.53);
const LINE = rgb(0.85, 0.87, 0.9);
const PALE = rgb(0.96, 0.97, 0.98);

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
  page.drawRectangle({ x: 0, y: h - 118, width: w, height: 118, color: NAVY });
  page.drawRectangle({ x: 0, y: h - 122, width: w, height: 4, color: GOLD });
  text(page, ctx, "AMAALA · Commercial KPI Reporting – F1 (Variation Orders)", 40, h - 40, 9, { color: rgb(0.8, 0.86, 0.95) });
  text(page, ctx, title, 40, h - 70, 22, { bold: true, color: rgb(1, 1, 1) });
  text(page, ctx, subtitle, 40, h - 92, 11, { color: rgb(0.85, 0.9, 0.97) });
  text(page, ctx, `${input.programme.name} (${input.programme.code}) · ${input.periodLabel}`, w - 40, h - 110, 9, { color: rgb(0.85, 0.9, 0.97), align: "right" });
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
  let y = text(page, ctx, it.description, 40, h - 150, 13, { bold: true, width: w - 80 }) - 6;
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
    text(page, ctx, k, 46, y, 9, { bold: true, color: NAVY });
    text(page, ctx, v, 40 + labelW, y, 10, { width: w - 80 - labelW - 10 });
    y -= rowH;
  }
  y -= 14;
  text(page, ctx, "Contents", 40, y, 12, { bold: true, color: NAVY });
  y -= 18;
  for (const c of contents) {
    page.drawRectangle({ x: 40, y: y - 4, width: w - 80, height: 16, color: NAVY });
    text(page, ctx, KPI_SECTION_LABEL[c.section], 46, y, 9.5, { bold: true, color: rgb(1, 1, 1) });
    text(page, ctx, `page ${c.page}`, w - 46, y, 9, { color: rgb(1, 1, 1), align: "right" });
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
  const letter = KPI_SECTION_LABEL[section].slice(0, 1);
  page.drawRectangle({ x: 0, y: 0, width: 26, height: h, color: NAVY });
  page.drawRectangle({ x: 26, y: 0, width: 3, height: h, color: GOLD });
  page.drawCircle({ x: w / 2, y: h / 2 + 60, size: 58, color: PALE, borderColor: NAVY, borderWidth: 1.2 });
  text(page, ctx, letter, w / 2, h / 2 + 40, 56, { bold: true, color: NAVY, align: "center" });
  text(page, ctx, KPI_SECTION_LABEL[section].replace(/^[A-E]\.\s*/, ""), w / 2, h / 2 - 30, 18, { bold: true, color: NAVY, align: "center", width: w - 120 });
  text(page, ctx, `${input.item.itemNo} · ${input.item.vendor}`, w / 2, h / 2 - 62, 11, { color: MUTED, align: "center" });
  let y = h / 2 - 100;
  page.drawLine({ start: { x: 120, y: y + 12 }, end: { x: w - 120, y: y + 12 }, thickness: 0.6, color: LINE });
  for (const d of docs) {
    const line = `${d.name}${d.note ? ` – ${d.note}` : d.pages ? ` (${d.pages} page${d.pages === 1 ? "" : "s"})` : ""}`;
    y = text(page, ctx, line, 120, y, 10, { width: w - 240, color: INK }) - 2;
    if (y < 60) break;
  }
  footer(page, ctx, input, KPI_SECTION_LABEL[section]);
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
  const loaded: { doc: KpiDoc; src: PDFDocument | null; image: { bytes: Buffer; mime: string } | null; pages: number; note?: string }[] = [];
  for (const { doc, bytes } of input.docs) {
    if (!bytes) {
      loaded.push({ doc, src: null, image: null, pages: 0, note: "file missing on the server" });
      continue;
    }
    // the file's own extension decides; the browser's mime type only when there is no extension
    const ext = (doc.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
    const isPdf = ext ? ext === "pdf" : /pdf/i.test(doc.mime);
    const isImg = ext ? ["png", "jpg", "jpeg"].includes(ext) : /image\/(png|jpe?g)/i.test(doc.mime);
    if (isPdf) {
      try {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        loaded.push({ doc, src, image: null, pages: src.getPageCount() });
      } catch (e) {
        loaded.push({ doc, src: null, image: null, pages: 0, note: `could not be read as a PDF (${e instanceof Error ? e.message.slice(0, 80) : "error"})` });
      }
    } else if (isImg) loaded.push({ doc, src: null, image: { bytes, mime: doc.mime }, pages: 1 });
    else loaded.push({ doc, src: null, image: null, pages: 0, note: "only PDF, JPG and PNG files go into the pack" });
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
        const pages = await pdf.copyPages(l.src, l.src.getPageIndices());
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
  if (!contents.length) noticePage(ctx, input, "No supporting documents uploaded yet", "Upload the DVO, the instruction, the PVO and the RFC / CRF on the KPI Report page, then create the pack again.");
  coverPage(ctx, input, contents, pageNo - 1);
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

export function packFileName(base: string): string {
  const cleanName = clean(base).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "KPI_pack";
  return `${cleanName}.pdf`;
}
