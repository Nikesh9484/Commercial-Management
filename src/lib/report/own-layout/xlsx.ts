import JSZip from "jszip";

/**
 * Edits a workbook in place at the XML level: values are written into the cells of the sheets the
 * file already has, every formula, style, merged range, conditional format, hidden sheet and defined
 * name is kept exactly as it was, and rows can be inserted inside a table (the rows beneath, the
 * formulas that point at them and the ranges that cover them all move together). This is what lets
 * the dashboard give the monthly report back in the very layout it was uploaded in.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");

export function colNo(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function colLetters(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
const refOf = (r: number, c: number) => `${colLetters(c)}${r}`;
const parseRef = (ref: string) => {
  const m = ref.match(/^\$?([A-Z]{1,3})\$?(\d+)$/);
  return m ? { c: colNo(m[1]), r: Number(m[2]) } : null;
};

export interface XCell {
  c: number;
  /** the attributes other than r (style, type) */
  attrs: string;
  /** the inner XML (<f>, <v>, <is>) */
  inner: string;
}
export interface XRow {
  r: number;
  attrs: string;
  cells: Map<number, XCell>;
}
export class XSheet {
  name: string;
  path: string;
  /** hidden in the workbook (a stale copy or a working sheet): left exactly as it is */
  hidden = false;
  head = "";
  tail = "";
  private raw: string | null = null;
  private parsed: Map<number, XRow> | null = null;
  private loader: () => string;
  dirty = false;
  constructor(name: string, path: string, loader: () => string) {
    this.name = name;
    this.path = path;
    this.loader = loader;
  }
  /** true while the sheet has not been parsed: its file in the zip is left as it is */
  get untouched(): boolean {
    return !this.parsed;
  }
  private get xml(): string {
    if (this.raw === null && !this.parsed) this.raw = this.loader();
    return this.raw ?? "";
  }
  /** a cheap look at the XML without parsing it */
  mentions(text: string): boolean {
    if (this.parsed) return (this.head + this.tail).includes(text) || [...this.parsed.values()].some((r) => [...r.cells.values()].some((c) => c.inner.includes(text)));
    const hit = this.xml.includes(text);
    if (!hit) this.raw = null; // nothing here: let the text go
    return hit;
  }
  get rows(): Map<number, XRow> {
    if (!this.parsed) this.parse(this.xml);
    return this.parsed!;
  }
  set rows(m: Map<number, XRow>) {
    this.parsed = m;
  }
  private parse(xml: string) {
    this.parsed = new Map();
    this.raw = null;
    const open = xml.indexOf("<sheetData");
    const selfClosed = open >= 0 && xml.slice(open, xml.indexOf(">", open) + 1).endsWith("/>");
    if (open < 0) {
      this.head = xml;
      this.tail = "";
      return;
    }
    if (selfClosed) {
      const end = xml.indexOf(">", open) + 1;
      this.head = `${xml.slice(0, open)}<sheetData>`;
      this.tail = `</sheetData>${xml.slice(end)}`;
      return;
    }
    const dataStart = xml.indexOf(">", open) + 1;
    const close = xml.indexOf("</sheetData>");
    this.head = xml.slice(0, dataStart);
    this.tail = xml.slice(close);
    const body = xml.slice(dataStart, close);
    for (const m of body.matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
      const attrs = m[1];
      const r = Number(attrs.match(/\br="(\d+)"/)?.[1] ?? 0);
      const row: XRow = { r, attrs: attrs.replace(/\s*\br="\d+"/, ""), cells: new Map() };
      for (const cm of (m[3] ?? "").matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = cm[1].match(/\br="([A-Z]+\d+)"/)?.[1] ?? "";
        const p = parseRef(ref);
        if (!p) continue;
        row.cells.set(p.c, { c: p.c, attrs: cm[1].replace(/\s*\br="[A-Z]+\d+"/, ""), inner: cm[3] ?? "" });
      }
      this.parsed.set(r, row);
    }
  }
  serialize(): string {
    if (!this.parsed) return this.xml;
    const rows = [...this.rows.values()].sort((a, b) => a.r - b.r);
    const out: string[] = [this.head];
    for (const row of rows) {
      const cells = [...row.cells.values()].sort((a, b) => a.c - b.c);
      const spans = cells.length ? ` spans="${cells[0].c}:${cells[cells.length - 1].c}"` : "";
      const attrs = row.attrs.replace(/\s*\bspans="[^"]*"/, "") + spans;
      out.push(`<row r="${row.r}"${attrs}>`);
      for (const cell of cells) out.push(cell.inner ? `<c r="${refOf(row.r, cell.c)}"${cell.attrs}>${cell.inner}</c>` : `<c r="${refOf(row.r, cell.c)}"${cell.attrs}/>`);
      out.push("</row>");
    }
    out.push(this.tail);
    let xml = out.join("");
    // the dimension follows the rows
    const last = rows.length ? rows[rows.length - 1].r : 1;
    const maxC = rows.reduce((m, r) => Math.max(m, ...[...r.cells.keys()]), 1);
    xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${refOf(last, maxC)}"/>`);
    return xml;
  }
}

export class XWorkbook {
  zip!: JSZip;
  sheets: XSheet[] = [];
  strings: string[] = [];
  private workbookXml = "";
  /** workbook.xml as bytes – it can run to tens of megabytes of defined names, so it is never held as one string */
  private workbookBytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private readonly serialBase = Date.UTC(1899, 11, 30);

  static async load(bytes: Buffer): Promise<XWorkbook> {
    const wb = new XWorkbook();
    wb.zip = await JSZip.loadAsync(bytes);
    wb.workbookBytes = (await wb.zip.file("xl/workbook.xml")?.async("nodebuffer")) ?? Buffer.alloc(0);
    // the sheet list only needs the <sheets> block
    const sheetsBlock = wb.workbookBytes.toString("utf8", 0, Math.min(wb.workbookBytes.length, 400_000));
    wb.workbookXml = sheetsBlock.includes("</sheets>") ? sheetsBlock.slice(0, sheetsBlock.indexOf("</sheets>") + 9) : wb.workbookBytes.toString("utf8");
    const rels = (await wb.zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
    const relMap = new Map<string, string>();
    for (const m of rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) relMap.set(m[1], m[2]);
    for (const m of rels.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g)) if (!relMap.has(m[2])) relMap.set(m[2], m[1]);
    const ss = await wb.zip.file("xl/sharedStrings.xml")?.async("string");
    if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) wb.strings.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(""));
    for (const m of wb.workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const attrs = m[1];
      const name = attrs.match(/\bname="([^"]+)"/)?.[1];
      const rid = attrs.match(/\br:id="([^"]+)"/)?.[1];
      const target = rid ? relMap.get(rid) : undefined;
      if (!name || !target) continue;
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\/?xl\//, "")}`;
      const entry = wb.zip.file(path);
      if (!entry) continue;
      const bytes = await entry.async("nodebuffer");
      const sheet = new XSheet(unesc(name), path, () => bytes.toString("utf8"));
      sheet.hidden = /\bstate="(hidden|veryHidden)"/.test(attrs);
      wb.sheets.push(sheet);
    }
    return wb;
  }

  sheet(...names: string[]): XSheet | undefined {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    for (const n of names) {
      const hit = this.sheets.find((s) => norm(s.name) === norm(n));
      if (hit) return hit;
    }
    return undefined;
  }

  /** The text of a cell as a person reads it (shared strings, inline strings, numbers, cached formula results). */
  text(s: XSheet, r: number, c: number): string {
    const cell = s.rows.get(r)?.cells.get(c);
    if (!cell) return "";
    const t = cell.attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
    if (t === "s") {
      const i = Number(cell.inner.match(/<v>(\d+)<\/v>/)?.[1] ?? -1);
      return i >= 0 ? (this.strings[i] ?? "") : "";
    }
    if (t === "inlineStr") return [...cell.inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join("");
    if (t === "str" || t === "e") return unesc(cell.inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
    return unesc(cell.inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
  }
  number(s: XSheet, r: number, c: number): number | null {
    const cell = s.rows.get(r)?.cells.get(c);
    if (!cell) return null;
    const t = cell.attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
    if (t === "s" || t === "inlineStr" || t === "str" || t === "e") {
      const n = Number(this.text(s, r, c).replace(/[^\d.-]/g, ""));
      return Number.isFinite(n) && /\d/.test(this.text(s, r, c)) ? n : null;
    }
    const v = cell.inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  hasFormula(s: XSheet, r: number, c: number): boolean {
    return /<f\b/.test(s.rows.get(r)?.cells.get(c)?.inner ?? "");
  }
  /** A date cell's ISO date (serial numbers and dd-Mon-yy texts alike). */
  date(s: XSheet, r: number, c: number): string | null {
    const n = this.number(s, r, c);
    if (n !== null && n > 20000 && n < 80000) return new Date(this.serialBase + Math.round(n) * 86400000).toISOString().slice(0, 10);
    return null;
  }
  serial(iso: string): number | null {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - this.serialBase) / 86400000);
  }

  /**
   * Writes a value. A formula cell is left alone unless `force`; a null clears the value. Text goes
   * in as an inline string; a date as its serial number with the cell's own format kept.
   */
  set(s: XSheet, r: number, c: number, value: string | number | null | undefined, opts: { force?: boolean; date?: boolean; styleFrom?: XCell } = {}): boolean {
    let row = s.rows.get(r);
    if (!row) {
      row = { r, attrs: "", cells: new Map() };
      s.rows.set(r, row);
    }
    const cell = row.cells.get(c);
    if (cell && !opts.force && /<f\b/.test(cell.inner)) return false;
    const style = (cell ?? opts.styleFrom)?.attrs.match(/\bs="(\d+)"/)?.[1];
    const sAttr = style ? ` s="${style}"` : "";
    if (value === null || value === undefined || value === "") {
      row.cells.set(c, { c, attrs: sAttr, inner: "" });
    } else if (typeof value === "number") {
      row.cells.set(c, { c, attrs: sAttr, inner: `<v>${Number.isFinite(value) ? String(value) : "0"}</v>` });
    } else if (opts.date || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const n = this.serial(value);
      if (n === null) row.cells.set(c, { c, attrs: `${sAttr} t="inlineStr"`, inner: `<is><t>${esc(value)}</t></is>` });
      else row.cells.set(c, { c, attrs: sAttr, inner: `<v>${n}</v>` });
    } else {
      row.cells.set(c, { c, attrs: `${sAttr} t="inlineStr"`, inner: `<is><t xml:space="preserve">${esc(value)}</t></is>` });
    }
    s.dirty = true;
    return true;
  }

  /** The first row (from `from`) whose cells carry every one of the words, else null. */
  headerRow(s: XSheet, words: string[], from = 1, to = 40): number | null {
    for (let r = from; r <= to; r++) {
      const row = s.rows.get(r);
      if (!row) continue;
      const joined = [...row.cells.keys()].map((c) => this.text(s, r, c).toLowerCase()).join(" | ");
      if (words.every((w) => joined.includes(w.toLowerCase()))) return r;
    }
    return null;
  }
  /** The column on a row whose text holds the words (first match), else 0. */
  columnOf(s: XSheet, r: number, ...words: string[]): number {
    const row = s.rows.get(r);
    if (!row) return 0;
    for (const c of [...row.cells.keys()].sort((a, b) => a - b)) {
      const t = this.text(s, r, c).toLowerCase().replace(/\s+/g, " ");
      if (words.every((w) => t.includes(w.toLowerCase()))) return c;
    }
    return 0;
  }

  /**
   * Inserts `n` rows before row `at`, each a copy of row `template` (styles and formulas, no values).
   * Everything from row `at` downwards moves down by `n`: the rows, the references in every formula
   * of every sheet, merged ranges, conditional formats, data validations and defined names.
   */
  insertRows(s: XSheet, at: number, n: number, template: number): void {
    if (n <= 0) return;
    this.expandSharedFormulas(s);
    const shiftRef = (col: string, abs: string, rowNo: string) => {
      const r = Number(rowNo);
      return `${col}${abs}${r >= at ? r + n : r}`;
    };
    const shiftFormula = (f: string, sameSheet: boolean) => {
      // sheet-qualified references to this sheet move; unqualified ones only inside this sheet
      let out = f.replace(/(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!(\$?[A-Z]{1,3})(\$?)(\d+)(?::(\$?[A-Z]{1,3})(\$?)(\d+))?/g, (m, q: string | undefined, u: string | undefined, c1: string, a1: string, r1: string, c2?: string, a2?: string, r2?: string) => {
        const name = (q ?? u ?? "").replace(/''/g, "'");
        if (name.toLowerCase() !== s.name.toLowerCase()) return m;
        const head = q !== undefined ? `'${q}'!` : `${u}!`;
        return `${head}${shiftRef(c1, a1, r1)}${c2 ? `:${shiftRef(c2, a2 ?? "", r2 ?? "")}` : ""}`;
      });
      if (sameSheet) {
        // unqualified: not preceded by a letter, digit, "!" or "'" (so sheet-qualified ones and names stay)
        out = out.replace(/(?<![A-Za-z0-9_!'.$])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, c: string, a: string, r: string) => (Number(r) > 1048576 ? m : shiftRef(c, a, r)));
      }
      return out;
    };
    const shiftRange = (sq: string) => sq.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (_m, c: string, a: string, r: string) => shiftRef(c, a, r));
    // 1. this sheet's rows
    const rows = [...s.rows.values()].sort((a, b) => b.r - a.r);
    const tpl = s.rows.get(template);
    s.rows = new Map();
    for (const row of rows) {
      const nr = row.r >= at ? row.r + n : row.r;
      for (const cell of row.cells.values()) if (/<f\b/.test(cell.inner)) cell.inner = cell.inner.replace(/<f\b([^>]*)>([\s\S]*?)<\/f>/g, (_m, a: string, f: string) => `<f${a}>${esc(shiftFormula(unesc(f), true))}</f>`);
      row.r = nr;
      s.rows.set(nr, row);
    }
    for (let i = 0; i < n; i++) {
      const r = at + i;
      const cells = new Map<number, XCell>();
      for (const cell of tpl?.cells.values() ?? []) {
        const fm = cell.inner.match(/<f\b([^>]*)>([\s\S]*?)<\/f>/);
        let inner = "";
        if (fm) {
          // the template row's own row number becomes this row's
          const tplRow = template >= at ? template + n : template;
          const f = unesc(fm[2]).replace(/(?<![A-Za-z0-9_!'.$])(\$?[A-Z]{1,3})(\d+)(?![\d(A-Za-z_])/g, (m, c: string, rr: string) => (Number(rr) === tplRow ? `${c}${r}` : m));
          inner = `<f>${esc(f)}</f>`;
        }
        cells.set(cell.c, { c: cell.c, attrs: cell.attrs.replace(/\s*\bt="[^"]*"/, ""), inner });
      }
      s.rows.set(r, { r, attrs: (tpl?.attrs ?? "").replace(/\s*\bspans="[^"]*"/, ""), cells });
    }
    // 2. the sheet's own ranges
    s.tail = s.tail
      .replace(/<mergeCell ref="([^"]+)"\/>/g, (_m, ref: string) => `<mergeCell ref="${shiftRange(ref)}"/>`)
      .replace(/sqref="([^"]+)"/g, (_m, ref: string) => `sqref="${shiftRange(ref)}"`)
      .replace(/<formula>([\s\S]*?)<\/formula>/g, (_m, f: string) => `<formula>${esc(shiftFormula(unesc(f), true))}</formula>`)
      .replace(/<formula1>([\s\S]*?)<\/formula1>/g, (_m, f: string) => `<formula1>${esc(shiftFormula(unesc(f), true))}</formula1>`);
    // 3. other sheets' formulas pointing here
    const token = s.name.replace(/'/g, "''").split(" ")[0];
    for (const o of this.sheets) {
      if (o === s || !o.mentions(token)) continue;
      let touched = false;
      for (const row of o.rows.values())
        for (const cell of row.cells.values())
          if (cell.inner.includes("<f") && cell.inner.includes(s.name.replace(/'/g, "''").split(" ")[0])) {
            const before = cell.inner;
            cell.inner = cell.inner.replace(/<f\b([^>]*)>([\s\S]*?)<\/f>/g, (_m, a: string, f: string) => `<f${a}>${esc(shiftFormula(unesc(f), false))}</f>`);
            if (cell.inner !== before) touched = true;
          }
      if (touched) o.dirty = true;
      if (o.tail.includes(s.name.split(" ")[0])) {
        o.tail = o.tail.replace(/<formula>([\s\S]*?)<\/formula>/g, (_m, f: string) => `<formula>${esc(shiftFormula(unesc(f), false))}</formula>`);
        o.dirty = true;
      }
    }
    // 4. defined names
    // defined names (a workbook can carry hundreds of thousands): one pass, only the entries naming this sheet are rebuilt
    if (this.workbookBytes.includes(token)) {
      const xml = this.workbookBytes;
      const parts: Buffer[] = [];
      let pos = 0;
      let scan = 0;
      // jump from one mention of the sheet to the next (never a scan per entry: 200,000 entries × 17 MB would
      // run for minutes) and rebuild only the entry each mention sits in
      for (;;) {
        const hit = xml.indexOf(token, scan);
        if (hit < 0) break;
        const open = xml.lastIndexOf("<definedName", hit);
        const gt = open < 0 ? -1 : xml.indexOf(">", open);
        const close = gt < 0 ? -1 : xml.indexOf("</definedName>", gt);
        if (open < 0 || gt < 0 || close < 0 || hit < gt || hit > close || open < pos) {
          scan = hit + 1; // a mention outside a defined name's body (a sheet entry, an already rebuilt part)
          continue;
        }
        const body = xml.toString("utf8", gt + 1, close);
        parts.push(xml.subarray(pos, gt + 1), Buffer.from(esc(shiftFormula(unesc(body), false)), "utf8"));
        pos = close;
        scan = close + "</definedName>".length;
      }
      if (parts.length) {
        parts.push(xml.subarray(pos));
        this.workbookBytes = Buffer.concat(parts);
      }
    }
    s.dirty = true;
  }

  /** Shared formulas become plain ones, so rows can move without breaking a shared block. */
  private expandSharedFormulas(s: XSheet) {
    const masters = new Map<string, { text: string; r: number; c: number }>();
    for (const row of s.rows.values())
      for (const cell of row.cells.values()) {
        const m = cell.inner.match(/<f\b([^>]*\bt="shared"[^>]*)>([\s\S]+?)<\/f>/);
        if (m) {
          const si = m[1].match(/\bsi="(\d+)"/)?.[1];
          if (si !== undefined) masters.set(si, { text: unesc(m[2]), r: row.r, c: cell.c });
        }
      }
    if (!masters.size) return;
    const offset = (f: string, dr: number, dc: number) =>
      f.replace(/(?<![A-Za-z0-9_!'.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, ca: string, col: string, ra: string, rowNo: string) => {
        const c = ca ? col : colLetters(Math.max(1, colNo(col) + dc));
        const r = ra ? rowNo : String(Math.max(1, Number(rowNo) + dr));
        return `${ca}${c}${ra}${r}`;
      });
    for (const row of s.rows.values())
      for (const cell of row.cells.values()) {
        const m = cell.inner.match(/<f\b([^>]*\bt="shared"[^>]*)(?:\/>|>([\s\S]*?)<\/f>)/);
        if (!m) continue;
        const si = m[1].match(/\bsi="(\d+)"/)?.[1] ?? "";
        const master = masters.get(si);
        if (!master) continue;
        const text = m[2] && m[2].trim() ? unesc(m[2]) : offset(master.text, row.r - master.r, cell.c - master.c);
        cell.inner = cell.inner.replace(m[0], `<f>${esc(text)}</f>`);
      }
    s.dirty = true;
  }

  /** The workbook recalculates when it opens, so every total reflects the values written. */
  async save(): Promise<Buffer> {
    for (const s of this.sheets) if (s.dirty && !s.untouched) this.zip.file(s.path, s.serialize());
    // the calculation flag is patched in the bytes: only the tag itself is decoded
    const wbBytes = this.workbookBytes;
    const at = wbBytes.indexOf("<calcPr");
    let patched: Buffer;
    if (at >= 0) {
      const end = wbBytes.indexOf(">", at) + 1;
      const tag = wbBytes.toString("utf8", at, end).replace(/<calcPr\b([^>]*?)\s*\/?>/, (_m, a: string) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`);
      patched = Buffer.concat([wbBytes.subarray(0, at), Buffer.from(tag, "utf8"), wbBytes.subarray(end)]);
    } else {
      const close = wbBytes.lastIndexOf("</workbook>");
      patched = close >= 0 ? Buffer.concat([wbBytes.subarray(0, close), Buffer.from('<calcPr fullCalcOnLoad="1"/>', "utf8"), wbBytes.subarray(close)]) : wbBytes;
    }
    this.zip.file("xl/workbook.xml", patched);
    // the calculation chain is rebuilt by Excel; a stale one makes it complain
    if (this.zip.file("xl/calcChain.xml")) {
      this.zip.remove("xl/calcChain.xml");
      const ct = await this.zip.file("[Content_Types].xml")?.async("string");
      if (ct) this.zip.file("[Content_Types].xml", ct.replace(/<Override[^>]*calcChain\.xml"[^>]*\/>/, ""));
      const rels = await this.zip.file("xl/_rels/workbook.xml.rels")?.async("string");
      if (rels) this.zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship[^>]*calcChain\.xml"[^>]*\/>/, ""));
    }
    return Buffer.from(await this.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  }
}
