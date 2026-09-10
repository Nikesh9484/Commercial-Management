import {
  AlignmentType,
  BorderStyle,
  DeletedTextRun,
  Document,
  Footer,
  Header,
  HeadingLevel,
  InsertedTextRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ParagraphChild,
} from "docx";
import { diffArrays, diffWords } from "diff";
import { APP_NAME } from "../brand";
import type { EarDocument } from "./model";

/**
 * Writes the Employer's Assessment Report as a print-ready Word file.
 * For a revised submission the report is written on top of the previous EAR: every difference is a
 * tracked change by "Commercial Manager" (Track Changes is switched on in the file), so the reviewer
 * opens it in Word and sees exactly what moved since the previous report.
 */
export const REVISION_AUTHOR = "Commercial Manager";

const NAVY = "1F3A5F";
const ACCENT = "0E7C86";
const GREY_LINE = "BFC7D1";
const ZEBRA = "F3F6FA";
const NOTE_FILL = "FFF7E6";
const FONT = "Calibri";
const PAGE_W = 11906; // A4 in DXA
const MARGIN = 1134; // 2 cm
const TEXT_W = PAGE_W - 2 * MARGIN;

type Kind = "title" | "subtitle" | "meta" | "summary" | "heading" | "para" | "note" | "bullet" | "numbered" | "caption" | "thead" | "trow" | "listhead";
interface Line {
  kind: Kind;
  text: string;
  level?: number;
  cells?: string[];
  /** table identity so deleted rows land inside the right table */
  table?: number;
  /** numbered list instance */
  list?: number;
  label?: string;
}

/** The report as an ordered list of lines – the unit of comparison for tracked changes. */
function flatten(doc: EarDocument): Line[] {
  const out: Line[] = [{ kind: "title", text: doc.title }];
  if (doc.subtitle) out.push({ kind: "subtitle", text: doc.subtitle });
  for (const m of doc.meta) out.push({ kind: "meta", text: `${m.label} | ${m.value}`, label: m.label, cells: [m.label, m.value], table: 0 });
  const s = doc.summary;
  const money = (v: number) => (v ? `SAR ${Math.round(v).toLocaleString("en-US")}` : "–");
  const days = (v: number) => (v ? `${Math.round(v)} days` : "–");
  const glance = (cells: string[], kind: Kind = "summary"): Line => ({ kind, text: cells.join(" | "), cells, table: 1 });
  out.push(glance(["Assessment at a glance", "Claimed by the Contractor", "Assessed by the Employer"], "thead"));
  out.push(glance(["Extension of time", days(s.eot_claimed_days), days(s.eot_assessed_days)]));
  out.push(glance(["Additional payment", money(s.cost_claimed_sar), money(s.cost_assessed_sar)]));
  if (s.recommendation) out.push(glance(["Employer's position", s.recommendation, ""]));
  let tableNo = 2;
  let listNo = 1;
  for (const sec of doc.sections) {
    out.push({ kind: "heading", text: sec.heading, level: sec.level });
    for (const b of sec.blocks) {
      if (b.type === "paragraph") out.push({ kind: "para", text: b.text });
      else if (b.type === "note") out.push({ kind: "note", text: b.text });
      else if (b.type === "bullets") for (const i of b.items) out.push({ kind: "bullet", text: i });
      else if (b.type === "numbered") {
        const list = listNo++;
        for (const i of b.items) out.push({ kind: "numbered", text: i, list });
      } else {
        const t = tableNo++;
        if (b.caption) out.push({ kind: "caption", text: b.caption });
        const width = Math.max(b.header.length, ...b.rows.map((r) => r.length), 1);
        if (b.header.length) out.push({ kind: "thead", text: b.header.join(" | "), cells: pad(b.header, width), table: t });
        for (const r of b.rows) out.push({ kind: "trow", text: r.join(" | "), cells: pad(r, width), table: t });
      }
    }
  }
  if (doc.documents_relied_on.length) {
    out.push({ kind: "heading", text: "Documents relied upon", level: 1 });
    for (const d of doc.documents_relied_on) out.push({ kind: "bullet", text: d });
  }
  if (doc.information_gaps.length) {
    out.push({ kind: "heading", text: "Information gaps and requests to the Contractor", level: 1 });
    for (const g of doc.information_gaps) out.push({ kind: "bullet", text: g });
  }
  return out;
}

const pad = (cells: string[], n: number) => Array.from({ length: n }, (_, i) => cells[i] ?? "");
const splitRow = (s: string) => s.split(/\s*\|\s*/);
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Splits the previous report (Word / PDF text) into paragraphs. PDF text keeps printed line breaks, so those are joined back. */
export function paragraphsFromText(text: string, kind: string): string[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  const out: string[] = [];
  if (kind === "pdf") {
    let cur = "";
    for (const l of raw) {
      if (!l) {
        if (cur) out.push(cur);
        cur = "";
        continue;
      }
      const joins = cur && !/[.:;!?)]$/.test(cur) && (cur.length > 55 || /^[a-z(]/.test(l));
      if (joins) cur = `${cur} ${l}`;
      else {
        if (cur) out.push(cur);
        cur = l;
      }
    }
    if (cur) out.push(cur);
  } else {
    for (const l of raw) if (l) out.push(l);
  }
  // page furniture of a previous print (header / footer lines)
  return out.filter((l) => l.length > 1 && !/^page \d+( of \d+)?$/i.test(l) && !/· Confidential · Page/.test(l));
}

interface Aligned {
  /** per new line: unchanged, inserted, or changed from `old` */
  mode: ("same" | "inserted" | "changed")[];
  old: (string | undefined)[];
  /** old lines deleted before new line i (key = i; key = lines.length for trailing deletions) */
  deletedBefore: Map<number, string[]>;
}

function similarity(a: string, b: string): number {
  const parts = diffWords(a, b);
  let same = 0;
  let total = 0;
  for (const p of parts) {
    total += p.value.length;
    if (!p.added && !p.removed) same += 2 * p.value.length;
  }
  return total ? same / (total + same / 2) : 1;
}

/** Lines of the new report against the paragraphs of the previous one. */
function align(oldLines: string[], lines: Line[]): Aligned {
  const res: Aligned = { mode: lines.map(() => "inserted"), old: lines.map(() => undefined), deletedBefore: new Map() };
  const chunks = diffArrays(oldLines.map(norm), lines.map((l) => norm(l.text)));
  let oi = 0;
  let ni = 0;
  const pushDeleted = (at: number, text: string) => {
    const list = res.deletedBefore.get(at) ?? [];
    list.push(text);
    res.deletedBefore.set(at, list);
  };
  for (let c = 0; c < chunks.length; c++) {
    const ch = chunks[c];
    if (!ch.added && !ch.removed) {
      for (let k = 0; k < ch.value.length; k++) {
        res.mode[ni] = "same";
        res.old[ni] = oldLines[oi];
        oi++;
        ni++;
      }
      continue;
    }
    if (ch.removed) {
      const removed = ch.value.length;
      const next = chunks[c + 1];
      const added = next && next.added ? next.value.length : 0;
      // pair removed with added lines in order; pairs that look alike become word-level changes
      let r = 0;
      let a = 0;
      while (r < removed && a < added) {
        const o = oldLines[oi + r];
        const n = lines[ni + a].text;
        if (similarity(o, n) >= 0.4) {
          res.mode[ni + a] = "changed";
          res.old[ni + a] = o;
          r++;
          a++;
        } else if (removed - r > added - a) {
          pushDeleted(ni + a, o);
          r++;
        } else {
          res.mode[ni + a] = "inserted";
          a++;
        }
      }
      for (; r < removed; r++) pushDeleted(ni + a, oldLines[oi + r]);
      for (; a < added; a++) res.mode[ni + a] = "inserted";
      oi += removed;
      ni += added;
      if (added) c++;
      continue;
    }
    // added only
    for (let k = 0; k < ch.value.length; k++) res.mode[ni++] = "inserted";
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Word building                                                       */
/* ------------------------------------------------------------------ */

let revId = 1;
const stamp = () => new Date().toISOString();

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  color?: string;
  size?: number;
}

function runs(text: string, style: RunStyle, mode: "same" | "inserted" | "changed" | "deleted", old?: string, track = true): ParagraphChild[] {
  if (!track || mode === "same") return [new TextRun({ text, ...style })];
  if (mode === "inserted") return [new InsertedTextRun({ text, ...style, id: revId++, author: REVISION_AUTHOR, date: stamp() })];
  if (mode === "deleted") return [new DeletedTextRun({ text, ...style, id: revId++, author: REVISION_AUTHOR, date: stamp() })];
  const out: ParagraphChild[] = [];
  for (const p of diffWords(old ?? "", text)) {
    if (p.removed) out.push(new DeletedTextRun({ text: p.value, ...style, id: revId++, author: REVISION_AUTHOR, date: stamp() }));
    else if (p.added) out.push(new InsertedTextRun({ text: p.value, ...style, id: revId++, author: REVISION_AUTHOR, date: stamp() }));
    else out.push(new TextRun({ text: p.value, ...style }));
  }
  return out;
}

const border = { style: BorderStyle.SINGLE, size: 4, color: GREY_LINE };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(children: Paragraph[], width: number, opts: { fill?: string; bold?: boolean } = {}) {
  return new TableCell({
    children,
    width: { size: width, type: WidthType.DXA },
    borders,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: "auto" } : undefined,
  });
}

function widths(n: number, first = 0.32): number[] {
  if (n === 1) return [TEXT_W];
  const w0 = Math.round(TEXT_W * first);
  const rest = Math.floor((TEXT_W - w0) / (n - 1));
  const arr = [w0, ...Array.from({ length: n - 1 }, () => rest)];
  arr[n - 1] += TEXT_W - arr.reduce((a, b) => a + b, 0);
  return arr;
}

export interface RenderOptions {
  /** paragraphs of the previous EAR – when given, the file is written with tracked changes */
  previousLines?: string[] | null;
  revised: boolean;
  revisionNo: number;
  /** shown in the page header */
  reference?: string;
}

export async function renderEarDocx(doc: EarDocument, opts: RenderOptions): Promise<Buffer> {
  revId = 1;
  const lines = flatten(doc);
  const track = !!(opts.previousLines && opts.previousLines.length);
  const al: Aligned = track ? align(opts.previousLines!, lines) : { mode: lines.map(() => "same"), old: lines.map(() => undefined), deletedBefore: new Map() };

  const body: (Paragraph | Table)[] = [];
  const deletedParagraph = (text: string, style: RunStyle = {}) => new Paragraph({ spacing: { after: 120 }, children: runs(text, style, "deleted") });
  const flushDeleted = (i: number, into: (Paragraph | Table)[] = body) => {
    for (const t of al.deletedBefore.get(i) ?? []) into.push(deletedParagraph(t));
  };

  // tables are built row by row from the line list
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    flushDeleted(i);
    const mode = al.mode[i];
    const old = al.old[i];
    if (ln.kind === "title") {
      body.push(new Paragraph({ heading: HeadingLevel.TITLE, spacing: { before: 0, after: 120 }, children: runs(ln.text, { color: NAVY }, mode, old, track) }));
      i++;
      continue;
    }
    if (ln.kind === "subtitle") {
      body.push(new Paragraph({ spacing: { after: 240 }, children: runs(ln.text, { color: ACCENT, size: 26, bold: true }, mode, old, track) }));
      i++;
      continue;
    }
    if (ln.kind === "meta" || ln.kind === "summary" || ln.kind === "thead" || ln.kind === "trow") {
      // gather the whole table
      const t = ln.table!;
      const rows: TableRow[] = [];
      const width = ln.cells!.length;
      const w = widths(width, ln.kind === "meta" ? 0.3 : ln.table === 1 ? 0.34 : Math.min(0.4, Math.max(0.2, 1 / width + 0.08)));
      let zebra = 0;
      while (i < lines.length && lines[i].table === t) {
        for (const d of al.deletedBefore.get(i) ?? []) {
          const cells = pad(splitRow(d), width);
          rows.push(new TableRow({ children: cells.map((c, k) => cell([new Paragraph({ children: runs(c, {}, "deleted") })], w[k])) }));
        }
        const row = lines[i];
        const m = al.mode[i];
        const o = al.old[i];
        const oldCells = o ? pad(splitRow(o), width) : undefined;
        const head = row.kind === "thead";
        const fill = head ? NAVY : row.kind === "meta" ? undefined : zebra++ % 2 ? ZEBRA : undefined;
        rows.push(
          new TableRow({
            tableHeader: head,
            children: row.cells!.map((c, k) => {
              const style: RunStyle = head ? { bold: true, color: "FFFFFF" } : row.kind === "meta" && k === 0 ? { bold: true, color: NAVY } : row.kind === "summary" && k === 0 ? { bold: true } : {};
              // metadata rows: the label never changes – only the value is compared
              const cellMode = m === "changed" && oldCells && oldCells[k] === c ? "same" : m;
              const cellOld = oldCells ? oldCells[k] : undefined;
              const alignRight = !head && row.kind === "trow" && /^[-–]?\s*(SAR\s*)?[\d,.]+%?$/.test(c);
              return cell([new Paragraph({ alignment: alignRight ? AlignmentType.RIGHT : AlignmentType.LEFT, children: runs(c, style, cellMode === "changed" && cellOld === undefined ? "inserted" : cellMode, cellOld, track) })], w[k], { fill: row.kind === "meta" && k === 0 ? ZEBRA : fill });
            }),
          }),
        );
        i++;
      }
      body.push(new Table({ rows, width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: w }));
      body.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
      continue;
    }
    if (ln.kind === "heading") {
      const lvl = ln.level === 1 ? HeadingLevel.HEADING_1 : ln.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      body.push(new Paragraph({ heading: lvl, spacing: { before: ln.level === 1 ? 320 : 200, after: 120 }, keepNext: true, children: runs(ln.text, {}, mode, old, track) }));
    } else if (ln.kind === "para") {
      body.push(new Paragraph({ spacing: { after: 140, line: 276 }, alignment: AlignmentType.JUSTIFIED, children: runs(ln.text, {}, mode, old, track) }));
    } else if (ln.kind === "note") {
      body.push(new Paragraph({ spacing: { after: 140 }, shading: { type: ShadingType.CLEAR, fill: NOTE_FILL, color: "auto" }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "D97706", space: 8 } }, indent: { left: 200 }, children: runs(ln.text, { italics: true }, mode, old, track) }));
    } else if (ln.kind === "caption") {
      body.push(new Paragraph({ spacing: { before: 120, after: 60 }, keepNext: true, children: runs(ln.text, { bold: true, color: NAVY, size: 20 }, mode, old, track) }));
    } else if (ln.kind === "bullet") {
      body.push(new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: runs(ln.text, {}, mode, old, track) }));
    } else if (ln.kind === "numbered") {
      body.push(new Paragraph({ numbering: { reference: "numbers", level: 0, instance: ln.list }, spacing: { after: 80 }, children: runs(ln.text, {}, mode, old, track) }));
    }
    i++;
  }
  flushDeleted(lines.length);

  const headerText = `${doc.title}${opts.reference ? ` · ${opts.reference}` : ""}${opts.revised ? ` · Revision ${opts.revisionNo}` : ""}`;
  const document = new Document({
    creator: REVISION_AUTHOR,
    title: doc.title,
    description: `${APP_NAME} – Employer's Assessment Report`,
    features: track ? { trackRevisions: true } : undefined,
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 44, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { after: 120 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 25, bold: true, color: ACCENT, font: FONT }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true, color: NAVY, font: FONT }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
        { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GREY_LINE, space: 4 } },
                children: [new TextRun({ text: headerText, size: 16, color: "6B7280" })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                border: { top: { style: BorderStyle.SINGLE, size: 6, color: GREY_LINE, space: 4 } },
                children: [new TextRun({ text: `${APP_NAME} · Confidential · Page `, size: 16, color: "6B7280" }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "6B7280" }), new TextRun({ text: " of ", size: 16, color: "6B7280" }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "6B7280" })],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(document);
}
