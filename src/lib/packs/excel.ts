/**
 * The Excel form of a pack: the RSG template as the user keeps it (a workbook with its tabs),
 * with this pack's values written into its cells.
 *
 * The workbook is edited at the XML level – only the value of a cell changes. Its tabs, merged
 * cells, styles, column widths, print settings, images, formulas and every cell that is not a
 * value of this pack stay byte for byte as uploaded. A label cell names the value that goes in the
 * cell beside it (or beneath it, for a paragraph); a cell holding a formula is never overwritten,
 * so the template's own totals and percentages keep working; {{key}} placeholders are replaced
 * wherever they are.
 */
import JSZip from "jszip";
import { formatDate, formatMoney } from "../format";
import { fieldForLabel, normLabel, type PackField, type PackType, type PackValues, type TemplateInspection } from "./shared";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export const isExcelTemplate = (name: string) => /\.(xlsx|xlsm|xltx|xltm)$/i.test(name);

/* ------------------------------------------------------------------ */
/* cell references                                                     */

function colNo(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colLetters(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function refOf(r: number, c: number) {
  return `${colLetters(c)}${r}`;
}
function parseRef(ref: string): { r: number; c: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/i);
  return m ? { r: Number(m[2]), c: colNo(m[1]) } : { r: 0, c: 0 };
}

/* ------------------------------------------------------------------ */
/* the workbook, read                                                  */

interface XCell {
  r: number;
  c: number;
  /** the whole <c …>…</c> element, or null when the cell is not stored */
  xml: string | null;
  style: string;
  text: string;
  formula: boolean;
  /** the stored value was a number (a date serial, a figure) */
  numeric: boolean;
}
interface XRow {
  r: number;
  open: string;
  cells: XCell[];
}
interface XSheet {
  path: string;
  name: string;
  hidden: boolean;
  xml: string;
  rows: Map<number, XRow>;
  /** merged ranges: top-left ref -> {r1,c1,r2,c2} */
  merges: { r1: number; c1: number; r2: number; c2: number }[];
}

async function readWorkbook(zip: JSZip): Promise<{ sheets: XSheet[]; strings: string[] }> {
  const wbXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!wbXml) throw new Error("not a workbook");
  const relsXml = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\s[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*\/?>/g)) rels.set(m[1], m[2]);
  for (const m of relsXml.matchAll(/<Relationship\s[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"[^>]*\/?>/g)) if (!rels.has(m[2])) rels.set(m[2], m[1]);
  const strings: string[] = [];
  const ssXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (ssXml) for (const si of ssXml.match(/<si>[\s\S]*?<\/si>/g) ?? []) strings.push(unesc((si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/^<t(?:\s[^>]*)?>|<\/t>$/g, "")).join("")));
  const sheets: XSheet[] = [];
  for (const m of wbXml.matchAll(/<sheet\s[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"[^>]*\/?>/g)) {
    const hidden = /\sstate="(hidden|veryHidden)"/.test(m[0]);
    const target = rels.get(m[2]);
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const rows = new Map<number, XRow>();
    const sd = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
    if (sd) {
      for (const rm of sd[1].matchAll(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const rNo = Number((rm[1].match(/\br="(\d+)"/) ?? [])[1] ?? 0);
        if (!rNo) continue;
        const row: XRow = { r: rNo, open: `<row ${rm[1]}>`, cells: [] };
        for (const cm of (rm[2] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = cm[1];
          const ref = (attrs.match(/\br="([A-Z]+\d+)"/) ?? [])[1];
          if (!ref) continue;
          const { r, c } = parseRef(ref);
          const style = (attrs.match(/\bs="(\d+)"/) ?? [])[1] ?? "";
          const t = (attrs.match(/\bt="(\w+)"/) ?? [])[1] ?? "";
          const inner = cm[2] ?? "";
          const formula = /<f[\s>\/]/.test(inner);
          const v = (inner.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
          let text = "";
          if (t === "s") text = strings[Number(v ?? -1)] ?? "";
          else if (t === "inlineStr") text = unesc((inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? []).map((x) => x.replace(/^<t(?:\s[^>]*)?>|<\/t>$/g, "")).join(""));
          else if (t === "str" || t === "e") text = unesc(v ?? "");
          else if (v !== undefined) text = v;
          row.cells.push({ r, c, xml: cm[0], style, text, formula, numeric: !t && v !== undefined && v !== "" && !Number.isNaN(Number(v)) });
        }
        rows.set(rNo, row);
      }
    }
    const merges: XSheet["merges"] = [];
    for (const mm of xml.matchAll(/<mergeCell\s[^>]*?ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      const a = parseRef(mm[1]);
      const b = parseRef(mm[2]);
      merges.push({ r1: a.r, c1: a.c, r2: b.r, c2: b.c });
    }
    sheets.push({ path, name: unesc(m[1]), hidden, xml, rows, merges });
  }
  return { sheets, strings };
}

const cellAt = (s: XSheet, r: number, c: number): XCell | undefined => s.rows.get(r)?.cells.find((x) => x.c === c);
const mergeAt = (s: XSheet, r: number, c: number) => s.merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
/** the top-left cell of the merged range holding (r, c), or the cell itself */
const anchor = (s: XSheet, r: number, c: number): { r: number; c: number } => {
  const m = mergeAt(s, r, c);
  return m ? { r: m.r1, c: m.c1 } : { r, c };
};
/** the column just after the range the cell belongs to */
const rightOf = (s: XSheet, r: number, c: number) => (mergeAt(s, r, c)?.c2 ?? c) + 1;
/** the row just under the range the cell belongs to */
const below = (s: XSheet, r: number, c: number) => (mergeAt(s, r, c)?.r2 ?? r) + 1;

/** a cell whose wording is a heading or a label of the form, not a value */
function looksLikeLabel(type: PackType, t: string): boolean {
  const s = t.trim();
  if (!s || /^\{\{/.test(s)) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (/^(SAR|USD|AED|Yes|No|N\/A|TBC|TBA|P\d)$/i.test(s)) return false;
  if (/[:?]$/.test(s)) return true;
  if (fieldForLabel(type, s)) return true;
  return /^(name|position|signature|date|sub-?total|total value|reference|description|omit|add|program|project ?\/ ?asset|control account|work package|from|to|totals?)\b/i.test(s) && s.length < 40;
}

/* ------------------------------------------------------------------ */
/* what goes where                                                     */

interface Edit {
  sheet: XSheet;
  r: number;
  c: number;
  /** text or a number */
  value: string | number;
}

const num = (v: unknown) => {
  const s = String(v ?? "").trim();
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && /\d/.test(s) ? (neg ? -n : n) : null;
};
const serial = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
};
/** the value as the cell should hold it: figures as numbers, dates as serials where the cell already held one, text otherwise */
function cellValue(f: PackField | null, raw: string, target: XCell | undefined): string | number {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (f?.kind === "money" || f?.kind === "number") {
    const n = num(v);
    return n === null ? v : n;
  }
  if (f?.kind === "date" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const s = serial(v);
    return target?.numeric && s !== null ? s : formatDate(v);
  }
  return v;
}

/** the lines of a "n – description – omit – add" cost items field */
const items = (v: unknown) =>
  String(v ?? "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(/\s+[–-]\s+/);
      if (parts.length >= 4) return { ref: parts[0].replace(/^\d+$/, ""), desc: parts.slice(1, -2).join(" - "), omit: num(parts[parts.length - 2]) ?? 0, add: num(parts[parts.length - 1]) ?? 0 };
      return { ref: "", desc: l, omit: 0, add: 0 };
    });
const lines = (v: unknown) => String(v ?? "").split(/\n/).map((s) => s.trim()).filter(Boolean);

/**
 * Works out every cell the pack fills. The same walk serves the inspection (what the template will
 * take) and the fill (what goes in).
 */
function plan(type: PackType, sheets: XSheet[], values: PackValues | null): { edits: Edit[]; labels: { label: string; field: string | null }[]; placeholders: Set<string> } {
  const edits: Edit[] = [];
  const labels: { label: string; field: string | null }[] = [];
  const seenLabel = new Set<string>();
  const placeholders = new Set<string>();
  const taken = new Set<string>();
  const byKey = new Map(type.fields.map((f) => [f.key, f]));
  /** fields already placed beside their first label: a later cell with the same wording (a column heading, a legend) is left alone */
  const placed = new Set<string>();
  const put = (sheet: XSheet, r: number, c: number, value: string | number) => {
    const a = anchor(sheet, r, c);
    const key = `${sheet.path}!${a.r}:${a.c}`;
    if (taken.has(key)) return false;
    const cell = cellAt(sheet, a.r, a.c);
    if (cell?.formula) return false;
    taken.add(key);
    if (values) edits.push({ sheet, r: a.r, c: a.c, value });
    return true;
  };
  const valueOf = (f: PackField, target: XCell | undefined) => (values ? cellValue(f, values[f.key] ?? "", target) : "");

  for (const sheet of sheets) {
    if (sheet.hidden) continue;
    const rowNos = [...sheet.rows.keys()].sort((a, b) => a - b);
    const cells = rowNos.flatMap((r) => sheet.rows.get(r)!.cells);
    // a row of three or more labels is a table heading, not a run of label / value pairs
    const headerRows = new Set(
      rowNos.filter((r) => {
        const ls = sheet.rows.get(r)!.cells.filter((c) => looksLikeLabel(type, c.text) && c.text.trim().length < 60);
        return ls.length >= 3 && !ls.some((c) => /:$/.test(c.text.trim()));
      }),
    );
    // 1. {{placeholders}}
    for (const cell of cells) {
      if (!/\{\{/.test(cell.text)) continue;
      for (const m of cell.text.matchAll(PLACEHOLDER)) placeholders.add(m[1]);
      if (values) {
        const replaced = cell.text.replace(PLACEHOLDER, (_m, key) => (byKey.has(key) ? String(values[key] ?? "") : `{{${key}}}`));
        const only = cell.text.match(/^\s*\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*$/);
        put(sheet, cell.r, cell.c, only && byKey.has(only[1]) ? cellValue(byKey.get(only[1])!, String(values[only[1]] ?? ""), cell) : replaced);
      }
    }
    // 2. the items table: rows between the column headings and the sub-total
    const header = rowNos.find((r) => {
      const t = sheet.rows.get(r)!.cells.map((c) => normLabel(c.text));
      return t.some((x) => /^(instruction )?reference$/.test(x)) && t.some((x) => x === "description") && t.some((x) => /^add( \(sar\))?$/.test(x));
    });
    if (header && byKey.has("cost_items")) {
      const H = sheet.rows.get(header)!.cells;
      const col = (re: RegExp) => H.find((c) => re.test(normLabel(c.text)))?.c;
      const cRef = col(/^(instruction )?reference$/);
      const cDesc = col(/^description$/);
      const cOmit = col(/^omit( \(sar\))?$/);
      const cAdd = col(/^add( \(sar\))?$/);
      const cCur = col(/^contract currency$/);
      const dataRows: number[] = [];
      for (const r of rowNos) {
        if (r <= header) continue;
        if (sheet.rows.get(r)!.cells.some((c) => /^sub-?total|^total value/i.test(c.text.trim()))) break;
        dataRows.push(r);
      }
      if (dataRows.length && !seenLabel.has("items")) {
        seenLabel.add("items");
        labels.push({ label: `Items table (${dataRows.length} rows)`, field: "cost_items" });
      }
      if (values) {
        const its = items(values.cost_items);
        dataRows.forEach((r, i) => {
          const it = its[i];
          const held = (c: number | undefined) => (c ? cellAt(sheet, r, c) : undefined);
          if (it) {
            if (cDesc) put(sheet, r, cDesc, it.desc);
            if (cRef) put(sheet, r, cRef, it.ref || held(cRef)?.text.trim() || String(i + 1));
            if (cOmit) put(sheet, r, cOmit, it.omit || (held(cOmit)?.numeric ? 0 : held(cOmit)?.text.trim() || "-"));
            if (cAdd) put(sheet, r, cAdd, it.add || (held(cAdd)?.numeric ? 0 : held(cAdd)?.text.trim() || "-"));
            if (cCur) put(sheet, r, cCur, "SAR");
          } else if (held(cDesc)?.text.trim()) {
            // a row the previous pack used and this one does not: emptied, its dashes kept
            if (cDesc) put(sheet, r, cDesc, "");
            if (cOmit && held(cOmit)?.numeric) put(sheet, r, cOmit, "-");
            if (cAdd && held(cAdd)?.numeric) put(sheet, r, cAdd, "-");
          }
        });
      }
    }
    // 3. signatories: a "Name … Position … Signature" row names the cells above it
    const sigRows = rowNos.filter((r) => {
      const t = sheet.rows.get(r)!.cells.map((c) => normLabel(c.text));
      return t.includes("name") && t.includes("position") && t.includes("signature");
    });
    const sectionCount = new Map<string, number>();
    for (const r of sigRows) {
      // the heading above decides whose row this is
      let section = "";
      for (let k = r - 1; k >= Math.max(1, r - 40) && !section; k--) {
        const t = sheet.rows.get(k)?.cells.map((c) => c.text.trim()).join(" ") ?? "";
        if (/prepared|initiated by/i.test(t)) section = "prepared";
        else if (/checked by|reviewed by/i.test(t)) section = "checked";
        else if (/review and recommendation panel/i.test(t)) section = "panel";
        else if (/final determination by the employer/i.test(t)) section = "employer";
        else if (/agreement for final determination/i.test(t)) section = "contractor";
        else if (/approved by/i.test(t)) section = "approved";
        else if (/recommended for approval/i.test(t)) section = "recommended";
        else if (/executive approval/i.test(t)) section = "executive";
      }
      if (!section) continue;
      const n = sectionCount.get(section) ?? 0;
      sectionCount.set(section, n + 1);
      const rowCells = sheet.rows.get(r)!.cells;
      const nameC = rowCells.find((c) => normLabel(c.text) === "name")!.c;
      const posC = rowCells.find((c) => normLabel(c.text) === "position")!.c;
      // the value cell: the nearest stored, non-label cell above, in the same column (merged ranges included)
      const above = (c: number): { r: number; c: number } | null => {
        for (let k = r - 1; k >= Math.max(1, r - 4); k--) {
          const m = mergeAt(sheet, k, c);
          const a = m ? { r: m.r1, c: m.c1 } : { r: k, c };
          const cell = cellAt(sheet, a.r, a.c);
          if (cell && looksLikeLabel(type, cell.text)) return null;
          if (cell) return a;
        }
        return null;
      };
      const nameAt = above(nameC);
      const posAt = above(posC);
      if (!nameAt) continue;
      if (!seenLabel.has(`sig:${section}`)) {
        seenLabel.add(`sig:${section}`);
        labels.push({ label: `${section === "panel" ? "Review and recommendation panel" : section === "employer" ? "Employer's Representative" : section === "contractor" ? "Contractor's Representative" : `${section[0].toUpperCase()}${section.slice(1)} by`} – name and position`, field: section === "prepared" ? "prepared_by" : section === "checked" ? "checked_by" : section === "approved" ? "approved_by" : section === "panel" ? "review_panel" : section === "employer" ? "employer_rep" : section === "contractor" ? "contractor_rep" : section === "recommended" ? "recommended_by" : "executive_approver" });
      }
      if (!values) continue;
      let name = "";
      let position = "";
      const split = (l: string) => {
        const i = Math.max(l.lastIndexOf(" – "), l.lastIndexOf(" - "));
        return i >= 0 ? { a: l.slice(0, i).trim(), b: l.slice(i + 3).trim() } : { a: l.trim(), b: "" };
      };
      if (section === "prepared" || section === "checked" || section === "approved") {
        name = lines(values[`${section}_by`])[n] ?? "";
        position = lines(values[`${section}_position`])[n] ?? "";
      } else if (section === "panel") {
        const all = [{ name: String(values.contractor_rep ?? ""), position: String(values.contractor_rep_position ?? "") }, ...lines(values.review_panel).map((l) => ({ name: split(l).b, position: split(l).a }))];
        name = all[n]?.name ?? "";
        position = all[n]?.position ?? "";
      } else if (section === "employer" || section === "contractor") {
        name = String(values[`${section}_rep`] ?? "");
        position = String(values[`${section}_rep_position`] ?? "");
      } else if (section === "recommended") {
        const p = lines(values.recommended_by)[n];
        if (p) ({ b: name, a: position } = split(p));
      } else if (section === "executive") {
        name = String(values.executive_approver ?? "");
        position = String(values.executive_position ?? "");
      }
      put(sheet, nameAt.r, nameAt.c, name);
      if (posAt) put(sheet, posAt.r, posAt.c, position);
    }
    // 3b. the budget transfer table: the From (budget hold) and To (this contract) rows, by column heading
    const trHeader = rowNos.find((r) => {
      const t = sheet.rows.get(r)!.cells.map((c) => normLabel(c.text));
      return t.some((x) => x === "control account") && t.some((x) => x === "transfer amount");
    });
    if (trHeader && values) {
      const H = sheet.rows.get(trHeader)!.cells;
      const col = (re: RegExp) => H.find((c) => re.test(normLabel(c.text)))?.c;
      const cAsset = col(/^project ?\/ ?asset$/);
      const cAcc = col(/^control account$/);
      const cWp = col(/^work ?package$/);
      const cCur = col(/^current budget$/);
      for (const r of rowNos.filter((x) => x > trHeader && x <= trHeader + 4)) {
        const first = sheet.rows.get(r)!.cells.find((c) => c.text.trim())?.text.trim().toLowerCase();
        if (first === "from") {
          if (cAcc && values.budget_line) put(sheet, r, cAcc, String(values.budget_line));
          if (cWp && values.budget_line) put(sheet, r, cWp, "Budget Hold");
          if (cCur && num(values.budget_available) !== null) put(sheet, r, cCur, num(values.budget_available)!);
        } else if (first === "to") {
          if (cAsset && values.project_name) put(sheet, r, cAsset, String(values.project_name));
          if (cAcc && values.budget_to_line) put(sheet, r, cAcc, String(values.budget_to_line));
          if (cWp && values.works_package) put(sheet, r, cWp, String(values.works_package));
        }
      }
    }
    // 4. label cells: the cell to the right, or beneath for a paragraph, takes the value
    for (const cell of cells) {
      const label = cell.text.replace(/\s+/g, " ").trim();
      if (!label || label.length > 90 || /\{\{/.test(label)) continue;
      if (headerRows.has(cell.r)) continue;
      // the signature blocks are filled from their Name / Position rows above
      if (/^(name|position|signature|date|from|to)$/i.test(label) || /^(prepared|checked|approved|review|reviewed|recommended|initiated)\b|^(prepared|initiated)\/|by:$/i.test(label)) continue;
      const f = fieldForLabel(type, label);
      // the basis of the ROM is a row of tick boxes on the workbook, the change log and the ACC table are the workbook's own tabs
      if (!f || placed.has(f.key) || ["change_log", "acc_table", "rom_basis"].includes(f.key)) continue;
      const key = normLabel(label);
      let right = { r: cell.r, c: rightOf(sheet, cell.r, cell.c) };
      // a code letter between the label and its figure ("A", "C = A+B") is stepped over
      const code = cellAt(sheet, right.r, right.c);
      if (code && /^[A-H](\s*=\s*[A-H+\-\s]+)?$/i.test(code.text.trim())) right = { r: right.r, c: rightOf(sheet, right.r, right.c) };
      const under = { r: below(sheet, cell.r, cell.c), c: cell.c };
      const ok = (p: { r: number; c: number }) => {
        const a = anchor(sheet, p.r, p.c);
        const t = cellAt(sheet, a.r, a.c);
        return !(t && (t.formula || looksLikeLabel(type, t.text)));
      };
      const rightCell = cellAt(sheet, right.r, right.c);
      const underCell = cellAt(sheet, under.r, under.c);
      // a paragraph goes beneath its heading when there is room there; a one-line value beside its label
      let target: { r: number; c: number } | null = null;
      // a one-line value sits beside its label; a paragraph beneath its heading when the heading spans the row
      if (rightCell && ok(right)) target = right;
      else if ((f.kind === "long" || (rightCell && looksLikeLabel(type, rightCell.text))) && underCell && ok(under)) target = under;
      if (!target) continue;
      if (!seenLabel.has(key)) {
        seenLabel.add(key);
        labels.push({ label, field: f.key });
      }
      if (values && values[f.key]) {
        placed.add(f.key);
        put(sheet, target.r, target.c, valueOf(f, cellAt(sheet, target.r, target.c)));
      }
    }
  }
  return { edits, labels, placeholders };
}

/* ------------------------------------------------------------------ */
/* writing the cells back                                              */

function cellXml(ref: string, style: string, value: string | number): string {
  const s = style ? ` s="${style}"` : "";
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (value === "") return `<c r="${ref}"${s}/>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value.replace(/\r\n?/g, "\n"))}</t></is></c>`;
}

function applyEdits(sheet: XSheet, edits: Edit[]): string {
  const byRow = new Map<number, Edit[]>();
  for (const e of edits) byRow.set(e.r, [...(byRow.get(e.r) ?? []), e]);
  let xml = sheet.xml;
  const sd = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sd || sd.index === undefined) return xml;
  let body = sd[1];
  // rows that exist: their cells replaced or inserted in column order
  body = body.replace(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (whole, attrs: string, inner: string | undefined) => {
    const rNo = Number((attrs.match(/\br="(\d+)"/) ?? [])[1] ?? 0);
    const rowEdits = byRow.get(rNo);
    if (!rowEdits) return whole;
    byRow.delete(rNo);
    const parts: { c: number; xml: string }[] = [];
    for (const cm of (inner ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (cm[1].match(/\br="([A-Z]+\d+)"/) ?? [])[1];
      if (!ref) continue;
      parts.push({ c: parseRef(ref).c, xml: cm[0] });
    }
    for (const e of rowEdits) {
      const i = parts.findIndex((p) => p.c === e.c);
      const style = i >= 0 ? ((parts[i].xml.match(/\bs="(\d+)"/) ?? [])[1] ?? "") : "";
      const next = { c: e.c, xml: cellXml(refOf(e.r, e.c), style, e.value) };
      if (i >= 0) parts[i] = next;
      else parts.push(next);
    }
    parts.sort((a, b) => a.c - b.c);
    // the row's spans attribute may no longer hold: dropped, Excel works it out
    const cleanAttrs = attrs.replace(/\sspans="[^"]*"/, "");
    return `<row ${cleanAttrs}>${parts.map((p) => p.xml).join("")}</row>`;
  });
  // rows that did not exist: added in order
  const missing = [...byRow.entries()].sort((a, b) => a[0] - b[0]);
  if (missing.length) {
    const rowXml = (r: number, es: Edit[]) => `<row r="${r}">${es.sort((a, b) => a.c - b.c).map((e) => cellXml(refOf(r, e.c), "", e.value)).join("")}</row>`;
    for (const [r, es] of missing) {
      // before the first row with a higher number
      const re = /<row\s[^>]*?\br="(\d+)"/g;
      let at = -1;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) if (Number(m[1]) > r) {
        at = m.index;
        break;
      }
      body = at >= 0 ? body.slice(0, at) + rowXml(r, es) + body.slice(at) : body + rowXml(r, es);
    }
  }
  xml = xml.slice(0, sd.index) + `<sheetData>${body}</sheetData>` + xml.slice(sd.index + sd[0].length);
  return xml;
}

/* ------------------------------------------------------------------ */

/** What the workbook will take: its {{placeholders}} and the label cells with a value cell beside or beneath them. */
export async function inspectExcelTemplate(bytes: Buffer, type: PackType): Promise<TemplateInspection> {
  const zip = await JSZip.loadAsync(bytes);
  const { sheets } = await readWorkbook(zip);
  const { labels, placeholders } = plan(type, sheets, null);
  const taken = new Set([...placeholders, ...labels.map((l) => l.field).filter(Boolean)]);
  const unmatched = type.fields.filter((f) => !taken.has(f.key)).map((f) => f.key);
  return { placeholders: [...placeholders], labels, unmatched };
}

/** The workbook with the pack's values written in; everything else as uploaded. */
export async function fillExcelTemplate(bytes: Buffer, type: PackType, values: PackValues): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const { sheets } = await readWorkbook(zip);
  const { edits } = plan(type, sheets, values);
  for (const sheet of sheets) {
    const mine = edits.filter((e) => e.sheet === sheet);
    if (!mine.length) continue;
    zip.file(sheet.path, applyEdits(sheet, mine));
  }
  // the template's own formulas (totals, percentages) are worked out again when the file opens
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const next = /<calcPr\b/.test(wb) ? wb.replace(/<calcPr\b([^>]*?)\/?>/, (m, attrs: string) => `<calcPr${attrs.replace(/\sfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"${m.endsWith("/>") ? "/>" : ">"}`) : wb.replace(/<\/workbook>/, '<calcPr fullCalcOnLoad="1"/></workbook>');
  zip.file("xl/workbook.xml", next);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

/** the money of a value, the way a figure is shown when a cell cannot take a number */
export const excelMoney = (v: unknown) => {
  const n = num(v);
  return n === null ? String(v ?? "") : formatMoney(n);
};
