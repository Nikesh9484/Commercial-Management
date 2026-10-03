/**
 * The document written onto the approved form itself.
 *
 * The last approved PVO / DVO / RFA that the user uploads as the template is not just read for its
 * values: its form pages are copied as they are (grid, wording, logos, shading) and this pack's
 * values are written where the old ones were. Every old value is painted over in the colour of the
 * cell it sits in, then the new value is written at the same place, in the same size, aligned the
 * way the old one was. Signatures, stamps and sign tags of the earlier document are cleared, because
 * this document goes out for its own signatures.
 */
import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, StandardFonts, decodePDFRawStream, rgb, type PDFContext, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { formatDate, formatMoney } from "../format";
import { voDescription } from "./annexures";
import { isLabel, readFills, readPositioned, type Cell, type Fill, type PosPage, type Row } from "./positioned";
import type { PackValues } from "./shared";

const clean = (s: string) =>
  String(s ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\t]/g, " ")
    .replace(/\r/g, "")
    // list bullets of any shape stay bullets (the standard fonts carry U+2022)
    .replace(/[\u2022\u25CF\u25AA\u2023\u2043\u25E6\u2219]/g, "\u2022")
    .replace(/[^\x20-\x7E\u00A1-\u00FF\u2022\n]/g, "")
    .replace(/ +/g, " ")
    .trim();
const num = (v: unknown) => {
  const s = String(v ?? "").trim();
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
};
/** money the way the forms print it: 1,234.56 / (1,234.56) / "-" for nothing */
const mny = (v: unknown, dashZero = true) => {
  const n = num(v);
  if (!n && dashZero) return "-";
  return n < 0 ? `(${formatMoney(-n)})` : formatMoney(n);
};
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(2)}%` : "-");
const dmy = (v: unknown) => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return formatDate(s) || s;
};
const addDays = (iso: string, days: number) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isNumeric = (s: string) => /^\(?-?[\d,]+(\.\d+)?\)?%?$|^-$/.test(s.trim());
const isDateLike = (s: string) => /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(s.trim());
/** dark enough for white text (the gold bands of the forms carry white headings) */
const DARK = 0.66;
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/* ------------------------------------------------------------------ */
/* the faces the forms are set in: the same families, embedded from the bundled font files, so a
   rewritten value is in the font of the value it replaces                                        */

type Family = "notosans" | "opensans" | "arial";
const FONT_FILES: Record<Family, { r: string; b: string; i: string; bi: string }> = {
  notosans: { r: "NotoSans-Regular.ttf", b: "NotoSans-Bold.ttf", i: "NotoSans-Italic.ttf", bi: "NotoSans-BoldItalic.ttf" },
  opensans: { r: "OpenSans-Regular.ttf", b: "OpenSans-Bold.ttf", i: "OpenSans-Italic.ttf", bi: "OpenSans-Bold.ttf" },
  arial: { r: "LiberationSans-Regular.ttf", b: "LiberationSans-Bold.ttf", i: "LiberationSans-Italic.ttf", bi: "LiberationSans-BoldItalic.ttf" },
};
/** the bundled family that stands for a face named in the PDF */
export function familyOf(face: string | undefined): Family {
  const f = (face ?? "").toLowerCase();
  if (/open ?sans/.test(f)) return "opensans";
  if (/arial|helvetica|liberation|calibri|carlito|segoe|cambria|times|minion|playfair/.test(f)) return "arial";
  return "notosans";
}

class FontSet {
  private cache = new Map<string, PDFFont>();
  constructor(
    private pdf: PDFDocument,
    private plain: PDFFont,
    private plainBold: PDFFont,
  ) {}
  /** every face the pages use is embedded up front (embedding is the one async step) */
  async prepare(pages: PosPage[]) {
    const wanted = new Set<string>();
    for (const p of pages) for (const r of p.rows) for (const c of r.cells) wanted.add(`${familyOf(c.f)}:${c.b ? "b" : ""}${c.i ? "i" : ""}`);
    // bold and regular of each family are always wanted: a value may be written bold where the old one was not
    for (const k of [...wanted]) {
      const fam = k.split(":")[0];
      wanted.add(`${fam}:`);
      wanted.add(`${fam}:b`);
    }
    for (const key of wanted) {
      if (this.cache.has(key)) continue;
      const [fam, style] = key.split(":") as [Family, string];
      const file = FONT_FILES[fam][(style || "r") as "r" | "b" | "i" | "bi"];
      try {
        const bytes = fs.readFileSync(path.join(process.cwd(), "public", "fonts", file));
        this.cache.set(key, await this.pdf.embedFont(bytes, { subset: true }));
      } catch {
        this.cache.set(key, style.includes("b") ? this.plainBold : this.plain);
      }
    }
  }
  get(face: string | undefined, bold: boolean, italic: boolean): PDFFont {
    const key = `${familyOf(face)}:${bold ? "b" : ""}${italic ? "i" : ""}`;
    return this.cache.get(key) ?? this.cache.get(`${familyOf(face)}:${bold ? "b" : ""}`) ?? (bold ? this.plainBold : this.plain);
  }
}

/** One copied form page with the tools to rewrite its cells. */
/** a 1×1 fully transparent PNG: what a removed picture is swapped for, so the page draws nothing there */
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

interface Picture {
  name: PDFName;
  /** the XObject dictionary the name is looked up in (the page's, or a form's) */
  xobjects: PDFDict;
  x: number;
  y: number;
  w: number;
  h: number;
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];

/** the operators of a content stream with their operands: enough of the syntax to follow q, Q, cm and Do */
function* operators(src: string): Generator<{ op: string; args: (string | number)[] }> {
  let args: (string | number)[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "%") {
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
      continue;
    }
    if (ch === "/") {
      let j = i + 1;
      while (j < n && !/[\s/[\]()<>{}%]/.test(src[j])) j++;
      args.push(src.slice(i, j));
      i = j;
      continue;
    }
    if (ch === "(") {
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (src[j] === "\\") {
          j++;
          continue;
        }
        if (src[j] === "(") depth++;
        else if (src[j] === ")" && --depth === 0) break;
      }
      i = j + 1;
      args.push("()");
      continue;
    }
    if (ch === "<") {
      if (src[i + 1] === "<") {
        let depth = 0;
        let j = i;
        for (; j < n - 1; j++) {
          if (src[j] === "<" && src[j + 1] === "<") {
            depth++;
            j++;
          } else if (src[j] === ">" && src[j + 1] === ">" && --depth === 0) break;
        }
        i = j + 2;
        args.push("<<>>");
      } else {
        const j = src.indexOf(">", i);
        i = j < 0 ? n : j + 1;
        args.push("<>");
      }
      continue;
    }
    if (ch === "[" || ch === "]" || ch === "{" || ch === "}") {
      i++;
      continue;
    }
    if (/[-+.\d]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[-+.\deE]/.test(src[j])) j++;
      args.push(Number(src.slice(i, j)) || 0);
      i = j;
      continue;
    }
    let j = i;
    while (j < n && /[A-Za-z'"*]/.test(src[j])) j++;
    const op = src.slice(i, j) || ch;
    i = j > i ? j : i + 1;
    if (op === "BI") {
      // an inline image runs to EI
      const e = src.indexOf("EI", i);
      i = e < 0 ? n : e + 2;
      args = [];
      continue;
    }
    yield { op, args };
    args = [];
  }
}

/**
 * The text of the earlier document's own content streams. The stream this overlay is writing to is
 * left alone: reading it would fix its bytes as they are now, and nothing drawn after would be saved.
 */
function streamText(ctx: PDFContext, obj: unknown): string {
  if (obj instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1");
  if (obj instanceof PDFArray) return obj.asArray().map((r) => streamText(ctx, ctx.lookup(r))).join("\n");
  return "";
}

/** every picture drawn on the page (through nested forms too) with where it lands, in page points */
function picturesOn(ctx: PDFContext, page: PDFPage): Picture[] {
  const out: Picture[] = [];
  const walk = (content: string, resources: PDFDict | undefined, base: Matrix, depth: number) => {
    const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const stack: Matrix[] = [];
    let ctm = base;
    for (const { op, args } of operators(content)) {
      if (op === "q") stack.push(ctm);
      else if (op === "Q") ctm = stack.pop() ?? ctm;
      else if (op === "cm" && args.length >= 6) ctm = mul(args.slice(-6).map(Number) as Matrix, ctm);
      else if (op === "Do" && typeof args[args.length - 1] === "string" && xobjects) {
        const name = PDFName.of(String(args[args.length - 1]).slice(1));
        const xo = xobjects.lookupMaybe(name, PDFStream);
        if (!xo) continue;
        const sub = xo.dict.lookupMaybe(PDFName.of("Subtype"), PDFName);
        if (sub === PDFName.of("Form") && depth < 4) {
          const m = xo.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray);
          const fm = m && m.size() === 6 ? (m.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) as Matrix) : ([1, 0, 0, 1, 0, 0] as Matrix);
          walk(streamText(ctx, xo), xo.dict.lookupMaybe(PDFName.of("Resources"), PDFDict) ?? resources, mul(fm, ctm), depth + 1);
        } else if (sub === PDFName.of("Image")) {
          const pts = [
            [ctm[4], ctm[5]],
            [ctm[0] + ctm[4], ctm[1] + ctm[5]],
            [ctm[2] + ctm[4], ctm[3] + ctm[5]],
            [ctm[0] + ctm[2] + ctm[4], ctm[1] + ctm[3] + ctm[5]],
          ];
          const xs = pts.map((q) => q[0]);
          const ys = pts.map((q) => q[1]);
          out.push({ name, xobjects, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
        }
      }
    }
  };
  try {
    walk(streamText(ctx, page.node.Contents()), page.node.Resources(), [1, 0, 0, 1, 0, 0], 0);
  } catch (e) {
    console.error("could not walk the page's pictures:", e);
  }
  return out;
}

class Sheet {
  readonly width: number;
  readonly height: number;
  /** the face most of the page's values are set in */
  readonly face: string;
  constructor(
    readonly page: PDFPage,
    readonly pos: PosPage,
    readonly fills: Fill[],
    readonly fonts: FontSet,
    readonly blank: PDFImage | null = null,
  ) {
    this.width = page.getWidth();
    this.height = page.getHeight();
    const count = new Map<string, number>();
    for (const r of pos.rows) for (const c of r.cells) if (c.f && !c.b && !c.i) count.set(c.f, (count.get(c.f) ?? 0) + c.s.length);
    this.face = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }
  /** the font for a run: the family of the cell it replaces (or of the page), in the style asked for */
  fontOf(cell?: Cell | null, bold?: boolean, italic?: boolean): PDFFont {
    return this.fonts.get(cell?.f || this.face, bold ?? !!cell?.b, italic ?? !!cell?.i);
  }
  /** the colour under a point: the last-painted fill holding it, else white */
  bgAt(x: number, y: number): string {
    let c = "#ffffff";
    for (const f of this.fills) if (!f.stroke && !f.image && x >= f.x - 0.2 && x <= f.x + f.w + 0.2 && y >= f.y - 0.2 && y <= f.y + f.h + 0.2 && f.w < this.width - 5) c = f.color;
    return c;
  }
  /** the right edge of the form's table: the widest band on the page */
  get tableRight(): number {
    const bands = this.fills.filter((f) => !f.stroke && !f.image && f.w > this.width * 0.5 && f.w < this.width - 5 && f.h < 40);
    return bands.length ? Math.max(...bands.map((f) => f.x + f.w)) - 1.5 : this.width - 22;
  }
  /**
   * Clears an area and puts back what the form itself had there – its shaded bands, its borders
   * and its small headings – so only the earlier document's own marks (signatures, stamps,
   * sign tags) are gone.
   */
  /**
   * Takes the pictures the test picks (a stamp, a pasted signature) off the page: each is swapped for a
   * transparent picture, so whatever the earlier document printed under it (the footer, the labels) stays
   * untouched. A picture that cannot be traced to its name is whited out instead.
   */
  removePictures(pick: (p: { x: number; y: number; w: number; h: number }) => boolean) {
    const found = picturesOn(this.page.doc.context, this.page);
    const gone: Picture[] = [];
    for (const p of found) {
      if (p.w < 3 || p.h < 3 || !pick(p)) continue;
      if (this.blank) {
        p.xobjects.set(p.name, this.blank.ref);
        gone.push(p);
      }
    }
    // a picture the reader saw that is not in the page's own content (an annotation's appearance, an inline
    // image): whited out, if it is the size of a stamp or a signature – never a picture the size of the form
    for (const f of this.fills) {
      if (!f.image || f.w < 3 || f.h < 3 || f.w > this.width * 0.5 || f.h > 150 || !pick(f)) continue;
      if (gone.some((p) => Math.abs(p.x - f.x) < 2 && Math.abs(p.y - f.y) < 2)) continue;
      this.restore(f.x - 0.5, f.y - 0.5, f.w + 1, f.h + 1);
    }
  }
  restore(x: number, y: number, w: number, h: number, keep?: (f: Fill) => boolean) {
    if (w <= 0 || h <= 0) return;
    this.page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1), borderWidth: 0 });
    for (const f of this.fills) {
      if (f.w >= this.width - 5 || f.image) continue;
      if (keep && !keep(f)) continue;
      const ix = Math.max(x, f.x);
      const iy = Math.max(y, f.y);
      const iw = Math.min(x + w, f.x + f.w) - ix;
      const ih = Math.min(y + h, f.y + f.h) - iy;
      if (iw <= 0 || ih <= 0) continue;
      if (!f.stroke && f.h > 60) continue;
      this.page.drawRectangle({ x: ix, y: iy, width: iw, height: ih, color: rgbOf(f.color), borderWidth: 0 });
    }
    for (const row of this.pos.rows) for (const c of row.cells) {
      const size = c.h ?? 5;
      if (c.x < x - 1 || c.x + c.w > x + w + 1 || c.y < y || c.y + size > y + h) continue;
      if (!/^(signature|date|name|position|sign|stamp)$/i.test(c.s)) continue;
      const bg = this.bgAt(c.x + c.w / 2, c.y + size / 2);
      this.text(c.s, c.x, c.y, size, { color: lum(bg) < DARK ? "#ffffff" : "#6b6b6b", cell: c });
    }
  }
  fillAt(x: number, y: number): Fill | null {
    let hit: Fill | null = null;
    for (const f of this.fills) if (!f.stroke && !f.image && x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h && f.w < this.width - 5 && f.h < 60) hit = f;
    return hit;
  }
  wipe(x: number, y: number, w: number, h: number, sample?: { x: number; y: number }) {
    if (w <= 0 || h <= 0) return;
    const s = sample ?? { x: x + w / 2, y: y + h / 2 };
    this.page.drawRectangle({ x, y, width: w, height: h, color: rgbOf(this.bgAt(s.x, s.y)), borderWidth: 0 });
  }
  /** wipes a whole area but only inside the cell fills it crosses, so a band keeps its colour */
  wipeArea(x: number, y: number, w: number, h: number) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1), borderWidth: 0 });
  }
  widthOf(s: string, size: number, bold = false, cell?: Cell | null, italic?: boolean) {
    return this.fontOf(cell, bold, italic).widthOfTextAtSize(s, size);
  }
  /** writes one line, shrinking the size to fit the width, then cutting it with "..." */
  text(s: string, x: number, y: number, size: number, opts: { align?: "left" | "right" | "center"; maxWidth?: number; color?: string; bold?: boolean; italic?: boolean; minSize?: number; cell?: Cell | null } = {}) {
    let t = clean(s);
    if (!t) return;
    const font = this.fontOf(opts.cell, opts.bold ?? !!opts.cell?.b, opts.italic ?? !!opts.cell?.i);
    let sz = size;
    const max = opts.maxWidth ?? Infinity;
    const min = opts.minSize ?? Math.max(3.2, size * 0.7);
    while (font.widthOfTextAtSize(t, sz) > max && sz > min) sz -= 0.2;
    if (font.widthOfTextAtSize(t, sz) > max) {
      while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, sz) > max) t = t.slice(0, -1);
      t = `${t.trim()}...`;
    }
    const w = font.widthOfTextAtSize(t, sz);
    const dx = opts.align === "right" ? -w : opts.align === "center" ? -w / 2 : 0;
    this.page.drawText(t, { x: x + dx, y, size: sz, font, color: rgbOf(opts.color ?? "#000000") });
  }
  /** wraps a paragraph into lines that fit the width */
  wrap(s: string, size: number, width: number, bold = false, cell?: Cell | null): string[] {
    const out: string[] = [];
    for (const para of clean(s).split(/\n/)) {
      const words = para.split(" ").filter(Boolean);
      if (!words.length) {
        out.push("");
        continue;
      }
      let line = "";
      for (const w of words) {
        const cand = line ? `${line} ${w}` : w;
        if (this.widthOf(cand, size, bold, cell) <= width || !line) line = cand;
        else {
          out.push(line);
          line = w;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }
  /** the first row holding a cell that reads as the label */
  find(label: string | RegExp, opts: { after?: number; before?: number } = {}): { row: Row; idx: number; cell: Cell } | null {
    for (const row of this.pos.rows) {
      if (opts.after !== undefined && row.y >= opts.after) continue;
      if (opts.before !== undefined && row.y <= opts.before) continue;
      for (let i = 0; i < row.cells.length; i++) if (isLabel(row.cells[i].s, label)) return { row, idx: i, cell: row.cells[i] };
    }
    return null;
  }
  rowAt(y: number, tol = 3): Row | undefined {
    return this.pos.rows.find((r) => Math.abs(r.y - y) <= tol);
  }
  rowIndex(row: Row) {
    return this.pos.rows.indexOf(row);
  }
  /** paints over one cell and writes the new text where it was, keeping alignment */
  replaceCell(cell: Cell, value: string, opts: { rightEdge?: number; align?: "auto" | "left" | "right" | "center"; size?: number; bold?: boolean; leftEdge?: number; minSize?: number } = {}) {
    const size = opts.size ?? cell.h ?? 5;
    const bg = this.bgAt(cell.x + Math.max(1, cell.w / 2), cell.y + size / 2);
    const color = lum(bg) < DARK ? "#ffffff" : "#000000";
    // the old run, a little wider than measured (the measure runs short of the last glyph)
    const oldW = cell.w * 1.01 + 0.8;
    const bold = opts.bold ?? !!cell.b;
    const fill = this.fillAt(cell.x + 1, cell.y + size / 2);
    const oldCentre = cell.x + oldW / 2;
    let align: "left" | "right" | "center" = "left";
    if (opts.align && opts.align !== "auto") align = opts.align;
    else if (isNumeric(cell.s) || (isNumeric(value) && !isDateLike(value) && cell.s === "")) align = "right";
    else if (fill && Math.abs(fill.x + fill.w / 2 - oldCentre) < Math.max(6, fill.w * 0.08)) align = "center";
    const right = opts.rightEdge ?? (align === "right" ? cell.x + oldW : fill && fill.w < 400 ? fill.x + fill.w - 2 : Math.min(this.tableRight, cell.x + Math.max(oldW, 120)));
    const left = opts.leftEdge ?? (align === "right" ? Math.max(cell.x - 60, (opts.leftEdge ?? cell.x) - 60) : cell.x);
    // clear the old text (a little wider than it is, never past the cell's right edge)
    const wx = align === "right" ? Math.min(cell.x, right - Math.max(oldW, this.widthOf(value, size, bold, cell) + 2)) - 0.5 : cell.x - 0.5;
    const ww = align === "right" ? right - wx + 0.8 : Math.max(oldW, Math.min(this.widthOf(value, size, bold, cell) + 2, right - cell.x)) + 1.2;
    const wipe = { x: wx, y: cell.y - size * 0.32, w: Math.max(ww, 1) + (align === "right" ? 1.5 : 0), h: size * 1.36 };
    this.page.drawRectangle({ x: wipe.x, y: wipe.y, width: wipe.w, height: wipe.h, color: rgbOf(bg), borderWidth: 0 });
    for (const f of this.fills) {
      if (!f.stroke || f.w >= 1.5) continue;
      if (f.x < wipe.x - 0.5 || f.x > wipe.x + wipe.w + 0.5 || f.y > wipe.y + wipe.h || f.y + f.h < wipe.y) continue;
      const iy = Math.max(wipe.y, f.y);
      this.page.drawRectangle({ x: f.x, y: iy, width: f.w, height: Math.min(wipe.y + wipe.h, f.y + f.h) - iy, color: rgbOf(f.color), borderWidth: 0 });
    }
    if (!value) return;
    const maxWidth = align === "right" ? right - left : align === "center" && fill ? fill.w - 4 : right - cell.x;
    const x = align === "right" ? right : align === "center" ? (fill ? fill.x + fill.w / 2 : oldCentre) : cell.x;
    this.text(value, x, cell.y, size, { align, maxWidth, color, bold, cell, minSize: opts.minSize });
  }
  /** the value beside the label on its row (or wrapped onto the rows just above/below), replaced */
  replaceRight(label: string | RegExp, value: string | undefined, opts: { notLabels?: (string | RegExp)[]; nearRows?: boolean; rightEdge?: number; align?: "auto" | "left" | "right" | "center"; bold?: boolean; after?: number; last?: boolean; emptyAt?: number; maxDx?: number; minSize?: number } = {}) {
    if (value === undefined || value === null) return;
    const hit = this.find(label, { after: opts.after });
    if (!hit) return;
    const cells = hit.row.cells;
    let target: Cell | undefined;
    let i = hit.idx + 1;
    if (cells[i] && /^(a|b|c|d|e|f)\s*(=\s*[a-z+\-]+)?$/i.test(cells[i].s)) i++;
    // the value belongs to the label only when it starts near it; a run far along the row is another column's
    const maxDx = opts.maxDx ?? 330;
    if (opts.last) target = [...cells].reverse().find((c) => c.x > hit.cell.x + hit.cell.w && (isNumeric(c.s) || isDateLike(c.s)));
    else if (cells[i] && cells[i].x - hit.cell.x <= maxDx && !(opts.notLabels ?? []).some((l) => isLabel(cells[i].s, l))) target = cells[i];
    // a value that ran into the label after it ("26-Jul-25 Anticipated …"): the whole run is written again
    let rest = "";
    if (target) {
      const m = target.s.match(/^(\(?-?[\d,]+(?:\.\d+)?\)?|[0-9]{1,2}-[A-Za-z]{3}-\d{2,4}|[\d.]+%)\s+(\S.*)$/);
      if (m) rest = m[2];
    }
    if (!target && opts.nearRows) {
      // a wrapped label or value: the value sits on a row within a few points, to the right of the label
      const near = this.pos.rows.filter((r) => r !== hit.row && Math.abs(r.y - hit.row.y) <= 9).flatMap((r) => r.cells).filter((c) => c.x > hit.cell.x + hit.cell.w - 2 && c.x - hit.cell.x <= maxDx && !(opts.notLabels ?? []).some((l) => isLabel(c.s, l)) && !/^[a-z].{20,}/.test(c.s) && !isLabel(c.s, label));
      near.sort((a, b) => a.x - b.x);
      if (near.length) {
        // clear every wrapped part, write once at the first
        for (const c of near.slice(1)) this.replaceCell(c, "", { size: c.h });
        target = { ...near[0], y: near.reduce((m, c) => Math.max(m, c.y), near[0].y) };
        if (near.length > 1) target.w = Math.max(...near.map((c) => c.w));
      }
    }
    if (!target) {
      if (opts.emptyAt === undefined) return;
      target = { x: opts.emptyAt, y: hit.row.y, w: 0, s: "", h: hit.cell.h };
    }
    if (rest) this.replaceCell(target, `${value} ${rest}`, { align: "left", rightEdge: target.x + target.w * 1.04 + 2, minSize: (target.h ?? 5) * 0.9 });
    else this.replaceCell(target, value, { rightEdge: opts.rightEdge, align: opts.align, bold: opts.bold, minSize: opts.minSize });
  }
  /**
   * The free-text area beneath a label, down to the stop label: cleared and written again with the
   * new text, wrapped to the width of the area and shrunk when it would not fit.
   */
  block(label: string | RegExp, stop: (string | RegExp)[], text: string | undefined, opts: { left?: number; right?: number; size?: number; lead?: number; topGap?: number; bottomGap?: number; bold?: boolean; keepLabelRow?: boolean; firstBold?: boolean; after?: number } = {}) {
    if (text === undefined) return;
    const hit = this.find(label, { after: opts.after });
    if (!hit) return;
    const rows = this.pos.rows;
    const start = this.rowIndex(hit.row);
    let end = rows.length;
    for (let i = start + 1; i < rows.length; i++) if (stop.some((s) => rows[i].cells.some((c) => isLabel(c.s, s)))) {
      end = i;
      break;
    }
    const stopRow = rows[end];
    // written at the form's own body size – the label's – never at the size of some small run that happened to sit under it
    const size = opts.size ?? Math.max(hit.cell.h ?? 0, 7);
    const left = opts.left ?? hit.cell.x;
    const right = opts.right ?? this.width - 22;
    const top = hit.row.y - (opts.topGap ?? size * 0.9);
    const stopH = stopRow?.cells[0]?.h ?? size;
    const bottom = stopRow ? stopRow.y + stopH + (opts.bottomGap ?? 3) : 30;
    if (top - bottom < size) return;
    // clear the text between the rows; the borders and shading of the area come back as they were
    this.restoreText(left - 0.6, bottom, right - left + 1.2, top - bottom);
    // the face of the text that was there (or of the page)
    const old = rows.slice(start + 1, end).flatMap((r) => r.cells).find((c) => c.f) ?? null;
    const cell: Cell | null = old ? { ...old, b: false, i: false } : null;
    let sz = size;
    let lead = opts.lead ?? Math.max(size * 1.42, 6.5);
    let lines = this.wrap(text, sz, right - left - 2, opts.bold, cell);
    const fits = () => (lines.length + 0.6) * lead <= top - bottom;
    // a long text is set smaller rather than cut short: down to about 5 pt before anything is left out
    while (!fits() && sz > 5) {
      sz -= 0.2;
      lead = Math.max(sz * 1.22, 5);
      lines = this.wrap(text, sz, right - left - 2, opts.bold, cell);
    }
    const maxLines = Math.max(1, Math.floor((top - bottom - lead * 0.4) / lead));
    if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].replace(/[.,;:]?$/, "")} ...`];
    let y = top - lead * 0.9;
    lines.forEach((l, i) => {
      if (l) this.text(l, left, y, sz, { bold: opts.bold || (opts.firstBold && i === 0), maxWidth: right - left - 1, cell });
      y -= lead;
    });
  }
  /** the rows strictly between two labels */
  rowsBetween(from: string | RegExp, to: string | RegExp, opts: { after?: number } = {}): Row[] {
    const a = this.find(from, { after: opts.after });
    if (!a) return [];
    const rows = this.pos.rows;
    const start = this.rowIndex(a.row);
    const out: Row[] = [];
    for (let i = start + 1; i < rows.length; i++) {
      if (rows[i].cells.some((c) => isLabel(c.s, to))) break;
      out.push(rows[i]);
    }
    return out;
  }
  /** clears a text area: its shading and the borders around it come back, marks inside the text do not */
  restoreText(x: number, y: number, w: number, h: number) {
    this.restore(x, y, w, h, (f) => !f.stroke || f.w > w * 0.4 || f.h > h * 0.4);
  }
  /**
   * Clears the signature and date boxes of a signatory row – the columns right of Position, from
   * just under the row's labels up to the band or row above – and restores the form there.
   */
  clearSignature(labelRow: Row, topY: number, fromX?: number, bottomY?: number) {
    const sig = labelRow.cells.find((c) => /^signature$/i.test(c.s));
    const pos = labelRow.cells.find((c) => /^position$/i.test(c.s));
    const sigC = sig ? sig.x + sig.w / 2 : this.width * 0.72;
    const posC = pos ? pos.x + pos.w / 2 : this.width * 0.45;
    const x = fromX ?? sigC - (sigC - posC) * 0.36;
    const y = bottomY ?? labelRow.y - 6.5;
    if (topY - y < 3) return;
    const pics = this.fills.filter((f) => f.image && f.w > 5 && f.h > 5 && f.w < this.width * 0.5 && f.h < 150);
    const framesPicture = (f: Fill) => pics.some((i) => f.x >= i.x - 4 && f.x + f.w <= i.x + i.w + 4 && f.y >= i.y - 4 && f.y + f.h <= i.y + i.h + 4);
    // a signature picture, or the frame drawn around one, that starts in this row but reaches up past the
    // top of the cleared area (to just under the labels of the row above) would leave its top edge behind
    let top = topY;
    for (const f of this.fills) {
      if (!(f.image || (f.stroke && f.w > 5 && f.h > 5)) || f.x < x - 2 || f.x > this.tableRight) continue;
      if (f.y >= topY || f.y + f.h <= y) continue;
      top = Math.max(top, Math.min(f.y + f.h + 0.4, topY + 5.5));
    }
    const h = top - y;
    // what comes back: the shaded bands with the hairlines along their edges, the underlines just above the
    // labels, any rule that runs across the page and the table's own right border – never the frame of a
    // signature picture, whether it is drawn as a box or as four hairlines
    const bands = this.fills.filter((f) => !f.stroke && !f.image && f.h > 5 && f.h < 30 && f.w > 80);
    const alongBand = (f: Fill) => f.h < 1.5 && bands.some((b) => Math.abs(f.y - b.y) < 2.5 || Math.abs(f.y - (b.y + b.h)) < 2.5);
    const keep = (f: Fill) => !framesPicture(f) && ((!f.stroke && f.h > 5 && f.w > 80) || alongBand(f) || (f.h < 1.5 && f.y > labelRow.y && f.y < labelRow.y + 10) || (f.w < 1.5 && f.h > h * 0.8 && f.x > this.tableRight - 5) || (f.h < 1.5 && f.w > this.width * 0.6));
    this.restore(x, y, this.tableRight + 1 - x, h, keep);
  }
  /** a person on a Name / Position / Signature / Date row: written centred under the headings */
  person(nameRow: Row, labelRow: Row, name: string, position: string, topY: number, bottomY?: number, opts: { keepSignature?: boolean } = {}) {
    const centre = (re: RegExp) => {
      const c = labelRow.cells.find((k) => re.test(k.s));
      return c ? c.x + c.w / 2 : null;
    };
    const nc = centre(/^name$/i);
    const pc = centre(/^position$/i);
    const size = nameRow.cells[0]?.h ?? 5.4;
    // clear the old name and position runs
    for (const c of nameRow.cells) this.replaceCell(c, "", { size: c.h });
    // the rows just around the name row that are wrapped parts of the position
    for (const r of this.pos.rows) if (r !== nameRow && r !== labelRow && Math.abs(r.y - nameRow.y) <= 8 && r.y > labelRow.y) for (const c of r.cells) if (!/^(name|position|signature|date)$/i.test(c.s)) this.replaceCell(c, "", { size: c.h });
    const half = pc && nc ? (pc - nc) * 0.92 : 130;
    const nameCell = nameRow.cells[0] ?? null;
    const posCell = nameRow.cells[1] ?? nameCell;
    // the names on the form are in bold: the embedded face of the earlier pack does not always say so
    if (nc && name) this.text(name, nc, nameRow.y, size, { align: "center", maxWidth: half, bold: true, cell: nameCell });
    if (pc && position) this.text(position, pc, nameRow.y, size, { align: "center", maxWidth: half * 1.15, bold: true, cell: posCell });
    if (!opts.keepSignature) this.clearSignature(labelRow, topY, undefined, bottomY);
  }
  /** where a signatory block starts: under the band above it, or under the labels of the row above */
  blockTop(prev: Row): number {
    const band = this.fillAt(this.width * 0.8, prev.y + 1.5);
    // just over the band's top edge: any further up would cut into the labels of the row above it
    return band && band.h < 30 ? band.y + band.h + 1.5 : prev.y - 6.5;
  }
  /** where a signatory block ends: the top edge of the band beneath it (plus a little), or under the labels */
  blockBottom(labelRow: Row, next: Row | undefined): number {
    const band = next ? this.fillAt(this.width * 0.8, next.y + 1.5) : null;
    if (band && band.h < 30 && band.y + band.h < labelRow.y) return band.y + band.h - 6;
    return labelRow.y - 6.5;
  }
}

interface Loaded {
  pdf: PDFDocument;
  src: PDFDocument;
  pages: PosPage[];
  fills: Map<number, Fill[]>;
  fonts: FontSet;
}

async function open(refBytes: Buffer, wanted: (pages: PosPage[]) => number[]): Promise<{ l: Loaded; sheets: Sheet[] } | null> {
  const pages = await readPositioned(refBytes);
  if (!pages.length) return null;
  const nos = wanted(pages);
  if (!nos.length) return null;
  const fills = await readFills(refBytes, nos);
  const src = await PDFDocument.load(refBytes, { ignoreEncryption: true, updateMetadata: false });
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fonts = new FontSet(pdf, font, bold);
  await fonts.prepare(nos.map((n) => pages[n - 1]));
  const blank = await pdf.embedPng(BLANK_PNG);
  const copied = await pdf.copyPages(src, nos.map((n) => n - 1));
  const sheets: Sheet[] = [];
  copied.forEach((pg, i) => {
    // the sign tags, links and stamps of the earlier document are annotations: dropped
    pg.node.delete(PDFName.of("Annots"));
    pdf.addPage(pg);
    sheets.push(new Sheet(pg, pages[nos[i] - 1], fills.get(nos[i]) ?? [], fonts, blank));
  });
  return { l: { pdf, src, pages, fills, fonts }, sheets };
}

const pageText = (p: PosPage) => p.rows.flatMap((r) => r.cells.map((c) => c.s)).join(" | ");
const lines = (v: unknown) => String(v ?? "").split(/\n/).map((s) => s.trim()).filter(Boolean);
/** "n – description – omit – add" lines of the cost items field */
const items = (v: unknown) =>
  lines(v).map((l) => {
    const parts = l.split(/\s+[–-]\s+/);
    if (parts.length >= 4) return { ref: parts[0].replace(/^\d+$/, ""), desc: parts.slice(1, -2).join(" - "), omit: num(parts[parts.length - 2]), add: num(parts[parts.length - 1]) };
    return { ref: "", desc: l, omit: 0, add: 0 };
  });

/**
 * A drafted form goes out for approval: the signatures, stamps and initials on the earlier document
 * come off (every picture below the heading named, or below the page's top band when none is), and
 * anything written under the last signatory block – a contractor's note – goes too; the footer stays.
 */
function stripDraftMarks(s: Sheet, firstBlock: RegExp | null, opts: { keepTop?: number; footer?: RegExp } = {}) {
  const hit = firstBlock ? s.find(firstBlock) : null;
  const limit = hit ? hit.row.y + 4 : s.height * (opts.keepTop ?? 0.86);
  s.removePictures((p) => p.y + p.h / 2 < limit);
  const labels = s.pos.rows.filter((r) => r.cells.some((c) => /^name$/i.test(c.s)) && r.cells.some((c) => /^(signature|date)$/i.test(c.s)));
  if (!labels.length) return;
  const last = labels.reduce((a, b) => (b.y < a.y ? b : a));
  const footer = opts.footer ?? /^(RSG-CM-FRM|TRS-CM-FRM|RSG-PR-FRM|Rev(ision|\.)|Page \d|Internal|Confidential|Variation Order Form|Determination of Variation Order|Proposed Variation Order|Request for Approval)/i;
  for (const r of s.pos.rows) if (r.y < last.y - 3) for (const c of r.cells) if (!footer.test(c.s.trim())) s.replaceCell(c, "", { size: c.h });
}

/** every Name / Position / Signature / Date row under a heading, written for this pack's people */
function signatories(sh: Sheet, from: string | RegExp, to: (string | RegExp)[], names: string[], positions: string[], opts: { keepFirstSignature?: boolean } = {}) {
  const hit = sh.find(from);
  if (!hit) return;
  const rows = sh.pos.rows;
  const start = sh.rowIndex(hit.row);
  let n = 0;
  let prev = hit.row;
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i];
    if (to.some((s) => r.cells.some((c) => isLabel(c.s, s)))) break;
    if (r.cells.some((c) => /^name$/i.test(c.s)) && r.cells.some((c) => /^signature$/i.test(c.s))) {
      const nameRow = rows[i - 1] && rows[i - 1] !== prev && rows[i - 1].y - r.y < 14 ? rows[i - 1] : { y: r.y + 6, cells: [] };
      // the person who prepared the pack has signed it (the same person as on the earlier pack); everyone after
      // signs on approval, so their boxes go out blank
      const oldName = nameRow.cells.map((c) => c.s).join(" ").toLowerCase();
      const surname = (names[n] ?? "").trim().split(/\s+/).pop()?.toLowerCase() ?? "";
      const samePerson = !names[n] || (surname.length > 2 && oldName.includes(surname));
      const keepSignature = !!opts.keepFirstSignature && n === 0 && samePerson;
      const top = sh.blockTop(prev);
      const bottom = sh.blockBottom(r, rows[i + 1]);
      // the signature and any stamp on this row come off the page first (a stamp often spills over the
      // labels and the band below, where whiting it out would take the form with it)
      if (!keepSignature) sh.removePictures((p) => p.y + p.h / 2 > bottom - 10 && p.y + p.h / 2 < top + 10 && p.x + p.w / 2 > sh.width * 0.3);
      // nobody named for this block: the people printed on the earlier pack stay as they are, only the signatures go
      if (!names.length) {
        if (!keepSignature) sh.clearSignature(r, top, undefined, bottom);
      } else sh.person(nameRow, r, names[n] ?? "", positions[n] ?? "", top, bottom, { keepSignature });
      n++;
      prev = r;
    }
  }
}

/* ------------------------------------------------------------------ */
/* PVO – RSG-CM-FRM-0013                                               */

export interface AccOverlayRow {
  category: string;
  thisPvo: number;
}

export async function overlayPvo(refBytes: Buffer, v: PackValues, opts: { targetCategory?: string } = {}): Promise<Buffer | null> {
  const o = await open(refBytes, (pages) => {
    const nos = pages.filter((p) => /RSG-CM-FRM-0013/i.test(pageText(p)) && /Proposed Variation Order \(PVO\)|Emergency Variation Order Assessment/i.test(pageText(p))).map((p) => p.no);
    return nos.slice(0, 2);
  });
  if (!o) return null;
  const [s1, s2] = o.sheets;
  const total = num(v.total_value) || num(v.add) - num(v.omit);
  const orig = num(v.original_contract);
  const dvos = num(v.approved_dvos);
  const pvos = num(v.approved_pvos);
  // the reconciliation is worked out from its parts, so figures from different sources cannot disagree on the form
  const current = orig ? orig + dvos : num(v.current_revised);
  const potential = current + pvos + total;
  const other = num(v.other_contracts);
  if (s1) {
    s1.removePictures((p) => p.y + p.h / 2 < s1.height * 0.86);
    const gen: [string, string | RegExp, string | undefined, (string | RegExp)[]][] = [
      ["pvo_no", "Proposed Variation Order No", v.pvo_no, ["Date"]],
      ["date", /^Date:?$/, dmy(v.date), []],
      ["rfc_ref", "RFC/CRF Reference", v.rfc_ref, ["Requesting Department"]],
      ["requesting_department", "Requesting Department", v.requesting_department, []],
      ["development_name", "Development Name", v.development_name, ["Development No"]],
      ["development_no", "Development No", v.development_no, []],
      ["program_name", "Program Name", v.program_name, ["Program No"]],
      ["program_no", "Program No", v.program_no, []],
      ["project_name", "Project Name", v.project_name, ["Project Code"]],
      ["project_code", "Project Code", v.project_code, []],
      ["contractor", "Vendor Name", v.contractor, ["EWBS Code"]],
      ["ewbs_code", "EWBS Code", v.ewbs_code, []],
      ["works_package", "Works Package", v.works_package, ["ACC Contract No"]],
      ["contract_no", "ACC Contract No", v.contract_no, []],
    ];
    for (const [, label, val, not] of gen) if (val) s1.replaceRight(label, val, { notLabels: not, align: "left" });
    if (v.title) s1.replaceRight("Title of this Variation", v.title, { align: "left", bold: true, rightEdge: s1.tableRight - 2 });
    if (v.eac_included) s1.replaceRight("Is this change included in the latest EAC", v.eac_included, { align: "center", bold: true, maxDx: 600 });
    // the EAC line names the budget hold the value sits under, the way the approved PVOs do
    const eacLine = String(v.eac_explanation ?? "").trim() || (v.budget_line && v.budget_available ? `Current budget available under the construction budget on Hold - ${v.budget_line} = ${formatMoney(num(v.budget_available))}` : "");
    s1.block("Explain if the topic was included within the EAC", ["Root Cause for this change"], eacLine, { topGap: 4, bottomGap: 4 });
    if (v.root_cause) s1.replaceRight("Root Cause for this change", v.root_cause, { align: "center", bold: true, maxDx: 600 });
    if (s1.find("Description of Emergency Circumstances")) s1.block("Description of Emergency Circumstances", ["Scope of works / services (brief)"], v.emergency_circumstances ?? "", { topGap: 4, bottomGap: 4 });
    s1.block("Scope of works / services (brief)", ["Contractual basis for variation entitlement", "b) Estimated Cost Impact"], v.scope ?? "", { firstBold: true });
    s1.block("Contractual basis for variation entitlement", ["b) Estimated Cost Impact", "Basis of ROM Estimate"], v.contractual_basis ?? "", { topGap: 4, bottomGap: 4 });
    // the items table: the rows between the column headings and the sub-total
    const header = s1.find(/^Reference$/);
    const dataRows = s1.rowsBetween(/^Reference$/, /^Sub-Total$/).filter((r) => r.cells.length >= 1 && r.cells.every((c) => isNumeric(c.s) || c.x > 40));
    if (header && dataRows.length) {
      const H = header.row.cells;
      const col = (re: RegExp) => H.find((c) => re.test(c.s));
      const cDesc = col(/^Description$/i);
      const cCur = col(/^Contract Currency$/i);
      const cOmit = col(/^Omit$/i);
      const cAdd = col(/^Add$/i);
      // right edges of the money columns: the furthest right run in each
      const rightOf = (c: Cell | undefined, fallback: number) => {
        const runs = c ? dataRows.flatMap((r) => r.cells).filter((k) => isNumeric(k.s) && Math.abs(k.x + k.w / 2 - (c.x + c.w / 2)) < 60).map((k) => k.x + k.w * 1.05) : [];
        return runs.length ? Math.max(...runs) : fallback;
      };
      const omitR = rightOf(cOmit, cOmit ? cOmit.x + cOmit.w + 30 : 480);
      const addR = rightOf(cAdd, cAdd ? cAdd.x + cAdd.w + 30 : s1.tableRight);
      const its = items(v.cost_items);
      if (!its.length && total) its.push({ ref: "", desc: v.title ?? "", omit: total < 0 ? -total : 0, add: total > 0 ? total : 0 });
      const size = dataRows[0].cells[0]?.h ?? 4.9;
      const face: Cell | null = dataRows.flatMap((r) => r.cells).find((c) => /[A-Za-z]{3}/.test(c.s)) ?? dataRows[0].cells[0] ?? null;
      const plain = face ? { ...face, b: false, i: false } : null;
      dataRows.forEach((r, i) => {
        for (const c of r.cells) s1.replaceCell(c, "", { size: c.h });
        const it = its[i];
        if (!it) return;
        const descX = cDesc ? Math.min(cDesc.x - 110, 101) : 101;
        s1.text(it.ref, descX - 8, r.y, size, { align: "right", maxWidth: descX - 30, cell: plain });
        s1.text(it.desc, descX, r.y, size, { maxWidth: (cCur ? cCur.x - 6 : 340) - descX, cell: plain });
        if (cCur) s1.text("SAR", cCur.x + cCur.w / 2, r.y, size, { align: "center", cell: plain });
        s1.text(mny(it.omit), omitR, r.y, size, { align: "right", cell: plain });
        s1.text(mny(it.add), addR, r.y, size, { align: "right", cell: plain });
      });
      const omitSum = its.reduce((a, b) => a + b.omit, 0);
      const addSum = its.reduce((a, b) => a + b.add, 0);
      const sub = s1.find(/^Sub-Total$/);
      if (sub) {
        const nums = sub.row.cells.filter((c) => c.x > sub.cell.x + sub.cell.w && isNumeric(c.s));
        for (const c of nums) s1.replaceCell(c, "", { size: c.h });
        s1.text(mny(omitSum), omitR, sub.row.y, size, { align: "right", cell: nums[0] ?? plain });
        s1.text(mny(addSum), addR, sub.row.y, size, { align: "right", cell: nums[nums.length - 1] ?? plain });
      }
      const net = addSum - omitSum || total;
      s1.replaceRight("Total Value (in Contract Currency)", mny(net), { last: true, rightEdge: addR, bold: true });
      s1.replaceRight("Total Value (in SAR)", mny(net), { last: true, rightEdge: addR, bold: true });
    }
    // contract reconciliation summary
    s1.replaceRight("Original Contract Value", mny(orig), { align: "right" });
    s1.replaceRight(/^Approved DVOs$/, mny(dvos), { align: "right" });
    s1.replaceRight(/^Approved DVOs$/, pct(dvos, orig), { last: true, align: "right" });
    s1.replaceRight("Current Revised Contract Value", mny(current), { align: "right", bold: true });
    s1.replaceRight(/^Approved PVOs$/, mny(pvos), { align: "right" });
    s1.replaceRight(/^Approved PVOs$/, pct(pvos, orig), { last: true, align: "right" });
    s1.replaceRight(/^This (Proposed Variation Order \(PVO\)|Variation Order \(ROM\))$/, mny(total), { align: "right", bold: true });
    s1.replaceRight(/^This (Proposed Variation Order \(PVO\)|Variation Order \(ROM\))$/, pct(total, orig), { last: true, align: "right" });
    s1.replaceRight(/^Potential Revised Contract Value \(After this (PVO|VO)\)$/, mny(potential), { align: "right", bold: true });
    s1.replaceRight(/^Potential Revised Contract Value \(After this (PVO|VO)\)$/, pct(potential - orig, orig), { last: true, align: "right" });
    s1.replaceRight("Overall 'Estimated Commercial Impact' due to this Change", mny(total + other), { last: true, align: "right", bold: true });
  }
  if (s2) {
    // b) package budget position: the one row of figures
    const pkgRows = s2.rowsBetween("b) Package Budget position", "c) Budget Transfer details").filter((r) => r.cells.filter((c) => isNumeric(c.s)).length >= 6);
    const pkg = pkgRows[0];
    if (pkg) {
      const nums = pkg.cells.filter((c) => isNumeric(c.s));
      const name = pkg.cells.find((c) => !isNumeric(c.s));
      const a = num(nums[0]?.s) || num(v.approved_contract);
      const b = num(v.approved_contract) || num(nums[1]?.s);
      const e = a - b - dvos - pvos;
      const vals = [a, b, dvos, pvos, e, total, e - total];
      if (name && v.works_package) s2.replaceCell(name, v.works_package, { align: "left", bold: true, rightEdge: nums[0] ? nums[0].x - 22 : undefined, minSize: (name.h ?? 4.3) * 0.85 });
      nums.slice(0, 7).forEach((c, i) => s2.replaceCell(c, mny(vals[i], false), { align: "right" }));
    }
    // c) budget transfer details: From (the hold) and To (this contract)
    for (const r of s2.rowsBetween("c) Budget Transfer details", "Note: The approval")) {
      const first = r.cells[0]?.s ?? "";
      const nums = r.cells.filter((c) => isNumeric(c.s));
      const acct = r.cells.find((c) => /^1TB\d{5}\.\d{2}\.[A-Z]{2}\./.test(c.s));
      if (/^from$/i.test(first)) {
        if (acct && v.budget_line) s2.replaceCell(acct, v.budget_line, { align: "left" });
        const avail = num(v.budget_available) || num(nums[0]?.s);
        const vals = [avail, -total, avail - total];
        nums.slice(0, 3).forEach((c, i) => s2.replaceCell(c, mny(vals[i], false), { align: "right" }));
      } else if (/^to$/i.test(first)) {
        if (acct && v.budget_to_line) s2.replaceCell(acct, v.budget_to_line, { align: "left" });
        const wp = r.cells.find((c) => c.x > (acct?.x ?? 0) + 60 && !isNumeric(c.s) && c !== acct && /[A-Za-z]/.test(c.s) && c.x > 300);
        if (wp && v.works_package) s2.replaceCell(wp, v.works_package, { align: "left", rightEdge: nums[0] ? nums[0].x - 26 : undefined, minSize: (wp.h ?? 4.3) * 0.85 });
        const vals = [current, total, current + total];
        nums.slice(0, 3).forEach((c, i) => s2.replaceCell(c, mny(vals[i], false), { align: "right" }));
      }
    }
    // d) project / asset budget position: this PVO on its category, totals to follow
    const accRows = s2.rowsBetween("d) Project / Asset Budget position", /^Comments/).filter((r) => r.cells.filter((c) => isNumeric(c.s)).length >= 11 && /[A-Za-z]{3}/.test(r.cells[0].s));
    const target = accRows.find((r) => opts.targetCategory && r.cells[0].s.toLowerCase().includes(opts.targetCategory.toLowerCase())) ?? accRows.find((r) => /construction/i.test(r.cells[0].s)) ?? accRows.find((r) => /^totals?$/i.test(r.cells[0].s) === false);
    const totals = accRows.find((r) => /^totals?$/i.test(r.cells[0].s));
    if (target && target !== totals) {
      const n = target.cells.filter((c) => isNumeric(c.s));
      const [A, , , , , , G, Hc, I, J, K] = n;
      const oldH = num(Hc.s);
      const oldJ = num(J.s);
      const oldK = num(K.s);
      const newJ = total + num(I.s);
      const newK = num(A.s) - num(G.s) - newJ;
      s2.replaceCell(Hc, mny(total, false), { align: "right" });
      s2.replaceCell(J, mny(newJ, false), { align: "right" });
      s2.replaceCell(K, mny(newK, false), { align: "right" });
      if (totals) {
        const t = totals.cells.filter((c) => isNumeric(c.s));
        if (t.length >= 11) {
          s2.replaceCell(t[7], mny(num(t[7].s) - oldH + total, false), { align: "right", bold: true });
          s2.replaceCell(t[9], mny(num(t[9].s) - oldJ + newJ, false), { align: "right", bold: true });
          s2.replaceCell(t[10], mny(num(t[10].s) - oldK + newK, false), { align: "right", bold: true });
        }
      }
    }
    // 4. time impact
    const eot = Math.round(num(v.approved_eot));
    const impact = Math.round(num(v.time_impact));
    const others = Math.round(num(v.other_eots));
    const origDate = String(v.original_completion ?? "");
    const currentDate = String(v.current_completion ?? "") || (origDate ? addDays(origDate, eot) : "");
    s2.replaceRight("a) Original Contract Completion Date", dmy(origDate), { align: "right" });
    s2.replaceRight("b) Approved EOTs (Days)", eot ? String(eot) : "0.00", { align: "right" });
    s2.replaceRight("c) Current Revised Completion Date (a+b)", dmy(currentDate), { align: "left" });
    s2.replaceRight("c) Current Revised Completion Date (a+b)", currentDate ? dmy(addDays(currentDate, impact + others)) : "", { last: true, align: "right", bold: true });
    s2.replaceRight("d) Estimated 'time impact' of this variation (Days)", String(impact), { align: "right" });
    s2.replaceRight("e) Other anticipated EOTs", String(others), { align: "right" });
    // signatories: every Name / Position / Signature / Date row under Prepared and Approved
    // stamps and notes outside the signatory rows (the preparer's own signature is kept by the rows below)
    {
      const labels = s2.pos.rows.filter((r) => r.cells.some((c) => /^name$/i.test(c.s)) && r.cells.some((c) => /^signature$/i.test(c.s)));
      if (labels.length) {
        const last = labels.reduce((a, b) => (b.y < a.y ? b : a));
        s2.removePictures((p) => p.y + p.h / 2 < last.y - 3);
        for (const r of s2.pos.rows) if (r.y < last.y - 3) for (const c of r.cells) if (!/^(RSG-CM-FRM|Rev\.|Page \d|Internal|Confidential)/i.test(c.s.trim())) s2.replaceCell(c, "", { size: c.h });
      }
    }
    signatories(s2, /^Prepared(\s*\/\s*Initiated)?\s*By:?$/i, ["Checked by", "Approved by", "Review & Approval"], lines(v.prepared_by), lines(v.prepared_position), { keepFirstSignature: true });
    signatories(s2, "Checked by (Pre-Approval)", ["Approved by"], lines(v.checked_by), lines(v.checked_position));
    signatories(s2, /^Approved by/, [/^RSG-CM-FRM/], lines(v.approved_by), lines(v.approved_position));
    signatories(s2, /^Review & Approval/, [/^RSG-CM-FRM/], lines(v.approved_by), lines(v.approved_position));
  }
  return Buffer.from(await o.l.pdf.save({ useObjectStreams: true }));
}

/* ------------------------------------------------------------------ */
/* the Variation Order issued under the Emergency Protocol – RSG-CM-FRM-0034 */

/** The Variation Order page of the last issued EVO pack with this pack's particulars, description, documents and representatives. */
export async function overlayVoForm(refBytes: Buffer, v: PackValues, opts: { projectCode?: string } = {}): Promise<Buffer | null> {
  const o = await open(refBytes, (pages) => {
    const p = pages.find((x) => /Variation Order Form/i.test(pageText(x)) && /RSG-CM-FRM-0034/i.test(pageText(x)));
    return p ? [p.no] : [];
  });
  if (!o) return null;
  const s = o.sheets[0];
  const no = String(v.pvo_no ?? v.vo_no ?? "").replace(/\D/g, "").padStart(3, "0");
  s.replaceRight(/^Variation Order No\.?$/, no.replace(/^0+(\d)/, "$1"), { notLabels: [/^Date$/], align: "left" });
  if (v.date) s.replaceRight(/^Date$/, dmy(String(v.date)), { align: "left" });
  const projectLine = [v.program_name, v.development_name].filter(Boolean).join(" - ") || String(v.project_name ?? "");
  if (projectLine) s.replaceRight(/^Project Name$/, projectLine, { notLabels: [/^Project Code$/], align: "left" });
  if (opts.projectCode) s.replaceRight(/^Project Code$/, opts.projectCode, { align: "left" });
  if (v.contract_title || v.project_name) s.replaceRight(/^Contract Name$/, String(v.contract_title || v.project_name), { notLabels: [/^Contract No\.?$/], align: "left" });
  if (v.contract_no) s.replaceRight(/^Contract No\.?$/, String(v.contract_no), { align: "left" });
  if (v.works_package) s.replaceRight(/^Works Package$/, String(v.works_package), { notLabels: [/^Contractor\/Consultant$/], align: "left" });
  if (v.contractor) s.replaceRight(/^Contractor\/Consultant$/, String(v.contractor), { align: "left" });
  s.block(/^Variation Title:?$/, [/^Instruction Reference$/], String(v.title ?? ""), { topGap: 3, bottomGap: 3 });
  const ref = s.pos.rows.flatMap((r) => r.cells).find((c) => /^VO-\d+/i.test(c.s.trim()));
  if (ref) s.replaceCell(ref, `VO-${no}`, { align: "left", bold: true });
  const desc = s.find(/^Description$/);
  if (desc) s.block(/^Description$/, [/^Time Impact \(Contract Level\)$/], voDescription(v), { left: desc.cell.x, topGap: 6, bottomGap: 6 });
  const impact = Math.round(num(v.time_impact));
  s.replaceRight(/^Estimated 'time impact' of this variation \(Days\)$/, impact ? String(impact) : "TBA", { align: "left" });
  // the documents provided with the Variation Order: the rows of the table under its headings
  const head = s.find(/^Document Ref\. No\.$/);
  if (head) {
    const stop = s.find(/^Approved and Issued by/);
    const band = s.pos.rows.filter((r) => r.y < head.row.y - 2 && (!stop || r.y > stop.row.y + 12));
    for (const r of band) for (const c of r.cells) s.replaceCell(c, "", { size: c.h });
    const cols = head.row.cells;
    const titleX = cols.find((c) => /Document Title/i.test(c.s))?.x ?? head.cell.x + 108;
    const revC = cols.find((c) => /Rev\. No/i.test(c.s));
    const dateC = cols.find((c) => /Rev\. Date/i.test(c.s));
    const size = head.cell.h || 7;
    const step = size * 1.75;
    const docsOf = lines(v.information_provided).map((l) => l.split(/\s+[–-]\s+/));
    const rows: string[][] = docsOf.length ? docsOf : [["Appendix 01", v.title ? `Schedule to Variation Order No. ${no} - ${v.title}` : "", "0", v.date ? dmy(String(v.date)) : ""]];
    rows.slice(0, 5).forEach((parts, i) => {
      const y = head.row.y - step * (i + 1);
      if (parts[0]) s.text(parts[0], head.cell.x, y, size, { maxWidth: titleX - head.cell.x - 4, cell: head.cell });
      if (parts[1]) s.text(parts[1], titleX, y, size, { maxWidth: (revC ? revC.x : s.width - 120) - titleX - 4, cell: head.cell });
      if (revC && parts[2]) s.text(parts[2], revC.x + revC.w / 2, y, size, { align: "center", cell: head.cell });
      if (dateC && parts[3]) s.text(parts[3], dateC.x + dateC.w / 2, y, size, { align: "center", cell: head.cell });
    });
  }
  // the draft goes out for approval: the signatures and stamps on the earlier VO, and anything written
  // under its signatory blocks (a contractor's note), are not carried over – the logo at the top stays
  const appr = s.find(/^Approved and Issued by/);
  const limit = appr ? appr.row.y + 4 : s.height * 0.45;
  s.removePictures((p) => p.y + p.h / 2 < limit);
  const recv = s.find(/^Received by/);
  if (recv) {
    const rows = s.pos.rows;
    const labels = rows.slice(s.rowIndex(recv.row) + 1).find((r) => r.cells.some((c) => /^name$/i.test(c.s)) && r.cells.some((c) => /^signature$/i.test(c.s)));
    const floor = labels ? labels.y - 3 : recv.row.y - 30;
    for (const r of rows) if (r.y < floor) for (const c of r.cells) if (!/^(Variation Order Form|RSG-CM-FRM|Revision|Rev\.|Page \d|Internal|Confidential)/i.test(c.s.trim())) s.replaceCell(c, "", { size: c.h });
  }
  signatories(s, /^Approved and Issued by/, [/^Received by/], [String(v.employer_rep ?? "")], [String(v.employer_rep_position || "Employer's Representative")]);
  signatories(s, /^Received by/, [/^Variation Order Form \(RSG/, /^Page \d/], [String(v.contractor_rep ?? "")], [String(v.contractor_rep_position || "Contractor's Representative")]);
  return Buffer.from(await o.l.pdf.save({ useObjectStreams: true }));
}

/* ------------------------------------------------------------------ */
/* DVO – the cost movement summary, RSG-CM-FRM-0014 and RSG-CM-FRM-0027 */

export async function overlayDvo(refBytes: Buffer, v: PackValues): Promise<Buffer | null> {
  const o = await open(refBytes, (pages) => {
    const summary = pages.find((p) => /PVO to DVO Cost Movement Summary/i.test(pageText(p)));
    const f14 = pages.find((p) => /R[SG]G-CM-FRM-0014/i.test(pageText(p)) && /Determination of Variation Order Form/i.test(pageText(p)));
    const f27 = pages.find((p) => /RSG-CM-FRM-0027/i.test(pageText(p)) && /Review & Recommendation/i.test(pageText(p)));
    return [summary, f14, f27].filter((p): p is PosPage => !!p).map((p) => p.no);
  });
  if (!o) return null;
  const dvoValue = num(v.dvo_value) || num(v.add) - num(v.omit);
  const pvoValue = num(v.pvo_value);
  const price = num(v.contract_price);
  const prev = num(v.previous_dvos);
  const interim = num(v.interim_vos);
  const revised = num(v.revised_contract) || price + prev + interim + dvoValue;
  const prevEot = Math.round(num(v.previous_eot));
  const thisEot = Math.round(num(v.this_eot));
  const totalEot = num(v.total_eot) ? Math.round(num(v.total_eot)) : prevEot + thisEot;
  const origDate = String(v.original_completion ?? "");
  // the revised completion follows the days awarded; a register date equal to the original one is not it
  const givenRevised = String(v.revised_completion ?? "");
  const revisedDate = givenRevised && givenRevised !== origDate ? givenRevised : origDate ? addDays(origDate, totalEot) : givenRevised;
  const dvoNo = String(v.dvo_no ?? "");
  const dvoDigits = dvoNo.replace(/\D/g, "").padStart(3, "0");
  const title = String(v.title ?? "").replace(/^DVO[\s-]*\d+\s*-\s*/i, "");
  for (const s of o.sheets) {
    const text = pageText(s.pos);
    if (/PVO to DVO Cost Movement Summary/i.test(text)) {
      s.removePictures((p) => p.y + p.h / 2 < s.height * 0.86);
      const vals = s.pos.rows.find((r) => r.cells.filter((c) => /^SAR\s/i.test(c.s)).length >= 2);
      if (vals) {
        const cs = vals.cells.filter((c) => /^SAR\s/i.test(c.s));
        const diff = pvoValue - dvoValue;
        const nv = [`SAR ${formatMoney(pvoValue)}`, `SAR ${formatMoney(dvoValue)}`, `SAR ${formatMoney(Math.abs(diff))}`];
        cs.slice(0, 3).forEach((c, i) => s.replaceCell(c, nv[i], { align: "center", bold: true }));
        // the note beneath the table
        const bullet = s.pos.rows.filter((r) => r.y < vals.y - 40 && r.y > 60);
        if (bullet.length) {
          const first = bullet[0];
          const dot = first.cells.find((c) => /^[•·]$/.test(c.s));
          const x = dot ? dot.x + 17 : first.cells[0].x;
          const size = first.cells[first.cells.length - 1].h ?? 13.9;
          const top = first.y + size * 1.2;
          const bottom = Math.min(...bullet.map((r) => r.y)) - size * 0.5;
          s.restoreText(x - 1, bottom, s.width - 60 - x, top - bottom);
          const note = String(v.movement_note ?? "") || (diff === 0 ? "The DVO value equals the approved PVO value." : `The DVO value is ${diff > 0 ? "lower" : "higher"} than the approved PVO value, with a variance of SAR ${formatMoney(Math.abs(diff))}`);
          const face = first.cells.find((c) => c !== dot && !c.b) ?? first.cells[first.cells.length - 1];
          const ls = s.wrap(note, size, s.width - 62 - x, false, face);
          let y = first.y;
          for (const l of ls.slice(0, 4)) {
            s.text(l, x, y, size, { maxWidth: s.width - 60 - x, cell: face, bold: false });
            y -= size * 1.45;
          }
        }
      }
      continue;
    }
    const is27 = /RSG-CM-FRM-0027/i.test(text) && /Review & Recommendation/i.test(text);
    // an Excel error left in the header of the review form
    const err = s.find(/^#(VALUE|REF|N\/A|DIV\/0)!?$/);
    if (err) s.replaceCell(err.cell, "", { size: err.cell.h });
    if (dvoNo) s.replaceRight("Variation Order No", dvoNo, { notLabels: ["Date"], align: "left", bold: is27 });
    if (v.date) s.replaceRight(/^Date$/, dmy(v.date), { align: "left", after: 750 });
    if (v.program_name) s.replaceRight("Program Name", v.program_name, { notLabels: ["Project Code"], align: "left", bold: is27 });
    if (v.project_code) s.replaceRight("Project Code", v.project_code, { align: "left", bold: is27 });
    if (v.project_name) s.replaceRight("Project Name", v.project_name, { notLabels: ["Contract Ref"], align: "left", bold: is27 });
    if (v.contract_ref) s.replaceRight("Contract Ref", v.contract_ref, { align: "left", bold: is27 });
    if (v.works_package) s.replaceRight(/^Works Package$/, v.works_package, { notLabels: ["Contractor/Consultant"], align: "left", bold: is27 });
    if (v.contractor) s.replaceRight("Contractor/Consultant", v.contractor, { align: "left", nearRows: true, bold: is27, rightEdge: s.tableRight - 2 });
    s.block("Variation Order Title", ["Reason for Variation Order"], `DVO ${dvoDigits} - ${title}`, { bold: true, topGap: 5, bottomGap: 4 });
    const reason = [String(v.description ?? "").trim(), String(v.reason ?? "").trim()].filter(Boolean).join("\n\n");
    s.block("Reason for Variation Order", ["Instruction Reference"], reason, { topGap: 8, bottomGap: 4, firstBold: true });
    // the instruction table
    const header = s.find(/^Instruction Reference$/);
    const dataRows = s.rowsBetween(/^Instruction Reference$/, /^Sub-Total$/);
    if (header && dataRows.length) {
      const H = header.row.cells;
      const cDesc = H.find((c) => /^Description$/i.test(c.s));
      const cOmit = H.find((c) => /^Omit/i.test(c.s));
      const cAdd = H.find((c) => /^Add/i.test(c.s));
      const rightOf = (c: Cell | undefined, fallback: number) => {
        const runs = c ? dataRows.flatMap((r) => r.cells).filter((k) => isNumeric(k.s) && Math.abs(k.x + k.w / 2 - (c.x + c.w / 2)) < 60).map((k) => k.x + k.w * 1.05) : [];
        return runs.length ? Math.max(...runs) : fallback;
      };
      const omitR = rightOf(cOmit, cOmit ? cOmit.x + cOmit.w + 20 : 470);
      const addR = rightOf(cAdd, cAdd ? cAdd.x + cAdd.w + 20 : s.tableRight);
      let its = items(v.cost_items);
      if (!its.length && dvoValue) its = [{ ref: "", desc: title, omit: dvoValue < 0 ? -dvoValue : 0, add: dvoValue > 0 ? dvoValue : 0 }];
      const size = header.cell.h ?? 5.8;
      const old = dataRows.flatMap((r) => r.cells);
      const refFace = old.find((c) => /^1TB|^[A-Z]{2,}-/.test(c.s)) ?? old[0] ?? null;
      const descFace = old.find((c) => /[A-Za-z]{3}/.test(c.s) && c !== refFace) ?? old[0] ?? null;
      const numFace = old.find((c) => isNumeric(c.s) && c.s !== "-") ?? old.find((c) => isNumeric(c.s)) ?? descFace;
      dataRows.forEach((r, i) => {
        for (const c of r.cells) s.replaceCell(c, "", { size: c.h });
        const it = its[i];
        if (!it) return;
        const ref = it.ref || (i === 0 ? String(v.instruction_ref ?? "") : "");
        const descX = cDesc ? cDesc.x : 124;
        s.text(ref, header.cell.x, r.y, refFace?.h ?? size * 0.88, { maxWidth: descX - header.cell.x - 4, cell: refFace });
        s.text(it.desc || title, descX, r.y, size, { maxWidth: (cOmit ? cOmit.x - 8 : 380) - descX, cell: descFace });
        s.text(mny(it.omit), omitR, r.y, size, { align: "right", cell: numFace });
        s.text(mny(it.add), addR, r.y, size, { align: "right", cell: numFace });
      });
      const omitSum = its.reduce((a, b) => a + b.omit, 0);
      const addSum = its.reduce((a, b) => a + b.add, 0);
      const sub = s.find(/^Sub-Total$/);
      if (sub) {
        const subNums = sub.row.cells.filter((c) => c.x > sub.cell.x + sub.cell.w && isNumeric(c.s));
        for (const c of subNums) s.replaceCell(c, "", { size: c.h });
        s.text(mny(omitSum), omitR, sub.row.y, size, { align: "right", cell: subNums[0] ?? numFace });
        s.text(mny(addSum), addR, sub.row.y, size, { align: "right", cell: subNums[subNums.length - 1] ?? numFace });
      }
      s.replaceRight(/^Total Value$/, mny(addSum - omitSum || dvoValue), { last: true, rightEdge: addR, bold: true });
    }
    // contract reconciliation summary
    s.replaceRight("Contract Price [a]", mny(price), { align: "right", bold: is27 });
    s.replaceRight("Sum of Previous Determination of", mny(prev), { nearRows: true, align: "right", bold: is27, notLabels: ["Original Contract Completion Date [x]"] });
    s.replaceRight("account payments) [c]", mny(interim), { nearRows: true, align: "right", notLabels: ["Previous Approved Extension of Time (Days) [y]"] });
    s.replaceRight("This Variation Order [d]", mny(dvoValue), { align: "right", bold: true, notLabels: ["This Agreed Extension of Time (Days) [z]"] });
    s.replaceRight("Revised Contract Price", mny(revised), { nearRows: true, align: "right", bold: true, notLabels: ["Revised Contract Completion Date [x+y+z]"] });
    s.replaceRight("VO's % Original Contract Price", pct(revised - price, price), { align: "right", bold: true });
    s.replaceRight("Contract Commencement Date", dmy(v.commencement_date), { align: "right" });
    s.replaceRight("Original Contract Completion Date [x]", dmy(origDate), { nearRows: true, align: "right" });
    s.replaceRight("Previous Approved Extension of Time (Days) [y]", prevEot ? String(prevEot) : "-", { align: "right" });
    s.replaceRight("This Agreed Extension of Time (Days) [z]", thisEot ? String(thisEot) : "-", { align: "right" });
    s.replaceRight("Revised Contract Completion Date [x+y+z]", dmy(revisedDate), { nearRows: true, align: "right", bold: true });
    s.replaceRight("Total Extension (Days Difference to the Original", totalEot ? (is27 ? totalEot.toFixed(2) : String(totalEot)) : "-", { nearRows: true, align: "right", bold: true });
    // information provided with the form (0014 only)
    const info = s.rowsBetween("Document Ref. No", /^Final Determination/).filter((r) => r.cells.length >= 3);
    info.forEach((r, i) => {
      const dates = r.cells.filter((c) => isDateLike(c.s));
      for (const d of dates) s.replaceCell(d, dmy(v.date) || d.s, { align: "left" });
      if (i === 1) {
        const desc = r.cells.find((c) => /^Final Proposal/i.test(c.s));
        if (desc) s.replaceCell(desc, `Final Proposal for ${title}`, { align: "left", rightEdge: (r.cells.find((c) => isNumeric(c.s) && c.x > desc.x + 20)?.x ?? s.tableRight - 90) - 8 });
      }
    });
    // the earlier DVO's signatures, stamps and notes are not carried into the draft
    stripDraftMarks(s, is27 ? /^Review and Recommendation Panel/ : /^Final Determination by the Employer/);
    // signatories
    const sign = (heading: string | RegExp, stop: (string | RegExp)[], names: string[], positions: string[]) => {
      const hit = s.find(heading);
      if (!hit) return;
      const rows = s.pos.rows;
      let prev = hit.row;
      let n = 0;
      for (let i = s.rowIndex(hit.row) + 1; i < rows.length; i++) {
        const r = rows[i];
        if (stop.some((x) => r.cells.some((c) => isLabel(c.s, x)))) break;
        if (r.cells.some((c) => /^name$/i.test(c.s)) && r.cells.some((c) => /^signature$/i.test(c.s))) {
          const nameRow = rows[i - 1] !== prev && rows[i - 1].y - r.y < 16 ? rows[i - 1] : { y: r.y + 8, cells: [] };
          s.person(nameRow, r, names[n] ?? "", positions[n] ?? "", s.blockTop(prev), s.blockBottom(r, rows[i + 1]));
          n++;
          prev = r;
        }
      }
    };
    if (is27) {
      const panel = lines(v.review_panel).map((l) => {
        const i = Math.max(l.lastIndexOf(" – "), l.lastIndexOf(" - "));
        return i >= 0 ? { name: l.slice(i + 3).trim(), position: l.slice(0, i).trim() } : { name: l.trim(), position: "" };
      });
      const all = [{ name: String(v.contractor_rep ?? ""), position: String(v.contractor_rep_position ?? "") }, ...panel];
      sign("Review and Recommendation Panel", [/^RSG-CM-FRM/], all.map((p) => p.name), all.map((p) => p.position));
    } else {
      sign(/^Final Determination by the Employer/, [/^Agreement for Final Determination/], [String(v.employer_rep ?? "")], [String(v.employer_rep_position ?? "")]);
      sign(/^Agreement for Final Determination/, [/^RSG-CM-FRM/], [String(v.contractor_rep ?? "")], [String(v.contractor_rep_position ?? "")]);
    }
  }
  return Buffer.from(await o.l.pdf.save({ useObjectStreams: true }));
}

/* ------------------------------------------------------------------ */
/* RFA – RSG-PR-FRM-0004                                               */

export async function overlayRfa(refBytes: Buffer, v: PackValues, attachments: string[]): Promise<Buffer | null> {
  const o = await open(refBytes, (pages) => {
    const form = pages.filter((p) => /Request for Approval Form - RFA/i.test(pageText(p)));
    const last = form.findIndex((p) => /^Attachments/i.test(p.rows.map((r) => r.cells[0]?.s ?? "").find((s) => /^Attachments/i.test(s)) ?? ""));
    const upto = last >= 0 ? form.slice(0, last + 1) : form.slice(0, 4);
    return upto.map((p) => p.no);
  });
  if (!o) return null;
  const body = (s: Sheet) => {
    const header = s.pos.rows.find((r) => r.cells.some((c) => /^Request for Approval Form - RFA$/i.test(c.s)));
    const footer = s.pos.rows.find((r) => r.cells.some((c) => /^Request for Approval Form - RFA \(/i.test(c.s)));
    return { top: (header ? header.y : s.height - 50) - 32, bottom: footer ? footer.y + 20 : 45 };
  };
  const size = 10.1;
  const lead = 13.6;
  // the description pages: everything after the recommended-for-approval page
  let descPages = o.sheets.filter((s) => /Request for Approval . Description|^Background|Justification|Next Steps|Attachments/i.test(pageText(s.pos)) && !/Recommended for Approval/i.test(pageText(s.pos)) && !/General Information/i.test(pageText(s.pos)));
  for (const s of o.sheets) s.removePictures((p) => p.y + p.h / 2 < s.height * 0.86);
  for (const s of o.sheets) {
    const text = pageText(s.pos);
    if (/General Information/i.test(text) && /RFA Form Reference/i.test(text)) {
      if (v.contact) s.replaceRight("Contact Information", v.contact, { align: "left", rightEdge: s.width - 46 });
      if (v.rfa_no) s.replaceRight("RFA Form Reference", v.rfa_no, { align: "left", notLabels: ["Submittal Date"] });
      if (v.submittal_date || v.date) s.replaceRight("Submittal Date", dmy(v.submittal_date || v.date), { align: "left" });
      // purpose: the big cell between the Item / Description heading and Requesting Department
      const head = s.find(/^Description$/);
      const dept = s.find("Requesting Department");
      const purposeLabel = s.find("Purpose of Request for Approval");
      if (head && dept) {
        const x = head.cell.x - 3;
        const right = s.width - 42;
        const top = head.row.y - 10;
        const bottom = dept.row.y + 14;
        s.restoreText(x, bottom, right - x, top - bottom);
        const bodyFace = s.pos.rows.filter((r) => r.y < head.row.y && r.y > dept.row.y).flatMap((r) => r.cells).find((c) => c.x >= head.cell.x - 2 && !c.b && c.s.length > 10) ?? null;
        const parts: { t: string; bold?: boolean }[] = [];
        for (const p of String(v.purpose ?? "").split(/\n/)) parts.push({ t: p });
        const req = lines(v.requested_approvals);
        if (req.length) {
          parts.push({ t: "" }, { t: "Requested Approvals:", bold: true });
          req.forEach((r, i) => parts.push({ t: `${/^\d+[.)]/.test(r) ? "" : `${i + 1}. `}${r}` }));
        }
        let y = top - lead;
        const width = right - head.cell.x - 4;
        outer: for (const p of parts) {
          const ls = p.t ? s.wrap(p.t, size, width, p.bold, bodyFace) : [""];
          for (const l of ls) {
            if (y < bottom + 4) break outer;
            if (l) s.text(l, head.cell.x, y, size, { bold: !!p.bold, maxWidth: width, cell: bodyFace });
            y -= lead;
          }
        }
        void purposeLabel;
      }
      if (v.requesting_department) s.replaceRight("Requesting Department", v.requesting_department, { align: "left" });
      if (v.subject) s.replaceRight("Contract Name", v.subject, { align: "left", bold: true, rightEdge: s.width - 42 });
      if (v.funding_source) {
        const hit = s.find("Project Budget / Funding Source");
        if (hit) {
          const parts = s.pos.rows.filter((r) => Math.abs(r.y - hit.row.y) <= 14).flatMap((r) => r.cells).filter((c) => c.x > hit.cell.x + hit.cell.w);
          for (const c of parts) s.replaceCell(c, "", { size: c.h });
          const fundFace = parts.find((c) => c.s.length > 6) ?? parts[0] ?? null;
          const ls = s.wrap(String(v.funding_source), size, s.width - 42 - (head?.cell.x ?? 208) - 2, false, fundFace).slice(0, 2);
          const ys = parts.length >= 2 ? [Math.max(...parts.map((c) => c.y)), Math.min(...parts.map((c) => c.y))] : [hit.row.y + 6.5, hit.row.y - 6.5];
          ls.forEach((l, i) => s.text(l, head?.cell.x ?? 208, ls.length === 1 ? hit.row.y : ys[i], size, { maxWidth: s.width - 44 - (head?.cell.x ?? 208), cell: fundFace, bold: false }));
        }
      }
      if (v.budget_remaining) s.replaceRight("Budget Remaining to Date", v.budget_remaining, { align: "left", emptyAt: head?.cell.x ?? 208, rightEdge: s.width - 42 });
      if (v.preferred_tenderer) s.replaceRight("Preferred Tenderer", v.preferred_tenderer, { align: "left", rightEdge: s.width - 42 });
      if (v.contract_price) s.replaceRight(/^Contract Price$/, /^\(?-?[\d,]+(\.\d+)?\)?$/.test(String(v.contract_price)) ? `SAR ${formatMoney(num(v.contract_price))}` : String(v.contract_price), { align: "left", rightEdge: s.width - 42 });
      continue;
    }
    if (/Recommended for Approval/i.test(text) && /Executive Approval/i.test(text)) {
      const head = s.find(/^Function$/);
      const exec = s.find(/^Executive Approval$/);
      if (head && exec) {
        const sigX = head.row.cells.find((c) => /^Signature$/i.test(c.s))?.x ?? 396;
        const between = s.pos.rows.filter((r) => r.y < head.row.y - 4 && r.y > exec.row.y + 4);
        // the Name column starts where the second run of the rows starts (the heading is centred above it)
        const starts = between.flatMap((r) => r.cells).filter((c) => c.x > head.cell.x + 80 && c.x < sigX - 30).map((c) => c.x);
        const nameX = starts.length ? Math.min(...starts) : 226;
        const fnStarts = between.flatMap((r) => r.cells).filter((c) => c.x < nameX - 20).map((c) => c.x);
        const fnX = fnStarts.length ? Math.min(...fnStarts) : 59;
        // the rows that carry a name: one signatory each; wrapped function lines sit within 14pt of it
        const nameRows = between.filter((r) => r.cells.some((c) => Math.abs(c.x - nameX) < 6));
        const people = lines(v.recommended_by).map((l) => {
          const i = l.lastIndexOf(" – ") >= 0 ? l.lastIndexOf(" – ") : l.lastIndexOf(" - ");
          return i >= 0 ? { fn: l.slice(0, i).trim(), name: l.slice(i + 3).trim() } : { fn: "", name: l.trim() };
        });
        nameRows.forEach((r, i) => {
          const parts = between.filter((k) => Math.abs(k.y - r.y) <= 14).flatMap((k) => k.cells);
          for (const c of parts) s.replaceCell(c, "", { size: c.h });
          const p = people[i];
          const bandTop = i === 0 ? head.row.y - 6 : (nameRows[i - 1].y + r.y) / 2;
          const bandBottom = i === nameRows.length - 1 ? exec.row.y + 12 : (r.y + nameRows[i + 1].y) / 2;
          s.restore(sigX - 18, bandBottom - 1, s.width - 42 - (sigX - 18), bandTop - bandBottom + 2, (f) => f.h < 1.5 || f.w < 1.5);
          if (!p) return;
          const rowFace = parts.find((c) => c.s.length > 3) ?? between.flatMap((k) => k.cells)[0] ?? null;
          const fnLines = s.wrap(p.fn, 9.1, nameX - fnX - 8, false, rowFace).slice(0, 2);
          const y0 = fnLines.length > 1 ? r.y + 6 : r.y;
          fnLines.forEach((l, k) => s.text(l, fnX, y0 - k * 12, 9.1, { maxWidth: nameX - fnX - 8, cell: rowFace, bold: false }));
          s.text(p.name, nameX, r.y, 9.1, { maxWidth: sigX - nameX - 10, cell: rowFace, bold: false });
        });
        // the executive approver, centred under the Executive Approval band
        const execRows = s.pos.rows.filter((r) => r.y < exec.row.y - 4 && r.y > 40 && !r.cells.some((c) => /^Request for Approval Form/i.test(c.s) || /^Revision \d/i.test(c.s)));
        const labelRow = execRows.find((r) => r.cells.some((c) => /^Signature$/i.test(c.s)));
        const nameCells = execRows.filter((r) => r !== labelRow).flatMap((r) => r.cells);
        const posCell = labelRow?.cells.find((c) => !/^(signature|date)$/i.test(c.s));
        const all = [...nameCells, ...(posCell ? [posCell] : [])];
        const centre = all.length ? Math.min(...all.map((c) => c.x + c.w / 2)) : 140;
        for (const c of all) s.replaceCell(c, "", { size: c.h });
        const nameY = nameCells[0]?.y ?? (labelRow ? labelRow.y + 13 : 74);
        const execFace = nameCells[0] ?? posCell ?? null;
        if (v.executive_approver) s.text(String(v.executive_approver), centre, nameY, 9.1, { align: "center", maxWidth: 200, cell: execFace, bold: false });
        if (v.executive_position) s.text(String(v.executive_position), centre, labelRow ? labelRow.y : nameY - 13, 9.1, { align: "center", maxWidth: 200, cell: posCell ?? execFace, bold: false });
        if (labelRow) s.clearSignature(labelRow, exec.row.y - 8, sigX - 30);
      }
      continue;
    }
  }
  // the description pages: the form's own bands and borders stay, the text is written afresh
  if (descPages.length) {
    const sections: { h: string; body: string[] }[] = [];
    const add = (h: string, val: unknown, numbered = false) => {
      const ls = lines(val);
      if (ls.length) sections.push({ h, body: numbered ? ls.map((l, i) => (/^\d+[.)]/.test(l) ? l : `${i + 1}. ${l}`)) : ls });
    };
    add("Background:", v.background);
    add("Justification:", v.justification);
    add("Options considered:", v.options);
    add("Next Steps:", v.next_steps, true);
    const att = lines(v.attachments).length ? lines(v.attachments) : attachments;
    const attList = att.map((l, i) => (/^\d+[.)]/.test(l) ? l : `${i + 1}. ${l}`));
    descPages = descPages.slice(0, 4);
    // the writable zones, in order: each page's body, split around any heading band the form has there
    interface Zone {
      s: Sheet;
      top: number;
      bottom: number;
      face: Cell | null;
    }
    const zones: Zone[] = [];
    let attZone = null as Zone | null;
    for (const sh of descPages) {
      const { top, bottom } = body(sh);
      const face = sh.pos.rows.filter((r) => r.y < top && r.y > bottom).flatMap((r) => r.cells).find((c) => !c.b && c.s.length > 12) ?? null;
      // the text of the page goes; its bands and borders come back
      sh.restoreText(50, bottom, sh.width - 58, top - bottom);
      const bands = sh.pos.rows
        .filter((r) => r.y < top && r.y > bottom)
        .map((r) => ({ row: r, band: sh.fillAt(r.cells[0].x + 2, r.y + 2) }))
        .filter((b): b is { row: Row; band: Fill } => !!b.band && b.band.w > sh.width * 0.5 && b.band.h < 30)
        .sort((a, b) => b.row.y - a.row.y);
      let y = top;
      for (const b of bands) {
        const heading = b.row.cells.map((c) => c.s).join(" ");
        // the band's own heading is written back in its place
        for (const c of b.row.cells) sh.text(c.s, c.x, c.y, c.h ?? 9.1, { color: lum(b.band.color) < DARK ? "#ffffff" : "#000000", cell: c });
        if (y - (b.band.y + b.band.h) > 30) zones.push({ s: sh, top: y, bottom: b.band.y + b.band.h + 4, face });
        y = b.band.y - 6;
        if (/^Attachments/i.test(heading)) attZone = { s: sh, top: y, bottom, face };
      }
      if (y - bottom > 30 && !(attZone && attZone.s === sh && attZone.top === y)) zones.push({ s: sh, top: y, bottom, face });
    }
    if (attZone) zones.splice(zones.indexOf(attZone), 1);
    let zi = 0;
    let z: Zone | undefined = zones[0];
    let y = z ? z.top - 4 : 0;
    const x = 59;
    const width = (sh: Sheet) => sh.width - 42 - x;
    const next = () => {
      zi++;
      z = zones[zi];
      if (!z) return false;
      y = z.top - 4;
      return true;
    };
    const line = (t: string, bold = false, indent = 0) => {
      if (!z) return false;
      if (y < z.bottom + lead && !next()) return false;
      if (t && z) z.s.text(t, x + indent, y, size, { bold, maxWidth: width(z.s) - indent, cell: z.face });
      y -= bold ? lead * 1.15 : lead * 1.2;
      return true;
    };
    outer: for (const sec of sections) {
      y -= lead * 0.6;
      if (!line(sec.h, true)) break;
      for (const p of sec.body) {
        const numbered = /^\d+[.)]\s/.test(p);
        if (!z) break outer;
        for (const l of z.s.wrap(p, size, width(z.s) - (numbered ? 18 : 0), false, z.face)) if (!line(l, false, numbered ? 18 : 0)) break outer;
        y -= lead * 0.35;
      }
    }
    // the attachments list: under the form's own Attachments band, or after the text when the form has none
    if (attList.length) {
      if (attZone) {
        z = attZone as Zone;
        y = z.top - 6;
      } else if (z) {
        y -= lead * 0.6;
        if (y < z.bottom + lead * 3) next();
        if (z) {
          z.s.page.drawRectangle({ x: x - 1, y: y - 4, width: width(z.s) + 2, height: 16, color: rgbOf("#b89c67"), borderWidth: 0 });
          z.s.text("Attachments", x + 4, y, 9.1, { color: "#ffffff", bold: true, cell: z.face });
          y -= lead * 1.5;
        }
      }
      zi = zones.length;
      for (const b of attList) if (!line(b, false, 18)) break;
    }
  }
  return Buffer.from(await o.l.pdf.save({ useObjectStreams: true }));
}
