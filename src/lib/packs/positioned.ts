import path from "node:path";
/**
 * A PDF read by position rather than by text order: the RSG forms are tables, and the value of a
 * cell sits on the same row to the right of its label (or in the rows beneath a heading). pdf.js
 * gives every text run with its coordinates; the runs are grouped into rows and sorted left to
 * right, which is all a form needs.
 */

export interface Cell {
  x: number;
  y: number;
  w: number;
  s: string;
  /** font size in points (for writing a new value in the same place) */
  h?: number;
  /** set when the run is in a bold face */
  b?: boolean;
  /** set when the run is in an italic face */
  i?: boolean;
  /** the face the run is set in, as the PDF names it ("NotoSans-Bold", "OpenSans-Regular", "ArialMT") */
  f?: string;
}
export interface Row {
  y: number;
  cells: Cell[];
}
export interface PosPage {
  no: number;
  rows: Row[];
  /** page size in points */
  w?: number;
  h?: number;
}

/** where pdf.js finds its standard fonts and CMaps – given outright, so the bundled server finds them too */
export function pdfjsOptions(): Record<string, unknown> {
  const base = path.join(process.cwd(), "node_modules", "pdfjs-dist");
  return { useSystemFonts: true, disableFontFace: true, isEvalSupported: false, standardFontDataUrl: `${base}/standard_fonts/`, cMapUrl: `${base}/cmaps/`, cMapPacked: true, verbosity: 0 };
}

export async function readPositioned(bytes: Buffer): Promise<PosPage[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), ...pdfjsOptions() }).promise;
    const pages: PosPage[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items: Cell[] = [];
      for (const it of tc.items as { str?: string; transform?: number[]; width?: number; fontName?: string }[]) {
        const s = String(it.str ?? "").replace(/\s+/g, " ").trim();
        if (!s || !it.transform) continue;
        const style = it.fontName ? (tc.styles as Record<string, { fontFamily?: string }>)[it.fontName] : undefined;
        let face = "";
        try {
          const fobj = it.fontName && page.commonObjs.has(it.fontName) ? (page.commonObjs.get(it.fontName) as { name?: string } | null) : null;
          face = String(fobj?.name ?? style?.fontFamily ?? "").replace(/^[A-Z]{6}\+/, "");
        } catch {
          face = String(style?.fontFamily ?? "");
        }
        const h = Math.round(Math.hypot(it.transform[0], it.transform[1]) * 10) / 10;
        items.push({ x: Math.round(it.transform[4]), y: Math.round(it.transform[5]), w: Math.round(it.width ?? 0), s, h, f: face, b: /bold|black|heavy|semibold/i.test(face), i: /italic|oblique/i.test(face) });
      }
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows: Row[] = [];
      for (const it of items) {
        const r = rows.find((r) => Math.abs(r.y - it.y) <= 3);
        if (r) r.cells.push(it);
        else rows.push({ y: it.y, cells: [it] });
      }
      for (const r of rows) {
        r.cells.sort((a, b) => a.x - b.x);
        // runs that touch each other are one cell ("Proposed Variation Order" + " No.")
        const merged: Cell[] = [];
        for (const c of r.cells) {
          const last = merged[merged.length - 1];
          // only runs that touch (a font change inside one cell); a number never joins what follows it
          if (last && c.x - (last.x + last.w) < 2 && c.x >= last.x && !/^[\d(,.-]/.test(c.s) && !/^\(?-?[\d,]+(\.\d+)?\)?$/.test(last.s)) {
            last.s = `${last.s} ${c.s}`.replace(/\s+/g, " ");
            last.w = c.x + c.w - last.x;
          } else merged.push({ ...c });
        }
        r.cells = merged;
      }
      rows.sort((a, b) => b.y - a.y);
      const view = page.view as number[] | undefined;
      pages.push({ no: p, rows, w: view ? Math.abs(view[2] - view[0]) : undefined, h: view ? Math.abs(view[3] - view[1]) : undefined });
      page.cleanup();
    }
    await doc.destroy();
    return pages;
  } catch (e) {
    console.error("pdf read failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").replace(/[:.]+$/, "").trim();

/** Does the cell read as this label? Exact after normalising, or starting with it when the label is long. */
export function isLabel(cell: string, label: string | RegExp): boolean {
  if (label instanceof RegExp) return label.test(cell);
  const c = norm(cell);
  const l = norm(label);
  return c === l || (l.length >= 12 && c.startsWith(l));
}

/** The first row on any page holding a cell that reads as the label. */
export function findLabel(pages: PosPage[], label: string | RegExp): { page: PosPage; row: Row; idx: number; cell: Cell } | null {
  for (const page of pages) for (const row of page.rows) for (let i = 0; i < row.cells.length; i++) if (isLabel(row.cells[i].s, label)) return { page, row, idx: i, cell: row.cells[i] };
  return null;
}

/** The value beside the label on the same row: the next cell to the right that is not another label. */
export function valueRight(pages: PosPage[], label: string | RegExp, opts: { notLabels?: (string | RegExp)[]; maxDx?: number; nextRow?: boolean } = {}): string {
  const hit = findLabel(pages, label);
  if (!hit) return "";
  let next = hit.row.cells[hit.idx + 1];
  if (next && /^(a|b|c|d|e|f)\s*(=\s*[a-z+\-]+)?$/i.test(next.s)) next = hit.row.cells[hit.idx + 2];
  if (next && (!opts.maxDx || next.x - hit.cell.x <= opts.maxDx) && !(opts.notLabels ?? []).some((l) => isLabel(next.s, l))) {
    // a money value that ran into the next label: "2,196,802.90 % of approved DVOs…"
    const m = next.s.match(/^(\(?-?[\d,]+(?:\.\d+)?\)?|[0-9]{1,2}-[A-Za-z]{3}-\d{2,4}|[\d.]+%)\s+\S.*$/);
    return m ? m[1] : next.s;
  }
  if (opts.nextRow) {
    // a wrapped label: the value sits on the row beneath, first money-like cell to the right of the label's x
    const rows = hit.page.rows;
    const i = rows.indexOf(hit.row);
    for (let j = i + 1; j <= i + 2 && j < rows.length; j++) {
      const c = rows[j].cells.find((k) => k.x > hit.cell.x + 40 && k.x < hit.cell.x + 320 && /^\(?-?[\d,]+(\.\d+)?\)?$|^-$|^[0-9]{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(k.s));
      if (c) return c.s;
    }
  }
  return "";
}

/** The text of the rows beneath a heading, until a row that starts with one of the stop labels (or a heading-like cell ending with ":"). */
export function valueBelow(pages: PosPage[], label: string | RegExp, stops: (string | RegExp)[], maxRows = 30): string {
  const hit = findLabel(pages, label);
  if (!hit) return "";
  const rows = hit.page.rows;
  const start = rows.indexOf(hit.row);
  const lines: string[] = [];
  // text on the label row itself, to the right, counts too
  const same = hit.row.cells.slice(hit.idx + 1).map((c) => c.s).join(" ");
  if (same && !stops.some((s) => isLabel(same, s))) lines.push(same);
  for (let i = start + 1; i < Math.min(rows.length, start + 1 + maxRows); i++) {
    const r = rows[i];
    const first = r.cells[0]?.s ?? "";
    if (stops.some((s) => r.cells.some((c) => isLabel(c.s, s)))) break;
    if (/^(\d\)|[a-e]\)|\d+\.\s)?[A-Z][^.]{2,60}:$/.test(first) && r.cells.length === 1) break;
    if (/^(rsg|trs)-[a-z]{2}-frm|^page \d+ of \d+|^rev\. ?\d/i.test(first)) continue;
    lines.push(r.cells.map((c) => c.s).join(" "));
  }
  return lines.join("\n").trim();
}

/**
 * The rows between a header row and a stop row, as cells placed under the header's columns. The
 * header row is the first one after `anchor` (a heading above the table) holding `headerLabel`;
 * each column is the span between the midpoints of neighbouring header labels.
 */
export function tableUnder(pages: PosPage[], headerLabel: string | RegExp, stop: string | RegExp, cols: (string | RegExp)[], anchor?: string | RegExp): string[][] {
  let page: PosPage | null = null;
  let start = -1;
  for (const pg of pages) {
    let from = 0;
    if (anchor) {
      const a = pg.rows.findIndex((r) => r.cells.some((c) => isLabel(c.s, anchor)));
      if (a < 0) continue;
      from = a + 1;
    }
    const h = pg.rows.findIndex((r, i) => i >= from && r.cells.some((c) => isLabel(c.s, headerLabel)));
    if (h >= 0) {
      page = pg;
      start = h;
      break;
    }
  }
  if (!page) return [];
  const rows = page.rows;
  const xs: number[] = cols.map((c) => {
    for (let i = Math.max(0, start - 2); i <= start + 2 && i < rows.length; i++) {
      const cell = rows[i].cells.find((k) => isLabel(k.s, c));
      if (cell) return cell.x + Math.min(cell.w, 40) / 2;
    }
    return -1;
  });
  const known = xs.map((x, j) => ({ x, j })).filter((k) => k.x >= 0).sort((a, b) => a.x - b.x);
  const bounds = known.map((k, i) => (i + 1 < known.length ? (k.x + known[i + 1].x) / 2 : Infinity));
  const colOf = (cx: number) => {
    for (let i = 0; i < known.length; i++) if (cx < bounds[i]) return known[i].j;
    return known[known.length - 1]?.j ?? 0;
  };
  const out: string[][] = [];
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.cells.some((c) => isLabel(c.s, stop))) break;
    if (r.cells.every((c) => /^[A-Z](\s*=\s*[A-Z+\-\s]+)?$/.test(c.s))) continue;
    if (r.cells.every((c) => cols.some((l) => isLabel(c.s, l)))) continue;
    const line = cols.map(() => "");
    for (const c of r.cells) {
      const j = colOf(c.x + c.w / 2);
      line[j] = line[j] ? `${line[j]} ${c.s}` : c.s;
    }
    if (line.some(Boolean)) out.push(line);
  }
  return out;
}

/** The rows under a heading ("Prepared/Initiated By:") until the next heading: the "Name – Position" pairs on them. */
export function peopleUnder(pages: PosPage[], label: string | RegExp, stops: (string | RegExp)[], isPosition: (s: string) => boolean): { name: string; position: string }[] {
  const hit = findLabel(pages, label);
  if (!hit) return [];
  const rows = hit.page.rows;
  const start = rows.indexOf(hit.row);
  const out: { name: string; position: string }[] = [];
  for (let i = start + 1; i < Math.min(rows.length, start + 14); i++) {
    const r = rows[i];
    if (stops.some((s) => r.cells.some((c) => isLabel(c.s, s)))) break;
    const cells = r.cells.filter((c) => !/^(name|position|signature|date|sign)$/i.test(c.s));
    if (cells.length >= 2 && isPosition(cells[1].s) && /^[A-Za-z][A-Za-z'’.\- ]{3,60}$/.test(cells[0].s) && !/^note/i.test(cells[0].s)) out.push({ name: cells[0].s, position: cells[1].s });
  }
  return out;
}

/** A money cell → number (parentheses negative), or null. */
export function moneyOf(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/SAR/i, "").trim().match(/^\(?-?[\d,]+(\.\d+)?\)?$/);
  if (!m) return null;
  const neg = /^\(|^-/.test(s.trim());
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** The rows after an anchor that carry at least `minMoney` money cells, as [text…, numbers…] in cell order – the way a budget table reads. */
export function numericRowsAfter(pages: PosPage[], anchor: string | RegExp, stop: string | RegExp, minMoney: number, maxRows = 40): string[][] {
  for (const pg of pages) {
    const a = pg.rows.findIndex((r) => r.cells.some((c) => isLabel(c.s, anchor)));
    if (a < 0) continue;
    const out: string[][] = [];
    for (let i = a + 1; i < Math.min(pg.rows.length, a + 1 + maxRows); i++) {
      const r = pg.rows[i];
      if (r.cells.some((c) => isLabel(c.s, stop))) break;
      const money = r.cells.filter((c) => moneyOf(c.s) !== null || c.s === "-");
      if (money.length >= minMoney) out.push(r.cells.map((c) => c.s));
    }
    return out;
  }
  return [];
}

/**
 * Every "Name – Position" pair on a page with the heading (Prepared / Reviewed / Approved) it sits
 * under. On the RSG revision-history table the heading is centred in its merged cell, so it may
 * sit below the first names of its block: each block is read as symmetric about its heading, a
 * name whose position wraps onto the next row is joined to it, and a name and position in one run
 * ("Rufino Bautista Sr. Commercial Manager") is split at the position word.
 */
export function peopleWithHeadings(page: PosPage, headings: RegExp, isPosition: (s: string) => boolean): { heading: string; name: string; position: string }[] {
  type Item = { kind: "h"; text: string } | { kind: "p"; name: string; position: string };
  const items: Item[] = [];
  const POS_START = /^(Sr\.?|Senior|Head|Group|Associate|Executive|Chief|Director|Manager|Specialist|Chairman|Lead|Planning|Commercial|Project|Programme|Program|Junior|Principal|Assistant|General|Deputy|Vice|President|Partner|Consultant|Engineer|Quantity|Cost|Contracts?|Claims?|Legal|Finance|Financial|Technical|Design|Construction|Development|Operations?|Aviation|Site|Resident)\b/i;
  const NAME = /^[A-Za-z][A-Za-z'’.\-/ ]{3,60}$/;
  let pendingPos = ""; // a position whose first line sits on the row above its name (a two-line position centred on the name)
  for (const r of page.rows) {
    const h = r.cells.find((c) => headings.test(c.s));
    if (h) items.push({ kind: "h", text: h.s.replace(/[:\s]+$/, "") });
    const cells = r.cells.filter((c) => c !== h && !/^(name|position|signature|date|sign|rev\.?|details|\d{2})$/i.test(c.s));
    if (!cells.length) continue;
    const last = [...items].reverse().find((it): it is Extract<Item, { kind: "p" }> => it.kind === "p");
    const wraps = !!last && (/\/$/.test(last.name) || last.position.split("(").length > last.position.split(")").length || /[&,\/]$|'s$|’s$|\bof$|\band$/.test(last.position));
    const one = cells.length === 1 ? cells[0].s : "";
    if (one && isPosition(one)) {
      // "Rufino Bautista Sr. Commercial Manager" in one run splits at the position word; a bare position waits for its name
      const words = one.split(/\s+/);
      let split = false;
      for (let n = 2; n <= Math.min(4, words.length - 1); n++) {
        const rest = words.slice(n).join(" ");
        if (POS_START.test(rest) && isPosition(rest) && NAME.test(words.slice(0, n).join(" "))) {
          items.push({ kind: "p", name: words.slice(0, n).join(" "), position: rest });
          split = true;
          break;
        }
      }
      if (!split) pendingPos = pendingPos ? `${pendingPos} ${one}` : one;
    } else if (one && pendingPos && NAME.test(one) && !/^note/i.test(one)) {
      items.push({ kind: "p", name: one, position: pendingPos });
      pendingPos = "";
    } else if (one && wraps && last && /^[A-Z(][A-Za-z)’']{2,30}$/.test(one)) last.position = `${last.position} ${one}`;
    else if (cells.length >= 2 && wraps && last && /\/$/.test(last.name) && NAME.test(cells[0].s)) {
      last.name = `${last.name} ${cells[0].s}`.replace(/\/\s+/, " / ");
      last.position = `${last.position} ${cells.slice(1).map((c) => c.s).join(" ")}`;
    } else if (cells.length >= 2 && isPosition(cells[1].s) && NAME.test(cells[0].s) && !/^note/i.test(cells[0].s)) items.push({ kind: "p", name: cells[0].s, position: cells.slice(1).map((c) => c.s).join(" ") });
  }
  if (!items.some((it) => it.kind === "h")) return [];
  // blocks: each heading takes as many names below it as sit above it (since the last block's end)
  const out: { heading: string; name: string; position: string }[] = [];
  const people = items.map((it, i) => ({ it, i })).filter((x) => x.it.kind === "p");
  const heads = items.map((it, i) => ({ it, i })).filter((x) => x.it.kind === "h");
  let taken = 0; // index into people
  heads.forEach((h, hi) => {
    const above = people.filter((p, pi) => pi >= taken && p.i < h.i).length;
    const isLast = hi === heads.length - 1;
    const nextHead = heads[hi + 1];
    const below = isLast ? people.length - taken - above : Math.min(above, people.filter((p, pi) => pi >= taken + above && p.i < nextHead.i).length);
    const count = above + below;
    for (const p of people.slice(taken, taken + count)) if (p.it.kind === "p") out.push({ heading: (h.it as { kind: "h"; text: string }).text, name: p.it.name, position: p.it.position });
    taken += count;
  });
  // anything left after the last block belongs to it
  for (const p of people.slice(taken)) if (p.it.kind === "p") out.push({ heading: (heads[heads.length - 1].it as { kind: "h"; text: string }).text, name: p.it.name, position: p.it.position });
  return out;
}

/* ------------------------------------------------------------------ */
/* the filled rectangles of a page: the shaded cells and bands of the form, so a value can be
   rewritten on the colour that is already there                        */

export interface Fill {
  x: number;
  y: number;
  w: number;
  h: number;
  /** "#rrggbb" */
  color: string;
  /** a stroked line (a cell border), kept so it can be drawn again after an area is cleared */
  stroke?: boolean;
  /** a placed picture (a logo, a signature, a stamp): its box only */
  image?: boolean;
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

export async function readFills(bytes: Buffer, pageNos?: number[]): Promise<Map<number, Fill[]>> {
  const out = new Map<number, Fill[]>();
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), ...pdfjsOptions() }).promise;
    const OPS = pdfjs.OPS as Record<string, number>;
    const FILLS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const STROKES = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    for (let p = 1; p <= doc.numPages; p++) {
      if (pageNos && !pageNos.includes(p)) continue;
      const page = await doc.getPage(p);
      const ops = await page.getOperatorList();
      const fills: Fill[] = [];
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      let color = "#000000";
      let strokeColor = "#000000";
      let lineWidth = 1;
      const stack: { ctm: Matrix; color: string; strokeColor: string; lineWidth: number }[] = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i] as unknown[];
        if (fn === OPS.save) stack.push({ ctm, color, strokeColor, lineWidth });
        else if (fn === OPS.restore) {
          const s = stack.pop();
          if (s) ({ ctm, color, strokeColor, lineWidth } = s);
        } else if (fn === OPS.transform) ctm = mul(args as Matrix, ctm);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push({ ctm, color, strokeColor, lineWidth });
          const m = args[0] as Matrix | null;
          if (m) ctm = mul(m, ctm);
        } else if (fn === OPS.paintFormXObjectEnd) {
          const s = stack.pop();
          if (s) ({ ctm, color, strokeColor, lineWidth } = s);
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
          // an image fills the unit square of the current transform
          const pts = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
          const xs = pts.map((q) => q.x);
          const ys = pts.map((q) => q.y);
          fills.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), color: "#000000", image: true });
        } else if (fn === OPS.setFillRGBColor) color = String(args[0] ?? color);
        else if (fn === OPS.setStrokeRGBColor) strokeColor = String(args[0] ?? strokeColor);
        else if (fn === OPS.setLineWidth) lineWidth = Number(args[0] ?? 1);
        else if (fn === OPS.setFillGray) {
          const g = Math.round(Number(args[0] ?? 0) * 255).toString(16).padStart(2, "0");
          color = `#${g}${g}${g}`;
        } else if (fn === OPS.setStrokeGray) {
          const g = Math.round(Number(args[0] ?? 0) * 255).toString(16).padStart(2, "0");
          strokeColor = `#${g}${g}${g}`;
        } else if (fn === OPS.constructPath && (FILLS.has(Number(args[0])) || STROKES.has(Number(args[0])))) {
          const mm = args[2] as ArrayLike<number> | undefined;
          if (!mm || mm.length < 4 || !Number.isFinite(mm[0])) continue;
          const pts = [apply(ctm, mm[0], mm[1]), apply(ctm, mm[2], mm[1]), apply(ctm, mm[0], mm[3]), apply(ctm, mm[2], mm[3])];
          const xs = pts.map((q) => q.x);
          const ys = pts.map((q) => q.y);
          const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : "#000000");
          const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
          // a filled box: a shaded cell, or – when it is hair-thin – a border drawn as a fill
          if (FILLS.has(Number(args[0])) && box.w > 0.2 && box.h > 0.2) fills.push({ ...box, color: hex(color), stroke: box.h < 1.5 || box.w < 1.5 ? true : undefined });
          if (STROKES.has(Number(args[0]))) {
            // only straight lines are kept (a thin box); anything else would not be a border
            const t = Math.max(0.4, Math.min(2, lineWidth * Math.hypot(ctm[0], ctm[1])));
            if (box.h < 1.5 && box.w > 2) fills.push({ x: box.x, y: box.y - t / 2, w: box.w, h: t, color: hex(strokeColor), stroke: true });
            else if (box.w < 1.5 && box.h > 2) fills.push({ x: box.x - t / 2, y: box.y, w: t, h: box.h, color: hex(strokeColor), stroke: true });
          }
        }
      }
      out.set(p, fills);
      page.cleanup();
    }
    await doc.destroy();
  } catch {
    /* no fills: values are written on white */
  }
  return out;
}
