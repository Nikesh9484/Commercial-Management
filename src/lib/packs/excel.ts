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
  /** text, a number, or a cell carried along as it is (a formula) */
  value: string | number | { formula: string | null };
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
    // 3a. the change log tab: the workbook's own change becomes an ordinary line, and this change takes the "This PVO / DVO" line
    const logHeader = rowNos.find((r) => {
      const t = sheet.rows.get(r)!.cells.map((c) => normLabel(c.text));
      return t.includes("description") && t.includes("pvo") && t.includes("vo") && t.includes("dvo") && t.some((x) => /^rfc/.test(x));
    });
    if (logHeader && values) {
      const H = sheet.rows.get(logHeader)!.cells;
      const first = (re: RegExp) => H.find((c) => re.test(normLabel(c.text)))?.c;
      const after = (c0: number | undefined, re: RegExp) => H.find((c) => c.c > (c0 ?? 0) && re.test(normLabel(c.text)))?.c;
      const cDesc = first(/^description$/) ?? 2;
      const cRfc = first(/^rfc/);
      const cPvo = first(/^pvo$/);
      const cVo = first(/^vo$/);
      const cContract = first(/contra?ct value/);
      const cPvoVal = after(cContract ?? first(/^dvo$/), /^pvo/);
      const thisRow = rowNos.find((r) => r > logHeader && /^this pvo/i.test(cellAt(sheet, r, cDesc)?.text.trim() ?? ""));
      const totalRow = rowNos.find((r) => r > logHeader && sheet.rows.get(r)!.cells.some((c) => /^total/i.test(c.text.trim())));
      let prevRows: { description: string; pvo: string; vo: string; rfc: string; pvoValue: number | null }[] = [];
      try {
        prevRows = (JSON.parse(values.change_log_rows || "[]") as typeof prevRows).filter((r) => !/thisOne/.test("") && r);
      } catch {
        prevRows = [];
      }
      const thisNo = String(values.pvo_no ?? "").replace(/\D/g, "");
      const thisLabel = `This PVO /DVO${thisNo ? ` (PVO-${thisNo} – ${String(values.title ?? "").slice(0, 90)})` : ""}`;
      if (thisRow && totalRow && thisRow < totalRow) {
        // the workbook's own PVO (its "This PVO" line) is the last line of the earlier log: it moves up into the entries and this change takes its place
        const own = prevRows[prevRows.length - 1];
        const prevNo = String(cellAt(sheet, thisRow, cDesc)?.text ?? "").match(/PVO-?(\d+)/i)?.[1];
        const ownIsPrevious = own && (!prevNo || own.pvo.replace(/\D/g, "") === prevNo.replace(/^0+/, "") || own.pvo.replace(/\D/g, "").replace(/^0+/, "") === prevNo.replace(/^0+/, ""));
        const emptyBelow = thisRow + 1 < totalRow && !sheet.rows.get(thisRow + 1)?.cells.some((c) => c.text.trim());
        if (ownIsPrevious && emptyBelow) {
          // this change's line goes one row down (its formula cells carried along), the earlier PVO's line is written where "This PVO" was
          for (const c of sheet.rows.get(thisRow)!.cells) {
            if (c.formula) edits.push({ sheet, r: thisRow + 1, c: c.c, value: { formula: c.xml } as never });
            else if (c.text.trim()) put(sheet, thisRow + 1, c.c, c.c === cDesc ? thisLabel : c.numeric ? Number(c.text) : c.text);
          }
          put(sheet, thisRow, cDesc, own.description);
          if (cRfc && own.rfc) put(sheet, thisRow, cRfc, own.rfc);
          if (cPvo) put(sheet, thisRow, cPvo, own.pvo);
          if (cVo) put(sheet, thisRow, cVo, own.vo || own.pvo.replace(/^PVO/i, "VO"));
          if (cPvoVal && own.pvoValue !== null) put(sheet, thisRow, cPvoVal, own.pvoValue);
          // the cells the "This PVO" line carried (its formulas included) are cleared on the line it leaves
          for (const c of sheet.rows.get(thisRow)!.cells) if (c.c !== cDesc && c.c !== cRfc && c.c !== cPvo && c.c !== cVo && c.c !== cPvoVal && (c.text.trim() || c.formula)) edits.push({ sheet, r: thisRow, c: c.c, value: "" });
        } else put(sheet, thisRow, cDesc, thisLabel);
      } else if (thisRow) put(sheet, thisRow, cDesc, thisLabel);
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
      if (/^(name|position|signature|date|from|to)$/i.test(label) || /^(prepared|checked|reviewed|recommended|initiated) by|^approved (by|and issued by)|^review (&|and) approval|^(prepared|initiated)\/|by:$/i.test(label)) continue;
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
/* the workbook read                                                   */

/** text of a cell as a value: a date serial as an ISO date, a number as it is, text trimmed */
function textOf(cell: XCell | undefined, f: PackField | null): string {
  if (!cell) return "";
  // a formula cell gives the value the workbook last worked out
  const t = cell.text.trim();
  if (!t || /^#/.test(t)) return "";
  if (cell.numeric && f?.kind === "date") {
    const n = Number(t);
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  if (cell.numeric && /\.\d{3,}/.test(t) && Math.abs(Number(t)) >= 1) return String(Math.round(Number(t) * 100) / 100);
  if (cell.numeric && (f?.kind === "money" || f?.kind === "number")) return String(Math.round(Number(t) * 100) / 100);
  return t;
}

/**
 * The values the workbook holds, read the way they are written: the cell beside each label (or
 * beneath a heading), the rows of the items table, the names and positions above every Name /
 * Position row. The RSG workbook of the last PVO is the earlier document, cell by cell.
 */
export async function readExcelValues(bytes: Buffer, type: PackType): Promise<{ values: PackValues; sources: Record<string, string> }> {
  const values: PackValues = {};
  const sources: Record<string, string> = {};
  const src = `previous ${type.short}`;
  const set = (k: string, v: string) => {
    if (v && !values[k]) {
      values[k] = v;
      sources[k] = src;
    }
  };
  let sheets: XSheet[];
  try {
    sheets = (await readWorkbook(await JSZip.loadAsync(bytes))).sheets;
  } catch {
    return { values, sources };
  }
  for (const sheet of sheets) {
    if (sheet.hidden) continue;
    const rowNos = [...sheet.rows.keys()].sort((a, b) => a - b);
    const cells = rowNos.flatMap((r) => sheet.rows.get(r)!.cells);
    const headerRows = new Set(
      rowNos.filter((r) => {
        const ls = sheet.rows.get(r)!.cells.filter((c) => looksLikeLabel(type, c.text) && c.text.trim().length < 60);
        return ls.length >= 3 && !ls.some((c) => /:$/.test(c.text.trim()));
      }),
    );
    // the change log tab: every change on the contract with its RFC, PVO, VO and DVO and their values
    const logHeader = rowNos.find((r) => {
      const t = sheet.rows.get(r)!.cells.map((c) => normLabel(c.text));
      return t.includes("description") && t.includes("pvo") && t.includes("vo") && t.includes("dvo") && t.some((x) => /^rfc/.test(x));
    });
    if (logHeader && !values.change_log_rows) {
      const H = sheet.rows.get(logHeader)!.cells;
      const first = (re: RegExp) => H.find((c) => re.test(normLabel(c.text)))?.c;
      const after = (c0: number | undefined, re: RegExp) => H.find((c) => c.c > (c0 ?? 0) && re.test(normLabel(c.text)))?.c;
      const cDesc = first(/^description$/);
      const cRfc = first(/^rfc/);
      const cPvo = first(/^pvo$/);
      const cVo = first(/^vo$/);
      const cDvo = first(/^dvo$/);
      const cContract = first(/contra?ct value/);
      const cPvoVal = after(cContract ?? cDvo, /^pvo/);
      const cDvoVal = after(cPvoVal ?? cDvo, /^dvo/);
      const cThis = first(/^this pvo/);
      const rows: { description: string; rfc: string; pvo: string; vo: string; dvo: string; pvoValue: number | null; dvoValue: number | null; thisOne: boolean }[] = [];
      const t = (r: number, c: number | undefined) => (c ? textOf(cellAt(sheet, r, c), null) : "");
      const n = (r: number, c: number | undefined) => {
        const v = t(r, c);
        return /^-?\d/.test(v) ? Math.round(Number(v) * 100) / 100 : null;
      };
      for (const r of rowNos.filter((x) => x > logHeader)) {
        const desc = t(r, cDesc);
        if (/^total/i.test(desc) || /^total/i.test(t(r, 1))) break;
        if (!desc) continue;
        if (/^original contract/i.test(desc)) {
          const ocv = n(r, cContract);
          if (ocv !== null) set("original_contract", String(ocv));
          continue;
        }
        if (/^this pvo/i.test(desc)) {
          // the workbook's own PVO: the last line of the log, under its own number
          const no = String(values.pvo_no ?? "").replace(/\D/g, "");
          const v = n(r, cThis) ?? n(r, cPvoVal);
          if (no && v !== null) rows.push({ description: desc.replace(/^this pvo\s*\/?\s*dvo\s*/i, "").replace(/^\((.*)\)$/, "$1").replace(/^PVO-?\d+\s*[–-]\s*/i, "") || String(values.title ?? ""), rfc: "", pvo: `PVO-${no.padStart(2, "0")}`, vo: `VO-${no.padStart(2, "0")}`, dvo: "", pvoValue: v, dvoValue: null, thisOne: false });
          continue;
        }
        rows.push({ description: desc, rfc: t(r, cRfc), pvo: t(r, cPvo), vo: t(r, cVo), dvo: t(r, cDvo), pvoValue: n(r, cPvoVal), dvoValue: n(r, cDvoVal), thisOne: false });
      }
      if (rows.length) {
        values.change_log_rows = JSON.stringify(rows);
        sources.change_log_rows = src;
      }
      // the contract's dates on the tab
      for (const r of rowNos.filter((x) => x < logHeader)) {
        const label = normLabel(t(r, 1));
        if (label === "contract completion date") set("original_completion", textOf(cellAt(sheet, r, 2), { kind: "date" } as PackField));
        if (label === "revised completion date") set("current_completion", textOf(cellAt(sheet, r, 2), { kind: "date" } as PackField));
      }
    }
    // the items table
    const header = rowNos.find((r) => {
      const t = sheet.rows.get(r)!.cells.map((c) => normLabel(c.text));
      return t.some((x) => /^(instruction )?reference$/.test(x)) && t.some((x) => x === "description") && t.some((x) => /^add( \(sar\))?$/.test(x));
    });
    if (header && type.fields.some((f) => f.key === "cost_items") && !values.cost_items) {
      const H = sheet.rows.get(header)!.cells;
      const col = (re: RegExp) => H.find((c) => re.test(normLabel(c.text)))?.c;
      const cRef = col(/^(instruction )?reference$/);
      const cDesc = col(/^description$/);
      const cOmit = col(/^omit( \(sar\))?$/);
      const cAdd = col(/^add( \(sar\))?$/);
      const rows: string[] = [];
      for (const r of rowNos) {
        if (r <= header) continue;
        const rc = sheet.rows.get(r)!.cells;
        if (rc.some((c) => /^sub-?total|^total value/i.test(c.text.trim()))) break;
        const desc = cDesc ? textOf(cellAt(sheet, r, cDesc), null) : "";
        if (!desc) continue;
        const n = (c: number | undefined) => (c ? num(textOf(cellAt(sheet, r, c), null)) ?? 0 : 0);
        rows.push(`${(cRef ? textOf(cellAt(sheet, r, cRef), null) : "") || rows.length + 1} – ${desc} – ${n(cOmit)} – ${n(cAdd)}`);
      }
      if (rows.length) set("cost_items", rows.join("\n"));
    }
    // the signatories
    const sigRows = rowNos.filter((r) => {
      const t = sheet.rows.get(r)!.cells.map((c) => normLabel(c.text));
      return t.includes("name") && t.includes("position") && t.includes("signature");
    });
    const people = new Map<string, { names: string[]; positions: string[] }>();
    for (const r of sigRows) {
      let section = "";
      for (let k = r - 1; k >= Math.max(1, r - 40) && !section; k--) {
        const t = sheet.rows.get(k)?.cells.map((c) => c.text.trim()).join(" ") ?? "";
        if (/prepared|initiated by/i.test(t)) section = "prepared";
        else if (/checked by|reviewed by/i.test(t)) section = "checked";
        else if (/approved and issued by/i.test(t)) section = "employer";
        else if (/received by/i.test(t)) section = "contractor";
        else if (/approved by|review & approval|review and approval/i.test(t)) section = "approved";
      }
      if (!section) continue;
      const rowCells = sheet.rows.get(r)!.cells;
      const nameC = rowCells.find((c) => normLabel(c.text) === "name")!.c;
      const posC = rowCells.find((c) => normLabel(c.text) === "position")!.c;
      const above = (c: number): string => {
        for (let k = r - 1; k >= Math.max(1, r - 4); k--) {
          const a = anchor(sheet, k, c);
          const cell = cellAt(sheet, a.r, a.c);
          if (cell && looksLikeLabel(type, cell.text)) return "";
          if (cell?.text.trim()) return cell.text.trim().replace(/\s+/g, " ");
        }
        return "";
      };
      const name = above(nameC);
      if (!name) continue;
      const entry = people.get(section) ?? { names: [], positions: [] };
      entry.names.push(name);
      entry.positions.push(above(posC));
      people.set(section, entry);
    }
    for (const [section, e] of people) {
      if (section === "employer" || section === "contractor") {
        set(`${section}_rep`, e.names[0]);
        set(`${section}_rep_position`, e.positions[0]);
      } else {
        set(`${section}_by`, e.names.join("\n"));
        set(`${section}_position`, e.positions.join("\n"));
      }
    }
    // b) the package budget position: one row of figures under its column headings (a code row between)
    const pkgHeader = rowNos.find((r) => {
      const t = sheet.rows.get(r)!.cells.map((c) => normLabel(c.text));
      return t.some((x) => /^remaining budget before this (pvo|vo)/.test(x)) && t.some((x) => /^approved ?\/? ?contract/.test(x));
    });
    if (pkgHeader) {
      const H = sheet.rows.get(pkgHeader)!.cells;
      const col = (re: RegExp) => H.find((c) => re.test(normLabel(c.text)))?.c;
      const cContract = col(/^approved ?\/? ?contract/);
      const cRemaining = col(/^remaining budget before/);
      const cBudget = col(/^current approved budget/);
      for (const r of rowNos.filter((x) => x > pkgHeader && x <= pkgHeader + 4)) {
        const v = cContract ? textOf(cellAt(sheet, r, cContract), null) : "";
        if (!/^-?\d/.test(v)) continue;
        set("approved_contract", v);
        if (cRemaining) set("remaining_budget", textOf(cellAt(sheet, r, cRemaining), null));
        if (cBudget) set("acc_budget", textOf(cellAt(sheet, r, cBudget), null));
        break;
      }
    }
    // the budget transfer table: a From row with a control account means a transfer (option B), else option A
    const trHeader = rowNos.find((r) => {
      const t = sheet.rows.get(r)!.cells.map((c) => normLabel(c.text));
      return t.some((x) => x === "control account") && t.some((x) => x === "transfer amount");
    });
    if (trHeader) {
      const H = sheet.rows.get(trHeader)!.cells;
      const col = (re: RegExp) => H.find((c) => re.test(normLabel(c.text)))?.c;
      const cAcc = col(/^control account$/);
      const cCur = col(/^current budget$/);
      for (const r of rowNos.filter((x) => x > trHeader && x <= trHeader + 4)) {
        const first = sheet.rows.get(r)!.cells.find((c) => c.text.trim())?.text.trim().toLowerCase();
        const acc = cAcc ? textOf(cellAt(sheet, r, cAcc), null) : "";
        if (first === "from" && /^1TB\d{5}\./.test(acc)) {
          set("budget_line", acc);
          set("budget_available", cCur ? textOf(cellAt(sheet, r, cCur), null) : "");
          set("budget_source", "B) Budget Transfer Required");
        } else if (first === "to" && /^1TB\d{5}\./.test(acc)) set("budget_to_line", acc);
      }
      if (!values.budget_source) set("budget_source", "A) No Additional Budget or Budget Transfer Required");
    }
    // with no transfer, the budget available is the package's own approved budget
    if (!values.budget_available && values.acc_budget) set("budget_available", values.acc_budget);
    delete values.acc_budget;
    delete sources.acc_budget;
    // the label cells
    for (const cell of cells) {
      const label = cell.text.replace(/\s+/g, " ").trim();
      if (!label || label.length > 90 || headerRows.has(cell.r)) continue;
      if (/^(name|position|signature|date|from|to)$/i.test(label) || /^(prepared|checked|reviewed|recommended|initiated) by|^approved (by|and issued by)|^review (&|and) approval|^(prepared|initiated)\/|by:$/i.test(label)) continue;
      const f = fieldForLabel(type, label);
      if (!f || values[f.key] || ["change_log", "acc_table", "rom_basis"].includes(f.key)) continue;
      let right = { r: cell.r, c: rightOf(sheet, cell.r, cell.c) };
      const code = cellAt(sheet, right.r, right.c);
      if (code && /^[A-H](\s*=\s*[A-H+\-\s]+)?$/i.test(code.text.trim())) right = { r: right.r, c: rightOf(sheet, right.r, right.c) };
      const under = { r: below(sheet, cell.r, cell.c), c: cell.c };
      const ra = anchor(sheet, right.r, right.c);
      const ua = anchor(sheet, under.r, under.c);
      const rightCell = cellAt(sheet, ra.r, ra.c);
      const underCell = cellAt(sheet, ua.r, ua.c);
      const okCell = (x: XCell | undefined) => !!x && !looksLikeLabel(type, x.text);
      let target: XCell | undefined;
      if (okCell(rightCell)) target = rightCell;
      else if ((f.kind === "long" || (rightCell && looksLikeLabel(type, rightCell.text))) && okCell(underCell)) target = underCell;
      if (!target) continue;
      const v = textOf(target, f);
      if (!looksLikeLabel(type, v)) set(f.key, v);
    }
  }
  return { values, sources };
}

/* ------------------------------------------------------------------ */
/* writing the cells back                                              */

function cellXml(ref: string, style: string, value: string | number | { formula: string | null }): string {
  if (typeof value === "object") return (value.formula ?? "").replace(/\br="[A-Z]+\d+"/, `r="${ref}"`) || `<c r="${ref}"/>`;
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
