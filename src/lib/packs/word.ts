import JSZip from "jszip";
import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, Packer, PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell, TableOfContents, TableRow, TextRun, VerticalAlign, WidthType } from "docx";
import { formatDate, formatMoney } from "../format";
import { fieldForLabel, normLabel, packRefLabel, type PackField, type PackType, type PackValues, type TemplateInspection } from "./shared";

/**
 * The Word output of a document pack. When an RSG template (.docx) has been uploaded for the
 * category, the form is written INTO it: every {{field}} placeholder is replaced, and every label
 * cell of its tables that sits next to (or above) a blank cell is filled with the matching field –
 * the template's own fonts, borders, header and footer stay untouched. Without a template the form
 * is laid out from scratch in the same graphite style as the PDF.
 */

/* ------------------------------------------------------------------ */
/* values as they are written                                          */

export function displayValue(f: PackField, raw: string | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (f.kind === "money") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) && /\d/.test(v) ? formatMoney(n) : v;
  }
  if (f.kind === "date") return /^\d{4}-\d{2}-\d{2}/.test(v) ? formatDate(v) : v;
  return v;
}

export function formattedValues(type: PackType, values: PackValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of type.fields) out[f.key] = displayValue(f, values[f.key]);
  return out;
}

/* ------------------------------------------------------------------ */
/* XML helpers                                                         */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The text of a run of XML: every <w:t>, tabs and breaks. */
function textOf(xml: string): string {
  let out = "";
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] !== undefined ? unesc(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n";
  return out;
}

/** A run carrying `text`, with the run properties given (may be ""), line breaks kept. */
function runXml(rPr: string, text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const body = lines.map((l) => `<w:t xml:space="preserve">${esc(l)}</w:t>`).join("<w:br/>");
  return `<w:r>${rPr}${body}</w:r>`;
}

/** The first run properties in a piece of XML, so a value takes the font of the label beside it. */
function firstRPr(xml: string): string {
  const m = xml.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/);
  if (m) return m[1].replace(/<w:b\/>|<w:b w:val="[^"]*"\/>|<w:bCs\/>/g, "");
  const p = xml.match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)\s*<\/w:pPr>/);
  return p ? p[1].replace(/<w:b\/>|<w:b w:val="[^"]*"\/>|<w:bCs\/>/g, "") : "";
}

/** Replaces the runs of one paragraph with a single run of `text`, keeping the paragraph properties. */
function setParagraphText(pXml: string, text: string, rPr?: string): string {
  const open = pXml.match(/^<w:p(?:\s[^>]*)?>/)?.[0] ?? "<w:p>";
  const pPr = pXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  const props = rPr ?? firstRPr(pXml);
  return `${open}${pPr}${runXml(props, text)}</w:p>`;
}

/** Writes `text` into a table cell: the first paragraph carries it, the others are dropped. */
function setCellText(tcXml: string, text: string, rPr: string): string {
  const open = tcXml.match(/^<w:tc(?:\s[^>]*)?>/)?.[0] ?? "<w:tc>";
  const tcPr = tcXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] ?? "";
  const firstP = tcXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/)?.[0] ?? "<w:p/>";
  const p = firstP === "<w:p/>" ? "<w:p></w:p>" : firstP;
  const own = firstRPr(p);
  return `${open}${tcPr}${setParagraphText(p, text, own || rPr)}</w:tc>`;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Is this cell blank – nothing, or only dots, dashes and underscores where a value goes? */
function isBlank(text: string): boolean {
  return !text.replace(/[\s.…_\-–—:]/g, "");
}

interface Cell {
  xml: string;
  text: string;
}

/**
 * Walks every table, innermost first (RSG forms nest tables inside cells), and lets `fn` rewrite
 * the cells of each one. Returns the rewritten XML.
 */
function walkTables(xml: string, fn: (rows: Cell[][]) => Cell[][] | null): string {
  const stash: string[] = [];
  let work = xml;
  // innermost tables first: the ones that hold no other table
  const inner = /<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<\/w:tbl>/;
  for (let guard = 0; guard < 2000; guard++) {
    const m = work.match(inner);
    if (!m || m.index === undefined) break;
    const tbl = m[0];
    // rows and cells are rebuilt by position – blank cells are identical XML, so a text replace
    // would land a value in the wrong one
    const rowRe = /<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g;
    const rows: Cell[][] = [];
    const rowSpans: { start: number; end: number; cells: { start: number; end: number }[] }[] = [];
    let r: RegExpExecArray | null;
    while ((r = rowRe.exec(tbl))) {
      const cells: Cell[] = [];
      const spans: { start: number; end: number }[] = [];
      const cellRe = /<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g;
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(r[0]))) {
        cells.push({ xml: c[0], text: textOf(c[0]) });
        spans.push({ start: c.index, end: c.index + c[0].length });
      }
      rows.push(cells);
      rowSpans.push({ start: r.index, end: r.index + r[0].length, cells: spans });
    }
    const next = fn(rows);
    let out = tbl;
    if (next) {
      let rebuilt = "";
      let pos = 0;
      rowSpans.forEach((rs, i) => {
        rebuilt += tbl.slice(pos, rs.start);
        const rowXml = tbl.slice(rs.start, rs.end);
        let rowOut = "";
        let cp = 0;
        rs.cells.forEach((cs, j) => {
          rowOut += rowXml.slice(cp, cs.start) + next[i][j].xml;
          cp = cs.end;
        });
        rowOut += rowXml.slice(cp);
        rebuilt += rowOut;
        pos = rs.end;
      });
      rebuilt += tbl.slice(pos);
      out = rebuilt;
    }
    stash.push(out);
    work = work.slice(0, m.index) + `\u0000TBL${stash.length - 1}\u0000` + work.slice(m.index + tbl.length);
  }
  // put the tables back, outermost last
  for (let guard = 0; guard < 2000 && /\u0000TBL\d+\u0000/.test(work); guard++) work = work.replace(/\u0000TBL(\d+)\u0000/g, (_m, i) => stash[Number(i)]);
  return work;
}

function parts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
}

/* ------------------------------------------------------------------ */

/** What the template will take: its {{placeholders}} and the label cells beside a blank cell. */
export async function inspectTemplate(bytes: Buffer, type: PackType): Promise<TemplateInspection> {
  const zip = await JSZip.loadAsync(bytes);
  const placeholders = new Set<string>();
  const labels: { label: string; field: string | null }[] = [];
  const seen = new Set<string>();
  for (const name of parts(zip)) {
    const xml = await zip.file(name)!.async("string");
    // placeholders may be split across runs: read paragraph by paragraph
    for (const p of xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []) {
      const t = textOf(p);
      let m: RegExpExecArray | null;
      const re = new RegExp(PLACEHOLDER.source, "g");
      while ((m = re.exec(t))) placeholders.add(m[1]);
    }
    walkTables(xml, (rows) => {
      rows.forEach((cells, i) =>
        cells.forEach((c, j) => {
          const label = c.text.replace(/\s+/g, " ").trim();
          if (!label || label.length > 90) return;
          const right = cells[j + 1];
          const below = rows[i + 1]?.[j];
          const target = right && isBlank(right.text) ? right : below && isBlank(below.text) && !(right && !isBlank(right.text) && j + 1 < cells.length && false) ? below : null;
          if (!target) return;
          const key = normLabel(label);
          if (!key || seen.has(key)) return;
          seen.add(key);
          labels.push({ label, field: fieldForLabel(type, label)?.key ?? null });
        }),
      );
      return null;
    });
  }
  const taken = new Set([...placeholders, ...labels.map((l) => l.field).filter(Boolean)]);
  const unmatched = type.fields.filter((f) => !taken.has(f.key)).map((f) => f.key);
  return { placeholders: [...placeholders], labels, unmatched };
}

/** The template with the pack's values written in. */
export async function fillTemplate(bytes: Buffer, type: PackType, values: PackValues): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const shown = formattedValues(type, values);
  const byKey = new Map(type.fields.map((f) => [f.key, f]));
  for (const name of parts(zip)) {
    let xml = await zip.file(name)!.async("string");
    // 1. label cells: the blank cell to the right, else the blank cell below, takes the value
    xml = walkTables(xml, (rows) => {
      const next = rows.map((r) => r.map((c) => ({ ...c })));
      const used = new Set<string>();
      rows.forEach((cells, i) =>
        cells.forEach((c, j) => {
          const label = c.text.replace(/\s+/g, " ").trim();
          if (!label || label.length > 90 || /\{\{/.test(label)) return;
          const f = fieldForLabel(type, label);
          if (!f) return;
          const value = shown[f.key];
          if (!value) return;
          const right = cells[j + 1];
          const below = rows[i + 1]?.[j];
          const rPr = firstRPr(c.xml);
          if (right && isBlank(right.text) && !used.has(`${i}:${j + 1}`)) {
            next[i][j + 1].xml = setCellText(right.xml, value, rPr);
            used.add(`${i}:${j + 1}`);
          } else if (below && isBlank(below.text) && !used.has(`${i + 1}:${j}`)) {
            next[i + 1][j].xml = setCellText(below.xml, value, rPr);
            used.add(`${i + 1}:${j}`);
          }
        }),
      );
      return next;
    });
    // 2. {{placeholders}} anywhere, even when Word split them over several runs
    xml = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (p) => {
      const t = textOf(p);
      if (!/\{\{/.test(t)) return p;
      const replaced = t.replace(PLACEHOLDER, (_m, key) => (byKey.has(key) ? shown[key] ?? "" : `{{${key}}}`));
      return setParagraphText(p, replaced);
    });
    zip.file(name, xml);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

/* ------------------------------------------------------------------ */
/* the built-in layout, when no template has been uploaded            */

const GRAPHITE = "33383F";
const BRONZE = "A8845C";
const PALE = "F2F2F0";
const LINE = "D6D6D3";
const FONT = "Arial";

function cellBorders() {
  const b = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  return { top: b, bottom: b, left: b, right: b };
}

function textCell(text: string, opts: { bold?: boolean; shade?: string; width: number; color?: string; size?: number; span?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): TableCell {
  const lines = text.split("\n");
  return new TableCell({
    width: { size: opts.width, type: WidthType.DXA },
    columnSpan: opts.span,
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade, color: "auto" } : undefined,
    borders: cellBorders(),
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: lines.map((l) => new Paragraph({ alignment: opts.align, children: [new TextRun({ text: l, bold: opts.bold, font: FONT, size: opts.size ?? 18, color: opts.color })] })),
  });
}

export interface WordMeta {
  programme: { code: string; name: string };
  ref: string;
  title: string;
  revision: string;
  status: string;
  preparedBy: string;
  generatedAt: string;
}

/** The form laid out by the dashboard: a header, one shaded band per section, label / value rows and a signature block. */
export async function buildDocx(type: PackType, values: PackValues, meta: WordMeta): Promise<Buffer> {
  const shown = formattedValues(type, values);
  const W = 9638; // A4 text width at 2 cm margins, in DXA
  const half = W / 2;
  const label = Math.round(half * 0.42);
  const value = half - label;
  const rows: TableRow[] = [];
  for (const group of type.groups) {
    const fields = type.fields.filter((f) => f.group === group);
    if (!fields.length) continue;
    rows.push(new TableRow({ children: [textCell(group.toUpperCase(), { bold: true, shade: GRAPHITE, color: "FFFFFF", width: W, span: 4, size: 17 })] }));
    if (group === "Signatures") {
      const sig = [
        ["Prepared by", shown.prepared_by, shown.prepared_position],
        ["Checked by", shown.checked_by, shown.checked_position],
        ["Approved by", shown.approved_by, shown.approved_position],
      ];
      rows.push(new TableRow({ children: [textCell("", { width: label, shade: PALE }), textCell("Name", { bold: true, width: value, shade: PALE }), textCell("Position", { bold: true, width: label, shade: PALE }), textCell("Signature / date", { bold: true, width: value, shade: PALE })] }));
      for (const [who, name, pos] of sig) rows.push(new TableRow({ height: { value: 560, rule: "atLeast" }, children: [textCell(who, { bold: true, width: label, shade: PALE }), textCell(name || "", { width: value }), textCell(pos || "", { width: label }), textCell("", { width: value })] }));
      continue;
    }
    const short = fields.filter((f) => f.kind !== "long");
    const longs = fields.filter((f) => f.kind === "long");
    for (let i = 0; i < short.length; i += 2) {
      const a = short[i];
      const b = short[i + 1];
      rows.push(
        new TableRow({
          children: b
            ? [textCell(a.label, { bold: true, width: label, shade: PALE }), textCell(shown[a.key], { width: value }), textCell(b.label, { bold: true, width: label, shade: PALE }), textCell(shown[b.key], { width: value })]
            : [textCell(a.label, { bold: true, width: label, shade: PALE }), textCell(shown[a.key], { width: value, span: 3 })],
        }),
      );
    }
    for (const f of longs) {
      rows.push(new TableRow({ children: [textCell(f.label, { bold: true, width: W, span: 4, shade: PALE })] }));
      rows.push(new TableRow({ height: { value: 900, rule: "atLeast" }, children: [textCell(shown[f.key] || "", { width: W, span: 4 })] }));
    }
  }
  const doc = new Document({
    creator: meta.preparedBy,
    title: `${packRefLabel(type.short, meta.ref)} – ${meta.title}`,
    styles: { default: { document: { run: { font: FONT, size: 18 } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({ children: [new TextRun({ text: `${type.label}`, bold: true, size: 20, color: GRAPHITE, font: FONT }), new TextRun({ text: `\t${type.formRef}  ·  Internal : Confidential`, size: 16, color: "6B6F75", font: FONT })], tabStops: [{ type: "right", position: W }] }),
              new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRONZE, space: 4 } }, children: [new TextRun({ text: `${meta.programme.name} (${meta.programme.code})  ·  ${shown.project_name || ""}`, size: 16, color: "6B6F75", font: FONT })] }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({ tabStops: [{ type: "right", position: W }], children: [new TextRun({ text: `${packRefLabel(type.short, meta.ref)}${meta.revision ? ` Rev. ${meta.revision}` : ""} · ${meta.status} · prepared ${formatDate(meta.generatedAt)} by ${meta.preparedBy}`, size: 15, color: "6B6F75", font: FONT }), new TextRun({ children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 15, color: "6B6F75", font: FONT })] })],
          }),
        },
        children: [
          new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: type.label, bold: true, size: 32, color: GRAPHITE, font: FONT })] }),
          new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: `${packRefLabel(type.short, meta.ref)}${meta.revision ? ` · Rev. ${meta.revision}` : ""}  ·  ${meta.title}`, size: 20, color: BRONZE, font: FONT })] }),
          new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [label, value, label, value], rows }),
          new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: `This ${type.short} is issued in accordance with the terms and conditions of the Contract. Terms defined in the Contract have the same meaning here unless otherwise defined.`, size: 15, color: "6B6F75", font: FONT })] }),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}


/* ------------------------------------------------------------------ */
/* the Employer's Assessment Report as a Word document                 */

function para(text: string, opts: { bold?: boolean; size?: number; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number; indent?: number } = {}): Paragraph {
  return new Paragraph({ alignment: opts.align, spacing: { after: opts.after ?? 120, before: opts.before ?? 0 }, indent: opts.indent ? { left: opts.indent } : undefined, children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 20, color: opts.color, font: FONT })] });
}

function numbered(no: string, text: string): Paragraph {
  return new Paragraph({ spacing: { after: 120 }, tabStops: [{ type: "left", position: 900 }], indent: { left: 900, hanging: 900 }, children: [new TextRun({ text: `${no}\t`, font: FONT, size: 20 }), new TextRun({ text, font: FONT, size: 20 })] });
}

function simpleTable(rows: string[][], widths: number[], header = true): Table {
  const W = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({ children: r.map((c, j) => textCell(c, { width: widths[j], bold: header && i === 0, shade: header && i === 0 ? PALE : undefined, size: 17 })) })),
  });
}

/** Sections split on blank lines: short title-case lines become 1.1 headings, the rest 1.1.1 paragraphs. */
function sectionParagraphs(no: number, text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const paras = String(text ?? "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let sub = 0;
  let n = 0;
  for (const p of paras) {
    const line = p.replace(/\n/g, " ");
    if (line.length <= 70 && !/[.:;]$/.test(line) && /^[A-Z]/.test(line) && line.split(" ").length <= 9) {
      sub++;
      n = 0;
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 }, children: [new TextRun({ text: `${no}.${sub}\t${line}`, font: FONT, size: 22, bold: true, color: GRAPHITE })] }));
    } else if (/^(table|figure) \d+/i.test(line)) out.push(para(line, { size: 17, color: "6B6F75", align: AlignmentType.CENTER }));
    else {
      if (!sub) {
        sub = 1;
        out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 }, children: [new TextRun({ text: `${no}.1\tOverview`, font: FONT, size: 22, bold: true, color: GRAPHITE })] }));
      }
      n++;
      out.push(numbered(`${no}.${sub}.${n}`, p));
    }
  }
  if (!out.length) out.push(para("[To be completed]", { color: "6B6F75" }));
  return out;
}

const lines = (t: string) => String(t ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+[–—-]\s+/).map((x) => x.trim()));

/** The EAR as the issued reports are laid out: cover letter, cover page, revision history, table of contents and the seven numbered sections. */
export async function buildEarDocx(type: PackType, values: PackValues, meta: WordMeta): Promise<Buffer> {
  const v = formattedValues(type, values);
  const isTime = type.key === "eot_ear";
  const eot = v.eot_no || meta.ref;
  const W = 9638;
  const reportTitle = isTime ? "Extension of Time Report" : "Cost Claim Assessment Report";
  const runHead = `Contract No. ${v.contract_ref || v.contract_no} – ${v.contractor} – ${eot}`;
  const letter: Paragraph[] = [
    para("AMAALA Company - C.R: 1010590650 · Building No. 8491, An Nu'aylah 48511-3110, Alwajh, Kingdom of Saudi Arabia", { size: 15, color: "6B6F75", align: AlignmentType.CENTER, after: 0 }),
    para("CLASSIFICATION: INTERNAL & SENSITIVE", { size: 15, color: "6B6F75", align: AlignmentType.CENTER, after: 300 }),
    para(`Letter Ref.: ${v.letter_ref || "-"}`, { bold: true, after: 0 }),
    para(`Date: ${v.letter_date || v.date}`, { after: 240 }),
    para(v.contractor, { bold: true, after: 0 }),
    ...(v.contractor_address ? v.contractor_address.split("\n").map((l) => para(l, { after: 0 })) : []),
    para("", { after: 120 }),
    para(`Attention: ${v.attention || "-"}`, { after: 0 }),
    para(`Contract: ${v.contract_title || v.works_package}${v.contract_no ? `, Contract No. ${v.contract_no}` : ""}`, { after: 0 }),
    para(`Subject: Employer's Assessment Report for ${isTime ? `Extension of Time Claim ${eot}` : `${v.claim_type || "Cost"} Claim ${eot}`}`, { bold: true, after: 0 }),
    para(`Reference: [1] ${v.claim_letter_ref || "-"}${v.claim_letter_date ? ` dated ${v.claim_letter_date}` : ""} – ${v.title || "Contractor's claim submission"}`, { after: 240 }),
    para("Dear Sir,"),
    para(`The Employer refers to the Construction Contract entered into between (i) AMAALA Company (as the 'Employer'); and (ii) ${v.contractor} (as the 'Contractor'), in respect of the ${v.contract_title || v.works_package}, Contract No. ${v.contract_no} ("Contract") for the ${v.project_name} project, Kingdom of Saudi Arabia (the 'Project').`),
    para("All capitalized terms used in this letter but not otherwise defined herein shall have the same meaning as set out in the Contract."),
    para(isTime ? `With reference to the Contractor's [Extension of Time Claim No. ${eot}], claim for additional time submitted via the Contractor's letter reference ${v.claim_letter_ref || "-"}${v.claim_letter_date ? ` dated ${v.claim_letter_date}` : ""} above, please find attached the Employer's Assessment Report, which provides detailed comments and explanations in accordance with ${v.clauses || "Clause 8.4"} as to the Contractor's entitlement to Extension of Time.` : `With reference to the Contractor's [Claim No. ${eot}] for additional payment submitted via the Contractor's letter reference ${v.claim_letter_ref || "-"}${v.claim_letter_date ? ` dated ${v.claim_letter_date}` : ""} above, please find attached the Employer's Assessment Report, which provides detailed comments and explanations in accordance with ${v.clauses || "Clause 20.1"} as to the Contractor's entitlement.`),
    para(`The Contractor is requested to review the Employer's assessment and either provide comments supported by further particulars for the Employer's consideration or confirm its agreement with the entitlement stated. In accordance with ${v.determination_clause || "Clause 3.5 [Determinations]"} of the Conditions of Contract, if an agreement is not reached within twenty (20) Business Days (or such other period as the Parties may agree), the Employer shall make a fair determination in accordance with the Contract, taking due regard of all relevant circumstances.`),
    para("This notification is issued for the Contractor's information and necessary action.", { after: 360 }),
    para("Yours faithfully,", { after: 600 }),
    para("_______________________", { after: 0 }),
    para(v.signatory || "Employer's Representative", { bold: true, after: 0 }),
    para("AMAALA Company", { after: 240 }),
    para(`Attachments: Employer's Assessment Report for ${eot}`, { size: 17, color: "6B6F75" }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  const hist = lines(values.revision_history ?? "");
  const histRows = [["Rev.", "Details", "Name", "Position", "Date", "Signature"], ...(hist.length ? hist.map((r) => [v.revision || "00", r[0] ?? "", r[1] ?? "", r[2] ?? "", "", ""]) : [[v.revision || "00", "Prepared by:", v.prepared_by, v.prepared_position, "", ""], [v.revision || "00", "Reviewed by:", v.checked_by, v.checked_position, "", ""], [v.revision || "00", "Approved by:", v.approved_by, v.approved_position, "", ""]])];
  const sections: [number, string, string][] = [[1, "Executive Summary", values.executive_summary ?? ""], [2, "Project Summary", values.project_summary ?? ""], [3, "Relevant Contract Provisions", values.contract_provisions ?? ""], [4, "The Contractor's Claim", values.contractor_claim ?? ""], [5, "The Employer's Assessment", values.employer_assessment ?? ""], [6, "Cost Assessment", values.cost_assessment ?? ""], [7, "Conclusion and Recommendation", values.conclusion ?? ""]];
  const projectTable = [["Project Name", v.project_name], ["Contract No.", v.contract_no], ["Contractor", v.contractor], ["Contract Price", v.contract_price ? `SAR ${v.contract_price}` : "-"], ["Contract dated", v.contract_date || "-"], ["Time for Completion", v.completion_date || "-"], ["Previous Extension of Time", v.revised_completion_date ? `Revised Time for Completion ${v.revised_completion_date}` : "-"]];
  const claimTable = isTime ? [["Claim reference", v.claim_letter_ref || "-"], ["Claim dated", v.claim_letter_date || "-"], ["Notice", `${v.notice_ref || "-"}${v.notice_date ? ` dated ${v.notice_date}` : ""}`], ["Extension of Time claimed", v.days_claimed ? `${v.days_claimed} days` : "-"], ["Extension of Time assessed", v.days_assessed ? `${v.days_assessed} days` : "-"], ["Assessed Time for Completion", v.assessed_completion_date || "-"]] : [["Claim reference", v.claim_letter_ref || "-"], ["Claim dated", v.claim_letter_date || "-"], ["Notice", `${v.notice_ref || "-"}${v.notice_date ? ` dated ${v.notice_date}` : ""}`], ["Amount claimed", v.amount_claimed ? `SAR ${v.amount_claimed}` : "-"], ["Amount assessed", v.amount_assessed ? `SAR ${v.amount_assessed}` : "-"]];
  const body: (Paragraph | Table)[] = [];
  for (const [no, title, text] of sections) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 200 }, children: [new TextRun({ text: `${no}.0\t${title}`, font: FONT, size: 26, bold: true, color: GRAPHITE })] }));
    if (no === 2) body.push(simpleTable(projectTable, [2800, 6838], false), para("", { after: 120 }));
    if (no === 4) {
      body.push(simpleTable(claimTable, [2800, 6838], false), para("", { after: 120 }));
      if (isTime && values.delay_events) body.push(simpleTable([["Delay Event", "Title", "Clause", "Validity (in principle)", "Remarks"], ...lines(values.delay_events).map((r) => [r[0] ?? "", r[1] ?? "", r[2] ?? "", r[3] ?? "", r[4] ?? ""])], [1000, 3000, 1400, 1400, 2838]), para("", { after: 120 }));
      if (!isTime && values.heads_of_claim) body.push(simpleTable([["Head of claim", "Claimed (SAR)", "Assessed (SAR)", "Basis"], ...lines(values.heads_of_claim).map((r) => [r[0] ?? "", r[1] ?? "", r[2] ?? "", r[3] ?? ""])], [3200, 1600, 1600, 3238]), para("", { after: 120 }));
    }
    body.push(...sectionParagraphs(no, text));
  }
  const doc = new Document({
    creator: meta.preparedBy,
    title: `Employer's Assessment Report for ${eot}`,
    features: { updateFields: true },
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        children: letter,
      },
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        headers: { default: new Header({ children: [new Paragraph({ tabStops: [{ type: "right", position: W }], border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRONZE, space: 4 } }, children: [new TextRun({ text: reportTitle, size: 16, color: "6B6F75", font: FONT }), new TextRun({ text: `\t${v.template_rev || "Template Revision Sep-2025"}`, size: 16, color: "6B6F75", font: FONT })] }), new Paragraph({ children: [new TextRun({ text: runHead, size: 16, color: "6B6F75", font: FONT })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: "right", position: W }], children: [new TextRun({ text: `${runHead} · ${meta.status}${meta.revision ? ` · Rev. ${meta.revision}` : ""}`, size: 15, color: "6B6F75", font: FONT }), new TextRun({ children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 15, color: "6B6F75", font: FONT })] })] }) },
        children: [
          para("", { after: 2400 }),
          para("AMAALA · COMMERCIAL", { size: 18, color: BRONZE, after: 200 }),
          para(`Employer's Assessment Report for ${eot}`, { bold: true, size: 44, color: GRAPHITE, after: 600 }),
          simpleTable([["Contract No. & Title:", `${v.contract_no} - ${v.contract_title || v.works_package}`], ["Project:", `${v.project_name}${v.project_code ? ` (${v.project_code})` : ""}`], ["Contractor:", v.contractor], ["Claim:", v.title || eot], ["Date:", v.date], ["Revision:", `${v.revision || "00"}${v.previous_revision ? ` – supersedes ${v.previous_revision}` : ""}`]], [2800, 6838], false),
          new Paragraph({ children: [new PageBreak()] }),
          para("Revision History", { bold: true, size: 26, color: GRAPHITE, after: 200 }),
          simpleTable(histRows, [700, 1700, 2500, 2838, 950, 950]),
          new Paragraph({ children: [new PageBreak()] }),
          para("Table of Contents", { bold: true, size: 26, color: GRAPHITE, after: 200 }),
          new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
          para("(Right-click the table and choose Update Field in Word to refresh the page numbers.)", { size: 15, color: "6B6F75" }),
          ...body,
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
